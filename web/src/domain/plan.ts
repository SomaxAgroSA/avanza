/**
 * Quadro do projeto — Gerenciamento de Projetos (docs/diretriz_feature_gerenciamento_projetos.md).
 * Módulo à parte das tarefas: grupos (fases), elementos e subelementos com etiquetas próprias de
 * status e de recursos. Os cálculos (duração, progresso, totais do grupo, numeração) vêm prontos do
 * servidor (backend/src/domain/plan.js); aqui ficam os tipos, as regras de edição na tela,
 * a barra de status e os formatos compactos. A organização da tela (seções, filtros, agrupar por)
 * fica em plan-view.ts.
 */
import type { OptionColor } from './task-config'
import type { UserSummary } from './projects'
import type { CustomValue, PlanColumn } from './plan-columns'

export const PLAN_STATUS_CATEGORIES = ['todo', 'in_progress', 'review', 'blocked', 'done', 'canceled'] as const
export type PlanStatusCategory = (typeof PLAN_STATUS_CATEGORIES)[number]

/** De onde vem o progresso: status concluído, subelementos, tarefas vinculadas, digitado ou nenhum. */
export const PROGRESS_SOURCES = ['done', 'subitems', 'tasks', 'manual', 'none'] as const
export type ProgressSource = (typeof PROGRESS_SOURCES)[number]

/** Referência curta a um elemento (ou subelemento) do quadro — ex.: o vínculo da tarefa. */
export interface PlanItemRef {
  id: string
  name: string
}

/** Tarefas vinculadas ao elemento (as canceladas não entram no total). */
export interface PlanTaskCount {
  total: number
  done: number
}

/** Limites (iguais aos do servidor). */
export const PLAN_LIMITS = {
  groupName: 120,
  itemName: 255,
  statusName: 40,
  resourceName: 60,
  resources: 20,
  hours: 100000,
  durationDays: 3650,
} as const

/** Etiqueta de status do quadro (própria do projeto). */
export interface PlanStatus {
  id: string
  name: string
  color: OptionColor
  category: PlanStatusCategory
  position: number
}

/** Etiqueta de recurso (papel: "Gerente de Projetos", "Cliente"…). */
export interface PlanResource {
  id: string
  name: string
  color: OptionColor
}

/** Totais do grupo (linha do rodapé), sobre os elementos de primeiro nível. */
export interface PlanGroupSummary {
  items: number
  statusCounts: Array<{ statusId: string | null; count: number }>
  startDate: string | null
  endDate: string | null
  estimatedHours: number | null
  durationDays: number | null
  progress: number
  /** Soma das colunas personalizadas numéricas (GP-5). */
  customSums?: Record<string, number | null>
}

export interface PlanGroup {
  id: string
  parentId: string | null
  name: string
  color: OptionColor
  position: number
  /** "1.0", "2.1"… */
  number: string | null
  summary: PlanGroupSummary | null
}

export interface PlanItem {
  id: string
  groupId: string
  /** Subelemento: id do elemento pai (um nível só). */
  parentId: string | null
  name: string
  statusId: string | null
  /** Datas no formato AAAA-MM-DD. */
  startDate: string | null
  endDate: string | null
  dueDate: string | null
  owner: UserSummary | null
  resourceIds: string[]
  estimatedHours: number | null
  actualHours: number | null
  /** Duração efetiva: dias do cronograma ou a informada. */
  durationDays: number | null
  /** Duração informada à mão (vale quando não há cronograma). */
  durationManual: number | null
  progress: { value: number; source: ProgressSource }
  /** Progresso informado à mão (null = automático). */
  progressManual: number | null
  subitems: number
  position: number
  /** Depende de elemento ainda aberto (a regra do quadro decide se só sinaliza ou impede). */
  blocked: boolean
  /** Contadores do painel do elemento (GP-3). */
  updates: number
  files: number
  /** Linha de base do Cronograma (GP-4), salva pelo gestor; AAAA-MM-DD. */
  baselineStart: string | null
  baselineEnd: string | null
  /** Valores das colunas personalizadas (GP-5; só elementos): { coluna: valor }. */
  custom: Record<string, CustomValue>
  /** Tarefas vinculadas (execução do elemento); ausente = nenhuma (ver plan-tasks.ts). */
  tasks?: PlanTaskCount
  /**
   * `estimatedHours`/`actualHours` vieram das tarefas vinculadas (o elemento não tem o próprio; regras
   * §28). Digitar um valor passa a valer no lugar; limpar volta às tarefas. Ausente = não.
   */
  estimatedFromTasks?: boolean
  actualFromTasks?: boolean
}

