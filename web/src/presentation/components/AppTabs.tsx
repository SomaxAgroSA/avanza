import { useState, type ReactNode } from 'react'
import { TabActionsSlotContext } from '@/presentation/common/tab-actions-slot'
import { Tabs } from 'radix-ui'
import { cn } from '@/core/utils/cn'

export interface AppTab {
  value: string
  label: ReactNode
  content: ReactNode
  disabled?: boolean
}

export interface AppTabsProps {
  tabs: AppTab[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  className?: string
  'aria-label'?: string
  /** Reserva um lugar à direita da linha de abas para as ações da aba aberta (ver useTabActionsSlot). */
  actionsSlot?: boolean
}

export function AppTabs({ tabs, value, defaultValue, onValueChange, className, actionsSlot, ...rest }: AppTabsProps) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  return (
    <Tabs.Root
      value={value}
      defaultValue={defaultValue ?? tabs[0]?.value}
      onValueChange={onValueChange}
      className={cn('flex flex-col gap-4', className)}
    >
      <div className="flex items-end gap-3 border-b border-border">
      <Tabs.List aria-label={rest['aria-label']} className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <Tabs.Trigger
            key={tab.value}
            value={tab.value}
            disabled={tab.disabled}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted transition-colors',
              'hover:text-fg data-[state=active]:border-primary data-[state=active]:text-fg disabled:opacity-50',
            )}
          >
            {tab.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {actionsSlot && <div ref={setSlot} className="mb-1.5 flex shrink-0 items-center gap-2 empty:hidden" />}
      </div>
      <TabActionsSlotContext.Provider value={actionsSlot ? slot : null}>
        {tabs.map((tab) => (
          <Tabs.Content key={tab.value} value={tab.value} className="focus:outline-none">
            {tab.content}
          </Tabs.Content>
        ))}
      </TabActionsSlotContext.Provider>
    </Tabs.Root>
  )
}
