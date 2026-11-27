import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isAppError } from '@/core/errors/app-error'
import { fileIssue, namePastedFile } from '@/domain/attachments'
import { heldImageSources, replaceHeldImages } from '@/domain/markdown-doc'
import { notify } from '@/presentation/components'
import type { RichTextUpload, UploadSource } from '@/presentation/components/rich-text'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { compressImage } from './image-compress'
import { useAttachmentMutations, useFieldFileUpload } from './queries'

export interface PendingUpload {
  key: string
  name: string
  /** Código de erro (validation.*) ou mensagem já traduzida; ausente = enviando. */
  error?: string
}

let uploadSeq = 0

/**
 * Envio de arquivos (anexos da tarefa, arquivos do elemento do quadro): pré-checagem no navegador,
 * compressão de fotos grandes e um arquivo por requisição. Os erros ficam por arquivo.
 */
export function useFileUploader<O>(upload: (file: File, options?: O) => Promise<unknown>) {
  const errorMessage = useErrorMessage()
  const [pending, setPending] = useState<PendingUpload[]>([])

  /** Envia e devolve quantos arquivos foram aceitos. */
  async function send(files: File[], options?: O): Promise<number> {
    let sent = 0
    for (const original of files) {
      const key = `u${++uploadSeq}`
      const issue = fileIssue(original)
      if (issue) {
        setPending((p) => [...p, { key, name: original.name, error: issue }])
        continue
      }
      setPending((p) => [...p, { key, name: original.name }])
      try {
        const file = original.type.startsWith('image/') ? await compressImage(original) : original
        await upload(file, options)
        sent++
        setPending((p) => p.filter((item) => item.key !== key))
      } catch (error) {
        const code = isAppError(error) && error.code === 'VALIDATION_ERROR' ? (error.fieldErrors().files ?? 'invalid_file') : errorMessage(error)
        setPending((p) => p.map((item) => (item.key === key ? { ...item, error: code } : item)))
      }
    }
    return sent
  }

  const dismiss = (key: string) => setPending((p) => p.filter((item) => item.key !== key))

  return { pending, send, dismiss, uploading: pending.some((p) => !p.error) }
}

/** Anexos da tarefa (aba Anexos e comentários). */
export function useAttachmentUploader(taskId: string) {
  const { upload } = useAttachmentMutations(taskId)
  return useFileUploader<{ commentId?: string; field?: string }>((file, options) => upload.mutateAsync({ file, ...options }))
}

/** Resultado do envio a um campo: ids dos anexos aceitos e, por arquivo recusado, o motivo já traduzido. */
export interface FieldUploadResult {
  ids: string[]
  failed: Array<{ name: string; reason: string }>
}

/**
 * Envia arquivos a um campo de imagem/arquivo de uma tarefa (o anexo já fica ligado ao campo):
 * pré-checagem no navegador (`imagesOnly` nos campos de imagem), compressão de fotos grandes e um
 * arquivo por requisição. Não avisa nada: devolve os aceitos e os recusados com o motivo.
 */
export function useFieldFilesSender() {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { mutateAsync } = useFieldFileUpload()
  return useCallback(
    async (taskId: string, files: File[], field: string, imagesOnly = false): Promise<FieldUploadResult> => {
      const result: FieldUploadResult = { ids: [], failed: [] }
      for (const original of files) {
        const issue = fileIssue(original, imagesOnly)
        if (issue) {
          result.failed.push({ name: original.name, reason: t(`validation.${issue}`, { defaultValue: issue }) })
          continue
        }
        try {
          const file = original.type.startsWith('image/') ? await compressImage(original) : original
          const saved = await mutateAsync({ taskId, file, field })
          saved.forEach((attachment) => result.ids.push(attachment.id))
        } catch (error) {
          const code = isAppError(error) && error.code === 'VALIDATION_ERROR' ? error.fieldErrors().files : undefined
          result.failed.push({ name: original.name, reason: code ? t(`validation.${code}`, { defaultValue: code }) : errorMessage(error) })
        }
      }
      return result
    },
    [mutateAsync, t, errorMessage],
  )
}

/**
 * Envio direto no campo de imagem/arquivo da tarefa já criada (edição e "Preencha para mover"): o
 * arquivo vira anexo já ligado ao campo — sem precisar passar pela aba Anexos. Devolve os ids aceitos;
 * os recusados aparecem num aviso com o motivo.
 */
export function useFieldAttachmentUpload(taskId: string) {
  const send = useFieldFilesSender()
  return useCallback(
    async (files: File[], field: string, imagesOnly = false): Promise<string[]> => {
      const { ids, failed } = await send(taskId, files, field, imagesOnly)
      failed.forEach((item) => notify.error(`${item.name}: ${item.reason}`))
      return ids
    },
    [send, taskId],
  )
}

/**
 * Arquivos dos campos de imagem/arquivo na criação da tarefa: ficam no formulário (pré-checados,
 * imagem só em campo de imagem) e são enviados logo depois de criar. O que a pré-checagem recusa
 * aparece num aviso com o motivo e não entra na lista.
 */
