import { useState, type ReactNode } from 'react'
import { Popover } from 'radix-ui'
import { ChevronDown, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/core/utils/cn'
import { AppFormField } from './AppFormField'
import { OptionPicker, type CreateOptionHandler } from './option-picker'

export interface AppMultiSelectOption {
  value: string
  label: string
  /** Elemento à esquerda do rótulo (ex.: bolinha de cor). */
  prefix?: ReactNode
  disabled?: boolean
}

export interface AppMultiSelectProps {
  value: string[]
  onValueChange: (value: string[]) => void
  options: AppMultiSelectOption[]
  label?: ReactNode
  placeholder?: string
  error?: string | undefined
  hint?: ReactNode
  required?: boolean
  disabled?: boolean
  className?: string
  /**
   * Permite criar uma opção a partir da busca: com o texto sem opção igual (sem diferenciar
   * maiúsculas e acentos), a lista mostra "Adicionar “texto”". A função cria e devolve o valor da
   * nova opção, que entra selecionada (null/undefined = não criou; ela mesma avisa o erro).
   */
  onCreateOption?: CreateOptionHandler | undefined
  /**
   * `chips` (padrão): cada escolhida vira um chip removível no campo. `summary`: o campo fica como um
   * select comum — nada escolhido mostra `allOptionLabel` (ou o placeholder), uma mostra o nome dela e
   * várias mostram `summary(n)`; para mudar, abre-se a lista e desmarca-se.
   */
  display?: 'chips' | 'summary'
  /** Primeiro item da lista que limpa a seleção (marcado quando nada está escolhido). Ex.: "Todos os projetos". */
  allOptionLabel?: string
  /** Texto do campo com 2 ou mais escolhidas no modo `summary` (padrão: "3 selecionados"). */
  summary?: (count: number) => string
}

/** Seleção múltipla com busca e chips removíveis ou um resumo (opcionalmente, criação de opção pela busca e o item "todos"). */
export function AppMultiSelect({
  value,
  onValueChange,
  options,
  label,
  placeholder,
  error,
  hint,
  required,
  disabled,
  className,
  onCreateOption,
  display = 'chips',
  allOptionLabel,
  summary,
}: AppMultiSelectProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const selected = options.filter((o) => value.includes(o.value))

  const summaryText =
    selected.length === 0
      ? (allOptionLabel ?? placeholder ?? t('multiSelect.placeholder'))
      : selected.length === 1
        ? (selected[0]?.label ?? '')
        : (summary?.(selected.length) ?? t('multiSelect.selected', { count: selected.length }))

  const toggle = (optionValue: string) =>
    onValueChange(value.includes(optionValue) ? value.filter((v) => v !== optionValue) : [...value, optionValue])

  return (
    <AppFormField label={label} error={error} hint={hint} required={required} className={className}>
      {({ id, describedBy, invalid, labelId }) => (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button
              id={id}
              type="button"
              role="combobox"
              aria-expanded={open}
              aria-controls={`${id}-listbox`}
              aria-haspopup="listbox"
              disabled={disabled}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              // no resumo, o nome do campo diz o que está escolhido ("Projetos, 3 projetos selecionados")
              aria-labelledby={display === 'summary' ? [labelId, `${id}-value`].filter(Boolean).join(' ') : undefined}
              className={cn(
                'flex min-h-9 w-full items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-left text-sm shadow-xs',
                display === 'summary' && 'px-3',
                'hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring aria-[invalid=true]:border-danger',
                'disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              {display === 'summary' ? (
                <span id={`${id}-value`} className={cn('min-w-0 flex-1 truncate', selected.length === 0 && !allOptionLabel ? 'text-subtle' : 'text-fg')}>
                  {summaryText}
                </span>
              ) : (
                <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                  {selected.length === 0 && <span className="px-1 text-subtle">{placeholder ?? t('multiSelect.placeholder')}</span>}
                  {selected.map((option) => (
                    <span key={option.value} className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-1.5 py-0.5 text-xs font-medium text-fg">
                      {option.prefix}
                      {option.label}
                      {!disabled && (
                        <span
                          role="button"
                          tabIndex={-1}
                          aria-label={t('multiSelect.remove', { item: option.label })}
                          onPointerDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            toggle(option.value)
                          }}
                          className="rounded text-subtle hover:text-fg"
                        >
                          <X className="size-3" />
                        </span>
                      )}
                    </span>
                  ))}
                </span>
              )}
              <ChevronDown className="size-4 shrink-0 text-subtle" aria-hidden />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={4}
              collisionPadding={8}
              className={cn(
                'z-50 min-w-56 rounded-xl border border-border bg-surface p-1 text-fg shadow-float animate-scale-in',
                // no resumo, a lista pode ser mais larga que o campo (nomes longos de projeto) até o limite da tela
                display === 'summary' ? 'w-max min-w-[var(--radix-popover-trigger-width)] max-w-[min(28rem,calc(100vw-1rem))]' : 'w-[var(--radix-popover-trigger-width)]',
              )}
            >
              <OptionPicker
                listboxId={`${id}-listbox`}
                multiple
                options={options}
                searchable={options.length > 7}
                isSelected={(optionValue) => value.includes(optionValue)}
                onPick={toggle}
                onCreateOption={onCreateOption}
                onCreated={(created) => onValueChange(value.includes(created) ? value : [...value, created])}
                allOption={allOptionLabel ? { label: allOptionLabel, selected: value.length === 0, onPick: () => onValueChange([]) } : undefined}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </AppFormField>
  )
}
