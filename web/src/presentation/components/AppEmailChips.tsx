import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { AppFormField } from './AppFormField'

const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

/** Um e-mail digitado, pronto para comparar e enviar: sem espaços nas pontas e em minúsculas. */
const normalizeEmail = (value: string): string => value.trim().toLowerCase()
const isEmail = (value: string): boolean => EMAIL_PATTERN.test(value) && value.length <= 254

export interface AppEmailChipsProps {
  label?: ReactNode
  value: string[]
  onChange: (next: string[]) => void
  /** Quantos endereços cabem (o campo de digitar some ao chegar no limite). */
  max?: number
  placeholder?: string
  /** Código de erro (validation.*) vindo de fora, ex.: do servidor. */
  error?: string | undefined
  /** Endereços oferecidos embaixo, a um clique (ex.: os usados antes); os já escolhidos não aparecem. */
  suggestions?: readonly string[]
  suggestionsLabel?: string
  /** Nome acessível do botão que tira um endereço. */
  removeLabel: (email: string) => string
  disabled?: boolean
  className?: string
}

/**
 * Lista de e-mails em etiquetas: Enter, vírgula, ponto e vírgula, espaço ou sair do campo confirmam o que foi
 * digitado; colar vários de uma vez também vale; Backspace com o campo vazio tira o último. Um endereço que
 * não é e-mail fica no campo, com o aviso, e nada é adicionado.
 */
export function AppEmailChips({ label, value, onChange, max = 5, placeholder, error, suggestions = [], suggestionsLabel, removeLabel, disabled, className }: AppEmailChipsProps) {
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState(false)
  const full = value.length >= max

  /** Confirma o texto (um ou vários endereços); devolve se entrou tudo. */
  const commit = (raw: string): boolean => {
    const parts = raw.split(/[\s,;]+/).map(normalizeEmail).filter(Boolean)
    if (parts.length === 0) return true
    if (!parts.every(isEmail)) {
      setInvalid(true)
      return false
    }
    const next = [...value]
    parts.forEach((email) => {
      if (!next.includes(email) && next.length < max) next.push(email)
    })
    if (next.length !== value.length) onChange(next)
    setText('')
    setInvalid(false)
    return true
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === ';' || (event.key === ' ' && text.trim() !== '')) {
      // Enter com o campo vazio segue para o formulário (salvar); com texto, confirma o endereço
      if (event.key === 'Enter' && text.trim() === '') return
      event.preventDefault()
      commit(text)
    } else if (event.key === 'Backspace' && text === '' && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  const offered = suggestions.filter((email) => !value.includes(email))

  return (
    <AppFormField label={label} error={invalid ? 'invalid_email' : error} className={className}>
      {({ id, describedBy, invalid: hasError }) => (
        <>
          <div
            className={cn(
              'flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-1 text-sm shadow-xs transition-colors duration-150',
              'hover:border-border-strong focus-within:border-primary focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-ring',
              hasError && 'border-danger focus-within:outline-danger/30',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            {value.map((email) => (
              <span key={email} className="inline-flex max-w-full items-center gap-0.5 rounded bg-primary-soft py-0.5 pl-2 pr-0.5 text-xs font-medium text-primary-soft-fg">
                <span className="truncate">{email}</span>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={removeLabel(email)}
                  onClick={() => onChange(value.filter((item) => item !== email))}
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
            {!full && (
              <input
                id={id}
                type="email"
                inputMode="email"
                autoComplete="off"
                value={text}
                disabled={disabled}
                placeholder={value.length === 0 ? placeholder : undefined}
                aria-invalid={hasError || undefined}
                aria-describedby={describedBy}
                onChange={(event) => {
                  setText(event.target.value)
                  setInvalid(false)
                }}
                onKeyDown={onKeyDown}
                onBlur={() => commit(text)}
                onPaste={(event) => {
                  const pasted = event.clipboardData.getData('text')
                  if (!/[\s,;]/.test(pasted.trim())) return
                  event.preventDefault()
                  if (!commit(`${text} ${pasted}`)) setText(`${text}${pasted}`.trim())
                }}
                className="h-6 min-w-32 flex-1 bg-transparent px-1.5 text-fg outline-none placeholder:text-subtle disabled:cursor-not-allowed"
              />
            )}
          </div>
          {offered.length > 0 && !full && !disabled && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              {suggestionsLabel && <span>{suggestionsLabel}</span>}
              {offered.map((email) => (
                <button
                  key={email}
                  type="button"
                  onClick={() => commit(email)}
                  className="max-w-full truncate rounded-full border border-border bg-surface px-2 py-0.5 text-fg hover:border-primary hover:text-primary-text focus-visible:outline-2 focus-visible:outline-ring"
                >
                  + {email}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </AppFormField>
  )
}
