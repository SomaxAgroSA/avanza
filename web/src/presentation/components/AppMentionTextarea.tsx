import { useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/core/utils/cn'
import { mentionQueryAt, type MentionPerson } from '@/domain/tasks'
import { AppAvatar } from './AppAvatar'
import { AppFormField } from './AppFormField'

export interface AppMentionTextareaProps {
  value: string
  onValueChange: (value: string) => void
  /** Pessoas que podem ser mencionadas. */
  people: MentionPerson[]
  /** Chamado ao escolher alguém na lista (a tela guarda quem foi mencionado). */
  onMention: (person: MentionPerson) => void
  /** Ctrl/⌘+Enter. */
  onSubmit?: () => void
  label?: ReactNode
  hint?: ReactNode
  error?: string | undefined
  placeholder?: string
  rows?: number
  disabled?: boolean
  /** Foca ao montar (ex.: ao abrir a edição de um comentário). */
  focusOnMount?: boolean
  maxLength?: number
  /**
   * Imagens/arquivos colados (Ctrl+V) ou soltos no campo. Texto copiado continua colando como texto
   * (o Excel, por exemplo, manda junto uma imagem da seleção).
   */
  onFiles?: (files: File[], source: 'paste' | 'drop') => void
}

const MAX_RESULTS = 8

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * Texto com menções: ao digitar "@", abre a lista de pessoas filtrando enquanto se digita
 * (setas navegam, Enter/Tab escolhem, Esc fecha). A pessoa escolhida entra como "@Nome".
 */
export function AppMentionTextarea({
  value,
  onValueChange,
  people,
  onMention,
  onSubmit,
  label,
  hint,
  error,
  placeholder,
  rows = 3,
  disabled,
  focusOnMount,
  maxLength,
  onFiles,
}: AppMentionTextareaProps) {
  const { t } = useTranslation()
  const listId = useId()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const [dropping, setDropping] = useState(false)

  const fileEvents = onFiles
    ? {
        onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => {
          const files = Array.from(event.clipboardData.files)
          if (files.length === 0 || event.clipboardData.getData('text/plain')) return
          event.preventDefault()
          onFiles(files, 'paste')
        },
        onDragOver: (event: DragEvent<HTMLTextAreaElement>) => {
          if (!Array.from(event.dataTransfer.types).includes('Files')) return
          event.preventDefault()
          setDropping(true)
        },
        onDragLeave: () => setDropping(false),
        onDrop: (event: DragEvent<HTMLTextAreaElement>) => {
          setDropping(false)
          const files = Array.from(event.dataTransfer.files)
          if (files.length === 0) return
          event.preventDefault()
          onFiles(files, 'drop')
        },
      }
    : {}

  useEffect(() => {
    if (focusOnMount) ref.current?.focus()
  }, [focusOnMount])

  // Depois de inserir a menção, o cursor vai para logo após ela ANTES da próxima tecla
  // (com requestAnimationFrame, quem digita rápido vê a letra cair no fim do texto).
  const pendingCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    const position = pendingCaret.current
    if (position === null || !ref.current) return
    pendingCaret.current = null
    ref.current.focus()
    ref.current.setSelectionRange(position, position)
  }, [value])

  const mention = mentionQueryAt(value, caret)
  const matches = mention
    ? people
        .filter((p) => normalize(p.name).includes(normalize(mention.query)))
        .sort((a, b) => Number(!normalize(a.name).startsWith(normalize(mention.query))) - Number(!normalize(b.name).startsWith(normalize(mention.query))))
        .slice(0, MAX_RESULTS)
    : []
  const open = !!mention && matches.length > 0 && dismissedAt !== mention.start && !disabled
  const activeIndex = Math.min(active, Math.max(matches.length - 1, 0))

  function choose(person: MentionPerson) {
    if (!mention) return
    const before = value.slice(0, mention.start)
    const after = value.slice(caret)
    const inserted = `@${person.name} `
    const next = before + inserted + (after.startsWith(' ') ? after.slice(1) : after)
    onValueChange(next)
    onMention(person)
    const position = before.length + inserted.length
    pendingCaret.current = position
    setCaret(position)
    setActive(0)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const delta = event.key === 'ArrowDown' ? 1 : -1
        setActive((activeIndex + delta + matches.length) % matches.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const person = matches[activeIndex]
        if (person) choose(person)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setDismissedAt(mention?.start ?? null)
        return
      }
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && onSubmit) {
      event.preventDefault()
      onSubmit()
    }
  }

  const optionId = (index: number) => `${listId}-opt-${index}`

  return (
    <AppFormField label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <textarea
            ref={ref}
            id={id}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={open ? optionId(activeIndex) : undefined}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            rows={rows}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            maxLength={maxLength}
            onChange={(event) => {
              onValueChange(event.target.value)
              setCaret(event.target.selectionStart)
              setActive(0)
              if (dismissedAt !== null && !mentionQueryAt(event.target.value, event.target.selectionStart)) setDismissedAt(null)
            }}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onBlur={() => setDismissedAt(mention?.start ?? null)}
            onFocus={() => setDismissedAt(null)}
            {...fileEvents}
            className={cn(
              'w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg shadow-xs placeholder:text-subtle',
              'hover:border-border-strong focus:border-primary focus:outline-2 focus:outline-offset-0 focus:outline-ring',
              'disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger',
              dropping && 'border-primary bg-primary-soft',
            )}
          />
          <ul
            id={listId}
            role="listbox"
            aria-label={t('mentions.listLabel')}
            hidden={!open}
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-float"
          >
            {matches.map((person, index) => (
              <li
                key={person.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === activeIndex}
                // mousedown para não perder o foco do texto antes de escolher
                onMouseDown={(event) => {
                  event.preventDefault()
                  choose(person)
                }}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg',
                  index === activeIndex && 'bg-primary-soft text-primary-soft-fg',
                )}
              >
                <AppAvatar name={person.name} size="xs" />
                <span className="min-w-0 truncate">{person.name}</span>
                {person.outside && <span className="ml-auto shrink-0 text-xs text-muted">{t('mentions.outside')}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </AppFormField>
  )
}
