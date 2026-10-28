/**
 * Quadro do projeto — organização da tela (Gerenciamento de Projetos, GP-1/GP-2): seções por grupo,
 * busca, filtros (barra, pessoa e por coluna), ordenação, agrupar por (status, recurso, cronograma),
 * totais das visões filtradas/agrupadas, dependências vistas de cada elemento e as colunas do Kanban (GP-4).
 *
 * Os totais seguem a mesma fórmula do servidor (backend/src/domain/plan.js `groupSummary`),
 * aplicada só aos elementos visíveis — sem filtro, o rodapé usa os totais que vêm do servidor.
 */
import type { OptionColor } from './task-config'
import type { Plan, PlanGroup, PlanGroupSummary, PlanItem, PlanLink, PlanStatus, PlanStatusCategory } from './plan'
import { columnIdOf, customSortKey, isCustomColumnId, sumCustom } from './plan-columns'

/* ------------------------------------------------------------------ tipos */

export interface BoardSection {
  group: PlanGroup
  /** Grupo pai (subgrupo) — o título vira "2.0 Planejamento | 2.1 Plano do Projeto". */
  parent: PlanGroup | null
  /** Elementos de primeiro nível, já filtrados e ordenados. */
  items: PlanItem[]
  /** Subelementos visíveis por elemento. */
  subitems: Map<string, PlanItem[]>
  /** Total de elementos do grupo (sem filtro). */
  total: number
  /** Fase só com subgrupos (sem elementos próprios): aparece como cabeçalho, sem tabela. */
  headerOnly: boolean
  /** Subgrupos (no grupo raiz). */
  subgroups: number
  /** Seção de agrupamento (status, recurso, cronograma): não é um grupo de verdade. */
  synthetic: boolean
}

export type PlanSortColumn = 'name' | 'status' | 'schedule' | 'resources' | 'estimated' | 'duration' | 'progress' | `custom:${string}`
export interface PlanSort {
  column: PlanSortColumn
  direction: 'asc' | 'desc'
}

export const PROGRESS_BUCKETS = ['not_started', 'in_progress', 'done'] as const
export type ProgressBucket = (typeof PROGRESS_BUCKETS)[number]

export const DEPENDENCY_FILTERS = ['blocked', 'linked'] as const
export type DependencyFilter = (typeof DEPENDENCY_FILTERS)[number]

/** Valor dos filtros de status/recurso para "em branco" / "sem recurso". */
export const NONE = ''

export interface PlanFilters {
  statusIds: string[]
  resourceIds: string[]
  groupIds: string[]
  /** Pessoa: responsável dos subelementos. */
  ownerIds: string[]
  /** Cronograma que cruza o período (AAAA-MM-DD). */
  period: { start: string; end: string } | null
  progress: ProgressBucket[]
  overdue: boolean
  dependency: DependencyFilter | null
}

export const EMPTY_FILTERS: PlanFilters = {
  statusIds: [],
  resourceIds: [],
  groupIds: [],
  ownerIds: [],
  period: null,
  progress: [],
  overdue: false,
  dependency: null,
}

export const GROUP_BY = ['group', 'status', 'resource', 'schedule'] as const
export type PlanGroupBy = (typeof GROUP_BY)[number]

export interface ViewOptions {
  query?: string
  sort?: PlanSort | null
  filters?: PlanFilters
  /** Hoje (AAAA-MM-DD), para "atrasados". */
  today?: string
}

/* ------------------------------------------------------------------ apoio */

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const byPosition = (a: PlanItem, b: PlanItem) => a.position - b.position
const CLOSED: PlanStatusCategory[] = ['done', 'canceled']

/** Título do grupo com a numeração: "1.0 Iniciação". */
export const groupTitle = (group: PlanGroup) => (group.number ? `${group.number} ${group.name}` : group.name)

/** Filtros da barra ativos (a pessoa tem botão próprio): "Filtros (3)". */
export function activeFilterCount(filters: PlanFilters): number {
  return (
    Number(filters.statusIds.length > 0) +
    Number(filters.resourceIds.length > 0) +
    Number(filters.groupIds.length > 0) +
    Number(!!filters.period) +
    Number(filters.progress.length > 0) +
    Number(filters.overdue) +
    Number(!!filters.dependency)
  )
}

