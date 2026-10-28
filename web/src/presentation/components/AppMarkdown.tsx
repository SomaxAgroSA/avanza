import { Fragment, type ReactNode } from 'react'
import { cn } from '@/core/utils/cn'

/**
 * Markdown simples e seguro para comentários e descrições.
 *
 * Suporta: parágrafos, quebras de linha, listas (- item / 1. item), **negrito**, *itálico*,
 * ~~riscado~~, `código`, [texto](https://…), links soltos http(s) e menções `@[Nome](id)`.
 * Nunca usa HTML cru (sem dangerouslySetInnerHTML): tudo vira elemento React, e links
 * só aceitam http(s) — `javascript:` e afins aparecem como texto.
 */
export interface AppMarkdownProps {
  text: string
  className?: string
  /** Como exibir uma menção (padrão: "@Nome" destacado). */
  renderMention?: (name: string, id: string, key: string) => ReactNode
}

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*|_[^_\n]+_)|(\[[^\]\n]+\]\([^)\s]+\))|(@\[[^\]\n]{1,120}\]\([A-Za-z0-9_]{1,64}\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g

const SAFE_URL = /^https?:\/\//i

function defaultMention(name: string, _id: string, key: string) {
  return (
    <span key={key} className="rounded bg-primary-soft px-1 font-medium text-primary-soft-fg">
      @{name}
    </span>
  )
}

function link(href: string, label: ReactNode, key: string) {
  if (!SAFE_URL.test(href)) return <Fragment key={key}>{label}</Fragment>
  return (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="break-words text-primary-text underline-offset-2 hover:underline">
      {label}
    </a>
  )
}

function inline(text: string, renderMention: NonNullable<AppMarkdownProps['renderMention']>, prefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let index = 0
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0
    if (start > last) nodes.push(text.slice(last, start))
    const token = match[0]
    const key = `${prefix}-${index++}`
    if (match[1]) nodes.push(<code key={key} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">{token.slice(1, -1)}</code>)
    else if (match[2]) nodes.push(<strong key={key}>{inline(token.slice(2, -2), renderMention, key)}</strong>)
    else if (match[3]) nodes.push(<del key={key}>{inline(token.slice(2, -2), renderMention, key)}</del>)
    else if (match[4]) nodes.push(<em key={key}>{inline(token.slice(1, -1), renderMention, key)}</em>)
    else if (match[5]) {
      const [, label = '', href = ''] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token) ?? []
      nodes.push(link(href, label, key))
    } else if (match[6]) {
      const [, name = '', id = ''] = /^@\[([^\]]+)\]\(([^)]+)\)$/.exec(token) ?? []
      nodes.push(renderMention(name, id, key))
    } else if (match[7]) nodes.push(link(token, token, key))
    last = start + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

type Block = { kind: 'p'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[] }

function blocks(text: string): Block[] {
  const result: Block[] = []
  text.replace(/\r\n/g, '\n').split('\n').forEach((line) => {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const current = result[result.length - 1]
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol'
      const content = (bullet ?? numbered)?.[1] ?? ''
      if (current && current.kind === kind) current.items.push(content)
      else result.push({ kind, items: [content] })
    } else if (line.trim() === '') {
      result.push({ kind: 'p', lines: [] })
    } else if (current && current.kind === 'p') {
      current.lines.push(line)
    } else {
      result.push({ kind: 'p', lines: [line] })
    }
  })
  return result.filter((b) => (b.kind === 'p' ? b.lines.length > 0 : true))
}

export function AppMarkdown({ text, className, renderMention = defaultMention }: AppMarkdownProps) {
  return (
    <div className={cn('flex flex-col gap-2 text-sm break-words text-fg', className)}>
      {blocks(text).map((block, i) => {
        const key = `b${i}`
        if (block.kind === 'p') {
          return (
            <p key={key}>
              {block.lines.map((line, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {inline(line, renderMention, `${key}-${j}`)}
                </Fragment>
              ))}
            </p>
          )
        }
        const List = block.kind
        return (
          <List key={key} className={cn('flex flex-col gap-0.5 pl-5', block.kind === 'ul' ? 'list-disc' : 'list-decimal')}>
            {block.items.map((item, j) => (
              <li key={j}>{inline(item, renderMention, `${key}-${j}`)}</li>
            ))}
          </List>
        )
      })}
    </div>
  )
}
