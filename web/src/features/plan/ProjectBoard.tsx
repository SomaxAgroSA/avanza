import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { FileUp, FolderPlus, GitBranch, LayoutList, Plus, Tags, Users, X } from 'lucide-react'
import { readJson, safeStorage, writeJson } from '@/core/storage/safe-storage'
import { statusSegments, type Plan, type PlanBulkInput, type PlanGroup, type PlanItem, type PlanItemInput } from '@/domain/plan'
import {
  EMPTY_FILTERS,
  GROUP_BY,
  boardSections,
  expandedByNarrowing,
  groupTitle,
  groupedSections,
  isNarrowed,
  type BoardSection,
  type PlanFilters,
  type PlanGroupBy,
  type PlanSort,
  type PlanView,
  PLAN_VIEWS,
} from '@/domain/plan-view'
import { AppBoardColumnsMenu, AppBoardTable, AppButton, AppConfirmDialog, AppEmptyState, AppErrorState, AppIconButton, AppSkeleton, notify, useBoardColumns, type AppDropdownItem } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useProjectMembers } from '@/features/projects/queries'
import { optionColor } from '@/features/task-config/config-theme'
import { AddRowInput, BoardGroup, SortableGroupBlock, type GroupActions } from './BoardGroup'
import { FilterButton, PersonButton } from './BoardFilters'
import { BoardToolbar } from './BoardToolbar'
import { BulkBar } from './BulkBar'
import { BoardDnd } from './board-dnd'
import { ROOTS, groupDragId, itemContainer, subContainer, subgroupsContainer, useBoardOrder, type Containers, type GroupTarget, type ItemTarget } from './board-order'
import { FooterSum, ProgressBar, SchedulePill, StatusBar } from './cells'
import { DependencyRuleDialog, GroupDialog, MoveItemDialog, ResourceLabelsDialog, StatusLabelsDialog, type GroupDialogState } from './dialogs'
import { ImportDialog } from './ImportDialog'
import { ItemPanel } from './ItemPanel'
import { PANEL_TABS, type PanelTab } from '@/domain/plan-updates'
import { usePlan, usePlanMutations, type PlanMutations } from './queries'
import { PlanViewNav } from './PlanViews'
import { PlanTimeline } from './PlanTimeline'
import { PlanKanban } from './PlanKanban'
import { PlanManagement } from './PlanManagement'
import { PlanReports } from './PlanReports'
import { usePlanError } from './use-plan-error'
import { MAIN_COLUMNS, SUB_COLUMNS, customColumnDefs, sortableColumnIds, usePlanColumns, type BoardCtx, type FilterFocus } from './use-plan-columns'
import { ColumnDialog, ColumnTypeDialog, DeleteColumnConfirm, type ColumnDialogState } from './column-dialogs'
import { customColumnId, type PlanColumn } from '@/domain/plan-columns'
import { useLiveProject } from '@/presentation/common/use-live'

/** Hoje no fuso de quem usa (AAAA-MM-DD). */
function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * Gestão de projetos (menu lateral, à parte das tarefas): visões do mesmo quadro (Quadro principal,
 * Cronograma, Kanban, Gestão e Relatórios). A visão e o painel do elemento ficam no endereço
 * (`?view=&item=&panel=`): dá para compartilhar o link, e as notificações abrem direto no painel.
 */
export function ProjectBoard({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const query = usePlan(projectId)
  if (query.isPending)
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label={t('common.loading')}>
        <AppSkeleton className="h-9 w-80" />
        <AppSkeleton className="h-40 w-full" />
        <AppSkeleton className="h-40 w-full" />
      </div>
    )
  if (query.isError) return <AppErrorState title={t('plan.loadError')} onRetry={() => void query.refetch()} />
  return <PlanWorkspace plan={query.data} />
}

