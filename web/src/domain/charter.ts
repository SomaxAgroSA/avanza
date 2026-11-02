/**
 * Ficha do projeto (regras de negócio §21): objetivos, funcionalidades, alcance e resultados esperados.
 * Os estados e a situação vêm calculados do servidor (backend/pb_hooks/src/domain/charter.js);
 * aqui ficam os tipos, as opções dos formulários e as regras de apresentação.
 */
import type { UserSummary } from './projects'
import type { TaskSummary } from './tasks'

export const CHARTER_KINDS = ['objective', 'feature', 'scope_in', 'scope_out', 'result'] as const
export type CharterKind = (typeof CHARTER_KINDS)[number]

export const OBJECTIVE_STATES = ['pending', 'in_progress', 'achieved', 'at_risk'] as const
export type ObjectiveState = (typeof OBJECTIVE_STATES)[number]

export const FEATURE_STATES = ['planned', 'in_progress', 'late', 'delivered', 'cancelled'] as const
export type FeatureState = (typeof FEATURE_STATES)[number]

export const RESULT_SITUATIONS = ['achieved', 'on_track', 'late', 'no_data'] as const
export type ResultSituation = (typeof RESULT_SITUATIONS)[number]

export const MEASURE_FREQUENCIES = ['none', 'weekly', 'monthly', 'quarterly'] as const
export type MeasureFrequency = (typeof MEASURE_FREQUENCIES)[number]

export const CHARTER_SECTIONS = ['objectives', 'features', 'scope', 'results'] as const
export type CharterSection = (typeof CHARTER_SECTIONS)[number]

export const CHARTER_LIMITS = { objective: 2000, title: 200, description: 1000, unit: 20, note: 500, tasks: 200, links: 50 } as const

interface CharterItemBase {
  id: string
  projectId: string
  title: string
  description: string
  position: number
  owner: UserSummary | null
  createdAt: Date | null
  updatedAt: Date | null
}

export interface ObjectiveItem extends CharterItemBase {
  kind: 'objective'
  /** `auto` = calculado pelos vínculos. */
  state: 'auto' | ObjectiveState
  effectiveState: ObjectiveState
  linkIds: string[]
}

export interface FeatureItem extends CharterItemBase {
  kind: 'feature'
  /** `auto` = calculado pelas tarefas vinculadas. */
  state: 'auto' | FeatureState
  effectiveState: FeatureState
  taskIds: string[]
  tasks: TaskSummary[]
  progress: { done: number; total: number }
}

export interface ScopeItem extends CharterItemBase {
  kind: 'scope_in' | 'scope_out'
}

export interface ResultItem extends CharterItemBase {
  kind: 'result'
  unit: string
  baseline: number
  target: number
  current: number | null
  /** AAAA-MM-DD */
  startDate: string | null
  dueDate: string | null
  frequency: MeasureFrequency
  measuredAt: string | null
  situation: ResultSituation
  percent: number
  stale: boolean
}

export type CharterItem = ObjectiveItem | FeatureItem | ScopeItem | ResultItem

export interface CharterSummary {
  featuresTotal: number
  featuresDelivered: number
  tasksTotal: number
  tasksDone: number
  resultsTotal: number
  resultsOnTrack: number
  resultsLate: number
  resultsStale: number
}

export interface ProjectCharter {
  projectId: string
  objective: string
  updatedAt: Date | null
  updatedBy: UserSummary | null
  capabilities: { edit: boolean }
  completeness: { sections: Record<CharterSection, boolean>; done: number; total: number; percent: number }
  summary: CharterSummary
  items: CharterItem[]
}

export interface CharterMeasurement {
  id: string
  itemId: string
  value: number
  note: string
  /** AAAA-MM-DD */
  measuredAt: string
  createdBy: UserSummary | null
  createdAt: Date | null
}

/** Corpo de criação/edição; cada tipo usa só os seus campos (o servidor ignora os demais). */
export interface CharterItemInput {
  kind?: CharterKind
  title?: string
  description?: string
  state?: string
  ownerId?: string | null
  linkIds?: string[]
  taskIds?: string[]
  unit?: string
  baseline?: number
  target?: number
  startDate?: string | null
  dueDate?: string | null
  frequency?: MeasureFrequency
}

export interface MeasurementInput {
  value: number
  note?: string
  /** AAAA-MM-DD; padrão hoje. */
  measuredAt?: string
}

export const itemsOf = <K extends CharterKind>(charter: ProjectCharter, kind: K) =>
  charter.items.filter((item): item is Extract<CharterItem, { kind: K }> => item.kind === kind)

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

export const OBJECTIVE_TONE: Record<ObjectiveState, Tone> = { pending: 'neutral', in_progress: 'info', achieved: 'success', at_risk: 'warning' }
export const FEATURE_TONE: Record<FeatureState, Tone> = { planned: 'neutral', in_progress: 'info', late: 'warning', delivered: 'success', cancelled: 'danger' }
export const SITUATION_TONE: Record<ResultSituation, Tone> = { achieved: 'success', on_track: 'info', late: 'warning', no_data: 'neutral' }

/** Texto do valor com a unidade ("68 %", "46 pessoas"); null = "—". */
export function formatMeasure(value: number | null, unit: string, locale: string): string {
  if (value === null) return '—'
  const text = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
  return unit ? `${text} ${unit}` : text
}
