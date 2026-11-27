import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import { useTranslation } from 'react-i18next'
import { cn } from '@/core/utils/cn'
import { normalizeDocHref } from '@/domain/docs'
import { createMarkdownCodec, isTaskImageSrc, safeTaskHref, taskMarkdown, TASK_MARKDOWN_OPTIONS, type MarkdownCodec } from '@/domain/markdown-doc'
import type { MentionPerson } from '@/domain/tasks'
import { AppFormField } from '../AppFormField'
import type { RichTextUpload } from './AppRichTextEditor'
import { markdownInsertCommands, type UploadKind } from './block-commands'
import { markdownExtensions } from './extensions'
import { setMentionPeople } from './mention'
import { LinkDialog, Toolbar } from './Toolbar'

export interface AppMarkdownEditorProps {
  /** Markdown inicial (o editor é não controlado: troque a `key` para recarregar, ex.: depois de enviar). */
  defaultValue: string
  onChange: (markdown: string) => void
  label: string
  placeholder?: string
  hint?: ReactNode
  /** Código de erro (validation.*) ou mensagem já traduzida. */
  error?: string
  required?: boolean
  disabled?: boolean
  /** Foca ao montar (ex.: ao abrir a edição de um comentário). */
  focusOnMount?: boolean
  /** Ctrl/⌘+Enter. */
  onSubmit?: () => void
  /** Com pessoas, o "@" abre a lista de menções (gravadas como `@[Nome](id)`). */
  people?: MentionPerson[]
  /** Envia imagens (botão, colar, arrastar) e devolve os endereços; sem isso, a barra não oferece imagem. */
  onUpload?: (files: File[]) => Promise<RichTextUpload[]>
  /** Outros arquivos colados/soltos no campo (ex.: viram anexos do comentário). */
  onAttach?: (files: File[]) => void
  /** Aceita imagens com endereço provisório (`blob:`), retidas até a tarefa existir. */
  heldImages?: boolean
  className?: string
}

const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp'
const isImage = (file: File) => file.type.startsWith('image/')

/** Links das tarefas: completa o que se digitou e aceita só http(s). */
const normalizeTaskHref = (input: string) => {
  const value = normalizeDocHref(input)
  return value && safeTaskHref(value)
}

/** Imagens retidas na criação: o endereço `blob:` vale até a tarefa existir e o arquivo subir. */
const heldCodec: MarkdownCodec = createMarkdownCodec({ ...TASK_MARKDOWN_OPTIONS, isImageSrc: (src) => isTaskImageSrc(src) || src.startsWith('blob:') })

/**
 * Editor dos comentários e descrições das tarefas (§53): a mesma barra da Documentação (deshacer,
 * títulos, negrito… tabela e "Inserir"), com os atalhos de Markdown (`- `, `1. `, `## `, `**x**`).
 * Recebe e devolve **Markdown** (`domain/markdown-doc.ts`): o modelo de dados não muda e o servidor
 * continua lendo as menções `@[Nome](id)`.
 */
export function AppMarkdownEditor(props: AppMarkdownEditorProps) {
  return (
    <AppFormField label={props.label} hint={props.hint} error={props.error} required={props.required} className={props.className}>
      {({ id, describedBy, invalid }) => <MarkdownEditorBody {...props} id={id} describedBy={describedBy} invalid={invalid} />}
    </AppFormField>
  )
}

interface BodyProps extends AppMarkdownEditorProps {
  id: string
  describedBy: string | undefined
  invalid: boolean
}

