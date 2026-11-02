import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, ChevronRight, Copy, FolderInput, ListChecks, MessageSquare, MoreHorizontal, Pencil, Plus, Shapes, Trash2 } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import type { ProjectMember } from '@/domain/projects'
import { PLAN_LIMITS, isDurationEditable, isProgressEditable, type Plan, type PlanGroup, type PlanItem, type PlanItemInput, type PlanLinkKind, type PlanResource } from '@/domain/plan'
import { linkedTasks } from '@/domain/plan-tasks'
import type { PanelTab } from '@/domain/plan-updates'
import { AppCheckbox, AppDropdown, AppInlineEdit, type AppBoardColumn, type AppDropdownItem, type BoardColumnDef } from '@/presentation/components'
import { customColumnId, isSortableType, type ColumnType, type PlanColumn } from '@/domain/plan-columns'
import { DateCell, NumberCell, OwnerCell, ProgressCell, ResourcesCell, ScheduleCell, StatusCell } from './cells'
import { CustomCell } from './custom-cells'
import { DependencyCell } from './DependencyCell'

/* ------------------------------------------------------------------ colunas (preferência por pessoa) */

export const MAIN = {
  name: { id: 'name', width: 400, minWidth: 240, pinned: true },
  status: { id: 'status', width: 150, minWidth: 100 },
  schedule: { id: 'schedule', width: 170, minWidth: 120 },
  resources: { id: 'resources', width: 210, minWidth: 120 },
  estimated: { id: 'estimated', width: 160, minWidth: 90 },
  duration: { id: 'duration', width: 110, minWidth: 80 },
  progress: { id: 'progress', width: 170, minWidth: 110 },
  dependency: { id: 'dependency', width: 190, minWidth: 120 },
} satisfies Record<string, BoardColumnDef>
export const MAIN_COLUMNS: BoardColumnDef[] = Object.values(MAIN)

export const SUB = {
  name: { id: 'name', width: 300, minWidth: 180, pinned: true },
  owner: { id: 'owner', width: 140, minWidth: 110 },
  status: { id: 'status', width: 130, minWidth: 100 },
  due: { id: 'due', width: 110, minWidth: 90 },
  schedule: { id: 'schedule', width: 160, minWidth: 120 },
  work: { id: 'work', width: 120, minWidth: 90 },
  actual: { id: 'actual', width: 130, minWidth: 90 },
  progress: { id: 'progress', width: 140, minWidth: 110 },
} satisfies Record<string, BoardColumnDef>
export const SUB_COLUMNS: BoardColumnDef[] = Object.values(SUB)

export const SORTABLE_COLUMNS = new Set(['name', 'status', 'schedule', 'resources', 'estimated', 'duration', 'progress'])

/** Largura inicial das colunas personalizadas por tipo. */
const CUSTOM_WIDTH: Record<ColumnType, number> = { text: 180, number: 130, date: 130, checkbox: 110, dropdown: 150, people: 160, link: 170 }

/** Definições das colunas personalizadas (GP-5) para as preferências de colunas. */
export const customColumnDefs = (columns: PlanColumn[]): BoardColumnDef[] => columns.map((c) => ({ id: customColumnId(c.id), width: CUSTOM_WIDTH[c.type], minWidth: 90 }))

/** Colunas que podem ordenar o quadro (fixas e personalizadas). */
export const sortableColumnIds = (columns: PlanColumn[]) => new Set([...SORTABLE_COLUMNS, ...columns.filter((c) => isSortableType(c.type)).map((c) => customColumnId(c.id))])

export type FilterFocus = 'status' | 'resources' | 'groups' | 'period' | 'progress' | 'dependency'

