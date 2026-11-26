import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { INTERNAL_PROJECT, NO_INBOX_FILTERS, hasInboxFilters, hasPersonFilters, type InboxFilters, type PersonFilters } from '@/domain/demands'
import { URGENCY_FILTER_VALUES } from '@/domain/urgency'
import type { ScreenKey } from '@/domain/screens'
import { useFitToolbar } from '@/presentation/common/use-fit-toolbar'
import { FilterMenu, type TableFilterDef } from '@/presentation/components/data-table/TableFilters'
import { filterValues } from '@/presentation/components/data-table/filter-values'

export interface InboxFilterOption {
  value: string
  label: string
}

/**
 * Responsável, Atribuída a e Empresa (caixa Todas): os valores e as opções de cada um. `onClear` tira estes e os
 * da Caixa de entrada de uma vez (as duas trocas juntas no endereço; uma depois da outra, a segunda desfaria a primeira).
 */
export interface InboxPeopleFilters {
  filters: PersonFilters
  onChange: (next: PersonFilters) => void
  onClear: () => void
  people: InboxFilterOption[]
  companies: InboxFilterOption[]
}

/**
 * A linha da Caixa de entrada se adapta à largura sem nunca quebrar nem trocar as coisas de lugar (ajuste 25/11;
 * `useFitToolbar` mede a linha e soma um passo por vez, lido por `[[data-compact~='n']_&]` em cada item):
 * 1 — "Lista | Caixa de entrada" e "Lista | Linha do tempo" só com o ícone, e os botões de criar curtos
 * ("＋ Tarefa"); 2 — as caixas sem os números; 3 — as caixas com o nome curto ("Recebidas"); 4 — cada filtro com a
 * largura do próprio nome (sem o mínimo de ~132px); 5 — a busca fica só com a lupa (abre por cima dos filtros ao
 * clicar; com texto, a lupa fica em verde suave); 6 — as caixas viram um seletor ("Todas ▾", como os grupos de
 * botões da grade); 7 — os filtros sem a seta (o nome continua inteiro); 8 — por último os nomes cortam com "…",
 * primeiro os mais longos e nunca abaixo de ~64px (sem se sobrepor; o nome inteiro fica na dica). Só se nem assim
 * couber (celular), a linha rola.
 *
 * O grupo dos filtros não encolhe abaixo do conteúdo (sem `min-w-0`): se encolhesse, os botões dele passariam por
 * baixo dos de criar sem a linha "transbordar", e a compactação nunca começaria (erro de 23/11). Por isso, no passo
 * 8 os filtros ficam numa grade `minmax(mínimo, max-content)`: o mínimo do grupo passa a ser a soma dos mínimos.
 */
const INBOX_LEVELS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const

/** Botão de cada filtro: largura do nome (passo 4), sem a seta (7) e a largura da coluna da grade (8). */
const FILTER_FIT = cn(
  "[[data-compact~='4']_&]:min-w-0 [[data-compact~='7']_&]:[&>svg]:hidden",
  "[[data-compact~='7']:not([data-compact~='8'])_&]:px-2.5 [[data-compact~='8']_&]:w-full [[data-compact~='8']_&]:px-2",
)

/** Os filtros juntos: soltos na linha até o passo 8; nele, a grade que corta os nomes. */
const FILTERS_FIT =
  "contents [[data-compact~='8']_&]:grid [[data-compact~='8']_&]:grid-flow-col [[data-compact~='8']_&]:auto-cols-[minmax(4rem,max-content)] [[data-compact~='8']_&]:gap-1.5"

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * Filtros da Caixa de entrada (ajuste 25/11, aprovado em demonstração): o mesmo padrão da grade (Projetos) — a
 * busca na caixa branca com borda e cada filtro no seu botão (FilterMenu): parado só o nome ("Prioridade"), ativo
 * "Prioridade: Alta +1" em verde suave. Todos de várias opções (§51): Projeto (com "Demanda interna", combinável com
 * projetos), Prioridade e Urgência e, na caixa Todas (`people`), Responsável, Atribuída a e Empresa — o painel fica
 * aberto para marcar e desmarcar (fecha com clique fora ou Esc); dentro de um filtro "ou", entre filtros "e". "Limpar" (texto verde, no fim)
 * só aparece com algum filtro e tira todos. Cada filtro só aparece se o perfil o mostra (`shows`, "O que aparece"
 * §48: `tasks.filters.*`). A busca vai para o endereço 300 ms depois da última tecla.
 */
