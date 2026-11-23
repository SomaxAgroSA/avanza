import { Link, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, Inbox } from 'lucide-react'
import {
  DEMAND_BOXES,
  DEMAND_KPI_STATUSES,
  countByStatus,
  demandActionsFor,
  groupByStatus,
  hasInboxFilters,
  inboxQuery,
  readInboxFilters,
  sortByUrgencyPriority,
  splitAssignedBox,
  loadPercent,
  writeInboxFilters,
  type DemandBox,
  type DemandCounts,
  type DemandListFilters,
  type InboxFilters,
  type TeamLoad,
} from '@/domain/demands'
import type { UserSummary } from '@/domain/projects'
import type { TaskSummary } from '@/domain/tasks'
import { AppAvatar, AppCard, AppEmptyState, AppErrorState, AppSegmentedControl, AppSelect, AppSkeleton } from '@/presentation/components'
import { formatNumber, formatShortDateTime } from '@/core/utils/format'
import { cn } from '@/core/utils/cn'
import { useCan, useSession } from '@/features/auth/session'
import { TasksHeader } from '@/features/tasks/TasksHeader'
import { DemandActions } from './DemandActions'
import { DemandChip, DemandStatusBadge, ProjectChip } from './demand-visuals'
import { useDemandList, useDemandOverview, useDemandOwners } from './queries'
import { useCompanies } from '@/features/companies/queries'
import { PROJECT_OPTIONS_QUERY, useProjects } from '@/features/projects/queries'
import { usePriorities } from '@/features/workflow/queries'
import { InboxFilterBar, type InboxFilterOption } from './InboxFilterBar'

const isBox = (value: string | null): value is DemandBox => !!value && (DEMAND_BOXES as readonly string[]).includes(value)
/** Opção "Todos" dos filtros de pessoa. */
const ANY = '__any__'

/**
 * Demandas internas (§45) dentro de Tarefas: Recebidas por mim (grupos por passo, números dos quatro
 * primeiros, Atribuir/Reatribuir e a Carga da minha equipe), Atribuídas a mim (Começar · Passar a… ·
 * Concluir), Pedidas por mim (Validar · Devolver) e — só com `projects.view_all` — Todas (todas as
 * demandas, com os números, os filtros Responsável e Atribuída a e a Carga das equipes). A caixa e os
 * filtros ficam no endereço (`?box=&owner=&assignee=`).
 */
