import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { INTERNAL_PROJECT, hasInboxFilters, type InboxFilters } from '@/domain/demands'
import { URGENCY_FILTER_VALUES, isUrgency } from '@/domain/urgency'
import { AppPopover } from '@/presentation/components'
import { UrgencyLight } from '@/features/tasks/TaskUrgency'

export interface InboxFilterOption {
  value: string
  label: string
  prefix?: ReactNode
}

/** Mesmo item do controle segmentado das caixas (altura, cantos e escolhido em branco). */
const ITEM = 'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none @max-[960px]:px-2'

/**
 * Filtros da Bandeja (ajuste 23/11, aprovado em demonstração): na linha das caixas e com o mesmo botão delas —
 * Buscar, Projeto (um, ou só as demandas internas), Prioridade e Urgência (várias). Cada um abre um menu
 * próprio; o botão com filtro fica em branco, como a caixa escolhida, e mostra a escolha ("Alta +1").
 */
export function InboxFilterBar({
  filters,
  onChange,
  projects,
  priorities,
}: {
  filters: InboxFilters
  onChange: (next: InboxFilters) => void
  projects: InboxFilterOption[]
  priorities: InboxFilterOption[]
}) {
  const { t } = useTranslation()
  const [text, setText] = useState(filters.search)
  // a busca vai para o endereço 300 ms depois da última tecla
  useEffect(() => {
    if (text === filters.search) return
    const timer = setTimeout(() => onChange({ ...filters, search: text }), 300)
    return () => clearTimeout(timer)
  }, [text, filters, onChange])

  const urgencies: InboxFilterOption[] = URGENCY_FILTER_VALUES.map((value) => ({
    value,
    label: t(`tasks.urgency.${value}`),
    prefix: <UrgencyLight urgency={isUrgency(value) ? value : null} />,
  }))
  const projectOptions: InboxFilterOption[] = [{ value: INTERNAL_PROJECT, label: t('demands.chip') }, ...projects]
  const active = hasInboxFilters({ ...filters, search: text })

  return (
    <div role="group" aria-label={t('demands.filters.bar')} className="inline-flex min-w-0 shrink items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
      <label className={cn(ITEM, 'min-w-28 max-w-64 flex-1 cursor-text text-muted focus-within:bg-surface focus-within:shadow-card')}>
        <Search className="size-3.5 shrink-0" aria-hidden />
        <input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('demands.filters.search')}
          aria-label={t('demands.filters.search')}
          className="w-full min-w-0 bg-transparent text-fg outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />
      <FilterMenu
        label={t('demands.filters.project')}
        allLabel={t('demands.filters.projectAll')}
        options={projectOptions}
        value={filters.projectId ? [filters.projectId] : []}
        onChange={(value) => onChange({ ...filters, search: text, projectId: value[0] ?? '' })}
      />
      <FilterMenu
        multiple
        label={t('demands.filters.priority')}
        allLabel={t('demands.filters.all')}
        options={priorities}
        value={filters.priorityIds}
        onChange={(value) => onChange({ ...filters, search: text, priorityIds: value })}
      />
      <FilterMenu
        multiple
        label={t('demands.filters.urgency')}
        allLabel={t('demands.filters.all')}
        options={urgencies}
        value={filters.urgencies}
        onChange={(value) => onChange({ ...filters, search: text, urgencies: value })}
      />
      {active && (
        <button
          type="button"
          onClick={() => {
            setText('')
            onChange({ search: '', projectId: '', priorityIds: [], urgencies: [] })
          }}
          className={cn(ITEM, 'text-primary hover:text-primary-hover')}
          aria-label={t('demands.filters.clear')}
        >
          <X className="size-3.5 shrink-0 @min-[961px]:hidden" aria-hidden />
          <span className="@max-[960px]:hidden">{t('demands.filters.clear')}</span>
        </button>
      )}
    </div>
  )
}

/**
 * Botão de filtro com menu: um só (Projeto, com "Todos" no topo e fechando ao escolher) ou vários (Prioridade,
 * Urgência). Sem escolha: "Projeto: todos" (numa linha apertada, só "Projeto"); com escolha: "Projeto: Alta +1".
 */
function FilterMenu({
  label,
  allLabel,
  options,
  value,
  onChange,
  multiple = false,
}: {
  label: string
  allLabel: string
  options: InboxFilterOption[]
  value: string[]
  onChange: (value: string[]) => void
  multiple?: boolean
}) {
  const chosen = options.filter((option) => value.includes(option.value))
  const first = chosen[0]
  const summary = first ? first.label + (chosen.length > 1 ? ` +${chosen.length - 1}` : '') : ''
  const on = chosen.length > 0
  return (
    <AppPopover
      label={label}
      className="min-w-52 p-1"
      trigger={
        <button type="button" className={cn(ITEM, on ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg')}>
          {on ? (
            <>
              <span className="@max-[1440px]:hidden">{label}:</span>{' '}
              <span className="max-w-40 truncate font-semibold">{summary}</span>
            </>
          ) : (
            <>
              {label}
              <span className="@max-[1440px]:hidden">: {allLabel}</span>
            </>
          )}
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </button>
      }
    >
      {(close) => (
        <ul className="flex flex-col">
          {!multiple && (
            <li>
              <Choice
                selected={!on}
                onSelect={() => {
                  onChange([])
                  close()
                }}
              >
                {allLabel.charAt(0).toUpperCase() + allLabel.slice(1)}
              </Choice>
            </li>
          )}
          {options.map((option) => {
            const selected = value.includes(option.value)
            return (
              <li key={option.value}>
                <Choice
                  selected={selected}
                  onSelect={() => {
                    if (!multiple) {
                      onChange([option.value])
                      close()
                    } else onChange(selected ? value.filter((v) => v !== option.value) : [...value, option.value])
                  }}
                >
                  {option.prefix}
                  <span className="truncate">{option.label}</span>
                </Choice>
              </li>
            )
          })}
        </ul>
      )}
    </AppPopover>
  )
}

function Choice({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
    >
      <span
        aria-hidden
        className={cn('inline-flex size-4 shrink-0 items-center justify-center rounded border', selected ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong')}
      >
        {selected && <Check className="size-3" />}
      </span>
      {children}
    </button>
  )
}
