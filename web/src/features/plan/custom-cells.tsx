import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Pencil, Plus, Settings2 } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import type { ProjectMember } from '@/domain/projects'
import { COLUMN_LIMITS, isSafeLink, optionOf, type ColumnOption, type CustomValue, type PlanColumn } from '@/domain/plan-columns'
import { AppCheckbox, AppIconButton, AppInlineEdit, AppPopover } from '@/presentation/components'
import { optionSolid } from '@/features/task-config/config-theme'
import { DateCell, NumberCell, OwnerCell } from './cells'

const cellButton =
  'flex h-full min-h-9 w-full items-center justify-center gap-1 px-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'

export interface CustomCellProps {
  column: PlanColumn
  value: CustomValue | undefined
  itemName: string
  readOnly: boolean
  members: ProjectMember[]
  /** Gestor: "Editar opções" na lista. */
  canManage: boolean
  onChange: (value: CustomValue | null) => void
  onEditColumn: () => void
}

/** Célula de coluna personalizada (GP-5): o editor depende do tipo da coluna. */
export function CustomCell({ column, value, itemName, readOnly, members, canManage, onChange, onEditColumn }: CustomCellProps) {
  const { t } = useTranslation()
  const label = t('plan.customColumns.cellOf', { column: column.name, name: itemName })
  switch (column.type) {
    case 'number':
      return (
        <NumberCell
          value={typeof value === 'number' ? value : null}
          label={label}
          readOnly={readOnly}
          max={COLUMN_LIMITS.number}
          suffix={column.settings.unit}
          onChange={(next) => onChange(next)}
        />
      )
    case 'date':
      return (
        <DateCell
          value={typeof value === 'string' ? value : null}
          itemName={itemName}
          readOnly={readOnly}
          onChange={(next) => onChange(next)}
          labels={{ popover: label, button: (shown) => t('plan.customColumns.cellOfValue', { column: column.name, name: itemName, value: shown }), empty: t('plan.customColumns.empty') }}
        />
      )
    case 'checkbox':
      return (
        <span className="flex h-full items-center justify-center">
          <AppCheckbox checked={value === true} disabled={readOnly} onCheckedChange={(checked) => onChange(checked ? true : null)} aria-label={label} />
        </span>
      )
    case 'dropdown':
      return <DropdownCell column={column} value={typeof value === 'string' ? value : null} label={label} itemName={itemName} readOnly={readOnly} canManage={canManage} onChange={onChange} onEditColumn={onEditColumn} />
    case 'people': {
      const member = typeof value === 'string' ? members.find((m) => m.user.id === value) : undefined
      return (
        <OwnerCell
          owner={member ? { id: member.user.id, name: member.user.name, avatarUrl: member.user.avatarUrl } : null}
          members={members}
          itemName={itemName}
          readOnly={readOnly}
          onChange={(next) => onChange(next)}
          labels={{ popover: label, button: (shown) => t('plan.customColumns.cellOfValue', { column: column.name, name: itemName, value: shown }), empty: t('plan.customColumns.empty') }}
        />
      )
    }
    case 'link':
      return <LinkCell value={typeof value === 'string' ? value : null} label={label} readOnly={readOnly} onChange={onChange} />
    default:
      return (
        <AppInlineEdit
          value={typeof value === 'string' ? value : ''}
          label={label}
          readOnly={readOnly}
          maxLength={COLUMN_LIMITS.text}
          align="center"
          onCommit={(text) => {
            const next = text.trim()
            if ((next || null) !== ((value as string | undefined) ?? null)) onChange(next || null)
          }}
        />
      )
  }
}

/** Opção da lista em bloco colorido (como o status). */
export function OptionBlock({ option, className }: { option: ColumnOption | null; className?: string }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn('flex h-full min-h-9 w-full items-center justify-center truncate px-2 text-[13px] font-medium', option ? 'text-white' : 'bg-surface-3 text-subtle', className)}
      style={option ? { backgroundColor: optionSolid(option.color) } : undefined}
    >
      {option ? option.name : <span className="sr-only">{t('plan.customColumns.empty')}</span>}
    </span>
  )
}