export function InboxFilterBar({
  filters,
  onChange,
  projects,
  priorities,
  people,
  shows = () => true,
}: {
  filters: InboxFilters
  onChange: (next: InboxFilters) => void
  projects: InboxFilterOption[]
  priorities: InboxFilterOption[]
  people?: InboxPeopleFilters
  shows?: (key: ScreenKey) => boolean
}) {
  const { t } = useTranslation()
  const [text, setText] = useState(filters.search)
  // a busca vai para o endereço 300 ms depois da última tecla
  useEffect(() => {
    if (text === filters.search) return
    const timer = setTimeout(() => onChange({ ...filters, search: text }), 300)
    return () => clearTimeout(timer)
  }, [text, filters, onChange])

  const urgencies: InboxFilterOption[] = URGENCY_FILTER_VALUES.map((value) => ({ value, label: t(`tasks.urgency.${value}`) }))
  const projectOptions: InboxFilterOption[] = [{ value: INTERNAL_PROJECT, label: t('demands.chip') }, ...projects]
  const active = hasInboxFilters({ ...filters, search: text }) || (!!people && hasPersonFilters(people.filters))
  const setPerson = (key: keyof PersonFilters, value: string | undefined) => people?.onChange({ ...people.filters, [key]: filterValues(value) })
  const ref = useFitToolbar(INBOX_LEVELS)

  /** Um filtro da barra: sempre de várias opções (§51; o painel fica aberto ao marcar). */
  const filter = (id: string, label: string, allLabel: string, options: InboxFilterOption[]): TableFilterDef => ({
    id,
    label,
    allLabel: capitalize(allLabel),
    options,
    variant: 'menu',
  })

  return (
    // ocupa o espaço livre da linha; a busca cresce com ele
    <div ref={ref} role="group" aria-label={t('demands.filters.bar')} className="flex flex-1 items-center gap-2 [[data-compact~='4']_&]:gap-1.5">
      {shows('tasks.filters.search') && (
        <InboxSearch
          value={text}
          onChange={setText}
          onClear={() => {
            setText('')
            onChange({ ...filters, search: '' })
          }}
        />
      )}
      <div className={FILTERS_FIT}>
        {shows('tasks.filters.project') && (
          <FilterMenu
            className={FILTER_FIT}
            filter={filter('project', t('demands.filters.project'), t('demands.filters.projectAll'), projectOptions)}
            value={filters.projectIds.join(',') || undefined}
            onChange={(value) => onChange({ ...filters, search: text, projectIds: filterValues(value) })}
          />
        )}
        {shows('tasks.filters.priority') && (
          <FilterMenu
            className={FILTER_FIT}
            filter={filter('priority', t('demands.filters.priority'), t('demands.filters.all'), priorities)}
            value={filters.priorityIds.join(',') || undefined}
            onChange={(value) => onChange({ ...filters, search: text, priorityIds: filterValues(value) })}
          />
        )}
        {shows('tasks.filters.urgency') && (
          <FilterMenu
            className={FILTER_FIT}
            filter={filter('urgency', t('demands.filters.urgency'), t('demands.filters.all'), urgencies)}
            value={filters.urgencies.join(',') || undefined}
            onChange={(value) => onChange({ ...filters, search: text, urgencies: filterValues(value) })}
          />
        )}
        {people && (
          <>
            {shows('tasks.filters.responsible') && (
              <FilterMenu
                className={FILTER_FIT}
                filter={filter('owner', t('demands.filters.owner'), t('demands.filters.everyone'), people.people)}
                value={people.filters.ownerIds.join(',') || undefined}
                onChange={(value) => setPerson('ownerIds', value)}
              />
            )}
            {shows('tasks.filters.assignee') && (
              <FilterMenu
                className={FILTER_FIT}
                filter={filter('assignee', t('demands.filters.assignee'), t('demands.filters.everyone'), people.people)}
                value={people.filters.assigneeIds.join(',') || undefined}
                onChange={(value) => setPerson('assigneeIds', value)}
              />
            )}
            {shows('tasks.filters.company') && (
              <FilterMenu
                className={FILTER_FIT}
                filter={filter('company', t('companies.field'), t('demands.filters.all'), people.companies)}
                value={people.filters.companyIds.join(',') || undefined}
                onChange={(value) => setPerson('companyIds', value)}
              />
            )}
          </>
        )}
      </div>
      {active && (
        <button
          type="button"
          onClick={() => {
            setText('')
            if (people) people.onClear()
            else onChange(NO_INBOX_FILTERS)
          }}
          className="shrink-0 rounded-md px-1.5 py-1 text-sm font-semibold text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {t('demands.filters.clear')}
        </button>
      )}
    </div>
  )
}

/**
 * Busca da Caixa de entrada: a mesma caixa branca com borda e lupa da busca da grade (AppSearch), com o ✕ para
 * apagar. No passo 5 da linha fica só a lupa; ao clicar, abre por cima dos filtros ao lado (a linha não se mexe);
 * com texto e fora de foco, a lupa fica em verde suave, como um filtro ativo.
 */
function InboxSearch({ value, onChange, onClear }: { value: string; onChange: (value: string) => void; onClear: () => void }) {
  const { t } = useTranslation()
  const label = t('demands.filters.search')
  return (
    <div className="relative h-9 min-w-[110px] max-w-64 flex-[1_1_150px] [[data-compact~='5']_&]:w-9 [[data-compact~='5']_&]:min-w-9 [[data-compact~='5']_&]:flex-none">
      <label
        title={label}
        className={cn(
          'group/search absolute inset-y-0 left-0 flex w-full cursor-text items-center gap-2 overflow-hidden rounded-md border border-border bg-surface px-3 text-sm text-subtle shadow-xs',
          'transition-[width,border-color,background-color] duration-150 motion-reduce:transition-none',
          'hover:border-border-strong focus-within:border-primary focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-ring',
          "[[data-compact~='5']_&]:px-2.5 [[data-compact~='5']_&]:focus-within:z-10 [[data-compact~='5']_&]:focus-within:w-60 [[data-compact~='5']_&]:focus-within:px-3",
          "[[data-compact~='5']_&]:not-focus-within:has-[input:not(:placeholder-shown)]:border-primary-border [[data-compact~='5']_&]:not-focus-within:has-[input:not(:placeholder-shown)]:bg-primary-soft [[data-compact~='5']_&]:not-focus-within:has-[input:not(:placeholder-shown)]:text-primary-soft-fg",
        )}
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={label}
          aria-label={label}
          className="h-full min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-subtle [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
          <button
            type="button"
            onClick={onClear}
            aria-label={t('common.clearSearch')}
            className="shrink-0 rounded p-0.5 text-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-ring [[data-compact~='5']_&]:hidden [[data-compact~='5']_&]:group-focus-within/search:inline-flex"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </label>
    </div>
  )
}
