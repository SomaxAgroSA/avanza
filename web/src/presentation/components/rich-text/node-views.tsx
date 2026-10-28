import { NodeViewContent, NodeViewWrapper, useEditorState, type NodeViewProps } from '@tiptap/react'
import { useTranslation } from 'react-i18next'
import { Heading2, ListTree } from 'lucide-react'
import { CALLOUT_TONES, type CalloutTone } from '@/domain/docs'
import { cn } from '@/core/utils/cn'
import { CALLOUT_ICONS, toneOf } from './callout-icons'

/* Visualização (React) dos nós próprios do editor — ver nodes.ts. */

/** Fundo e borda suaves do tom; o ícone (solto ou no botão de trocar o tom) na cor forte. */
const CALLOUT_CLASSES: Record<CalloutTone, string> = {
  info: 'border-info-soft-fg/30 bg-info-soft [&>button]:text-info-soft-fg [&>svg]:text-info-soft-fg',
  success: 'border-success-soft-fg/30 bg-success-soft [&>button]:text-success-soft-fg [&>svg]:text-success-soft-fg',
  warning: 'border-warning-soft-fg/30 bg-warning-soft [&>button]:text-warning-soft-fg [&>svg]:text-warning-soft-fg',
  danger: 'border-danger-soft-fg/30 bg-danger-soft [&>button]:text-danger-soft-fg [&>svg]:text-danger-soft-fg',
}

export function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const { t } = useTranslation()
  const tone = toneOf(node.attrs.tone)
  const Icon = CALLOUT_ICONS[tone]
  const next = CALLOUT_TONES[(CALLOUT_TONES.indexOf(tone) + 1) % CALLOUT_TONES.length]
  return (
    <NodeViewWrapper
      data-callout={tone}
      role="note"
      aria-label={t(`richText.callout.${tone}`)}
      className={cn('my-3 flex gap-3 rounded-lg border px-4 py-3', CALLOUT_CLASSES[tone])}
    >
      {editor.isEditable ? (
        <button
          type="button"
          contentEditable={false}
          onClick={() => updateAttributes({ tone: next })}
          aria-label={t('richText.callout.change', { tone: t(`richText.callout.${next}`) })}
          title={t('richText.callout.change', { tone: t(`richText.callout.${next}`) })}
          className="mt-1 h-fit shrink-0 rounded-md p-0.5 hover:bg-surface/60 [&_svg]:size-4.5"
        >
          <Icon aria-hidden />
        </button>
      ) : (
        <Icon aria-hidden className="mt-1.5 size-4.5 shrink-0" />
      )}
      <NodeViewContent className="min-w-0 flex-1 [&>*+*]:mt-2" />
    </NodeViewWrapper>
  )
}

interface OutlineEntry {
  level: number
  text: string
}

/** Títulos do documento, direto do estado do editor (acompanha cada edição). */
function outlineOf(editor: NodeViewProps['editor']): OutlineEntry[] {
  const out: OutlineEntry[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'heading') {
      out.push({ level: Number(node.attrs.level) || 2, text: node.textContent.trim() })
      return false
    }
    return true
  })
  return out
}

/**
 * Sumário: não tem conteúdo próprio — lista sozinho os títulos (Título 1 a 4) da página e se
 * atualiza a cada edição. Sem títulos, na edição explica como criar um (e oferece o atalho); na
 * leitura some.
 */
export function TableOfContentsView({ editor, node, getPos, selected }: NodeViewProps) {
  const { t } = useTranslation()
  const items = useEditorState({ editor, selector: ({ editor: current }) => outlineOf(current) })
  const editing = useEditorState({ editor, selector: ({ editor: current }) => current.isEditable })
  const jump = (index: number) => {
    const target = editor.view.dom.querySelectorAll('h1, h2, h3, h4')[index]
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  /** Cria um Título 2 logo abaixo do sumário, com o cursor nele. */
  const addHeading = () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    const after = pos + node.nodeSize
    editor
      .chain()
      .focus()
      .insertContentAt(after, { type: 'heading', attrs: { level: 2 } })
      .setTextSelection(after + 1)
      .run()
  }
  if (items.length === 0 && !editing) return <NodeViewWrapper data-toc="" className="hidden" />
  return (
    <NodeViewWrapper
      contentEditable={false}
      data-toc=""
      className={cn('my-3 rounded-lg border border-border bg-surface-2/60 px-4 py-3', selected && editing && 'outline-2 outline-ring')}
    >
      <nav aria-label={t('richText.toc.title')}>
        <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-subtle">
          <ListTree aria-hidden className="size-3.5" />
          {t('richText.toc.title')}
        </p>
        {items.length === 0 ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted">{t('richText.toc.empty')}</p>
            <button
              type="button"
              onClick={addHeading}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg hover:bg-surface-2"
            >
              <Heading2 aria-hidden className="size-3.5" />
              {t('richText.toc.addHeading')}
            </button>
          </div>
        ) : (
          <ol className="list-none space-y-0.5 pl-0 text-sm">
            {items.map((item, index) => (
              <li key={index} style={{ paddingLeft: `${(item.level - 1) * 0.875}rem` }}>
                <button type="button" onClick={() => jump(index)} className="text-left text-primary-text hover:underline">
                  {item.text || t('richText.toc.untitled')}
                </button>
              </li>
            ))}
          </ol>
        )}
        {editing && items.length > 0 && <p className="mt-2 text-xs text-subtle">{t('richText.toc.auto')}</p>}
      </nav>
    </NodeViewWrapper>
  )
}