function DropdownCell({
  column,
  value,
  label,
  itemName,
  readOnly,
  canManage,
  onChange,
  onEditColumn,
}: {
  column: PlanColumn
  value: string | null
  label: string
  itemName: string
  readOnly: boolean
  canManage: boolean
  onChange: (value: CustomValue | null) => void
  onEditColumn: () => void
}) {
  const { t } = useTranslation()
  const current = optionOf(column, value) ?? null
  if (readOnly) return <OptionBlock option={current} />
  return (
    <AppPopover
      label={label}
      className="w-56"
      trigger={
        <button type="button" aria-label={t('plan.customColumns.cellOfValue', { column: column.name, name: itemName, value: current?.name ?? t('plan.customColumns.empty') })} className={cn(cellButton, 'p-0 hover:brightness-110')}>
          <OptionBlock option={current} />
        </button>
      }
    >
      {(close) => (
        <div className="flex flex-col gap-1">
          {[...(column.settings.options ?? []), null].map((option) => {
            const selected = (option?.id ?? null) === value
            return (
              <button
                key={option?.id ?? 'blank'}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  if (!selected) onChange(option?.id ?? null)
                  close()
                }}
                className={cn('relative h-8 overflow-hidden rounded-md outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring', selected && 'ring-2 ring-primary')}
              >
                <OptionBlock option={option} className="min-h-8" />
                {!option && <span className="absolute inset-0 flex items-center justify-center text-xs text-muted">{t('plan.customColumns.empty')}</span>}
              </button>
            )
          })}
          {canManage && (
            <button
              type="button"
              onClick={() => {
                close()
                onEditColumn()
              }}
              className="mt-1 flex items-center justify-center gap-1.5 rounded-md border-t border-border px-2 pt-2 text-xs font-medium text-muted hover:text-fg [&_svg]:size-3.5"
            >
              <Settings2 />
              {t('plan.customColumns.editOptions')}
            </button>
          )}
        </div>
      )}
    </AppPopover>
  )
}

/** Link: abre em outra aba (só http/https); o lápis edita. */
function LinkCell({ value, label, readOnly, onChange }: { value: string | null; label: string; readOnly: boolean; onChange: (value: CustomValue | null) => void }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  if (editing && !readOnly)
    return (
      <AppInlineEdit
        value={value ?? ''}
        label={label}
        maxLength={COLUMN_LIMITS.link}
        autoEdit
        placeholder="https://"
        onCommit={(text) => {
          const next = text.trim()
          setEditing(false)
          if (next && !isSafeLink(next)) return false
          if ((next || null) !== value) onChange(next || null)
        }}
      />
    )
  if (!value)
    return readOnly ? null : (
      <button type="button" aria-label={t('plan.customColumns.fill', { label })} onClick={() => setEditing(true)} className={cn(cellButton, 'group/cell min-h-8')}>
        <Plus aria-hidden className="size-4 text-subtle opacity-0 group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100" />
      </button>
    )
  let host = value
  try {
    host = new URL(value).host
  } catch {
    // mostra o texto como veio
  }
  return (
    <span className="flex h-full min-w-0 items-center justify-center gap-1 px-1">
      {isSafeLink(value) ? (
        <a href={value} target="_blank" rel="noopener noreferrer" title={value} className="inline-flex min-w-0 items-center gap-1 truncate text-xs text-primary-text hover:underline">
          <span className="truncate">{host}</span>
          <ExternalLink aria-hidden className="size-3 shrink-0" />
        </a>
      ) : (
        <span className="truncate text-xs">{value}</span>
      )}
      {!readOnly && <AppIconButton size="sm" variant="ghost" icon={<Pencil />} label={t('plan.customColumns.editLink', { label })} onClick={() => setEditing(true)} />}
    </span>
  )
}
