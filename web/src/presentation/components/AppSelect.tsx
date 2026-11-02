import type { ReactNode } from 'react'
import { Select } from 'radix-ui'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { AppFormField } from './AppFormField'

export interface AppSelectOption {
  value: string
  label: ReactNode
  disabled?: boolean
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
  /** Conteúdo do gatilho no lugar do texto da opção escolhida (ex.: filtro "Estado: Alta"). */
  renderValue?: ReactNode
}

/** Valor sentinela para "todos" (Radix Select não aceita string vazia como item). */
export const SELECT_ALL = '__all__'

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
  renderValue,
  ...rest
}: AppSelectProps) {
  return (
    <AppFormField label={label} error={error} hint={hint} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <Select.Root value={value} onValueChange={onValueChange} disabled={disabled} required={required}>
          <Select.Trigger
            id={id}
            aria-label={rest['aria-label']}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-sm text-fg shadow-xs',
              'hover:border-border-strong focus:outline-2 focus:outline-ring data-[placeholder]:text-subtle',
              'disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger',
              size === 'sm' ? 'h-8 text-xs' : 'h-9',
              triggerClassName,
            )}
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
                      <Check className="size-4 text-primary" aria-hidden />
                    </Select.ItemIndicator>
                    <Select.ItemText>{option.label}</Select.ItemText>
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
