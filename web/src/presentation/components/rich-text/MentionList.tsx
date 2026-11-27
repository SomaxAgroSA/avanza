import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/core/utils/cn'
import type { MentionPerson } from '@/domain/tasks'
import { AppAvatar } from '../AppAvatar'

export interface MentionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

export interface MentionListProps {
  items: MentionPerson[]
  command: (person: MentionPerson) => void
  editor: Editor
}

/** Lista do "@" (mesmo visual da caixa de menções de sempre): foto, nome e "passa a ver" para quem é de fora. */
export const MentionList = forwardRef<MentionListHandle, MentionListProps>(function MentionList({ items, command, editor }, ref) {
  const { t } = useTranslation()
  const listId = useId()
  const [active, setActive] = useState(0)
  const [prevItems, setPrevItems] = useState(items)
  const listRef = useRef<HTMLUListElement>(null)
  // lista nova (outro filtro) → volta para o primeiro
  if (prevItems !== items) {
    setPrevItems(items)
    setActive(0)
  }
  const optionId = (index: number) => `${listId}-opt-${index}`

  // o campo anuncia a lista aberta e a pessoa em destaque (leitores de tela)
  useEffect(() => {
    const dom = editor.view.dom
    if (items.length === 0) return
    dom.setAttribute('aria-controls', listId)
    dom.setAttribute('aria-activedescendant', optionId(Math.min(active, items.length - 1)))
    return () => {
      dom.removeAttribute('aria-controls')
      dom.removeAttribute('aria-activedescendant')
    }
  })

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (items.length === 0 || event.ctrlKey || event.metaKey || event.altKey) return false
      if (event.key === 'ArrowDown') {
        setActive((i) => (i + 1) % items.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        setActive((i) => (i - 1 + items.length) % items.length)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const person = items[Math.min(active, items.length - 1)]
        if (person) command(person)
        return true
      }
      return false
    },
  }))

  return (
    <ul
      ref={listRef}
      id={listId}
      role="listbox"
      aria-label={t('mentions.listLabel')}
      className="max-h-64 w-64 overflow-y-auto rounded-lg border border-border bg-surface p-1 text-fg shadow-float animate-scale-in"
    >
      {items.map((person, index) => (
        <li
          key={person.id}
          id={optionId(index)}
          role="option"
          aria-selected={index === active}
          data-index={index}
          // mousedown para não perder o foco do texto antes de escolher
          onMouseDown={(event) => {
            event.preventDefault()
            command(person)
          }}
          onMouseEnter={() => setActive(index)}
          className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg', index === active && 'bg-primary-soft text-primary-soft-fg')}
        >
          <AppAvatar name={person.name} size="xs" />
          <span className="min-w-0 truncate">{person.name}</span>
          {person.outside && <span className="ml-auto shrink-0 text-xs text-muted">{t('mentions.outside')}</span>}
        </li>
      ))}
    </ul>
  )
})