export function progressBucket(value: number): ProgressBucket {
  return value >= 100 ? 'done' : value > 0 ? 'in_progress' : 'not_started'
}

function categoryLookup(plan: Plan) {
  const byId = new Map(plan.statuses.map((s) => [s.id, s.category]))
  return (item: PlanItem) => (item.statusId ? (byId.get(item.statusId) ?? null) : null)
}

/** Atrasado: o fim do cronograma já passou e o elemento não está encerrado (concluído/cancelado). */
export function isOverdue(item: PlanItem, today: string, category: PlanStatusCategory | null): boolean {
  const end = item.endDate ?? item.startDate
  return !!end && end < today && !(category && CLOSED.includes(category))
}

function matchesElement(item: PlanItem, f: PlanFilters, ctx: { today: string; categoryOf: (i: PlanItem) => PlanStatusCategory | null; linked: Set<string>; parentOf: Map<string, string | null> }) {
  if (f.statusIds.length && !f.statusIds.includes(item.statusId ?? NONE)) return false
  if (f.resourceIds.length && !(item.resourceIds.some((id) => f.resourceIds.includes(id)) || (f.resourceIds.includes(NONE) && item.resourceIds.length === 0))) return false
  if (f.groupIds.length && !f.groupIds.includes(item.groupId) && !f.groupIds.includes(ctx.parentOf.get(item.groupId) ?? '')) return false
  if (f.period) {
    const start = item.startDate ?? item.endDate
    const end = item.endDate ?? item.startDate
    if (!start || !end || end < f.period.start || start > f.period.end) return false
  }
  if (f.progress.length && !f.progress.includes(progressBucket(item.progress.value))) return false
  if (f.overdue && !isOverdue(item, ctx.today, ctx.categoryOf(item))) return false
  if (f.dependency === 'blocked' && !item.blocked) return false
  if (f.dependency === 'linked' && !ctx.linked.has(item.id)) return false
  return true
}

function comparator(plan: Plan, sort: PlanSort) {
  const statusPos = new Map(plan.statuses.map((s) => [s.id, s.position]))
  const resourceName = new Map(plan.resources.map((r) => [r.id, r.name]))
  const custom = isCustomColumnId(sort.column) ? plan.columns.find((c) => c.id === columnIdOf(sort.column)) : undefined
  const key = (item: PlanItem): string | number | null => {
    if (custom) return customSortKey(custom, item.custom[custom.id])
    switch (sort.column) {
      case 'name':
        return fold(item.name)
      case 'status':
        return item.statusId ? (statusPos.get(item.statusId) ?? null) : null
      case 'schedule':
        return item.startDate ?? item.endDate
      case 'resources':
        return item.resourceIds.length ? fold(resourceName.get(item.resourceIds[0] ?? '') ?? '') : null
      case 'estimated':
        return item.estimatedHours
      case 'duration':
        return item.durationDays
      case 'progress':
        return item.progress.value
      default:
        return null
    }
  }
  const sign = sort.direction === 'asc' ? 1 : -1
  return (a: PlanItem, b: PlanItem) => {
    const x = key(a)
    const y = key(b)
    // vazios sempre no fim
    if (x === null || y === null) return x === y ? byPosition(a, b) : x === null ? 1 : -1
    const diff = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
    return diff * sign || byPosition(a, b)
  }
}

/* ------------------------------------------------------------------ totais */

const sum2 = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100 : null)