function PlanWorkspace({ plan }: { plan: Plan }) {
  const [params, setParams] = useSearchParams()
  const view: PlanView = PLAN_VIEWS.find((v) => v === params.get('view')) ?? 'board'
  const panelItem = params.get('item')
  const panelTab: PanelTab = PANEL_TABS.find((x) => x === params.get('panel')) ?? 'updates'
  const setPanel = (itemId: string | null, tab: PanelTab = 'updates') =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (itemId) {
          next.set('item', itemId)
          next.set('panel', tab)
        } else {
          next.delete('item')
          next.delete('panel')
        }
        return next
      },
      { replace: true },
    )
  const open = (itemId: string) => setPanel(itemId)
  return (
    <div className="flex flex-col gap-4">
      <PlanViewNav value={view} />
      {view === 'board' && <Board plan={plan} onOpenPanel={open} />}
      {view === 'timeline' && <PlanTimeline plan={plan} onOpen={open} />}
      {view === 'kanban' && <PlanKanban plan={plan} onOpen={open} />}
      {view === 'management' && <PlanManagement plan={plan} />}
      {view === 'reports' && <PlanReports plan={plan} />}
      <ItemPanel plan={plan} itemId={panelItem} tab={panelTab} onTab={(tab) => panelItem && setPanel(panelItem, tab)} onClose={() => setPanel(null)} />
    </div>
  )
}

