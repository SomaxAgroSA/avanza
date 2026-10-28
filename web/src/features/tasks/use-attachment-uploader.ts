import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isAppError } from '@/core/errors/app-error'
import { fileIssue } from '@/domain/attachments'
import { notify } from '@/presentation/components'
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
