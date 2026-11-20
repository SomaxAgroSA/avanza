import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ExternalLink, FileCheck2, FileX2, Laptop, UserCheck } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { formatDateTime, formatRelative } from '@/core/utils/format'
import {
  TASK_SCOPE_SORT,
  awaitingAssignment,
  isClosed,
  responsibleOf,
  scopeBarFilters,
  scopedTaskFilters,
  taskListFilters,
  type TaskKind,
  type TaskScope,
  type TaskSummary,
} from '@/domain/tasks'
import {
  AppBadge,
  AppButton,
  AppConfirmDialog,
  AppDataTable,
  AppIconButton,
  notify,
  useDataTableState,
  type DataTableColumn,
} from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useCan, useSession } from '@/features/auth/session'
import { managementLink } from '@/features/plan/paths'
import { useAreas, usePriorities, useStatuses } from '@/features/workflow/queries'
import { useCompanies } from '@/features/companies/queries'
import { CompanyChip } from '@/features/companies/company-visuals'
import { useTaskMutations, useTasksList } from './queries'
import { TaskEditDialog } from './TaskEditDialog'
import { TaskPreviewDrawer } from './TaskPreviewDrawer'
import { UrgencyCell } from './TaskUrgency'
import { AreaCell } from './TaskArea'
import { useUrgencyFilterOptions } from './urgency-options'
import { useMineFirst } from './use-mine-first'
import { DueDate, PersonCell, TaskCode, TaskIndicators, TaskPriorityBadge, TaskStatusBadge, TaskTypeMark } from './task-visuals'
import { TagList } from '@/features/tags/tag-visuals'
import { DemandChip, DemandDateTime, DemandStatusBadge } from '@/features/demands/demand-visuals'

const EMPTY: TaskSummary[] = []

export interface TasksTableProps {
  /** Chave do estado persistido da tabela. */
  tableId: string
  /** Lista só as tarefas deste projeto (a coluna de projeto some). */
  projectId?: string
  /** Busca aplicada de fora (ex.: /tasks?search=… da command palette). */
  search?: string | null
  onSearchApplied?: () => void
  /** Onde ficam "Colunas" (ex.: a linha das visões da aba Tarefas do projeto); sem ele, na barra de filtros. */
  actionsSlot?: HTMLElement | null
  /**
   * Aba Tarefas do projeto: o que a pessoa pode marcar em cada linha — o que sai no informe (só com a
   * seção Informe, §35) e o que o Responsável TI vê (§36; nunca o próprio Responsável TI).
   */
  marks?: { report: boolean; itVisible: boolean }
  /**
   * Lista de tarefas do menu (§44): Minhas (responsável = quem olha) ou Todas. Só as abertas, a menos que o
   * Status diga outra coisa (o Status parado mostra "Abertas"); Prioridade e Urgência em botões; sem
   * Responsável na barra e sem "Minhas tarefas primeiro" (o escopo substitui); colunas Tarefa (o título, sem o
   * código), Projeto, Status, Responsável, Atribuída a, Prioridade, Urgência e Prazo.
   */
  scope?: TaskScope
  /** Com projeto · Sem projeto (§45; só na Lista de tarefas do menu). */
  kind?: TaskKind
}

/** Ordem das colunas na Lista de tarefas do menu (§44); as que não estão aqui ficam no fim. */
const SCOPE_COLUMN_ORDER = ['code', 'project', 'status', 'responsible', 'assignee', 'priority', 'urgency', 'due_date']
/** Ações de cada linha ("Colunas e ações"): Excluir desligado por padrão (fica no "⋯" e na página da tarefa). */
const ROW_ACTION_DEFAULTS = { delete: false }
/** Ocultas por padrão na Lista de tarefas do menu (continuam em "Colunas"). */
const SCOPE_HIDDEN_COLUMNS = { area: false, type: false, plan_item: false, tags: false, category: false, updated_at: false }

