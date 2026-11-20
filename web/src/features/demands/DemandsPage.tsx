import { Link, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Inbox } from 'lucide-react'
import { DEMAND_BOXES, DEMAND_KPI_STATUSES, demandActionsFor, groupByStatus, loadPercent, type DemandBox, type TeamLoad } from '@/domain/demands'
import type { TaskSummary } from '@/domain/tasks'
import { AppAvatar, AppCard, AppEmptyState, AppErrorState, AppSegmentedControl, AppSkeleton } from '@/presentation/components'
import { formatNumber, formatShortDateTime } from '@/core/utils/format'
import { useSession } from '@/features/auth/session'
import { TasksHeader } from '@/features/tasks/TasksHeader'
import { DemandActions } from './DemandActions'
import { DemandChip, DemandStatusBadge, ProjectChip } from './demand-visuals'
import { useDemandList, useDemandOverview } from './queries'

const isBox = (value: string | null): value is DemandBox => !!value && (DEMAND_BOXES as readonly string[]).includes(value)

/**
 * Demandas internas (§45) dentro de Tarefas: Recebidas por mim (grupos por passo, números dos quatro
 * primeiros, Atribuir/Reatribuir e a Carga da minha equipe), Atribuídas a mim (Começar · Passar a… ·
 * Concluir) e Pedidas por mim (Validar · Devolver). A caixa fica no endereço (`?box=`).
 */
export function DemandsPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const raw = params.get('box')
  const box: DemandBox = isBox(raw) ? raw : 'received'
  const overview = useDemandOverview()
  const counts = overview.data?.counts
  const open = (b: DemandBox) => (counts ? DEMAND_KPI_STATUSES.reduce((sum, status) => sum + counts[b][status], 0) : undefined)

  const label = (text: string, total: number | undefined) => (
    <>
      {text}
      {total !== undefined && <span className="rounded-full bg-surface px-1.5 text-xs font-semibold tabular-nums text-muted">{total}</span>}
    </>
  )

  return (
    <>
      <TasksHeader description={t(`demands.hints.${box}`)} />
      <AppSegmentedControl<DemandBox>
        label={t('demands.page.tabsLabel')}
        className="mb-4"
        value={box}
        onValueChange={(value) => setParams(value === 'received' ? {} : { box: value }, { replace: true })}
        options={DEMAND_BOXES.map((b) => ({ value: b, label: label(t(`demands.tabs.${b}`), open(b)) }))}
      />
      {box === 'received' && counts && (
        <section aria-label={t('demands.page.kpis')} className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {DEMAND_KPI_STATUSES.map((status) => (
            <div key={status} className="rounded-xl border border-border bg-surface px-4 py-3 shadow-card">
              <p className="text-xs font-medium text-muted">{t(`demands.groups.${status}`)}</p>
              <p className="text-2xl font-semibold tabular-nums text-fg" data-testid={`kpi-${status}`}>
                {counts.received[status]}
              </p>
            </div>
          ))}
        </section>
      )}
      {box === 'received' ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <DemandBoxList box="received" />
          <TeamLoadCard team={overview.data?.team ?? []} loading={overview.isPending} />
        </div>
      ) : (
        <DemandBoxList box={box} />
      )}
    </>
  )
}

/** Uma caixa: as demandas agrupadas por passo (as concluídas por último), cada uma com os botões dela. */
function DemandBoxList({ box }: { box: DemandBox }) {
  const { t } = useTranslation()
  const me = useSession().current?.user.id
  const list = useDemandList(box)
  // Atribuídas a mim: só o que ainda está comigo (as concluídas ficam na lista de tarefas)
  const items = (list.data?.items ?? []).filter((task) => box !== 'assigned' || task.demand?.status !== 'done')

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
                <DemandRow task={task} box={box} actions={demandActionsFor(me, task)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </AppCard>
  )
}

/** Linha: código · tipo · departamento, título (abre a página inteira), passo, quem executa e prazo (ou prioridade) e os botões. */
function DemandRow({ task, box, actions }: { task: TaskSummary; box: DemandBox; actions: ReturnType<typeof demandActionsFor> }) {
  const { t, i18n } = useTranslation()
  const demand = task.demand
  return (
    <div className="grid items-center gap-x-3 gap-y-2 py-3 sm:grid-cols-[minmax(0,1fr)_8.5rem_11rem_auto]">
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-2 text-xs text-muted">
          {/* demanda interna ou tarefa de projeto com quem recebe e distribui (o nome do projeto) */}
          {task.project ? <ProjectChip name={task.project.name} className="shrink-0" /> : <DemandChip className="shrink-0" />}
          <span className="truncate">{[task.code, task.type?.name, task.area?.name].filter(Boolean).join(' · ')}</span>
        </p>
        <Link
          to={`/tasks/${task.id}`}
          state={{ from: { to: box === 'received' ? '/tasks/demands' : `/tasks/demands?box=${box}`, place: box } }}
          className="block truncate font-semibold text-fg hover:underline"
        >
          {task.title}
        </Link>
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

/** Carga da minha equipe: por pessoa, demandas atribuídas e em andamento e as horas estimadas (barra pelas horas). */
function TeamLoadCard({ team, loading }: { team: TeamLoad[]; loading: boolean }) {
  const { t, i18n } = useTranslation()
  return (
    <AppCard title={t('demands.load.title')} description={t('demands.load.hint')}>
      {loading ? (
        <AppSkeleton className="h-24" />
      ) : team.length === 0 ? (
        <p className="text-sm text-muted">{t('demands.load.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t('demands.load.title')}>
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
      <p className="mt-3 text-xs text-muted">{t('demands.load.foot')}</p>
    </AppCard>
  )
}