/** O que as células precisam do quadro (estado e ações). */
export interface BoardCtx {
  plan: Plan
  canEdit: boolean
  canManage: boolean
  members: ProjectMember[]
  groupById: Map<string, PlanGroup>
  /** Elementos com a subtabela aberta (inclusive pela busca/pessoa). */
  isOpen: (id: string) => boolean
  justCreated: string | null
  selected: Set<string>
  /** Arrastar liberado (sem ordenação, filtro ou agrupamento). */
  dragEnabled: boolean
  save: (item: PlanItem, input: PlanItemInput) => void
  createResource: (name: string) => Promise<PlanResource>
  toggleItem: (id: string, open?: boolean) => void
  toggleSelected: (id: string, checked: boolean) => void
  finishCreate: (id: string) => void
  openLabels: (kind: 'status' | 'resources') => void
  openFilter: (focus: FilterFocus) => void
  openRule: () => void
  askMove: (item: PlanItem) => void
  /** Abre o painel do elemento (atualizações, tarefas, histórico, detalhes); padrão: atualizações. */
  openPanel: (item: PlanItem, tab?: PanelTab) => void
  askDelete: (item: PlanItem) => void
  duplicate: (item: PlanItem) => void
  shift: (item: PlanItem, step: -1 | 1) => void
  canShift: (item: PlanItem, step: -1 | 1) => boolean
  link: (item: PlanItem, kind: PlanLinkKind, otherId: string) => Promise<unknown>
  unlink: (linkId: string) => void
  /** Gestor: colunas personalizadas (GP-5). `add(after)`: depois da coluna do quadro (null = no fim). */
  columnActions: {
    add: (after: string | null) => void
    edit: (column: PlanColumn) => void
    changeType: (column: PlanColumn) => void
    duplicate: (column: PlanColumn) => void
    remove: (column: PlanColumn) => void
  }
}

