import { useTranslation } from 'react-i18next'
import { ListFilter, X } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { AppButton } from '../AppButton'
import { AppPopover } from '../AppPopover'
import { AppSelect, SELECT_ALL } from '../AppSelect'

export interface TableFilterDef {
  id: string
  label: string
  options: Array<{ value: string; label: string }>
}

interface FilterProps {
  filter: TableFilterDef
  value: string | undefined
  onChange: (value: string | undefined) => void
}

const optionLabel = (filter: TableFilterDef, value: string | undefined) => filter.options.find((o) => o.value === value)?.label

/**
 * Filtro da barra: parado mostra só o nome ("Estado"); ativo mostra "Estado: Alta" em verde suave,
 * para dar para ver de longe o que está filtrando a lista.
 */
export function FilterSelect({ filter, value, onChange }: FilterProps) {
  const { t } = useTranslation()
  const active = value !== undefined && value !== ''
  const selected = optionLabel(filter, value)
  return (
    <AppSelect
      aria-label={filter.label}
      value={active ? value : SELECT_ALL}
      onValueChange={(next) => onChange(next === SELECT_ALL ? undefined : next)}
      options={[{ value: SELECT_ALL, label: t('common.all') }, ...filter.options]}
      renderValue={
        active ? (
          <>
            {filter.label}: <strong className="font-semibold">{selected ?? value}</strong>
          </>
        ) : (
          filter.label
        )
      }
      className="w-auto"
      triggerClassName={cn('w-auto max-w-60 font-medium', active ? 'border-primary-border bg-primary-soft text-primary-soft-fg hover:border-primary' : 'text-muted')}
    />
  )
}

/** "Mais filtros": os filtros menos usados num painel, com a quantidade de ativos no botão. */
export function MoreFilters({ filters, values, onChange }: { filters: TableFilterDef[]; values: Record<string, string>; onChange: (id: string, value: string | undefined) => void }) {
  const { t } = useTranslation()
  if (filters.length === 0) return null
  const activeCount = filters.filter((f) => values[f.id]).length
  return (
    <AppPopover
      label={t('table.moreFilters')}
      align="start"
      className="w-[min(22rem,calc(100vw-2rem))] p-3"
      trigger={
        <AppButton
          variant="secondary"
          leftIcon={<ListFilter />}
          aria-label={activeCount ? t('table.moreFiltersActive', { count: activeCount }) : t('table.moreFilters')}
          className={cn(activeCount > 0 && 'border-primary-border bg-primary-soft text-primary-soft-fg')}
        >
          {t('table.moreFilters')}
          {activeCount > 0 && <span className="ml-0.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-fg">{activeCount}</span>}
        </AppButton>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {filters.map((filter) => (
          <AppSelect
            key={filter.id}
            label={filter.label}
            value={values[filter.id] ?? SELECT_ALL}
            onValueChange={(next) => onChange(filter.id, next === SELECT_ALL ? undefined : next)}
            options={[{ value: SELECT_ALL, label: t('common.all') }, ...filter.options]}
          />
        ))}
      </div>
    </AppPopover>
  )
}

/** Fichas dos filtros ativos que estão dentro de "Mais filtros" (cada uma com o seu ×). */
export function FilterChips({ filters, values, onChange }: { filters: TableFilterDef[]; values: Record<string, string>; onChange: (id: string, value: string | undefined) => void }) {
  const { t } = useTranslation()
  const active = filters.filter((f) => values[f.id])
  if (active.length === 0) return null
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label={t('table.activeFilters')}>
      {active.map((filter) => {
        const text = `${filter.label}: ${optionLabel(filter, values[filter.id]) ?? values[filter.id]}`
        return (
          <li key={filter.id}>
            <span className="inline-flex h-7 items-center gap-1 rounded-full border border-primary-border bg-primary-soft pl-2.5 pr-1 text-xs font-medium text-primary-soft-fg">
              {text}
              <button
                type="button"
                aria-label={t('table.removeFilter', { filter: text })}
                onClick={() => onChange(filter.id, undefined)}
                className="flex size-5 items-center justify-center rounded-full hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