function MarkdownEditorBody({ defaultValue, onChange, label, placeholder, required, disabled, focusOnMount, onSubmit, people, onUpload, onAttach, heldImages, id, describedBy, invalid }: BodyProps) {
  const { t } = useTranslation()
  const codec = heldImages ? heldCodec : taskMarkdown
  const [uploading, setUploading] = useState(0)
  const [linkOpen, setLinkOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // as extensões são criadas uma vez: leem sempre a versão atual por refs
  const latest = useRef({ onChange, onSubmit, onUpload, onAttach })
  useEffect(() => {
    latest.current = { onChange, onSubmit, onUpload, onAttach }
  })
  const withMention = !!people
  const extensions = useMemo(() => markdownExtensions({ placeholder: placeholder ?? '', mention: withMention }), [placeholder, withMention])
  const insertCommands = useMemo(() => markdownInsertCommands(withMention), [withMention])
  const insertFilesRef = useRef<(files: File[], pos?: number) => Promise<void>>(async () => undefined)

  const editor = useEditor(
    {
      extensions,
      content: codec.toDoc(defaultValue),
      editable: !disabled,
      autofocus: focusOnMount ? 'end' : false,
      editorProps: {
        attributes: {
          id,
          class: 'kb-rich kb-rich-compact min-h-[130px] px-3 py-2 focus:outline-none',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': label,
          ...(describedBy ? { 'aria-describedby': describedBy } : {}),
          ...(invalid ? { 'aria-invalid': 'true' } : {}),
          ...(required ? { 'aria-required': 'true' } : {}),
        },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? [])
          // texto copiado continua colando como texto (o Excel, por exemplo, manda junto uma imagem da seleção)
          if (!files.length || event.clipboardData?.getData('text/plain')) return false
          void insertFilesRef.current(files)
          return true
        },
        handleDrop: (view, event, _slice, moved) => {
          const files = Array.from(event.dataTransfer?.files ?? [])
          if (moved || !files.length) return false
          event.preventDefault()
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
          void insertFilesRef.current(files, pos)
          return true
        },
        handleKeyDown: (_view, event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && latest.current.onSubmit) {
            event.preventDefault()
            latest.current.onSubmit()
            return true
          }
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault()
            setLinkOpen(true)
            return true
          }
          return false
        },
      },
      onUpdate: ({ editor: current }) => {
        latest.current.onChange(codec.toMarkdown(current.getJSON()))
      },
    },
    [extensions],
  )

  useEffect(() => {
    editor.setEditable(!disabled)
  }, [editor, disabled])

  // a lista do "@" lê as pessoas daqui (podem chegar depois de o editor abrir)
  useEffect(() => {
    if (withMention) setMentionPeople(editor, people ?? [])
  }, [editor, people, withMention])

  useEffect(() => {
    insertFilesRef.current = async (files, pos) => {
      const images = files.filter(isImage)
      const others = files.filter((file) => !isImage(file))
      if (others.length) latest.current.onAttach?.(others)
      const upload = latest.current.onUpload
      if (!upload || !images.length) return
      setUploading((n) => n + 1)
      try {
        const uploaded = await upload(images)
        const content = uploaded.filter((file) => file.kind === 'image').map((file) => ({ type: 'image', attrs: { src: file.url, alt: file.name } }))
        if (!content.length || editor.isDestroyed) return
        const chain = editor.chain().focus()
        void (pos === undefined ? chain.insertContent(content) : chain.insertContentAt(pos, content)).run()
        // imagem no fim do bloco fica selecionada — o próximo bloco a substituiria; abre uma linha depois dela
        if (editor.state.selection instanceof NodeSelection) editor.commands.createParagraphNear()
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }, [editor])

  const requestUpload = (_kind: UploadKind) => {
    // o seletor só abre com o atributo accept já aplicado
    requestAnimationFrame(() => fileRef.current?.click())
  }

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-xs',
        'hover:border-border-strong focus-within:border-primary focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-ring',
        invalid && 'border-danger',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <Toolbar
        editor={editor}
        insertCommands={insertCommands}
        cellTools={false}
        uploading={uploading > 0}
        canUpload={!!onUpload}
        onRequestUpload={requestUpload}
        onLink={() => setLinkOpen(true)}
      />
      <EditorContent editor={editor} className="max-h-[24rem] min-w-0 overflow-y-auto" />
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        accept={IMAGE_TYPES}
        aria-label={t('richText.blocks.image.label')}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          void insertFilesRef.current(files)
        }}
      />
      <LinkDialog editor={editor} open={linkOpen} onOpenChange={setLinkOpen} normalize={normalizeTaskHref} />
    </div>
  )
}