/** Totais de um conjunto de elementos (mesma fórmula do servidor, só sobre os de primeiro nível). */
export function summarize(items: PlanItem[], plan: Plan): PlanGroupSummary {
  const categoryOf = categoryLookup(plan)
  const top = items.filter((i) => !i.parentId)
  const counts = new Map<string | null, number>()
  top.forEach((i) => counts.set(i.statusId, (counts.get(i.statusId) ?? 0) + 1))
  const starts = top.map((i) => i.startDate ?? i.endDate).filter((d): d is string => !!d)
  const ends = top.map((i) => i.endDate ?? i.startDate).filter((d): d is string => !!d)
  const counted = top.filter((i) => categoryOf(i) !== 'canceled')
  const weight = counted.reduce((acc, i) => acc + (i.estimatedHours ?? 0), 0)
  const progress = counted.length
    ? Math.round(
        weight > 0
          ? counted.reduce((acc, i) => acc + (i.estimatedHours ?? 0) * i.progress.value, 0) / weight
          : counted.reduce((acc, i) => acc + i.progress.value, 0) / counted.length,
      )
    : 0
  return {
    items: top.length,
    statusCounts: [...counts].map(([statusId, count]) => ({ statusId, count })),
    startDate: starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : null,
    endDate: ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : null,
    estimatedHours: sum2(top.map((i) => i.estimatedHours).filter((v): v is number => v !== null)),
    durationDays: sum2(top.map((i) => i.durationDays).filter((v): v is number => v !== null)),
    progress,
    customSums: sumCustom(top, plan.columns),
  }
}

/* ------------------------------------------------------------------ elementos visíveis */

interface Visible {
  items: PlanItem[]
  subitems: Map<string, PlanItem[]>
}

/**
 * Filtra os elementos: filtros da barra valem para o elemento; busca e pessoa também olham os
 * subelementos — o elemento que casa com a busca leva os subelementos (da pessoa, se houver filtro);
 * senão, aparece com os subelementos que casam.
 */
function visibleOf(list: PlanItem[], children: Map<string, PlanItem[]>, plan: Plan, options: ViewOptions): Visible {
  const q = fold((options.query ?? '').trim())
  const f = options.filters ?? EMPTY_FILTERS
  const owners = f.ownerIds.length ? new Set(f.ownerIds) : null
  const ctx = {
    today: options.today ?? new Date().toISOString().slice(0, 10),
    categoryOf: categoryLookup(plan),
    linked: new Set(plan.links.flatMap((l) => [l.fromId, l.toId])),
    parentOf: new Map(plan.groups.map((g) => [g.id, g.parentId])),
  }
  const ownerOk = (k: PlanItem) => !owners || (!!k.owner && owners.has(k.owner.id))
  const subitems = new Map<string, PlanItem[]>()
  const items = list.filter((item) => {
    if (!matchesElement(item, f, ctx)) return false
    const kids = children.get(item.id) ?? []
    if (!q || fold(item.name).includes(q)) {
      const shown = kids.filter(ownerOk)
      subitems.set(item.id, shown)
      return !owners || shown.length > 0
    }
    const matching = kids.filter((k) => ownerOk(k) && fold(k.name).includes(q))
    if (matching.length) subitems.set(item.id, matching)
    return matching.length > 0
  })
  return { items, subitems }
}

/** A tela está recortada (busca, filtros ou pessoa)? */
export function isNarrowed(options: ViewOptions): boolean {
  const f = options.filters ?? EMPTY_FILTERS
  return !!(options.query ?? '').trim() || activeFilterCount(f) > 0 || f.ownerIds.length > 0
}

function indexItems(plan: Plan) {
  const children = new Map<string, PlanItem[]>()
  const top = new Map<string, PlanItem[]>()
  plan.items.forEach((item) => {
    if (item.parentId) children.set(item.parentId, [...(children.get(item.parentId) ?? []), item])
    else top.set(item.groupId, [...(top.get(item.groupId) ?? []), item])
  })
  children.forEach((list) => list.sort(byPosition))
  return { children, top }
}

/* ------------------------------------------------------------------ seções por grupo */

/**
 * Seções do quadro, na ordem dos grupos: cada grupo raiz aparece com a sua tabela quando tem
 * elementos próprios ou não tem subgrupos (senão, só como cabeçalho da fase); cada subgrupo aparece
 * logo depois (título com o do pai). Com busca/filtros, seções sem resultado somem e os totais do
 * rodapé passam a ser os dos elementos visíveis.
 */
