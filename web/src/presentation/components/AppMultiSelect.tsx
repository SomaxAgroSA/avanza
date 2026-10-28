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
}

/** Seleção múltipla com busca e chips removíveis (opcionalmente, criação de opção pela busca). */
export function AppMultiSelect({ value, onValueChange, options, label, placeholder, error, hint, required, disabled, className, onCreateOption }: AppMultiSelectProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const selected = options.filter((o) => value.includes(o.value))

  const toggle = (optionValue: string) =>
    onValueChange(value.includes(optionValue) ? value.filter((v) => v !== optionValue) : [...value, optionValue])

  return (
    <AppFormField label={label} error={error} hint={hint} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
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
              className={cn(
                'flex min-h-9 w-full items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-left text-sm shadow-xs',
                'hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring aria-[invalid=true]:border-danger',
                'disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
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
              <ChevronDown className="size-4 shrink-0 text-subtle" aria-hidden />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={4}
              className="z-50 w-[var(--radix-popover-trigger-width)] min-w-56 rounded-xl border border-border bg-surface p-1 text-fg shadow-float animate-scale-in"
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
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </AppFormField>
  )
}
