import { useId, type ReactNode } from 'react'
import { DropdownMenu } from 'radix-ui'
import { Check } from 'lucide-react'
import { cn } from '@/core/utils/cn'

export type AppDropdownItem =
  | {
      type?: 'item'
      key: string
      label: ReactNode
      /** Linha menor embaixo do nome (ex.: "Só você a vê no topo"); entra como descrição acessível do item. */
      description?: ReactNode
      icon?: ReactNode
      shortcut?: string
      onSelect: () => void
      disabled?: boolean
      tone?: 'default' | 'danger'
    }
  | { type: 'checkbox'; key: string; label: ReactNode; checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean }
  | { type: 'separator'; key: string }
  | { type: 'label'; key: string; label: ReactNode }

export interface AppDropdownProps {
  trigger: ReactNode
  items: AppDropdownItem[]
  align?: 'start' | 'center' | 'end'
  className?: string
  /**
   * Para onde vai o foco ao fechar. Padrão: volta ao gatilho. Barras de ferramentas de editor
   * devolvem o foco ao texto (a ação escolhida continua de onde o cursor estava).
   */
  onCloseFocus?: () => void
}

const itemClasses =
  'relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none ' +
  'data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4'

export function AppDropdown({ trigger, items, align = 'end', className, onCloseFocus }: AppDropdownProps) {
  const baseId = useId()
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={4}
          onCloseAutoFocus={
            onCloseFocus
              ? (event) => {
                  event.preventDefault()
                  onCloseFocus()
                }
              : undefined
          }
          className={cn(
            'z-50 min-w-48 overflow-hidden rounded-lg border border-border bg-surface p-1 text-fg shadow-float animate-scale-in',
            className,
          )}
        >
          {items.map((item) => {
            if (item.type === 'separator') return <DropdownMenu.Separator key={item.key} className="my-1 h-px bg-border" />
            if (item.type === 'label')
              return (
                <DropdownMenu.Label key={item.key} className="px-2 py-1.5 text-xs font-medium text-subtle">
                  {item.label}
                </DropdownMenu.Label>
              )
            if (item.type === 'checkbox')
              return (
                <DropdownMenu.CheckboxItem
                  key={item.key}
                  checked={item.checked}
                  disabled={item.disabled}
                  onCheckedChange={item.onCheckedChange}
                  onSelect={(event) => event.preventDefault()}
                  className={cn(itemClasses, 'pl-8')}
                >
                  <DropdownMenu.ItemIndicator className="absolute left-2">
                    <Check className="text-primary-text" />
                  </DropdownMenu.ItemIndicator>
                  {item.label}
                </DropdownMenu.CheckboxItem>
              )
            // com descrição: o nome do item é só o rótulo; a linha de baixo vira a descrição acessível
            const descriptionId = item.description ? `${baseId}-${item.key}` : undefined
            return (
              <DropdownMenu.Item
                key={item.key}
                disabled={item.disabled}
                onSelect={item.onSelect}
                aria-describedby={descriptionId}
                textValue={typeof item.label === 'string' ? item.label : undefined}
                className={cn(itemClasses, item.description && 'items-start', item.tone === 'danger' && 'text-danger data-[highlighted]:bg-danger-soft')}
              >
                {item.icon && <span className={cn('text-subtle', item.description && 'mt-0.5')}>{item.icon}</span>}
                {item.description ? (
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span>{item.label}</span>
                    <span id={descriptionId} aria-hidden="true" className="text-xs text-muted">
                      {item.description}
                    </span>
                  </span>
                ) : (
                  <span className="flex-1">{item.label}</span>
                )}
                {item.shortcut && <span className="text-xs text-subtle">{item.shortcut}</span>}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
