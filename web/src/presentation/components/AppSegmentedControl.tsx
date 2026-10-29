import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/core/utils/cn'

export interface AppSegmentedOption<V extends string = string> {
  value: V
  label: ReactNode
  /** Nome acessível quando o rótulo não é texto (ex.: só ícone). */
  ariaLabel?: string
}

export interface AppSegmentedControlProps<V extends string = string> {
  options: ReadonlyArray<AppSegmentedOption<V>>
  value: V
  onValueChange: (value: V) => void
  /** Nome acessível do grupo (ex.: "Período"). */
  label: string
  size?: 'sm' | 'md'
  className?: string
}

const SIZES = { sm: 'h-7 px-2.5 text-xs', md: 'h-8 px-3 text-sm' }

/**
 * Controle segmentado: poucas opções exclusivas lado a lado (ex.: período de um painel). Segue o
 * padrão de grupo de rádios: só a opção escolhida entra no Tab; as setas andam (circular) e escolhem.
 */
export function AppSegmentedControl<V extends string = string>({ options, value, onValueChange, label, size = 'md', className }: AppSegmentedControlProps<V>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : step ? (index + step + options.length) % options.length : -1
    if (target < 0) return
    event.preventDefault()
    const option = options[target]
    if (!option) return
    refs.current[target]?.focus()
    onValueChange(option.value)
  }

  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex max-w-full items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5', className)}>
      {options.map((option, index) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.ariaLabel}
            tabIndex={checked || (index === 0 && !options.some((o) => o.value === value)) ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-150 [&_svg]:size-3.5',
              'focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none',
              SIZES[size],
              checked ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