export function boardSections(plan: Plan, options: ViewOptions = {}): BoardSection[] {
  const narrowed = isNarrowed(options)
  const compare = options.sort ? comparator(plan, options.sort) : byPosition
  const { children, top } = indexItems(plan)

  const section = (group: PlanGroup, parent: PlanGroup | null, subgroups = 0): BoardSection => {
    const all = top.get(group.id) ?? []
    const { items, subitems } = visibleOf(all, children, plan, options)
    return {
      group: narrowed ? { ...group, summary: summarize(items, plan) } : group,
      parent,
      items: items.sort(compare),
      subitems,
      total: all.length,
      headerOnly: !parent && subgroups > 0 && all.length === 0,
      subgroups,
      synthetic: false,
    }
  }

  const out: BoardSection[] = []
  plan.groups
    .filter((g) => !g.parentId)
    .forEach((root) => {
      const subs = plan.groups.filter((g) => g.parentId === root.id)
      const head = section(root, null, subs.length)
      const subSections = subs.map((sub) => section(sub, root)).filter((s) => !narrowed || s.items.length > 0)
      if (narrowed && head.items.length === 0) {
        // recorte: a fase só aparece (como cabeçalho) quando algum subgrupo tem resultado
        if (subSections.length > 0) out.push({ ...head, headerOnly: true }, ...subSections)
        return
      }
      out.push(head, ...subSections)
    })
  return out
}

/* ------------------------------------------------------------------ agrupar por */

export interface GroupByLabels {
  noStatus: string
  noResource: string
  noSchedule: string
}