/** Listagem padrão de tarefas (página Tarefas e aba do projeto). */
export function TasksTable({ tableId, projectId, search, onSearchApplied, actionsSlot, marks, scope, kind = 'all' }: TasksTableProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const navigate = useNavigate()
  const errorMessage = useErrorMessage()
  const canEdit = useCan('tasks.edit')
  const canDelete = useCan('tasks.delete')
  const canViewPlan = useCan('plan.view')

  const table = useDataTableState(tableId, {
    sort: scope ? TASK_SCOPE_SORT[scope] : { id: 'updated_at', direction: 'desc' },
    columnVisibility: scope ? SCOPE_HIDDEN_COLUMNS : { category: false, tags: false, plan_item: false, in_report: false, it_visible: false },
    rowActions: ROW_ACTION_DEFAULTS,
  })
  // só os filtros da barra (ajuste 18/11): Área, Situação, Tipo, Projeto… guardados de antes não filtram escondidos — e saem do navegador
  // (na Lista de tarefas do menu, também o Responsável: quem decide é o escopo, §44)
  const filters = useMemo(() => (scope ? scopeBarFilters(table.query.filters) : taskListFilters(table.query.filters)), [table.query.filters, scope])
  const { setFilter } = table
  useEffect(() => {
    Object.keys(table.state.filters)
      .filter((id) => !(id in filters))
      .forEach((id) => setFilter(id, undefined))
  }, [table.state.filters, filters, setFilter])
  // busca vinda de fora (command palette): aplica uma vez e avisa para limpar o endereço
  const { setSearch } = table
  useEffect(() => {
    if (search === null || search === undefined) return
    setSearch(search)
    onSearchApplied?.()
  }, [search, setSearch, onSearchApplied])
  // Lista de tarefas do menu (§44): cada escopo abre na sua ordem (Minhas pelo prazo; Todas pelas mais recentes)
  const { setSort } = table
  useEffect(() => {
    if (scope) setSort(TASK_SCOPE_SORT[scope])
  }, [scope, setSort])
  // minhas tarefas primeiro (padrão ligado; fora da Lista de tarefas do menu): o servidor ordena; as da pessoa ganham a marca "Tuya"
  const [mineFirstChoice, setMineFirst] = useMineFirst()
  const mineFirst = !scope && mineFirstChoice
  const me = useSession().current?.user.id
  const apiFilters = useMemo(() => (scope ? scopedTaskFilters(filters, scope, kind) : filters), [filters, scope, kind])
  // demanda interna (§45): abre a página inteira (não o painel lateral), lembrando de onde veio
  const openPage = (task: TaskSummary) => void navigate(`/tasks/${task.id}`, { state: { from: { to: '/tasks', place: 'tasks' } } })
  const tasks = useTasksList({ ...table.query, filters: apiFilters }, { ...(projectId ? { projectId } : {}), ...(mineFirst ? { mineFirst: true } : {}) })
  const statuses = useStatuses(true)
  const priorities = usePriorities(true)
  const { remove, setInReport, setItVisible } = useTaskMutations()
  const markReport = !!projectId && !!marks?.report
  const markIt = !!projectId && !!marks?.itVisible
  const urgencyOptions = useUrgencyFilterOptions()
  // áreas ativas: opções do clique na célula (uma consulta só para a lista inteira)
  const areas = useAreas(false)
  // empresas ativas (§46): opções do filtro Empresa
  const companies = useCompanies()

  const [viewing, setViewing] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<TaskSummary | null>(null)

  const columns = useMemo<DataTableColumn<TaskSummary>[]>(
    () => [
      {
        id: 'code',
        header: t('tasks.fields.task'),
        sortable: true,
        hideable: false,
        pinned: true,
        size: 360,
        minSize: 240,
        cell: (task) =>
          scope ? (
            // Lista de tarefas do menu (§44): o ícone do tipo e o título, sem o código (ajuste 20/11: fica na
            // página da tarefa e na busca); embaixo, só o que pede atenção (checklist incompleto, bloqueio…)
            <div className="flex min-w-0 items-start gap-2">
              <TaskTypeMark task={task} className="mt-px" />
              <div className="min-w-0">
                <p className={isClosed(task) ? 'truncate font-medium text-muted line-through decoration-subtle' : 'truncate font-medium text-fg'}>{task.title}</p>
                <TaskIndicators task={task} lean />
              </div>
            </div>
          ) : (
            <div className="min-w-0">
              <span className="flex items-center gap-2">
                <TaskCode task={task} />
                {mineFirst && me && task.assignee?.id === me && (
                  <AppBadge tone="primary" className="px-1.5 py-0 text-[10px]" data-testid="task-mine">
                    {t('tasks.mine.badge')}
                  </AppBadge>
                )}
              </span>
              <p className={isClosed(task) ? 'truncate font-medium text-muted line-through decoration-subtle' : 'truncate font-medium text-fg'}>{task.title}</p>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <TagList tags={task.tags} max={3} className="mt-0.5" />
                <TaskIndicators task={task} lean />
              </span>
            </div>
          ),
      },
      {
        id: 'status',
        header: t('tasks.fields.status'),
        sortable: true,
        size: 170,
        // demanda interna: o passo da demanda; tarefa de projeto (com ou sem quem distribui): o status do fluxo, como sempre
        cell: (task) => (task.demand && !task.project ? <DemandStatusBadge status={task.demand.status} /> : <TaskStatusBadge status={task.status} />),
        filter: {
          label: t('tasks.fields.status'),
          options: (statuses.data ?? []).map((s) => ({ value: s.id, label: s.name })),
          // na Lista de tarefas do menu, sem Status escolhido só vêm as abertas: o filtro diz isso
          ...(scope ? { allLabel: t('taskList.openStatuses') } : {}),
        },
      },
      {
        id: 'priority',
        header: t('tasks.fields.priority'),
        sortable: true,
        size: 140,
        cell: (task) => <TaskPriorityBadge priority={task.priority} />,
        // na Lista de tarefas do menu, botões como nas listas de projetos (§37/§44): vários ao mesmo tempo
        filter: scope
          ? { label: t('tasks.fields.priority'), variant: 'buttons' as const, options: (priorities.data ?? []).filter((p) => p.isActive).map((p) => ({ value: p.id, label: p.name })) }
          : { label: t('tasks.fields.priority'), options: (priorities.data ?? []).map((p) => ({ value: p.id, label: p.name })) },
      },
      {
        // semáforo: quem edita troca com um clique, sem abrir a tarefa
        id: 'urgency',
        header: t('tasks.fields.urgency'),
        size: 170,
        cell: (task) => <UrgencyCell task={task} canEdit={canEdit} />,
        filter: { label: t('tasks.fields.urgency'), options: urgencyOptions, ...(scope ? { variant: 'buttons' as const } : {}) },
      },
      {
        // Responsável (ajuste 20/11): quem recebe e distribui (§45) ou, sem ele, a pessoa atribuída
        id: 'responsible',
        header: t('tasks.fields.assignee'),
        size: 180,
        cell: (task) => <PersonCell person={responsibleOf(task)} />,
        // na Lista de tarefas do menu o escopo (Minhas / Todas) faz o papel deste filtro; na aba do projeto,
        // "Responsável: Eu" segue a mesma regra da coluna (`responsible_id=me`)
        ...(scope ? {} : { filter: { label: t('tasks.fields.assignee'), options: [{ value: 'me', label: t('tasks.responsibleMe') }] } }),
      },
      {
        // Atribuída a: quem executa; "Sem atribuir" enquanto quem recebe e distribui não passou a ninguém
        id: 'assignee',
        header: t('tasks.fields.assignedTo'),
        size: 180,
        cell: (task) =>
          task.assignee ? (
            <PersonCell person={task.assignee} />
          ) : awaitingAssignment(task) ? (
            <AppBadge tone="warning">{t('tasks.noAssignee')}</AppBadge>
          ) : (
            <span className="text-subtle">—</span>
          ),
      },
      {
        // área responsável: quem edita troca com um clique, sem abrir a tarefa
        id: 'area',
        header: t('tasks.fields.area'),
        size: 190,
        cell: (task) => <AreaCell task={task} areas={areas.data ?? []} canEdit={canEdit} />,
      },
      {
        // empresa (§46): a do projeto ou, na demanda interna, a dela
        id: 'company',
        header: t('companies.field'),
        size: 180,
        cell: (task) => <CompanyChip company={task.company} />,
        filter: {
          label: t('companies.field'),
          options: [{ value: 'none', label: t('companies.none') }, ...(companies.data ?? []).map((c) => ({ value: c.id, label: c.name }))],
        },
      },
      {
        id: 'type',
        header: t('tasks.fields.type'),
        size: 160,
        cell: (task) => <span className="truncate text-muted">{task.type?.name ?? '—'}</span>,
      },
      ...(projectId
        ? []
        : [
            {
              id: 'project',
              header: t('tasks.fields.project'),
              size: 170,
              // demanda interna (sem projeto): o chip; tarefa de projeto, com ou sem quem distribui: o projeto
              cell: (task: TaskSummary) => (task.demand && !task.project ? <DemandChip /> : <span className="truncate text-muted">{task.project?.name ?? '—'}</span>),
            } satisfies DataTableColumn<TaskSummary>,
          ]),
      {
        id: 'due_date',
        header: t('tasks.fields.dueDate'),
        sortable: true,
        size: 130,
        // demanda interna: prazo com data e hora
        cell: (task) => (task.demand ? <DemandDateTime date={task.demand.dueAt} className="text-muted" /> : <DueDate task={task} showLabel={!!scope} />),
      },
      // elemento da Gestão que a tarefa executa (quem vê a Gestão); oculta por padrão
      ...(canViewPlan
        ? [
            {
              id: 'plan_item',
              header: t('tasks.planLink.short'),
              size: 200,
              cell: (task: TaskSummary) =>
                task.planItem && task.project ? (
                  <Link to={managementLink(task.project.id, { item: task.planItem.id })} title={t('tasks.planLink.open', { name: task.planItem.name })} className="block truncate text-muted hover:text-primary-text">
                    {task.planItem.name}
                  </Link>
                ) : (
                  <span className="text-subtle">—</span>
                ),
            } satisfies DataTableColumn<TaskSummary>,
          ]
        : []),
      {
        id: 'tags',
        header: t('tasks.fields.tags'),
        size: 200,
        cell: (task) => (task.tags.length ? <TagList tags={task.tags} max={2} /> : <span className="text-subtle">—</span>),
      },
      {
        id: 'category',
        header: t('tasks.fields.situation'),
        size: 120,
        cell: (task) => <span className="text-muted">{isClosed(task) ? t('tasks.closed') : t('tasks.open')}</span>,
      },
      // na aba do projeto: o que entra no informe e o que o Responsável TI vê (ocultas por padrão; os botões da linha ligam/desligam)
      ...(projectId
        ? [
            {
              id: 'it_visible',
              header: t('tasks.fields.itVisible'),
              size: 140,
              cell: (task: TaskSummary) => <span className="text-muted">{task.itVisible ? t('audit.yes') : t('audit.no')}</span>,
            } satisfies DataTableColumn<TaskSummary>,
            {
              id: 'in_report',
              header: t('tasks.fields.inReport'),
              size: 130,
              cell: (task: TaskSummary) => <span className="text-muted">{task.inReport ? t('audit.yes') : t('audit.no')}</span>,
            } satisfies DataTableColumn<TaskSummary>,
          ]
        : []),
      {
        id: 'updated_at',
        header: t('tasks.fields.updatedAt'),
        sortable: true,
        size: 150,
        cell: (task) => (
          <time className="text-muted" dateTime={task.updatedAt?.toISOString()} title={formatDateTime(task.updatedAt, locale)}>
            {formatRelative(task.updatedAt, locale)}
          </time>
        ),
      },
    ],
    [t, locale, statuses.data, priorities.data, projectId, canViewPlan, canEdit, urgencyOptions, areas.data, companies.data, mineFirst, me, scope],
  )
  const ordered = useMemo(() => {
    if (!scope) return columns
    const rank = (id: string) => (SCOPE_COLUMN_ORDER.includes(id) ? SCOPE_COLUMN_ORDER.indexOf(id) : SCOPE_COLUMN_ORDER.length)
    return [...columns].sort((a, b) => rank(a.id) - rank(b.id))
  }, [columns, scope])

  return (
    <>
      <AppDataTable
        caption={t('tasks.title')}
        columns={ordered}
        data={tasks.data?.items ?? EMPTY}
        total={tasks.data?.total ?? 0}
        getRowId={(task) => task.id}
        table={table}
        loading={tasks.isPending}
        fetching={tasks.isFetching}
        error={tasks.isError ? { correlationId: isAppError(tasks.error) ? tasks.error.correlationId : undefined } : null}
        onRetry={() => void tasks.refetch()}
        searchPlaceholder={t('tasks.searchPlaceholder')}
        actionsSlot={actionsSlot}
        configurableActions
        toolbar={
          scope ? undefined : (
            <AppButton
              variant={mineFirst ? 'soft' : 'secondary'}
              leftIcon={<UserCheck />}
              aria-pressed={mineFirst}
              title={t('tasks.mine.hint')}
              onClick={() => setMineFirst(!mineFirst)}
            >
              {t('tasks.mine.toggle')}
            </AppButton>
          )
        }
        actions={{
          // só na aba Tarefas do projeto: o que sai no informe (aba Informe) e o que o Responsável TI vê
          leading:
            markReport || markIt
              ? (task) => (
                  <>
                    {markReport && (
                      <AppIconButton
                        size="sm"
                        label={task.inReport ? t('tasks.report.remove') : t('tasks.report.add')}
                        aria-pressed={task.inReport}
                        icon={task.inReport ? <FileCheck2 /> : <FileX2 />}
                        className={task.inReport ? 'text-primary-text hover:text-primary-text' : 'text-subtle'}
                        disabled={!canEdit || (setInReport.isPending && setInReport.variables?.id === task.id)}
                        onClick={() =>
                          setInReport.mutate(
                            { id: task.id, inReport: !task.inReport },
                            {
                              onSuccess: (saved) => notify.success(t(saved.inReport ? 'tasks.report.added' : 'tasks.report.removed', { code: saved.code })),
                              onError: (error) => notify.error(errorMessage(error)),
                            },
                          )
                        }
                      />
                    )}
                    {markIt && (
                      <AppIconButton
                        size="sm"
                        label={task.itVisible ? t('tasks.itVisible.remove') : t('tasks.itVisible.add')}
                        aria-pressed={task.itVisible}
                        icon={<Laptop />}
                        className={task.itVisible ? 'text-primary-text hover:text-primary-text' : 'text-subtle'}
                        disabled={!canEdit || (setItVisible.isPending && setItVisible.variables?.id === task.id)}
                        onClick={() =>
                          setItVisible.mutate(
                            { id: task.id, itVisible: !task.itVisible },
                            {
                              onSuccess: (saved) => notify.success(t(saved.itVisible ? 'tasks.itVisible.added' : 'tasks.itVisible.removed', { code: saved.code })),
                              onError: (error) => notify.error(errorMessage(error)),
                            },
                          )
                        }
                      />
                    )}
                  </>
                )
              : undefined,
          // demanda interna: a página inteira; tarefa de projeto (com ou sem quem distribui): o painel, como sempre
          onView: (task) => (task.demand && !task.project ? openPage(task) : setViewing(task.id)),
          onOpen: (task) => (task.demand && !task.project ? openPage(task) : void navigate(`/tasks/${task.id}`)),
          onEdit: (task) => setEditing(task.id),
          canEdit: () => canEdit,
          onDelete: setDeleting,
          canDelete: () => canDelete,
          more: (task) => [{ key: 'open', label: t('tasks.openPage'), icon: <ExternalLink />, onSelect: () => void navigate(`/tasks/${task.id}`) }],
        }}
      />

      <TaskPreviewDrawer
        taskId={viewing}
        onOpenChange={(open) => !open && setViewing(null)}
        onEdit={(id) => {
          setViewing(null)
          setEditing(id)
        }}
      />
      <TaskEditDialog taskId={editing} onOpenChange={(open) => !open && setEditing(null)} />
      <AppConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('tasks.deleteTitle', { code: deleting?.code ?? '' })}
        description={t('tasks.deleteDescription')}
        confirmLabel={t('common.delete')}
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              notify.success(t('tasks.deleted', { code: deleting.code }))
              setDeleting(null)
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
    </>
  )
}
