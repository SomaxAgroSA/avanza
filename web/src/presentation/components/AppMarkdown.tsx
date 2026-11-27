import { useMemo, type ReactNode } from 'react'
import { cn } from '@/core/utils/cn'
import type { RichContent } from '@/domain/docs'
import { isTaskImageSrc, safeTaskHref, taskMarkdown } from '@/domain/markdown-doc'

/**
 * Markdown seguro dos comentários e descrições (§53), com a mesma aparência da Documentação
 * (`kb-rich`): títulos, **negrito**, *itálico*, <u>sublinhado</u>, ~~riscado~~, ==destaque==, `código`,
 * links, listas (também de verificação, só leitura), citação, bloco de código, separador, tabelas,
 * imagens dos anexos e menções `@[Nome](id)`. O texto é lido pelo mesmo conversor do editor
 * (`domain/markdown-doc.ts`); textos antigos continuam iguais (nova linha simples = quebra de linha).
 *
 * Nunca usa HTML cru (sem dangerouslySetInnerHTML): o documento vira elementos React; links só http(s)
 * e imagens só dos anexos da tarefa (`/api/v1/attachments/<id>/file`) e da Documentação.
 */
export interface AppMarkdownProps {
  text: string
  className?: string
  /** Como exibir uma menção (padrão: "@Nome" destacado). */
  renderMention?: (name: string, id: string, key: string) => ReactNode
}

function defaultMention(name: string, _id: string, key: string) {
  return (
    <span key={key} className="rounded bg-primary-soft px-1 font-medium text-primary-soft-fg">
      @{name}
    </span>
  )
}

type MentionRenderer = NonNullable<AppMarkdownProps['renderMention']>

const children = (node: RichContent) => node.content ?? []

const plain = (node: RichContent): string =>
  node.type === 'text' ? (node.text ?? '') : node.type === 'mention' ? `@${String(node.attrs?.label ?? '')}` : children(node).map(plain).join('')

/** Texto com as marcas, de fora para dentro (link por fora, código por dentro). */
function textNode(node: RichContent, key: string): ReactNode {
  const marks = node.marks ?? []
  if (!marks.length) return node.text ?? ''
  let out: ReactNode = node.text ?? ''
  ;[...marks].reverse().forEach((mark) => {
    if (mark.type === 'code') out = <code>{out}</code>
    else if (mark.type === 'bold') out = <strong>{out}</strong>
    else if (mark.type === 'italic') out = <em>{out}</em>
    else if (mark.type === 'underline') out = <u>{out}</u>
    else if (mark.type === 'strike') out = <del>{out}</del>
    else if (mark.type === 'highlight') out = <mark>{out}</mark>
    else if (mark.type === 'link') {
      const href = safeTaskHref(String(mark.attrs?.href ?? ''))
      if (href)
        out = (
          <a href={href} target="_blank" rel="noopener noreferrer" className="break-words">
            {out}
          </a>
        )
    }
  })
  return <span key={key}>{out}</span>
}

function inline(nodes: RichContent[], mention: MentionRenderer, prefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${prefix}-${index}`
    if (node.type === 'hardBreak') return <br key={key} />
    if (node.type === 'mention') return mention(String(node.attrs?.label ?? ''), String(node.attrs?.id ?? ''), key)
    return textNode(node, key)
  })
}

function block(node: RichContent, mention: MentionRenderer, key: string): ReactNode {
  const kids = () => children(node).map((child, index) => block(child, mention, `${key}-${index}`))
  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{inline(children(node), mention, key)}</p>
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 4)
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4'
      return <Tag key={key}>{inline(children(node), mention, key)}</Tag>
    }
    case 'bulletList':
      return <ul key={key}>{kids()}</ul>
    case 'orderedList': {
      const start = Number(node.attrs?.start) || 1
      return (
        <ol key={key} start={start === 1 ? undefined : start}>
          {kids()}
        </ol>
      )
    }
    case 'listItem':
      return <li key={key}>{kids()}</li>
    case 'taskList':
      return (
        <ul key={key} data-type="taskList">
          {kids()}
        </ul>
      )
    case 'taskItem': {
      const checked = !!node.attrs?.checked
      // casinha só de leitura: marca-se editando o texto
      return (
        <li key={key} data-checked={checked}>
          <label>
            <input type="checkbox" checked={checked} readOnly disabled aria-label={plain(node)} />
          </label>
          <div>{kids()}</div>
        </li>
      )
    }
    case 'blockquote':
      return <blockquote key={key}>{kids()}</blockquote>
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{plain(node)}</code>
        </pre>
      )
    case 'horizontalRule':
      return <hr key={key} />
    case 'image': {
      const src = String(node.attrs?.src ?? '')
      if (!isTaskImageSrc(src)) return null
      const width = Number(node.attrs?.width) || null
      const title = node.attrs?.title ? String(node.attrs.title) : undefined
      return <img key={key} src={src} alt={String(node.attrs?.alt ?? '')} title={title} loading="lazy" style={width ? { width: `${width}%` } : undefined} />
    }
    case 'table':
      return (
        <div key={key} className="tableWrapper">
          <table>
            <tbody>{kids()}</tbody>
          </table>
        </div>
      )
    case 'tableRow':
      return <tr key={key}>{kids()}</tr>
    case 'tableHeader':
      return <th key={key}>{kids()}</th>
    case 'tableCell':
      return <td key={key}>{kids()}</td>
    default:
      return children(node).length ? <div key={key}>{kids()}</div> : null
  }
}

export function AppMarkdown({ text, className, renderMention = defaultMention }: AppMarkdownProps) {
  const doc = useMemo(() => taskMarkdown.toDoc(text), [text])
  return <div className={cn('kb-rich kb-rich-compact min-w-0 break-words', className)}>{children(doc).map((node, index) => block(node, renderMention, `b${index}`))}</div>
}