export function useHeldFieldFiles() {
  const { t } = useTranslation()
  const [files, setFiles] = useState<Record<string, File[]>>({})

  const add = useCallback(
    (field: string, chosen: File[], imagesOnly: boolean) => {
      const accepted = chosen.filter((file) => {
        const issue = fileIssue(file, imagesOnly)
        if (issue) notify.error(t('attachments.rejected', { name: file.name, reason: t(`validation.${issue}`) }))
        return !issue
      })
      if (accepted.length > 0) setFiles((current) => ({ ...current, [field]: [...(current[field] ?? []), ...accepted] }))
    },
    [t],
  )
  const remove = useCallback((field: string, index: number) => setFiles((current) => ({ ...current, [field]: (current[field] ?? []).filter((_, i) => i !== index) })), [])

  return useMemo(() => ({ files, add, remove }), [files, add, remove])
}

/** Imagem colada ganha nome legível ("imagem-colada-…"); escolhida ou solta fica com o nome dela. */
function nameImages(files: File[], source: UploadSource, prefix: string): File[] {
  const now = new Date()
  return source === 'paste' ? files.map((file, index) => namePastedFile(file, prefix, now, index)) : files
}

/**
 * Imagens no texto (comentário ou descrição, §53) da tarefa que já existe: cada uma vira anexo da
 * tarefa (aparece em "Anexos") e entra no texto como `![nome](/api/v1/attachments/<id>/file)`. O que a
 * pré-checagem ou o servidor recusa aparece num aviso com o motivo.
 */
export function useTextImageUpload(taskId: string) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { mutateAsync } = useFieldFileUpload()
  return useCallback(
    async (files: File[], source: UploadSource): Promise<RichTextUpload[]> => {
      const uploaded: RichTextUpload[] = []
      for (const original of nameImages(files, source, t('attachments.pastedName'))) {
        const issue = fileIssue(original, true)
        if (issue) {
          notify.error(t('attachments.rejected', { name: original.name, reason: t(`validation.${issue}`) }))
          continue
        }
        try {
          const saved = await mutateAsync({ taskId, file: await compressImage(original) })
          saved.forEach((attachment) => uploaded.push({ url: attachment.url, name: attachment.name, kind: 'image' }))
        } catch (error) {
          const code = isAppError(error) && error.code === 'VALIDATION_ERROR' ? error.fieldErrors().files : undefined
          notify.error(t('attachments.rejected', { name: original.name, reason: code ? t(`validation.${code}`, { defaultValue: code }) : errorMessage(error) }))
        }
      }
      return uploaded
    },
    [mutateAsync, t, errorMessage, taskId],
  )
}

/**
 * Imagens no texto da tarefa que ainda não existe (criação, §53): ficam no navegador com um endereço
 * provisório (`blob:`) e, depois de criar, sobem como anexos; o texto é então atualizado com os
 * endereços definitivos (`send`). `strip` tira as provisórias do texto que vai na criação.
 */
export function useHeldTextImages() {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { mutateAsync } = useFieldFileUpload()
  const held = useRef(new Map<string, File>())

  // os endereços provisórios liberam a memória quando o formulário fecha
  useEffect(() => {
    const files = held.current
    return () => {
      files.forEach((_file, url) => URL.revokeObjectURL(url))
      files.clear()
    }
  }, [])

  const hold = useCallback(
    async (files: File[], source: UploadSource): Promise<RichTextUpload[]> =>
      nameImages(files, source, t('attachments.pastedName')).flatMap((file) => {
        const issue = fileIssue(file, true)
        if (issue) {
          notify.error(t('attachments.rejected', { name: file.name, reason: t(`validation.${issue}`) }))
          return []
        }
        const url = URL.createObjectURL(file)
        held.current.set(url, file)
        return [{ url, name: file.name, kind: 'image' as const }]
      }),
    [t],
  )

  /** Texto para criar a tarefa: sem as imagens provisórias (ainda não há para onde apontar). */
  const strip = useCallback((markdown: string) => (heldImageSources(markdown).length ? replaceHeldImages(markdown, () => null) : markdown), [])

  /**
   * Depois de criar: envia as imagens retidas que ficaram no texto e devolve o texto com os endereços
   * definitivos (`null` = não havia imagem retida; nada a atualizar) e os nomes que não subiram.
   */
  const send = useCallback(
    async (taskId: string, markdown: string): Promise<{ markdown: string | null; failed: string[] }> => {
      const sources = heldImageSources(markdown).filter((src) => held.current.has(src))
      if (sources.length === 0) return { markdown: null, failed: [] }
      const urls = new Map<string, string>()
      const failed: string[] = []
      for (const src of sources) {
        const file = held.current.get(src) as File
        try {
          const saved = await mutateAsync({ taskId, file: await compressImage(file) })
          if (saved[0]) urls.set(src, saved[0].url)
        } catch (error) {
          const code = isAppError(error) && error.code === 'VALIDATION_ERROR' ? error.fieldErrors().files : undefined
          failed.push(`${file.name} (${code ? t(`validation.${code}`, { defaultValue: code }) : errorMessage(error)})`)
        }
      }
      return { markdown: replaceHeldImages(markdown, (src) => urls.get(src) ?? null), failed }
    },
    [mutateAsync, t, errorMessage],
  )

  return useMemo(() => ({ hold, strip, send }), [hold, strip, send])
}