/** Quadro principal: grupos, elementos e subelementos editáveis nas células. */
function Board({ plan, onOpenPanel }: { plan: Plan; onOpenPanel: (itemId: string) => void }) {
  const { t, i18n } = useTranslation()
  const projectId = plan.project.id
  useLiveProject(projectId)
  const mutations = usePlanMutations(projectId)
  const members = useProjectMembers(projectId)
  const canEdit = plan.capabilities.edit
  const canManage = plan.capabilities.manage

  // colunas fixas + personalizadas (GP-5); a ordem/largura de cada uma é preferência de quem usa
  const mainDefs = useMemo(() => [...MAIN_COLUMNS, ...customColumnDefs(plan.columns)], [plan.columns])
  const main = useBoardColumns('kb.plan.columns', mainDefs)
  const sortable = useMemo(() => sortableColumnIds(plan.columns), [plan.columns])
  const sub = useBoardColumns('kb.plan.subcolumns', SUB_COLUMNS)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<PlanFilters>(EMPTY_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterFocus, setFilterFocus] = useState<FilterFocus | null>(null)
  const groupByKey = `kb.plan.groupBy.${projectId}`
  const [groupBy, setGroupBy] = useState<PlanGroupBy>(() => {
    const saved = safeStorage.get(groupByKey)
    return GROUP_BY.find((g) => g === saved) ?? 'group'
  })
  const collapsedKey = `kb.plan.collapsed.${projectId}`
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(readJson<string[]>(collapsedKey, [])))
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [justCreated, setJustCreated] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [groupDialog, setGroupDialog] = useState<GroupDialogState>(null)
  const [labels, setLabels] = useState<'status' | 'resources' | null>(null)
  const [moving, setMoving] = useState<PlanItem | null>(null)
  const [removingGroup, setRemovingGroup] = useState<PlanGroup | null>(null)
  const [removingItem, setRemovingItem] = useState<PlanItem | null>(null)
  const [ruleOpen, setRuleOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [columnDialog, setColumnDialog] = useState<ColumnDialogState>(null)
  const [typing, setTyping] = useState<PlanColumn | null>(null)
  const [removingColumn, setRemovingColumn] = useState<PlanColumn | null>(null)

  const sort = main.sort && sortable.has(main.sort.column) ? (main.sort as PlanSort) : null
  const view = useMemo(() => ({ query: search, sort, filters, today: localToday() }), [search, sort, filters])
  const narrowed = isNarrowed(view)
  const locale = i18n.language
  const sections = useMemo(
    () =>
      groupBy === 'group'
        ? boardSections(plan, view)
        : groupedSections(plan, groupBy, { ...view, locale, labels: { noStatus: t('plan.statusBlank'), noResource: t('plan.filters.noResource'), noSchedule: t('plan.groupBy.noSchedule') } }),
    [plan, view, groupBy, locale, t],
  )
  const opened = useMemo(() => expandedByNarrowing(sections, view), [sections, view])
  const itemById = useMemo(() => new Map(plan.items.map((i) => [i.id, i])), [plan.items])
  const groupById = useMemo(() => new Map(plan.groups.map((g) => [g.id, g])), [plan.groups])
  const isOpen = (id: string) => expanded.has(id) || opened.has(id)
  const dragItems = canEdit && !sort && !narrowed && groupBy === 'group'
  const dragGroups = canManage && !narrowed && groupBy === 'group'
  const selectedIds = [...selected].filter((id) => itemById.has(id) && !itemById.get(id)?.parentId)

  // listas arrastáveis (ordem atual da tela)
  const containers = useMemo<Containers>(() => {
    const out: Containers = {}
    if (groupBy !== 'group') return out
    sections.forEach((s) => {
      if (!s.headerOnly) out[itemContainer(s.group.id)] = s.items.map((i) => i.id)
      s.items.forEach((i) => {
        const subs = s.subitems.get(i.id)
        if (subs && (expanded.has(i.id) || opened.has(i.id))) out[subContainer(i.id)] = subs.map((x) => x.id)
      })
    })
    const roots = plan.groups.filter((g) => !g.parentId)
    out[ROOTS] = roots.map((g) => groupDragId(g.id))
    roots.forEach((r) => {
      out[subgroupsContainer(r.id)] = plan.groups.filter((g) => g.parentId === r.id).map((g) => groupDragId(g.id))
    })
    return out
  }, [sections, groupBy, plan.groups, expanded, opened])

  /* ---------------------------------------------------------------- estado da tela */

  const saveCollapsed = (next: Set<string>) => {
    setCollapsed(next)
    writeJson(collapsedKey, [...next])
  }
  const toggleGroup = (id: string) => {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    saveCollapsed(next)
  }
  const toggleItem = (id: string, open?: boolean) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (open ?? !next.has(id)) next.add(id)
      else next.delete(id)
      return next
    })
  const changeGroupBy = (value: PlanGroupBy) => {
    setGroupBy(value)
    safeStorage.set(groupByKey, value)
  }
  // aberto pelo menu da coluna: espera o menu fechar (ele devolve o foco ao botão e fecharia o painel)
  const openFilter = (focus: FilterFocus) =>
    window.setTimeout(() => {
      setFilterFocus(focus)
      setFilterOpen(true)
    }, 0)

  /* ---------------------------------------------------------------- ações */

  const planError = usePlanError()
  const onError = (error: unknown) => notify.error(planError(error))
  const rethrow = (error: unknown) => {
    onError(error)
    throw error
  }
  const save = (item: PlanItem, input: PlanItemInput) => mutations.updateItem.mutate({ id: item.id, input }, { onError })
  const createItem = (input: PlanItemInput) => mutations.createItem.mutateAsync(input).catch(rethrow)

  /** Novo elemento com nome padrão e o nome já em edição (como no Monday). */
  function quickCreate(groupId: string) {
    const collapsedNow = new Set(collapsed)
    const group = groupById.get(groupId)
    collapsedNow.delete(groupId)
    if (group?.parentId) collapsedNow.delete(group.parentId)
    if (collapsedNow.size !== collapsed.size) saveCollapsed(collapsedNow)
    void createItem({ groupId, name: t('plan.newItemName') }).then((item) => setJustCreated(item.id), () => undefined)
  }

  const siblingsOf = (item: PlanItem) =>
    plan.items.filter((i) => (item.parentId ? i.parentId === item.parentId : !i.parentId && i.groupId === item.groupId)).sort((a, b) => a.position - b.position)
  const shiftTarget = (item: PlanItem, step: -1 | 1): ItemTarget | null => {
    const list = siblingsOf(item)
    const other = list[list.findIndex((i) => i.id === item.id) + step]
    if (!other) return null
    return step === -1 ? { nextId: other.id } : { prevId: other.id }
  }
  const moveItem = (id: string, target: ItemTarget) => mutations.moveItem.mutate({ id, target }, { onSuccess: () => notify.success(t('plan.itemMoved')), onError })
  const moveGroup = (id: string, target: GroupTarget) =>
    mutations.moveGroup.mutate({ id, target: { parentId: target.parentId, prevId: target.prevId, nextId: target.nextId } }, { onSuccess: () => notify.success(t('plan.group.moved')), onError })

  const ctx: BoardCtx = {
    plan,
    canEdit,
    canManage,
    members: members.data ?? [],
    groupById,
    isOpen,
    justCreated,
    selected,
    dragEnabled: dragItems,
    save,
    createResource: (name) => mutations.createResource.mutateAsync({ name }).catch(rethrow),
    toggleItem,
    toggleSelected: (id, checked) =>
      setSelected((current) => {
        const next = new Set(current)
        if (checked) next.add(id)
        else next.delete(id)
        return next
      }),
    finishCreate: () => setJustCreated(null),
    openLabels: setLabels,
    openFilter,
    openRule: () => setRuleOpen(true),
    askMove: setMoving,
    openPanel: (item) => onOpenPanel(item.id),
    askDelete: setRemovingItem,
    duplicate: (item) => mutations.duplicateItem.mutate(item.id, { onSuccess: (copy) => notify.success(t('plan.duplicated', { name: copy.name })), onError }),
    shift: (item, step) => {
      const target = shiftTarget(item, step)
      if (target) moveItem(item.id, target)
    },
    canShift: (item, step) => !!shiftTarget(item, step),
    link: (item, kind, otherId) => mutations.createLink.mutateAsync({ itemId: item.id, kind, otherId }).catch(rethrow),
    unlink: (linkId) => mutations.deleteLink.mutate(linkId, { onError }),
    columnActions: {
      add: (after) => setColumnDialog({ mode: 'create', after }),
      edit: (column) => setColumnDialog({ mode: 'edit', column }),
      changeType: setTyping,
      duplicate: (column) => mutations.duplicateColumn.mutate(column.id, { onSuccess: (copy) => notify.success(t('plan.customColumns.duplicated', { name: copy.name })), onError }),
      remove: setRemovingColumn,
    },
  }
  const columns = usePlanColumns(ctx)

  function applyBulk(input: PlanBulkInput) {
    return mutations.bulk.mutateAsync(input).then(
      (result) => {
        const count = result.updated ?? result.moved ?? result.duplicated ?? result.deleted ?? 0
        notify.success(t(`plan.bulk.done.${input.action}`, { count }))
        if (input.action === 'delete') setSelected(new Set())
      },
      (error: unknown) => {
        onError(error)
        throw error
      },
    )
  }

  /* ---------------------------------------------------------------- grupos */

  const levelOf = (group: PlanGroup) => plan.groups.filter((g) => (g.parentId ?? null) === (group.parentId ?? null))

  function groupActions(section: BoardSection): GroupActions | null {
    if (!canManage || section.synthetic) return null
    const { group } = section
    const siblings = levelOf(group)
    const index = siblings.findIndex((g) => g.id === group.id)
    const prev = siblings[index - 1]
    const next = siblings[index + 1]
    return {
      edit: () => setGroupDialog({ mode: 'edit', group }),
      addSubgroup: group.parentId ? undefined : () => setGroupDialog({ mode: 'create', parent: group }),
      addItem: section.headerOnly && canEdit ? () => quickCreate(group.id) : undefined,
      moveUp: prev ? () => moveGroup(group.id, { parentId: group.parentId, nextId: prev.id }) : undefined,
      moveDown: next ? () => moveGroup(group.id, { parentId: group.parentId, prevId: next.id }) : undefined,
      duplicate: () => mutations.duplicateGroup.mutate(group.id, { onSuccess: (copy) => notify.success(t('plan.group.duplicated', { name: copy.name })), onError }),
      remove: () => setRemovingGroup(group),
    }
  }

  const footerOf = (section: BoardSection): Record<string, ReactNode> => {
    const summary = section.group.summary
    if (!summary || summary.items === 0) return {}
    return {
      status: <StatusBar segments={statusSegments(summary, plan.statuses)} statuses={plan.statuses} />,
      schedule: <SchedulePill start={summary.startDate} end={summary.endDate} color={section.group.color} />,
      estimated: <FooterSum value={summary.estimatedHours} />,
      duration: <FooterSum value={summary.durationDays} />,
      progress: <ProgressBar value={summary.progress} label={t('plan.groupProgress', { name: groupTitle(section.group) })} />,
      ...Object.fromEntries(
        plan.columns.filter((c) => c.type === 'number').map((c) => [customColumnId(c.id), <FooterSum key={c.id} value={summary.customSums?.[c.id] ?? null} suffix={c.settings.unit} />]),
      ),
    }
  }

  const removingCounts = (group: PlanGroup) => {
    const ids = new Set([group.id, ...plan.groups.filter((g) => g.parentId === group.id).map((g) => g.id)])
    return { subgroups: ids.size - 1, items: plan.items.filter((i) => ids.has(i.groupId) && !i.parentId).length }
  }

  /* ---------------------------------------------------------------- tela */

  const firstGroupId =
    groupBy === 'group' ? sections.find((s) => !s.headerOnly)?.group.id : plan.groups.find((g) => plan.items.some((i) => i.groupId === g.id) || !plan.groups.some((c) => c.parentId === g.id))?.id
  const moreItems: AppDropdownItem[] = [
    ...(canManage ? [{ key: 'status', label: t('plan.labels.statusTitle'), icon: <Tags />, onSelect: () => setLabels('status') }] : []),
    { key: 'resources', label: t('plan.labels.resourceTitle'), icon: <Users />, onSelect: () => setLabels('resources') },
    ...(canManage ? [{ key: 'rule', label: t('plan.dependencyRule.menu'), icon: <GitBranch />, onSelect: () => setRuleOpen(true) }] : []),
    ...(canEdit ? [{ key: 'import', label: t('plan.import.menu'), icon: <FileUp />, onSelect: () => setImportOpen(true) }] : []),
  ]
  const allSectionIds = groupBy === 'group' ? plan.groups.map((g) => g.id) : sections.map((s) => s.group.id)
  const columnLabel = (id: string) => columns.main.find((c) => c.id === id)?.label ?? id

  return (
    <div className="flex flex-col gap-4">
      <BoardToolbar
        canEdit={canEdit}
        canManage={canManage}
        createDisabled={!firstGroupId}
        onCreateItem={() => firstGroupId && quickCreate(firstGroupId)}
        onCreateGroup={() => setGroupDialog({ mode: 'create', parent: null })}
        onImport={() => setImportOpen(true)}
        search={search}
        onSearch={setSearch}
        person={<PersonButton members={members.data ?? []} filters={filters} onChange={setFilters} />}
        filter={
          <FilterButton
            plan={plan}
            filters={filters}
            onChange={setFilters}
            open={filterOpen}
            onOpenChange={(open) => {
              setFilterOpen(open)
              if (!open) setFilterFocus(null)
            }}
            focus={filterFocus}
          />
        }
        sortColumns={[...sortable].map((id) => ({ id, label: columnLabel(id) }))}
        sortApi={main}
        groupBy={groupBy}
        onGroupBy={changeGroupBy}
        onExpandAll={() => saveCollapsed(new Set())}
        onCollapseAll={() => saveCollapsed(new Set(allSectionIds))}
        canExpand={collapsed.size > 0}
        canCollapse={allSectionIds.length > 0}
        columnsMenu={<AppBoardColumnsMenu api={main} columns={columns.main} />}
        moreItems={moreItems}
      />

      {plan.project.archived && <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-soft-fg">{t('plan.archived')}</p>}
      {plan.truncated && <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-soft-fg">{t('plan.truncated')}</p>}

      {plan.groups.length === 0 ? (
        <AppEmptyState
          icon={<LayoutList />}
          title={t('plan.emptyTitle')}
          description={canManage ? t('plan.emptyHint') : t('plan.emptyHintReadOnly')}
          action={
            canManage ? (
              <AppButton leftIcon={<FolderPlus />} onClick={() => setGroupDialog({ mode: 'create', parent: null })}>
                {t('plan.createGroup')}
              </AppButton>
            ) : undefined
          }
        />
      ) : sections.length === 0 ? (
        <AppEmptyState
          compact
          title={t('plan.noMatches')}
          description={t('plan.noMatchesHint')}
          action={
            <AppButton
              variant="secondary"
              leftIcon={<X />}
              onClick={() => {
                setFilters(EMPTY_FILTERS)
                setSearch('')
              }}
            >
              {t('plan.filters.clearAll')}
            </AppButton>
          }
        />
      ) : (
        // `relative`: o que é posicionado dentro do quadro (ex.: textos só para leitor de tela) fica no
        // contêiner que rola, sem alargar o <main>
        <div className="relative overflow-x-auto pb-2">
          <BoardDnd
            containers={containers}
            labelOf={(id) => (id.startsWith('grp:') ? groupTitle(groupById.get(id.slice(4)) ?? ({ name: id, number: null } as PlanGroup)) : (itemById.get(id)?.name ?? id))}
            containerLabel={(container) => {
              const group = container.startsWith('g:') ? groupById.get(container.slice(2)) : undefined
              if (group) return groupTitle(group)
              const parent = container.startsWith('s:') ? itemById.get(container.slice(2)) : undefined
              return parent ? parent.name : t('plan.announce.board')
            }}
            onMoveItem={moveItem}
            onMoveGroup={moveGroup}
          >
            <BoardSections
              sections={sections}
              synthetic={groupBy !== 'group'}
              collapsed={collapsed}
              narrowed={narrowed}
              itemById={itemById}
              groupById={groupById}
              renderSection={(section, rows, dragHandle) => {
                const visible = section.items.map((i) => i.id)
                const chosen = visible.filter((id) => selected.has(id)).length
                return (
                  <BoardGroup
                    key={section.group.id}
                    section={section}
                    collapsed={!narrowed && (collapsed.has(section.group.id) || (!!section.parent && collapsed.has(section.parent.id)))}
                    onToggle={() => toggleGroup(section.group.id)}
                    columns={columns.main}
                    api={main}
                    rows={rows}
                    footer={footerOf(section)}
                    actions={groupActions(section)}
                    dragHandle={dragHandle}
                    renderExpanded={(item) => <Subitems item={item} section={section} ctx={ctx} columns={columns.sub} api={sub} createItem={createItem} dragEnabled={dragItems} />}
                    selection={
                      canEdit && visible.length > 0
                        ? {
                            checked: chosen === 0 ? false : chosen === visible.length ? true : 'indeterminate',
                            onChange: (on) =>
                              setSelected((current) => {
                                const next = new Set(current)
                                visible.forEach((id) => (on ? next.add(id) : next.delete(id)))
                                return next
                              }),
                          }
                        : undefined
                    }
                    isRowSelected={(item) => selected.has(item.id)}
                    headerTrail={
                      canManage ? (
                        <AppIconButton size="sm" variant="ghost" icon={<Plus />} label={t('plan.customColumns.add')} onClick={() => setColumnDialog({ mode: 'create', after: null })} />
                      ) : undefined
                    }
                    sortable={section.synthetic ? undefined : { containerId: itemContainer(section.group.id), disabled: !dragItems }}
                    addRow={
                      canEdit && !section.synthetic ? (
                        <AddRowInput label={t('plan.addItemTo', { name: groupTitle(section.group) })} placeholder={t('plan.addItemPlaceholder')} onAdd={(name) => createItem({ groupId: section.group.id, name })} />
                      ) : undefined
                    }
                  />
                )
              }}
              dragGroups={dragGroups}
            />
          </BoardDnd>
        </div>
      )}

      {canManage && plan.groups.length > 0 && (
        <div className={selectedIds.length ? 'pb-16' : undefined}>
          <AppButton variant="secondary" leftIcon={<FolderPlus />} onClick={() => setGroupDialog({ mode: 'create', parent: null })}>
            {t('plan.addGroup')}
          </AppButton>
        </div>
      )}

      {canEdit && <BulkBar plan={plan} ids={selectedIds} pending={mutations.bulk.isPending} onApply={applyBulk} onClear={() => setSelected(new Set())} />}
      <GroupDialog state={groupDialog} mutations={mutations} onClose={() => setGroupDialog(null)} />
      <StatusLabelsDialog open={labels === 'status'} plan={plan} mutations={mutations} onClose={() => setLabels(null)} />
      <ResourceLabelsDialog open={labels === 'resources'} plan={plan} mutations={mutations} onClose={() => setLabels(null)} />
      <MoveItemDialog item={moving} plan={plan} mutations={mutations} onClose={() => setMoving(null)} />
      <DependencyRuleDialog open={ruleOpen} plan={plan} mutations={mutations} onClose={() => setRuleOpen(false)} />
      <ImportDialog open={importOpen} mutations={mutations} onClose={() => setImportOpen(false)} />
      {/* coluna criada pelo "à direita": a posição vai para a preferência (vale quando a coluna chegar) */}
      <ColumnDialog
        state={columnDialog}
        plan={plan}
        mutations={mutations}
        onClose={() => setColumnDialog(null)}
        onCreated={(column, after) => after && main.placeAfter(customColumnId(column.id), after)}
      />
      <ColumnTypeDialog column={typing} mutations={mutations} onClose={() => setTyping(null)} />
      <DeleteColumnConfirm column={removingColumn} plan={plan} mutations={mutations} onClose={() => setRemovingColumn(null)} />
      <DeleteGroupConfirm group={removingGroup} counts={removingGroup ? removingCounts(removingGroup) : null} mutations={mutations} onClose={() => setRemovingGroup(null)} />
      <DeleteItemConfirm item={removingItem} mutations={mutations} onClose={() => setRemovingItem(null)} />
    </div>
  )
}

/**
 * Seções na ordem da tela (dentro do arraste): no quadro por grupo, cada fase é um bloco arrastável
 * com os subgrupos (também arrastáveis entre si); nos agrupamentos, a lista simples.
 */
function BoardSections({
  sections,
  synthetic,
  collapsed,
  narrowed,
  itemById,
  groupById,
  renderSection,
  dragGroups,
}: {
  sections: BoardSection[]
  synthetic: boolean
  collapsed: Set<string>
  narrowed: boolean
  itemById: Map<string, PlanItem>
  groupById: Map<string, PlanGroup>
  renderSection: (section: BoardSection, rows: PlanItem[], dragHandle?: ReactNode) => ReactNode
  dragGroups: boolean
}) {
  const { t } = useTranslation()
  const order = useBoardOrder()
  const rowsOf = (section: BoardSection) => {
    const ids = order[itemContainer(section.group.id)]
    return ids ? ids.map((id) => itemById.get(id)).filter((i): i is PlanItem => !!i) : section.items
  }
  if (synthetic) return <div className="flex w-max min-w-full flex-col gap-5">{sections.map((s) => renderSection(s, s.items))}</div>

  const byGroup = new Map(sections.map((s) => [s.group.id, s]))
  const rootIds = (order[ROOTS] ?? []).map((id) => id.slice(4))
  const label = (group: PlanGroup) => t('plan.dragGroup', { name: groupTitle(group) })
  return (
    <SortableContext id={ROOTS} items={order[ROOTS] ?? []} strategy={verticalListSortingStrategy}>
      <div className="flex w-max min-w-full flex-col gap-5">
        {rootIds.map((rootId) => {
          const root = groupById.get(rootId)
          const head = byGroup.get(rootId)
          const subIds = (order[subgroupsContainer(rootId)] ?? []).map((id) => id.slice(4))
          const subs = subIds.map((id) => byGroup.get(id)).filter((s): s is BoardSection => !!s)
          if (!root || (!head && subs.length === 0)) return null
          const hideSubs = !narrowed && collapsed.has(rootId)
          return (
            <SortableGroupBlock key={rootId} id={groupDragId(rootId)} container={ROOTS} disabled={!dragGroups} label={label(root)}>
              {(handle) => (
                <>
                  {head && renderSection(head, rowsOf(head), handle)}
                  {!hideSubs && subs.length > 0 && (
                    <SortableContext id={subgroupsContainer(rootId)} items={order[subgroupsContainer(rootId)] ?? []} strategy={verticalListSortingStrategy}>
                      {subs.map((s) => (
                        <SortableGroupBlock key={s.group.id} id={groupDragId(s.group.id)} container={subgroupsContainer(rootId)} disabled={!dragGroups} label={label(s.group)}>
                          {(subHandle) => renderSection(s, rowsOf(s), subHandle)}
                        </SortableGroupBlock>
                      ))}
                    </SortableContext>
                  )}
                </>
              )}
            </SortableGroupBlock>
          )
        })}
      </div>
    </SortableContext>
  )
}

/** Subtabela de subelementos (arrastáveis só dentro do mesmo elemento). */
function Subitems({
  item,
  section,
  ctx,
  columns,
  api,
  createItem,
  dragEnabled,
}: {
  item: PlanItem
  section: BoardSection
  ctx: BoardCtx
  columns: ReturnType<typeof usePlanColumns>['sub']
  api: ReturnType<typeof useBoardColumns>
  createItem: (input: PlanItemInput) => Promise<unknown>
  dragEnabled: boolean
}) {
  const { t } = useTranslation()
  const order = useBoardOrder()
  if (!ctx.isOpen(item.id)) return null
  const ids = order[subContainer(item.id)]
  const byId = new Map(ctx.plan.items.map((i) => [i.id, i]))
  const list = ids ? ids.map((id) => byId.get(id)).filter((i): i is PlanItem => !!i) : (section.subitems.get(item.id) ?? [])
  const group = ctx.groupById.get(item.groupId)
  return (
    <div className="relative overflow-x-auto py-2 pl-12 pr-2">
      <AppBoardTable
        nested
        caption={t('plan.subitemsOf', { name: item.name })}
        accent={group ? `color-mix(in oklab, ${optionColor(group.color)} 55%, transparent)` : 'var(--color-border)'}
        columns={columns}
        api={api}
        rows={list}
        rowKey={(s) => s.id}
        sortable={section.synthetic ? undefined : { containerId: subContainer(item.id), disabled: !dragEnabled, handleLabel: (s) => t('plan.dragItem', { name: s.name }) }}
        addRow={
          ctx.canEdit ? <AddRowInput label={t('plan.addSubitemTo', { name: item.name })} placeholder={t('plan.addSubitemPlaceholder')} onAdd={(name) => createItem({ parentId: item.id, name })} /> : undefined
        }
      />
    </div>
  )
}

function DeleteGroupConfirm({ group, counts, mutations, onClose }: { group: PlanGroup | null; counts: { subgroups: number; items: number } | null; mutations: PlanMutations; onClose: () => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  return (
    <AppConfirmDialog
      open={!!group}
      onOpenChange={(open) => !open && onClose()}
      title={t('plan.group.deleteTitle', { name: group ? groupTitle(group) : '' })}
      description={counts ? t('plan.group.deleteDescription', { items: counts.items, subgroups: counts.subgroups }) : undefined}
      confirmLabel={t('common.delete')}
      loading={mutations.deleteGroup.isPending}
      onConfirm={() =>
        group &&
        mutations.deleteGroup.mutate(group.id, {
          onSuccess: () => {
            notify.success(t('plan.group.deleted', { name: group.name }))
            onClose()
          },
          onError: (error) => notify.error(errorMessage(error)),
        })
      }
    />
  )
}

function DeleteItemConfirm({ item, mutations, onClose }: { item: PlanItem | null; mutations: PlanMutations; onClose: () => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  return (
    <AppConfirmDialog
      open={!!item}
      onOpenChange={(open) => !open && onClose()}
      title={t('plan.deleteItemTitle', { name: item?.name ?? '' })}
      description={item && item.subitems > 0 ? t('plan.deleteItemWithSubitems', { count: item.subitems }) : t('plan.deleteItemDescription')}
      confirmLabel={t('common.delete')}
      loading={mutations.deleteItem.isPending}
      onConfirm={() =>
        item &&
        mutations.deleteItem.mutate(item.id, {
          onSuccess: () => {
            notify.success(t('plan.itemDeleted', { name: item.name }))
            onClose()
          },
          onError: (error) => notify.error(errorMessage(error)),
        })
      }
    />
  )
}