function monthLabel(month: string, locale: string): string {
  const parts = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).formatToParts(new Date(`${month}-01T00:00:00Z`))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('month').replace(/\.$/, '')} ${get('year')}`
}

/**
 * Seções de um agrupamento que não é o grupo (independente dos filtros): por etiqueta de status
 * (em branco no fim), por recurso (o elemento aparece em cada recurso; sem recurso no fim) ou por mês
 * do cronograma (sem cronograma no fim). Só seções com elementos; totais dos elementos da seção.
 */
export function groupedSections(plan: Plan, by: Exclude<PlanGroupBy, 'group'>, options: ViewOptions & { labels: GroupByLabels; locale: string }): BoardSection[] {
  const { children } = indexItems(plan)
  const groupIndex = new Map(plan.groups.map((g, i) => [g.id, i]))
  const all = plan.items.filter((i) => !i.parentId)
  const { items, subitems } = visibleOf(all, children, plan, options)
  const compare = options.sort ? comparator(plan, options.sort) : (a: PlanItem, b: PlanItem) => (groupIndex.get(a.groupId) ?? 0) - (groupIndex.get(b.groupId) ?? 0) || byPosition(a, b)

  const buckets: Array<{ key: string; name: string; color: OptionColor; items: PlanItem[] }> = []
  const bucket = (key: string, name: string, color: OptionColor) => {
    let found = buckets.find((b) => b.key === key)
    if (!found) {
      found = { key, name, color, items: [] }
      buckets.push(found)
    }
    return found
  }
  if (by === 'status') {
    plan.statuses.forEach((s) => bucket(s.id, s.name, s.color))
    bucket(NONE, options.labels.noStatus, 'gray')
    const known = new Set(plan.statuses.map((s) => s.id))
    items.forEach((i) => bucket(i.statusId && known.has(i.statusId) ? i.statusId : NONE, options.labels.noStatus, 'gray').items.push(i))
  } else if (by === 'resource') {
    plan.resources
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((r) => bucket(r.id, r.name, r.color))
    bucket(NONE, options.labels.noResource, 'gray')
    items.forEach((i) => (i.resourceIds.length ? i.resourceIds : [NONE]).forEach((id) => buckets.find((b) => b.key === id)?.items.push(i)))
  } else {
    const months = [...new Set(items.map((i) => (i.startDate ?? i.endDate)?.slice(0, 7)).filter((m): m is string => !!m))].sort()
    months.forEach((m) => bucket(m, monthLabel(m, options.locale), 'blue'))
    bucket(NONE, options.labels.noSchedule, 'gray')
    items.forEach((i) => bucket((i.startDate ?? i.endDate)?.slice(0, 7) ?? NONE, options.labels.noSchedule, 'gray').items.push(i))
  }
  return buckets
    .filter((b) => b.items.length > 0)
    .map((b, index) => {
      const list = b.items.slice().sort(compare)
      const group: PlanGroup = { id: `${by}:${b.key}`, parentId: null, name: b.name, color: b.color, position: index, number: null, summary: summarize(list, plan) }
      return { group, parent: null, items: list, subitems, total: list.length, headerOnly: false, subgroups: 0, synthetic: true }
    })
}

/** Elementos que a busca ou a pessoa abriram (subelementos mostrados por causa do recorte). */
export function expandedByNarrowing(sections: BoardSection[], options: ViewOptions): Set<string> {
  const q = fold((options.query ?? '').trim())
  const owners = (options.filters ?? EMPTY_FILTERS).ownerIds.length > 0
  const out = new Set<string>()
  if (!q && !owners) return out
  sections.forEach((s) =>
    s.items.forEach((item) => {
      const shown = s.subitems.get(item.id) ?? []
      if ((owners && shown.length > 0) || (q && shown.some((k) => fold(k.name).includes(q)))) out.add(item.id)
    }),
  )
  return out
}

/* ------------------------------------------------------------------ dependências */

export interface LinkedItem {
  link: PlanLink
  item: PlanItem
}

export interface ItemDependencies {
  /** Elementos de que este depende (bloqueiam este). */
  dependsOn: LinkedItem[]
  /** Elementos que este bloqueia. */
  blocks: LinkedItem[]
  relates: LinkedItem[]
}

/** Dependências vistas do elemento (os dois lados da ligação). */
export function dependenciesOf(itemId: string, plan: Plan): ItemDependencies {
  const byId = new Map(plan.items.map((i) => [i.id, i]))
  const out: ItemDependencies = { dependsOn: [], blocks: [], relates: [] }
  plan.links.forEach((link) => {
    if (link.fromId !== itemId && link.toId !== itemId) return
    const otherId = link.fromId === itemId ? link.toId : link.fromId
    const item = byId.get(otherId)
    if (!item) return
    if (link.type === 'relates') out.relates.push({ link, item })
    else if (link.toId === itemId) out.dependsOn.push({ link, item })
    else out.blocks.push({ link, item })
  })
  return out
}

/** Elementos que podem ser ligados a este (outros elementos, ainda sem ligação com ele), na ordem do quadro. */
export function linkCandidates(itemId: string, plan: Plan, query: string): PlanItem[] {
  const q = fold(query.trim())
  const linked = new Set(plan.links.filter((l) => l.fromId === itemId || l.toId === itemId).flatMap((l) => [l.fromId, l.toId]))
  const groupIndex = new Map(plan.groups.map((g, i) => [g.id, i]))
  return plan.items
    .filter((i) => !i.parentId && i.id !== itemId && !linked.has(i.id) && (!q || fold(i.name).includes(q)))
    .sort((a, b) => (groupIndex.get(a.groupId) ?? 0) - (groupIndex.get(b.groupId) ?? 0) || byPosition(a, b))
}

/* ------------------------------------------------------------------ Kanban (GP-4) */

export interface KanbanColumn {
  /** null = "Em branco" (sem status). */
  status: PlanStatus | null
  items: PlanItem[]
}

/**
 * Kanban do quadro: uma coluna por etiqueta de status (na ordem do quadro) e "Em branco" por último;
 * os cards são os elementos de primeiro nível (busca pelo nome, sem acento), na ordem dos grupos.
 */
export function kanbanColumns(plan: Plan, query = ''): KanbanColumn[] {
  const q = fold(query.trim())
  const order = new Map(plan.groups.map((g, index) => [g.id, index]))
  const known = new Set(plan.statuses.map((s) => s.id))
  const items = plan.items
    .filter((i) => !i.parentId && (!q || fold(i.name).includes(q)))
    .sort((a, b) => (order.get(a.groupId) ?? 0) - (order.get(b.groupId) ?? 0) || a.position - b.position)
  const columns: KanbanColumn[] = plan.statuses.map((status) => ({ status, items: items.filter((i) => i.statusId === status.id) }))
  columns.push({ status: null, items: items.filter((i) => !i.statusId || !known.has(i.statusId)) })
  return columns
}

/** Visões do quadro (GP-4): todas leem os mesmos elementos. */
export const PLAN_VIEWS = ['board', 'timeline', 'kanban', 'management', 'reports'] as const
export type PlanView = (typeof PLAN_VIEWS)[number]