/** Dependência gravada: `blocks` = from bloqueia to (to depende de from); `relates` = relacionados. */
export interface PlanLink {
  id: string
  fromId: string
  toId: string
  type: 'blocks' | 'relates'
}

/** Tipos pedidos na tela. */
export const LINK_KINDS = ['depends_on', 'blocks', 'relates'] as const
export type PlanLinkKind = (typeof LINK_KINDS)[number]

/** Regra do quadro: só sinalizar, ou impedir iniciar/concluir com dependência pendente. */
export const DEPENDENCY_RULES = ['warn', 'block'] as const
export type DependencyRule = (typeof DEPENDENCY_RULES)[number]

export interface Plan {
  project: { id: string; key: string; name: string; archived: boolean }
  /** edit: elementos e recursos; manage: grupos e etiquetas de status. */
  capabilities: { edit: boolean; manage: boolean }
  statuses: PlanStatus[]
  resources: PlanResource[]
  groups: PlanGroup[]
  items: PlanItem[]
  /** Colunas personalizadas do quadro (GP-5), na ordem do quadro. */
  columns: PlanColumn[]
  links: PlanLink[]
  /** baselineAt: quando o gestor salvou a linha de base do Cronograma (null = sem linha de base). */
  settings: { dependencyRule: DependencyRule; baselineAt: Date | null }
  /** Totais do quadro inteiro (Bateria e Esforço do Cronograma). */
  summary: PlanGroupSummary | null
  truncated: boolean
}

export interface PlanGroupInput {
  name?: string
  color?: OptionColor
  parentId?: string | null
}

export interface PlanGroupMove {
  parentId: string | null
  prevId?: string
  nextId?: string
}

export interface PlanItemInput {
  groupId?: string
  parentId?: string
  name?: string
  statusId?: string | null
  startDate?: string | null
  endDate?: string | null
  dueDate?: string | null
  ownerId?: string | null
  resourceIds?: string[]
  estimatedHours?: number | null
  actualHours?: number | null
  durationDays?: number | null
  progress?: number | null
  /** Colunas personalizadas: só as que mudaram (null limpa). */
  custom?: Record<string, CustomValue | null>
}

/** Arrastar/mover: grupo (elemento) e vizinho (sem vizinho = fim). */
export interface PlanItemMove {
  groupId?: string
  prevId?: string
  nextId?: string
}

/** Seleção em massa (até 200 elementos). */
export type PlanBulkInput = { ids: string[] } & (
  | { action: 'update'; statusId?: string | null; addResourceIds?: string[]; removeResourceIds?: string[] }
  | { action: 'move'; groupId: string }
  | { action: 'duplicate' }
  | { action: 'delete' }
)

export interface PlanBulkResult {
  updated?: number
  moved?: number
  duplicated?: number
  deleted?: number
}

/** Linha da importação (já lida da planilha). Grupo, status e recursos pelo nome. */
export interface PlanImportRow {
  group: string
  name: string
  /** Nome do elemento pai (a linha é subelemento). */
  parent?: string | null
  status?: string | null
  startDate?: string | null
  endDate?: string | null
  resources?: string[]
  estimatedHours?: number | null
  actualHours?: number | null
  durationDays?: number | null
  progress?: number | null
}

export interface PlanImportResult {
  groups: number
  statuses: number
  resources: number
  items: number
  subitems: number
}

export interface PlanStatusInput {
  name?: string
  color?: OptionColor
  category?: PlanStatusCategory
}

export interface PlanResourceInput {
  name?: string
  color?: OptionColor
}

/* ------------------------------------------------------------------ regras de edição na tela */

/** Duração só é digitada quando não há cronograma (senão é calculada pelas datas). */
export const isDurationEditable = (item: PlanItem) => !item.startDate && !item.endDate

