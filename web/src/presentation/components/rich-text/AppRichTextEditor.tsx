import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import { useTranslation } from 'react-i18next'
import type { RichContent } from '@/domain/docs'
import { cn } from '@/core/utils/cn'
import { BLOCK_COMMANDS, type UploadKind } from './block-commands'
import { richTextExtensions } from './extensions'
import { LinkDialog, Toolbar } from './Toolbar'

/** O "Inserir" da Documentação: todos os blocos do "/", menos parágrafo e títulos (já estão na barra). */
const DOC_INSERT = BLOCK_COMMANDS.filter((c) => !['paragraph', 'heading1', 'heading2', 'heading3'].includes(c.key))

export interface RichTextUpload {
  url: string
  name: string
  kind: 'image' | 'document'
}

export interface AppRichTextEditorProps {
  /** Conteúdo inicial (o editor é não controlado; troque a `key` para recarregar). */
  defaultValue: RichContent
  onChange: (value: RichContent) => void
  /** Envia arquivos (seletor, colar ou arrastar) e devolve os endereços; imagens entram no texto, demais viram link. */
  onUpload?: (files: File[]) => Promise<RichTextUpload[]>
  /** Nome acessível da área de edição. */
  label: string
  placeholder?: string
  className?: string
}

/** Ações que as extensões (criadas uma vez) chamam — sempre a versão atual, via ref. */
interface EditorActions {
  requestUpload: (kind: UploadKind) => void
  insertFiles: (files: File[], pos?: number) => Promise<void>
  openLink: () => void
}

/**
 * Editor de documentos (estilo Confluence): títulos, listas, tarefas, citações, código,
 * destaques, tabelas, imagens, anexos, sumário e menu "/". Grava JSON estruturado — o servidor
 * higieniza tudo (nada de HTML cru). Colar ou arrastar imagens envia pelo `onUpload`.
 */
export function AppRichTextEditor({ defaultValue, onChange, onUpload, label, placeholder, className }: AppRichTextEditorProps) {
  const { t } = useTranslation()
  const [uploading, setUploading] = useState(0)
  const [linkOpen, setLinkOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [accept, setAccept] = useState<UploadKind>('image')
  const onChangeRef = useRef(onChange)
  const onUploadRef = useRef(onUpload)
  const actionsRef = useRef<EditorActions>({ requestUpload: () => undefined, insertFiles: async () => undefined, openLink: () => undefined })
  useEffect(() => {
    onChangeRef.current = onChange
    onUploadRef.current = onUpload
  })

  const editor = useEditor({
    extensions: richTextExtensions({
      editing: {
        placeholder: placeholder ?? t('richText.placeholder'),
        slash: { label: (key) => t(`richText.blocks.${key}.label`), context: () => ({ requestUpload: (kind) => actionsRef.current.requestUpload(kind) }) },
      },
    }),
    content: defaultValue,
    editorProps: {
      attributes: {
        class: 'kb-rich min-h-[50vh] px-4 py-5 sm:px-8',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? [])
        if (!files.length || !onUploadRef.current) return false
        void actionsRef.current.insertFiles(files)
        return true
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = Array.from(event.dataTransfer?.files ?? [])
        if (moved || !files.length || !onUploadRef.current) return false
        event.preventDefault()
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        void actionsRef.current.insertFiles(files, pos)
        return true
      },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault()
          actionsRef.current.openLink()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: current }) => onChangeRef.current(current.getJSON() as RichContent),
  })

  useEffect(() => {
    actionsRef.current = {
      requestUpload: (kind) => {
        setAccept(kind)
        // o atributo accept precisa estar aplicado antes de abrir o seletor
        requestAnimationFrame(() => fileRef.current?.click())
      },
      insertFiles: async (files, pos) => {
        const upload = onUploadRef.current
        if (!upload || !files.length) return
        setUploading((n) => n + 1)
        try {
          const uploaded = await upload(files)
          const content = uploaded.map((file) =>
            file.kind === 'image'
              ? { type: 'image', attrs: { src: file.url, alt: file.name } }
              : { type: 'paragraph', content: [{ type: 'text', text: file.name, marks: [{ type: 'link', attrs: { href: file.url } }] }] },
          )
          if (!content.length) return
          const chain = editor.chain().focus()
          void (pos === undefined ? chain.insertContent(content) : chain.insertContentAt(pos, content)).run()
          // imagem no fim do bloco fica selecionada — o próximo bloco a substituiria; abre uma linha depois dela
          if (editor.state.selection instanceof NodeSelection) editor.commands.createParagraphNear()
        } finally {
          setUploading((n) => n - 1)
        }
      },
      openLink: () => setLinkOpen(true),
    }
  }, [editor])

  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <Toolbar editor={editor} insertCommands={DOC_INSERT} uploading={uploading > 0} canUpload={!!onUpload} onRequestUpload={(kind) => actionsRef.current.requestUpload(kind)} onLink={() => setLinkOpen(true)} />
      <EditorContent editor={editor} className="min-w-0" />
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        accept={accept === 'image' ? 'image/png,image/jpeg,image/gif,image/webp' : undefined}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          void actionsRef.current.insertFiles(files)
        }}
      />
      <LinkDialog editor={editor} open={linkOpen} onOpenChange={setLinkOpen} />
    </div>
  )
}
