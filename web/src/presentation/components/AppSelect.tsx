import { useState, type ReactNode } from 'react'
import { Popover, Select } from 'radix-ui'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { AppFormField } from './AppFormField'
import { OptionPicker, type CreateOptionHandler } from './option-picker'

export interface AppSelectOption {
  value: string
  label: ReactNode
  /** Elemento à esquerda do rótulo (ex.: bolinha de cor). */
  prefix?: ReactNode
  /** Texto do rótulo para a busca quando `label` não é texto (usado com `searchable`/`onCreateOption`). */
  textValue?: string
  disabled?: boolean
  /** Título da seção na lista com busca (`searchable`/`onCreateOption`): opções seguidas do mesmo grupo ficam sob ele. */
  group?: string
}

export interface AppSelectProps {
  value: string | undefined
  onValueChange: (value: string) => void
  options: AppSelectOption[]
  placeholder?: string
  label?: ReactNode
  error?: string | undefined
  hint?: ReactNode
  required?: boolean
  disabled?: boolean
  className?: string
  triggerClassName?: string
  /** Nome acessível quando não há label visível. */
  'aria-label'?: string
  size?: 'sm' | 'md'
  /**
   * Permite criar uma opção pela busca: a lista ganha busca e, com um texto sem opção igual (sem
   * diferenciar maiúsculas e acentos), o item "Adicionar “texto”". A função cria e devolve o valor da
   * nova opção, que fica escolhida (null/undefined = não criou; ela mesma avisa o erro).
   */
  onCreateOption?: CreateOptionHandler | undefined
  /** Lista com busca (sem acentos/maiúsculas) e cabeçalhos de grupo (`group` das opções) — para listas longas. */
  searchable?: boolean
  /** Conteúdo do gatilho no lugar do texto da opção escolhida (ex.: filtro "Status: Aberta"). */
  renderValue?: ReactNode
}

/** Valor sentinela para "todos" (Radix Select não aceita string vazia como item). */
export const SELECT_ALL = '__all__'

const triggerClass = (size: 'sm' | 'md', extra?: string) =>
  cn(
    'flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-sm text-fg shadow-xs',
    'hover:border-border-strong focus:outline-2 focus:outline-ring data-[placeholder]:text-subtle',
    'disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger',
    size === 'sm' ? 'h-8 text-xs' : 'h-9',
    extra,
  )

function OptionLabel({ option }: { option: AppSelectOption }) {
  if (!option.prefix) return <>{option.label}</>
  return (
    <span className="inline-flex items-center gap-2">
      {option.prefix}
      {option.label}
    </span>
  )
}

export function AppSelect({
  value,
  onValueChange,
  options,
  placeholder,
  label,
  error,
  hint,
  required,
  disabled,
  className,
  triggerClassName,
  size = 'md',
  onCreateOption,
  searchable,
  renderValue,
  ...rest
}: AppSelectProps) {
  if (onCreateOption || searchable) {
    return (
      <SearchableSelect
        {...{ value, onValueChange, options, placeholder, label, error, hint, required, disabled, className, triggerClassName, size, onCreateOption, renderValue }}
        aria-label={rest['aria-label']}
      />
    )
  }
  return (
    <AppFormField label={label} error={error} hint={hint} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <Select.Root value={value} onValueChange={onValueChange} disabled={disabled} required={required}>
          <Select.Trigger
            id={id}
            aria-label={rest['aria-label']}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={triggerClass(size, triggerClassName)}
          >
            <span className="truncate">
              <Select.Value placeholder={placeholder}>{renderValue}</Select.Value>
            </span>
            <Select.Icon>
              <ChevronDown className="size-4 text-subtle" aria-hidden />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content
              position="popper"
              sideOffset={4}
              className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-surface shadow-float animate-scale-in"
            >
              <Select.Viewport className="p-1">
                {options.map((option) => (
                  <Select.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className={cn(
                      'relative flex cursor-pointer select-none items-center rounded-md py-1.5 pl-8 pr-3 text-sm text-fg outline-none',
                      'data-[highlighted]:bg-surface-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
                    )}
                  >
                    <Select.ItemIndicator className="absolute left-2 flex items-center">
                      <Check className="size-4 text-primary-text" aria-hidden />
                    </Select.ItemIndicator>
                    <Select.ItemText>
                      <OptionLabel option={option} />
                    </Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      )}
    </AppFormField>
  )
}

/**
 * Variante com busca (`searchable`) ou criação (`onCreateOption`): popover com busca no lugar do Select
 * do Radix, que não aceita campo de texto dentro da lista.
 */
function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder,
  label,
  error,
  hint,
  required,
  disabled,
  className,
  triggerClassName,
  size = 'md',
  onCreateOption,
  renderValue,
  ...rest
}: AppSelectProps) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  const choose = (next: string) => {
    onValueChange(next)
    setOpen(false)
  }

  return (
    <AppFormField label={label} error={error} hint={hint} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button
              id={id}
              type="button"
              role="combobox"
              aria-label={rest['aria-label']}
              aria-expanded={open}
              aria-controls={`${id}-listbox`}
              aria-haspopup="listbox"
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              disabled={disabled}
              data-placeholder={current ? undefined : ''}
              className={triggerClass(size, triggerClassName)}
            >
              <span className="truncate">{renderValue ?? (current ? <OptionLabel option={current} /> : placeholder)}</span>
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
                options={options.map((o) => ({
                  value: o.value,
                  label: o.textValue ?? (typeof o.label === 'string' ? o.label : o.value),
                  prefix: o.prefix,
                  disabled: o.disabled,
                  group: o.group,
                }))}
                isSelected={(optionValue) => optionValue === value}
                onPick={choose}
                searchable
                onCreateOption={onCreateOption}
                onCreated={choose}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </AppFormField>
  )
}