export function DemandsPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const seesAll = useCan('projects.view_all')
  const boxes = DEMAND_BOXES.filter((b) => b !== 'all' || seesAll)
  const raw = params.get('box')
  const box: DemandBox = isBox(raw) && boxes.includes(raw) ? raw : 'received'
  const overview = useDemandOverview()
  const counts = overview.data?.counts
  const open = (b: DemandBox) => (counts ? DEMAND_KPI_STATUSES.reduce((sum, status) => sum + counts[b][status], 0) : undefined)
  // filtros da Bandeja (ajuste 23/11): valem em todas as caixas e ficam no endereço
  const inbox = readInboxFilters(params)
  const filtering = hasInboxFilters(inbox)
  const filters: DemandListFilters = { ...inboxQuery(inbox), ...(box === 'all' ? personFilters(params) : {}) }
  const list = useDemandList(box, filters)
  const projectOptions = useInboxProjects(list.data?.items ?? [])
  const priorities = usePriorities(false)
  const priorityOptions: InboxFilterOption[] = (priorities.data ?? []).map((p) => ({ value: p.id, label: p.name }))
  const setInbox = useCallback((next: InboxFilters) => setParams(writeInboxFilters(params, next), { replace: true }), [params, setParams])
  // com filtro, os números contam o que a lista mostra (enquanto ela vem inteira); sem filtro, os da caixa
  const kpiCounts = (b: DemandBox) => {
    const data = list.data
    if (filtering && data && data.total <= data.items.length) return countByStatus(data.items)
    return counts?.[b]
  }

  const label = (text: string, total: number | undefined) => (
    <>
      {text}
      {/* numa linha apertada (< 960px) os números somem */}
      {total !== undefined && <span className="rounded-full bg-surface px-1.5 text-xs font-semibold tabular-nums text-muted @max-[960px]:hidden">{total}</span>}
    </>
  )

  const setFilter = (key: 'owner' | 'assignee' | 'company', value: string) => {
    const next = new URLSearchParams(params)
    if (value === ANY) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  return (
    <>
      <TasksHeader>
        <AppSegmentedControl<DemandBox>
          className="shrink-0"
          label={t('demands.page.tabsLabel')}
          value={box}
          // trocar de caixa mantém os filtros da Bandeja (os de pessoa são só da caixa Todas)
          onValueChange={(value) => setParams(writeInboxFilters(value === 'received' ? new URLSearchParams() : new URLSearchParams({ box: value }), inbox), { replace: true })}
          options={boxes.map((b) => ({ value: b, label: label(t(`demands.tabs.${b}`), open(b)) }))}
        />
        <InboxFilterBar filters={inbox} onChange={setInbox} projects={projectOptions} priorities={priorityOptions} />
      </TasksHeader>
      {(box === 'received' || box === 'all') && kpiCounts(box) && <KpiCards counts={kpiCounts(box)!} />}
      {box === 'received' ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <DemandBoxList box="received" filters={filters} />
          <TeamLoadCard team={overview.data?.team ?? []} loading={overview.isPending} />
        </div>
      ) : box === 'all' ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <PersonFilters filters={filters} team={overview.data?.allTeam ?? []} onChange={setFilter} />
            <DemandBoxList box="all" filters={filters} />
          </div>
          <TeamLoadCard variant="all" team={overview.data?.allTeam ?? []} loading={overview.isPending} />
        </div>
      ) : (
        <DemandBoxList box={box} filters={filters} />
      )}
    </>
  )
}

/**
 * Projetos do filtro da Bandeja: os que a pessoa vê, somados aos que aparecem na caixa (tarefa de projeto com
 * responsável, que ela recebe sem ser do projeto), pelo nome.
 */
