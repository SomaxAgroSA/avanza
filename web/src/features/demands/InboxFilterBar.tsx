import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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

/**
 * A linha da Bandeja se adapta à largura (ajustes 23/11): mede a linha inteira (AppToolbar) e, enquanto ela não
 * cabe, compacta mais um passo (os passos se somam): 1 — os filtros sem o ": todas" ("Proyecto ▾"); 2 — os
 * botões de criar encurtam ("＋ Tarefa"); 3 — as caixas sem os números e os filtros mais justos; 4 — as caixas
 * com o nome curto ("Recebidas"); 5 — a busca fica só com a lupa (abre ao clicar e, com texto, mostra o começo). Volta ao completo quando a tela alarga. Sem estado do React: só o atributo
 * `data-compact` na linha ("1 2 3"), lido pelas classes `[[data-compact~='n']_&]`.
 *
 * O grupo dos filtros não encolhe abaixo do conteúdo (sem `min-w-0`): se encolhesse, os botões dele passariam
 * por baixo dos de criar sem a linha "transbordar", e a compactação nunca começaria (erro de 23/11).
 */
function useFitToolbar() {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const bar = ref.current?.closest<HTMLElement>('[data-toolbar]')
    if (!bar) return
    const fit = () => {
      bar.removeAttribute('data-compact')
      const levels: string[] = []
      for (const level of ['1', '2', '3', '4', '5']) {
        if (bar.scrollWidth <= bar.clientWidth) return
        levels.push(level)
        bar.setAttribute('data-compact', levels.join(' '))
      }
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return () => bar.removeAttribute('data-compact')
    const observer = new ResizeObserver(fit)
    observer.observe(bar)
    return () => {
      observer.disconnect()
      bar.removeAttribute('data-compact')
    }
  })
  return ref
}

/** Mesmo item do controle segmentado das caixas (altura, cantos e escolhido em branco). */
const ITEM = "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none @max-[960px]:px-2 [[data-compact~='3']_&]:px-2"

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
  const ref = useFitToolbar()

  return (
    // ocupa o espaço livre da linha (como as caixas, o mesmo grupo); a busca cresce com ele
    <div ref={ref} role="group" aria-label={t('demands.filters.bar')} className="flex flex-1 items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
      <label className={cn(ITEM, "min-w-24 flex-1 cursor-text text-muted focus-within:bg-surface focus-within:shadow-card [[data-compact~='5']_&]:min-w-9 [[data-compact~='5']_&]:focus-within:min-w-40 [[data-compact~='5']_&]:not-focus-within:has-[input:not(:placeholder-shown)]:min-w-24")}>
        <Search className="size-3.5 shrink-0" aria-hidden />
        <input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('demands.filters.search')}
          aria-label={t('demands.filters.search')}
          className="w-full min-w-0 bg-transparent text-fg outline-none placeholder:text-muted [[data-compact~='5']_&]:placeholder:text-transparent [&::-webkit-search-cancel-button]:hidden"
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
          <X className="hidden size-3.5 shrink-0 [[data-compact~='2']_&]:inline" aria-hidden />
          <span className="[[data-compact~='2']_&]:hidden">{t('demands.filters.clear')}</span>
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
        <button type="button" title={on ? `${label}: ${chosen.map((option) => option.label).join(', ')}` : undefined} className={cn(ITEM, on ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg')}>
          {on ? (
            // a partir do passo 3, um nome longo ("DRE SOMAX PARAGUAY") corta com "…"; o inteiro fica na dica
            <span className="truncate [[data-compact~='3']_&]:max-w-36">
              <span className="[[data-compact]_&]:hidden">{label}: </span>
              <span className="font-semibold">{summary}</span>
            </span>
          ) : (
            <>
              <span className="[[data-compact]_&]:hidden">
                {label}: {allLabel}
              </span>
              <span className="hidden [[data-compact]_&]:inline">{label}</span>
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
