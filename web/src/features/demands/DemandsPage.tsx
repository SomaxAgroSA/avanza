import { Link, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Inbox } from 'lucide-react'
import {
  DEMAND_BOXES,
  DEMAND_KPI_STATUSES,
  demandActionsFor,
  groupByStatus,
  loadPercent,
  type DemandBox,
  type DemandCounts,
  type DemandListFilters,
  type TeamLoad,
} from '@/domain/demands'
import type { UserSummary } from '@/domain/projects'
import type { TaskSummary } from '@/domain/tasks'
import { AppAvatar, AppCard, AppEmptyState, AppErrorState, AppSegmentedControl, AppSelect, AppSkeleton } from '@/presentation/components'
import { formatNumber, formatShortDateTime } from '@/core/utils/format'
import { useCan, useSession } from '@/features/auth/session'
import { TasksHeader } from '@/features/tasks/TasksHeader'
import { DemandActions } from './DemandActions'
import { DemandChip, DemandStatusBadge, ProjectChip } from './demand-visuals'
import { useDemandList, useDemandOverview, useDemandOwners } from './queries'
import { useCompanies } from '@/features/companies/queries'

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
  const filters = box === 'all' ? personFilters(params) : {}

  const label = (text: string, total: number | undefined) => (
    <>
      {text}
      {total !== undefined && <span className="rounded-full bg-surface px-1.5 text-xs font-semibold tabular-nums text-muted">{total}</span>}
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
          label={t('demands.page.tabsLabel')}
          value={box}
          onValueChange={(value) => setParams(value === 'received' ? {} : { box: value }, { replace: true })}
          options={boxes.map((b) => ({ value: b, label: label(t(`demands.tabs.${b}`), open(b)) }))}
        />
      </TasksHeader>
      {(box === 'received' || box === 'all') && counts && <KpiCards counts={counts[box]} />}
      {box === 'received' ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <DemandBoxList box="received" />
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
        <DemandBoxList box={box} />
      )}
    </>
  )
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
function KpiCards({ counts }: { counts: DemandCounts[DemandBox] }) {
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
    <div role="group" aria-label={t('demands.filters.label')} className="flex flex-wrap items-end gap-3">
      <AppSelect
        size="sm"
        searchable
        label={t('demands.filters.owner')}
        value={known(filters.ownerId)}
        onValueChange={(value) => onChange('owner', value)}
        options={options}
        className="min-w-48"
      />
      <AppSelect
        size="sm"
        searchable
        label={t('demands.filters.assignee')}
        value={known(filters.assigneeId)}
        onValueChange={(value) => onChange('assignee', value)}
        options={options}
        className="min-w-48"
      />
      <AppSelect
        size="sm"
        label={t('companies.field')}
        value={filters.companyId && companyOptions.some((o) => o.value === filters.companyId) ? filters.companyId : ANY}
        onValueChange={(value) => onChange('company', value)}
        options={companyOptions}
        className="min-w-48"
      />
    </div>
  )
}

/** Uma caixa: as demandas agrupadas por passo (as concluídas por último), cada uma com os botões dela. */
function DemandBoxList({ box, filters }: { box: DemandBox; filters?: DemandListFilters }) {
  const { t } = useTranslation()
  const me = useSession().current?.user.id
  const [params] = useSearchParams()
  const list = useDemandList(box, filters)
  // Atribuídas a mim: só o que ainda está comigo (as concluídas ficam na lista de tarefas)
  const items = (list.data?.items ?? []).filter((task) => box !== 'assigned' || task.demand?.status !== 'done')
  const total = list.data?.total ?? 0
  // o "← Voltar" da página da tarefa volta para a mesma caixa (com os filtros)
  const back = box === 'received' ? '/tasks/demands' : `/tasks/demands?${params.toString()}`

  if (list.isPending) return <AppSkeleton className="h-64 rounded-2xl" />
  if (list.isError) return <AppErrorState onRetry={() => void list.refetch()} />
  if (items.length === 0) {
    return (
      <AppCard>
        <AppEmptyState compact icon={<Inbox />} title={t(`demands.empty.${box}`)} />
      </AppCard>
    )
  }
  return (
    <AppCard padded={false} className="px-4 py-2">
      {groupByStatus(items).map((group) => (
        <section key={group.status} aria-label={t(`demands.groups.${group.status}`)}>
          <h2 className="mt-3 mb-1 text-[11px] font-bold tracking-wider text-muted uppercase">
            {t(`demands.groups.${group.status}`)} · {group.items.length}
          </h2>
          <ul>
            {group.items.map((task) => (
              <li key={task.id} className="border-t border-border first:border-t-0">
                <DemandRow task={task} box={box} back={back} actions={demandActionsFor(me, task, { viewAll: box === 'all' })} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {box === 'all' && total > items.length && <p className="border-t border-border py-3 text-xs text-muted">{t('demands.page.truncated', { shown: items.length, total })}</p>}
    </AppCard>
  )
}

/**
 * Linha: tipo · departamento, título (abre a página inteira), passo, quem executa e prazo (ou
 * prioridade) e os botões. Na caixa Todas, também o responsável.
 */
function DemandRow({ task, box, back, actions }: { task: TaskSummary; box: DemandBox; back: string; actions: ReturnType<typeof demandActionsFor> }) {
  const { t, i18n } = useTranslation()
  const demand = task.demand
  return (
    <div className="grid items-center gap-x-3 gap-y-2 py-3 sm:grid-cols-[minmax(0,1fr)_8.5rem_11rem_auto]">
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
      </div>
      <div>{demand && <DemandStatusBadge status={demand.status} />}</div>
      <div className="min-w-0 text-xs text-muted">
        {task.assignee ? (
          <span className="inline-flex max-w-full items-center gap-1.5 text-fg">
            <AppAvatar name={task.assignee.name} src={task.assignee.avatarUrl} size="xs" />
            <span className="truncate">{task.assignee.name}</span>
          </span>
        ) : (
          <span>{t('demands.row.noAssignee')}</span>
        )}
        <span className="block">
          {demand?.dueAt ? t('demands.row.due', { date: formatShortDateTime(demand.dueAt, i18n.language) }) : t('demands.row.priority', { name: task.priority?.name ?? '—' })}
        </span>
      </div>
      <div className="sm:text-right">
        <DemandActions task={task} actions={actions} />
      </div>
    </div>
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
        <p className="text-sm text-muted">{t(variant === 'all' ? 'demands.allLoad.empty' : 'demands.load.empty')}</p>
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