/** Progresso só é digitado quando não vem dos subelementos, das tarefas vinculadas nem do status concluído. */
export const isProgressEditable = (item: PlanItem) => item.progress.source !== 'subitems' && item.progress.source !== 'tasks' && item.progress.source !== 'done'

/* ------------------------------------------------------------------ barra de status do rodapé */

export interface StatusSegment {
  statusId: string | null
  count: number
  /** 0–100 */
  percent: number
}

/** Distribuição de status do grupo na ordem das etiquetas (em branco por último). */
export function statusSegments(summary: PlanGroupSummary | null, statuses: PlanStatus[]): StatusSegment[] {
  if (!summary || summary.items === 0) return []
  const order = new Map(statuses.map((s, index) => [s.id, index]))
  const rank = (id: string | null) => (id && order.has(id) ? (order.get(id) ?? 0) : Number.MAX_SAFE_INTEGER)
  return summary.statusCounts
    .map((c) => ({ statusId: c.statusId && order.has(c.statusId) ? c.statusId : null, count: c.count }))
    .reduce<Array<{ statusId: string | null; count: number }>>((acc, c) => {
      const found = acc.find((x) => x.statusId === c.statusId)
      if (found) found.count += c.count
      else acc.push({ ...c })
      return acc
    }, [])
    .sort((a, b) => rank(a.statusId) - rank(b.statusId))
    .map((c) => ({ ...c, percent: Math.round((c.count / summary.items) * 1000) / 10 }))
}

/* ------------------------------------------------------------------ números digitados */

export type ParsedNumber = { ok: true; value: number | null } | { ok: false }

/**
 * Número digitado numa célula: vazio = null; aceita vírgula ou ponto; `integer` exige inteiro;
 * até 2 casas decimais; dentro de [min, max].
 */
export function parseNumberInput(text: string, options: { integer?: boolean; min?: number; max: number }): ParsedNumber {
  const raw = text.trim().replace(/\s/g, '')
  if (raw === '') return { ok: true, value: null }
  if (!/^-?\d+([.,]\d+)?$/.test(raw)) return { ok: false }
  const value = Number(raw.replace(',', '.'))
  if (!Number.isFinite(value)) return { ok: false }
  if (options.integer && !Number.isInteger(value)) return { ok: false }
  if (!options.integer && Math.round(value * 100) !== value * 100) return { ok: false }
  if (value < (options.min ?? 0) || value > options.max) return { ok: false }
  return { ok: true, value }
}

/* ------------------------------------------------------------------ formatos compactos */

const stripDot = (text: string) => text.replace(/\.$/, '')
const toUtc = (day: string) => new Date(`${day}T00:00:00Z`)

function dayParts(day: string, locale: string) {
  const parts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).formatToParts(toUtc(day))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return { day: get('day'), month: stripDot(get('month')), year: get('year') }
}

/** Cronograma compacto: "18 set", "18 — 20 set", "28 set — 2 out", "28 dez 2026 — 3 jan 2027" (ano só fora do atual). */
export function formatSchedule(start: string | null, end: string | null, locale: string, now: Date = new Date()): string | null {
  const first = start ?? end
  const last = end ?? start
  if (!first || !last) return null
  const a = dayParts(first, locale)
  const b = dayParts(last, locale)
  const currentYear = String(now.getUTCFullYear())
  const withYear = a.year !== b.year || a.year !== currentYear
  const one = (p: typeof a) => `${p.day} ${p.month}${withYear ? ` ${p.year}` : ''}`
  if (first === last) return one(a)
  if (!withYear && a.month === b.month) return `${a.day} — ${b.day} ${b.month}`
  return `${one(a)} — ${one(b)}`
}

/** Dias corridos do intervalo, contando as duas pontas (uma data = 1). */
export function rangeDays(start: string | null, end: string | null): number {
  const first = start ?? end
  const last = end ?? start
  if (!first || !last) return 0
  return Math.round((toUtc(last).getTime() - toUtc(first).getTime()) / 86400000) + 1
}

/** Número compacto: "4,1", "10", "26,25". */
export function formatNumber(value: number | null, locale: string): string | null {
  if (value === null || value === undefined) return null
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
}

/** Número para editar (sem separador de milhar): "4,1" em pt-BR, "4.1" em en. */
export function formatNumberInput(value: number | null, locale: string): string {
  if (value === null || value === undefined) return ''
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(value)
}