/** Colunas do quadro (elementos) e da subtabela (subelementos). */
export function usePlanColumns(ctx: BoardCtx): { main: AppBoardColumn<PlanItem>[]; sub: AppBoardColumn<PlanItem>[] } {
  const { t } = useTranslation()
  const { plan, canEdit, canManage, save } = ctx

  const nameCell = (item: PlanItem, nested: boolean, dragHandle: ReactNode) => {
    const open = ctx.isOpen(item.id)
    const tasks = linkedTasks(item)
    const menu: AppDropdownItem[] = [
      ...(!nested ? [{ key: 'sub', label: t('plan.addSubitem'), icon: <Plus />, onSelect: () => ctx.toggleItem(item.id, true) }] : []),
      { key: 'up', label: t('plan.moveUp'), icon: <ArrowUp />, disabled: !ctx.canShift(item, -1), onSelect: () => ctx.shift(item, -1) },
      { key: 'down', label: t('plan.moveDown'), icon: <ArrowDown />, disabled: !ctx.canShift(item, 1), onSelect: () => ctx.shift(item, 1) },
      ...(!nested && plan.groups.length > 1 ? [{ key: 'move', label: t('plan.moveToGroup'), icon: <FolderInput />, onSelect: () => ctx.askMove(item) }] : []),
      { key: 'duplicate', label: t('plan.duplicate'), icon: <Copy />, onSelect: () => ctx.duplicate(item) },
      { type: 'separator' as const, key: 'sep' },
      { key: 'delete', label: nested ? t('plan.deleteSubitem') : t('plan.deleteItem'), icon: <Trash2 />, tone: 'danger' as const, onSelect: () => ctx.askDelete(item) },
    ]
    return (
      <div className="flex h-full min-w-0 items-center gap-0.5 pl-1">
        {dragHandle ?? <span className="w-6 shrink-0" />}
        {canEdit && !nested && (
          <span className="flex w-6 shrink-0 justify-center">
            <AppCheckbox checked={ctx.selected.has(item.id)} onCheckedChange={(checked) => ctx.toggleSelected(item.id, checked)} aria-label={t('plan.select', { name: item.name })} />
          </span>
        )}
        {canEdit ? (
          <AppDropdown
            align="start"
            items={menu}
            trigger={
              <button
                type="button"
                aria-label={t('plan.itemActions', { name: item.name })}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle opacity-0 hover:bg-surface-3 hover:text-fg focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100 [&_svg]:size-3.5"
              >
                <MoreHorizontal />
              </button>
            }
          />
        ) : (
          <span className="w-6 shrink-0" />
        )}
        {!nested &&
          (item.subitems > 0 || open ? (
            <button
              type="button"
              aria-expanded={open}
              aria-label={open ? t('plan.hideSubitems', { name: item.name }) : t('plan.showSubitems', { name: item.name, count: item.subitems })}
              onClick={() => ctx.toggleItem(item.id)}
              className="flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1 text-xs text-muted hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
            >
              <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
              {item.subitems > 0 && <span className="tabular-nums">{item.subitems}</span>}
            </button>
          ) : (
            <span className="w-6 shrink-0" />
          ))}
        <div className="min-w-0 flex-1">
          <AppInlineEdit
            key={item.id === ctx.justCreated ? `${item.id}:new` : item.id}
            value={item.name}
            label={t('plan.editName', { name: item.name })}
            readOnly={!canEdit}
            maxLength={PLAN_LIMITS.itemName}
            autoEdit={item.id === ctx.justCreated}
            onCommit={(text) => {
              if (item.id === ctx.justCreated) ctx.finishCreate(item.id)
              const name = text.trim()
              if (!name) return false
              if (name !== item.name) save(item, { name })
            }}
          />
        </div>
        {/* tarefas vinculadas (execução do elemento): concluídas/total; abre a aba Tarefas do painel */}
        {tasks.total > 0 && (
          <button
            type="button"
            onClick={() => ctx.openPanel(item, 'tasks')}
            aria-label={t('plan.itemTasks.indicator', { name: item.name, done: tasks.done, total: tasks.total })}
            title={t('plan.itemTasks.indicator', { name: item.name, done: tasks.done, total: tasks.total })}
            className={cn(
              'flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs tabular-nums hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-3.5',
              tasks.done === tasks.total ? 'text-success' : 'text-muted',
            )}
          >
            <ListChecks aria-hidden />
            {tasks.done}/{tasks.total}
          </button>
        )}
        {/* atualizações do elemento (contador), como no Monday */}
        <button
          type="button"
          onClick={() => ctx.openPanel(item)}
          aria-label={t('plan.panel.open', { name: item.name, count: item.updates })}
          title={t('plan.panel.open', { name: item.name, count: item.updates })}
          className={cn(
            'relative mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-surface-3 hover:text-fg focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-4',
            item.updates > 0 ? 'text-primary-text' : 'opacity-0 group-hover/row:opacity-100',
          )}
        >
          <MessageSquare />
          {item.updates > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-primary-fg">{item.updates}</span>}
        </button>
      </div>
    )
  }

  const statusCell = (item: PlanItem) => (
    <StatusCell
      statuses={plan.statuses}
      value={item.statusId}
      itemName={item.name}
      readOnly={!canEdit}
      canEditLabels={canManage}
      onChange={(statusId) => save(item, { statusId })}
      onEditLabels={() => ctx.openLabels('status')}
    />
  )

  const scheduleCell = (item: PlanItem) => (
    <ScheduleCell
      start={item.startDate}
      end={item.endDate}
      color={ctx.groupById.get(item.groupId)?.color ?? 'blue'}
      itemName={item.name}
      readOnly={!canEdit}
      onChange={(range) => save(item, range)}
    />
  )

  const progressCell = (item: PlanItem) => (
    <ProgressCell
      value={item.progress.value}
      source={item.progress.source}
      tasks={linkedTasks(item)}
      itemName={item.name}
      editable={canEdit && isProgressEditable(item)}
      onChange={(progress) => save(item, { progress })}
    />
  )

  const main: AppBoardColumn<PlanItem>[] = [
    { ...MAIN.name, label: t('plan.columns.item'), sortable: true, flush: true, align: 'start', cell: (item, extra) => nameCell(item, false, extra.dragHandle) },
    { ...MAIN.status, label: t('plan.columns.status'), sortable: true, flush: true, onFilter: () => ctx.openFilter('status'), cell: statusCell },
    { ...MAIN.schedule, label: t('plan.columns.schedule'), sortable: true, flush: true, onFilter: () => ctx.openFilter('period'), cell: scheduleCell },
    {
      ...MAIN.resources,
      label: t('plan.columns.resources'),
      sortable: true,
      flush: true,
      onFilter: () => ctx.openFilter('resources'),
      cell: (item) => (
        <ResourcesCell
          resources={plan.resources}
          value={item.resourceIds}
          itemName={item.name}
          readOnly={!canEdit}
          canCreate={canEdit}
          onChange={(resourceIds) => save(item, { resourceIds })}
          onCreate={ctx.createResource}
          onEditLabels={() => ctx.openLabels('resources')}
        />
      ),
    },
    {
      ...MAIN.estimated,
      label: t('plan.columns.estimated'),
      sortable: true,
      cell: (item) => (
        <NumberCell value={item.estimatedHours} label={t('plan.estimatedOf', { name: item.name })} readOnly={!canEdit} max={PLAN_LIMITS.hours} onChange={(estimatedHours) => save(item, { estimatedHours })} />
      ),
    },
    {
      ...MAIN.duration,
      label: t('plan.columns.duration'),
      sortable: true,
      cell: (item) => (
        <NumberCell
          value={isDurationEditable(item) ? item.durationManual : item.durationDays}
          label={t('plan.durationOf', { name: item.name })}
          readOnly={!canEdit || !isDurationEditable(item)}
          integer
          max={PLAN_LIMITS.durationDays}
          title={isDurationEditable(item) ? undefined : t('plan.durationFromSchedule')}
          onChange={(durationDays) => save(item, { durationDays })}
        />
      ),
    },
    { ...MAIN.progress, label: t('plan.columns.progress'), sortable: true, onFilter: () => ctx.openFilter('progress'), cell: progressCell },
    {
      ...MAIN.dependency,
      label: t('plan.columns.dependency'),
      flush: true,
      onFilter: () => ctx.openFilter('dependency'),
      cell: (item) => (
        <DependencyCell
          item={item}
          plan={plan}
          readOnly={!canEdit}
          canManage={canManage}
          onLink={(kind, otherId) => ctx.link(item, kind, otherId)}
          onUnlink={ctx.unlink}
          onOpenRule={ctx.openRule}
        />
      ),
    },
  ]

  // colunas personalizadas (GP-5): valores nos elementos; o gestor define pelo menu da coluna
  const custom: AppBoardColumn<PlanItem>[] = plan.columns.map((column) => ({
    id: customColumnId(column.id),
    width: CUSTOM_WIDTH[column.type],
    minWidth: 90,
    label: column.name,
    sortable: isSortableType(column.type),
    flush: column.type !== 'text' && column.type !== 'number',
    menuExtra: canManage
      ? [
          { key: 'add-right', label: t('plan.customColumns.addRight'), icon: <Plus />, onSelect: () => ctx.columnActions.add(customColumnId(column.id)) },
          { key: 'edit', label: column.type === 'dropdown' ? t('plan.customColumns.editColumn') : t('plan.customColumns.rename'), icon: <Pencil />, onSelect: () => ctx.columnActions.edit(column) },
          { key: 'type', label: t('plan.customColumns.changeType'), icon: <Shapes />, onSelect: () => ctx.columnActions.changeType(column) },
          { key: 'duplicate', label: t('plan.customColumns.duplicate'), icon: <Copy />, onSelect: () => ctx.columnActions.duplicate(column) },
          { type: 'separator' as const, key: 'sep-delete' },
          { key: 'delete', label: t('plan.customColumns.delete'), icon: <Trash2 />, tone: 'danger' as const, onSelect: () => ctx.columnActions.remove(column) },
        ]
      : undefined,
    cell: (item: PlanItem) => (
      <CustomCell
        column={column}
        value={item.custom[column.id]}
        itemName={item.name}
        readOnly={!canEdit}
        members={ctx.members}
        canManage={canManage}
        onChange={(value) => save(item, { custom: { [column.id]: value } })}
        onEditColumn={() => ctx.columnActions.edit(column)}
      />
    ),
  }))
  // "Adicionar coluna à direita" também nas colunas fixas
  const withAdd = (column: AppBoardColumn<PlanItem>): AppBoardColumn<PlanItem> =>
    canManage ? { ...column, menuExtra: [{ key: 'add-right', label: t('plan.customColumns.addRight'), icon: <Plus />, onSelect: () => ctx.columnActions.add(column.id) }] } : column

  const sub: AppBoardColumn<PlanItem>[] = [
    { ...SUB.name, label: t('plan.columns.subitem'), flush: true, align: 'start', cell: (item, extra) => nameCell(item, true, extra.dragHandle) },
    {
      ...SUB.owner,
      label: t('plan.columns.owner'),
      flush: true,
      cell: (item) => <OwnerCell owner={item.owner} members={ctx.members} itemName={item.name} readOnly={!canEdit} onChange={(ownerId) => save(item, { ownerId })} />,
    },
    { ...SUB.status, label: t('plan.columns.status'), flush: true, cell: statusCell },
    {
      ...SUB.due,
      label: t('plan.columns.due'),
      flush: true,
      cell: (item) => <DateCell value={item.dueDate} itemName={item.name} readOnly={!canEdit} onChange={(dueDate) => save(item, { dueDate })} />,
    },
    { ...SUB.schedule, label: t('plan.columns.schedule'), flush: true, cell: scheduleCell },
    {
      ...SUB.work,
      label: t('plan.columns.work'),
      cell: (item) => <NumberCell value={item.estimatedHours} label={t('plan.workOf', { name: item.name })} readOnly={!canEdit} max={PLAN_LIMITS.hours} onChange={(estimatedHours) => save(item, { estimatedHours })} />,
    },
    {
      ...SUB.actual,
      label: t('plan.columns.actual'),
      cell: (item) => <NumberCell value={item.actualHours} label={t('plan.actualOf', { name: item.name })} readOnly={!canEdit} max={PLAN_LIMITS.hours} onChange={(actualHours) => save(item, { actualHours })} />,
    },
    { ...SUB.progress, label: t('plan.columns.progress'), cell: progressCell },
  ]

  return { main: [...main.map(withAdd), ...custom], sub }
}