function useInboxProjects(items: readonly TaskSummary[]): InboxFilterOption[] {
  const projects = useProjects(PROJECT_OPTIONS_QUERY)
  return useMemo(() => {
    const byId = new Map<string, string>()
    ;(projects.data?.items ?? []).forEach((p) => byId.set(p.id, p.name))
    items.forEach((task) => {
      if (task.project) byId.set(task.project.id, task.project.name)
    })
    return [...byId.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [projects.data, items])
}

/** Filtros de pessoa da caixa Todas, lidos do endereço (`owner`, `assignee`). */
function personFilters(params: URLSearchParams): DemandListFilters {
  const out: DemandListFilters = {}
  const owner = params.get('owner')
  const assignee = params.get('assignee')
  const company = params.get('company')
  if (owner) out.ownerId = owner
  if (assignee) out.assigneeId = assignee
  if (company) out.companyId = company
  return out
}

/** Números dos quatro primeiros passos (Sem atribuir, Atribuídas, Em andamento, Para validar). */
function KpiCards({ counts }: { counts: Pick<DemandCounts[DemandBox], (typeof DEMAND_KPI_STATUSES)[number]> }) {
  const { t } = useTranslation()
  return (
    <section aria-label={t('demands.page.kpis')} className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {DEMAND_KPI_STATUSES.map((status) => (
        <div key={status} className="rounded-xl border border-border bg-surface px-4 py-3 shadow-card">
          <p className="text-xs font-medium text-muted">{t(`demands.groups.${status}`)}</p>
          <p className="text-2xl font-semibold tabular-nums text-fg" data-testid={`kpi-${status}`}>
            {counts[status]}
          </p>
        </div>
      ))}
    </section>
  )
}

/**
 * Filtros da caixa Todas: Responsável e Atribuída a. As pessoas vêm da lista de responsáveis possíveis
 * (pessoas ativas) somada a quem aparece na Carga das equipes.
 */
function PersonFilters({ filters, team, onChange }: { filters: DemandListFilters; team: TeamLoad[]; onChange: (key: 'owner' | 'assignee' | 'company', value: string) => void }) {
  const { t } = useTranslation()
  // Empresa (§46): as ativas
  const companies = useCompanies()
  const companyOptions = [{ value: ANY, label: t('companies.all') }, ...(companies.data ?? []).map((c) => ({ value: c.id, label: c.name }))]
  const owners = useDemandOwners(useCan('tasks.create'))
  const people = new Map<string, UserSummary>()
  ;[...(owners.data ?? []), ...team.map((member) => member.user)].forEach((person) => people.set(person.id, person))
  const sorted = [...people.values()].sort((a, b) => a.name.localeCompare(b.name))
  const options = [
    { value: ANY, label: t('demands.filters.any') },
    ...sorted.map((person) => ({ value: person.id, label: person.name, prefix: <AppAvatar name={person.name} src={person.avatarUrl} size="xs" /> })),
  ]
  const known = (id: string | undefined) => (id && people.has(id) ? id : ANY)
  return (
    // uma linha só, que nunca quebra: os seletores dividem o espaço e param em ~132px (no celular, a linha rola)
    <div role="group" aria-label={t('demands.filters.label')} className="-m-1 flex flex-nowrap items-end gap-3 overflow-x-auto p-1">
      <AppSelect
        size="sm"
        searchable
        label={t('demands.filters.owner')}
        value={known(filters.ownerId)}
        onValueChange={(value) => onChange('owner', value)}
        options={options}
        className="min-w-[8.25rem] max-w-64 flex-1"
      />
      <AppSelect
        size="sm"
        searchable
        label={t('demands.filters.assignee')}
        value={known(filters.assigneeId)}
        onValueChange={(value) => onChange('assignee', value)}
        options={options}
        className="min-w-[8.25rem] max-w-64 flex-1"
      />
      <AppSelect
        size="sm"
        label={t('companies.field')}
        value={filters.companyId && companyOptions.some((o) => o.value === filters.companyId) ? filters.companyId : ANY}
        onValueChange={(value) => onChange('company', value)}
        options={companyOptions}
        className="min-w-[8.25rem] max-w-64 flex-1"
      />
    </div>
  )
}

/**
 * Uma caixa: as demandas agrupadas por passo (as concluídas por último), cada uma com os botões dela. Em
 * Atribuídas a mim (ajuste 23/11): o que está comigo ("Para validar" vira "Em validação") e, recolhidos no fim,
 * Concluídas (últimos 30 dias) e Passadas a outra pessoa — o histórico de quem executa.
 */
function DemandBoxList({ box, filters }: { box: DemandBox; filters?: DemandListFilters }) {
  const { t } = useTranslation()
  const me = useSession().current?.user.id
  const [params] = useSearchParams()
  const list = useDemandList(box, filters)
  const priorities = usePriorities(false)
  const order = (priorities.data ?? []).map((p) => p.id)
  const all = list.data?.items ?? []
  const split = box === 'assigned' ? splitAssignedBox(all, me) : null
  const items = split ? split.active : all
  const total = list.data?.total ?? 0
  const filtering = hasInboxFilters(readInboxFilters(params))
  // o "← Voltar" da página da tarefa volta para a mesma caixa (com os filtros)
  const back = params.toString() ? `/tasks/demands?${params.toString()}` : '/tasks/demands'
  const executor = box === 'assigned'

  if (list.isPending) return <AppSkeleton className="h-64 rounded-2xl" />
  if (list.isError) return <AppErrorState onRetry={() => void list.refetch()} />
  if (all.length === 0) {
    return (
      <AppCard>
        <AppEmptyState compact icon={<Inbox />} title={filtering ? t('demands.empty.filtered') : t(`demands.empty.${box}`)} />
      </AppCard>
    )
  }
  const rows = (list: readonly TaskSummary[]) => (
    <ul>
      {list.map((task) => (
        <li key={task.id} className="border-t border-border first:border-t-0">
          <DemandRow task={task} box={box} back={back} executor={executor} actions={demandActionsFor(me, task, { viewAll: box === 'all' })} />
        </li>
      ))}
    </ul>
  )
  return (
    <AppCard padded={false} className="px-4 py-2">
      {/* colunas (ajuste 23/11): Estado, Urgência, Prioridade e Atribuída a, cada uma com o seu título */}
      <div aria-hidden className={cn(ROW_GRID, 'hidden border-b border-border pt-2 pb-2 text-[11px] font-bold tracking-wider text-muted uppercase sm:grid')}>
        <span>{t('demands.columns.task')}</span>
        <span>{t('demands.columns.status')}</span>
        <span>{t('demands.columns.urgency')}</span>
        <span>{t('demands.columns.priority')}</span>
        <span>{t('demands.columns.assignee')}</span>
        <span />
      </div>
      {items.length === 0 && <p className="py-3 text-sm text-muted">{t('demands.empty.assigned')}</p>}
      {groupByStatus(sortByUrgencyPriority(items, order)).map((group) => {
        const label = executor && group.status === 'to_validate' ? t('demands.groups.inValidation') : t(`demands.groups.${group.status}`)
        return (
          <section key={group.status} aria-label={label}>
            <h2 className="mt-3 mb-1 text-[11px] font-bold tracking-wider text-muted uppercase">
              {label} · {group.items.length}
            </h2>
            {rows(group.items)}
          </section>
        )
      })}
      {split && split.done.length > 0 && <HistoryGroup label={t('demands.groups.recentDone')} count={split.done.length}>{rows(split.done)}</HistoryGroup>}
      {split && split.passed.length > 0 && <HistoryGroup label={t('demands.groups.passed')} count={split.passed.length}>{rows(split.passed)}</HistoryGroup>}
      {box === 'all' && total > items.length && <p className="border-t border-border py-3 text-xs text-muted">{t('demands.page.truncated', { shown: items.length, total })}</p>}
    </AppCard>
  )
}

/** Grupo recolhido do histórico (fechado ao abrir a caixa; o número fica à vista). */
function HistoryGroup({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <section aria-label={label} className="border-t border-border">
      <h2 className="mt-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-1.5 py-2 text-left text-[11px] font-bold tracking-wider text-muted uppercase hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} aria-hidden />
          {label} · {count}
        </button>
      </h2>
      {open && children}
    </section>
  )
}

/**
 * Linha: tipo · departamento, título (abre a página inteira), passo, quem executa e prazo (ou
 * prioridade) e os botões. Na caixa Todas, também o responsável.
 */
function DemandRow({ task, box, back, actions, executor = false }: { task: TaskSummary; box: DemandBox; back: string; actions: ReturnType<typeof demandActionsFor>; executor?: boolean }) {
  const { t, i18n } = useTranslation()
  const demand = task.demand
  return (
    <div className={cn(ROW_GRID, 'grid gap-y-2 py-3')}>
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-2 text-xs text-muted">
          {/* demanda interna ou tarefa de projeto com quem recebe e distribui (o nome do projeto) */}
          {task.project ? <ProjectChip name={task.project.name} className="shrink-0" /> : <DemandChip className="shrink-0" />}
          {/* sem o código (fica na página da tarefa e na busca) */}
          <span className="truncate">{[task.type?.name, task.area?.name].filter(Boolean).join(' · ')}</span>
        </p>
        <Link to={`/tasks/${task.id}`} state={{ from: { to: back, place: box } }} className="line-clamp-2 font-semibold text-fg hover:underline">
          {task.title}
        </Link>
        {box === 'all' && demand?.owner && <p className="truncate text-xs text-muted">{t('demands.row.owner', { name: demand.owner.name })}</p>}
        {/* quem valida (ajuste 23/11): à vista de quem executa e do responsável; em Pedidas por mim é a própria pessoa */}
        {demand?.status === 'to_validate' && box !== 'requested' && task.reporter && (
          <p className="truncate text-xs text-warning-soft-fg">{t('demands.row.awaitingValidation', { name: task.reporter.name })}</p>
        )}
      </div>
      <div>{demand && <DemandStatusBadge status={demand.status} executor={executor} />}</div>
      <div className="min-w-0 text-sm" data-testid="demand-urgency">
        <UrgencyDot urgency={task.urgency} />
      </div>
      <div className="min-w-0 truncate text-sm text-fg" data-testid="demand-priority">
        {task.priority?.name ?? '—'}
      </div>
      <div className="min-w-0 text-xs text-muted">
        {task.assignee ? (
          <span className="inline-flex max-w-full items-center gap-1.5 text-sm text-fg">
            <AppAvatar name={task.assignee.name} src={task.assignee.avatarUrl} size="xs" />
            <span className="truncate">{task.assignee.name}</span>
          </span>
        ) : (
          <span className="text-sm">{t('demands.row.noAssignee')}</span>
        )}
        {demand?.dueAt && <span className="block">{t('demands.row.due', { date: formatShortDateTime(demand.dueAt, i18n.language) })}</span>}
      </div>
      <div className="sm:text-right">
        <DemandActions task={task} actions={actions} />
      </div>
    </div>
  )
}

/**
 * Colunas da caixa: tarefa, estado, urgência, prioridade, atribuída a e os botões (no celular, uma embaixo da
 * outra). Proporcionais à largura (ajuste 23/11): numa caixa larga (sem o painel da carga) as colunas acompanham,
 * em vez de ficarem coladas à direita.
 */
const ROW_GRID =
  'items-center gap-x-4 sm:grid-cols-[minmax(0,2.6fr)_minmax(6.5rem,0.7fr)_minmax(6rem,0.6fr)_minmax(5rem,0.5fr)_minmax(7.5rem,0.9fr)_minmax(6.5rem,max-content)]'

const DOT: Record<string, string> = { high: 'bg-danger', medium: 'bg-warning', low: 'bg-success' }

/** Urgência da linha: um ponto da cor (vazado = sem urgência) e o nome, como na demonstração aprovada. */
function UrgencyDot({ urgency }: { urgency: TaskSummary['urgency'] }) {
  const { t } = useTranslation()
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', urgency ? DOT[urgency] : 'border-[1.5px] border-border-strong')} />
      <span className={cn('truncate', urgency ? 'text-fg' : 'text-muted')}>{t(`tasks.urgency.${urgency ?? 'none'}`)}</span>
    </span>
  )
}

/**
 * Carga por pessoa: demandas atribuídas e em andamento e as horas estimadas (barra pelas horas). `team` =
 * Carga da minha equipe (Recebidas por mim); `all` = Carga das equipes (Todas: todas as pessoas).
 */
function TeamLoadCard({ team, loading, variant = 'team' }: { team: TeamLoad[]; loading: boolean; variant?: 'team' | 'all' }) {
  const { t, i18n } = useTranslation()
  const keys = variant === 'all' ? 'demands.allLoad' : 'demands.load'
  return (
    <AppCard title={t(`${keys}.title`)}>
      {loading ? (
        <AppSkeleton className="h-24" />
      ) : team.length === 0 ? (
        <p className="text-sm text-muted">{t(`${keys}.empty`)}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t(`${keys}.title`)}>
          {team.map((member) => {
            const hours = formatNumber(member.estimatedHours, i18n.language)
            return (
              <li key={member.user.id} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm" aria-label={t('demands.load.aria', { name: member.user.name, count: member.openCount, hours })}>
                <span className="inline-flex min-w-0 items-center gap-2">
                  <AppAvatar name={member.user.name} src={member.user.avatarUrl} size="xs" />
                  <span className="truncate">{member.user.name}</span>
                </span>
                <span className="h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${loadPercent(member.estimatedHours, team)}%` }} />
                </span>
                <span className="text-right text-xs whitespace-nowrap text-muted tabular-nums">{t('demands.load.value', { count: member.openCount, hours })}</span>
              </li>
            )
          })}
        </ul>
      )}
    </AppCard>
  )
}
