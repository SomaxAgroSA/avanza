/**
 * Escala e coluna dos títulos das linhas do tempo (Caixa de entrada › Linha do tempo e Projetos › Em andamento ›
 * "Linha do tempo dos projetos"), ajuste aprovado em demonstração em 26/11 (§52). Só cálculo: textos, cores e
 * medidas da tela ficam nos componentes (presentation/components/gantt).
 *
 * - **Por semanas** (janelas curtas): em cima, as semanas (segunda a domingo); embaixo, o número de cada dia; os
 *   fins de semana sombreados e a semana atual em destaque.
 * - **Por meses** (janelas longas): em cima, os meses (o atual em destaque); embaixo, o dia de início de cada
 *   semana (segunda-feira).
 * - Nos dois, HOJE ocupa o lugar do número do dia e a linha vermelha corta todo o alto.
 */

const DAY_MS = 86_400_000

export type GanttScaleUnit = 'weeks' | 'months'

/** Faixa de cima: uma semana ou um mês, em % da linha do tempo. */
export interface GanttPeriod {
  /** Primeiro dia (meia-noite UTC). */
  start: Date
  /** Último dia (meia-noite UTC). */
  last: Date
  left: number
  width: number
  /** Contém hoje (semana ou mês atual). */
  current: boolean
}

/** Marca de baixo: um dia (por semanas) ou uma segunda-feira (por meses); `left` = centro do dia, em %. */
export interface GanttMark {
  date: Date
  left: number
  weekend: boolean
}

export interface GanttScale {
  unit: GanttScaleUnit
  /** Começo (incluído) e fim (excluído) da janela, meia-noite UTC. */
  from: Date
  to: Date
  /** Dias da janela. */
  days: number
  periods: GanttPeriod[]
  /** Sem o dia de hoje (no lugar dele vai HOJE). */
  marks: GanttMark[]
  /** Sábados e domingos (só por semanas), em %. */
  weekends: Array<{ left: number; width: number }>
  /** Centro do dia de hoje, em %; null = hoje fora da janela. */
  today: number | null
}

const isWeekend = (ms: number) => {
  const day = new Date(ms).getUTCDay()
  return day === 0 || day === 6
}

/**
 * Escala da janela `[from, to)` (dias à meia-noite UTC); `today` = o dia de hoje no calendário de quem olha,
 * também como meia-noite UTC.
 */
export function ganttScale(from: number, to: number, today: number, unit: GanttScaleUnit): GanttScale {
  const span = Math.max(DAY_MS, to - from)
  const pct = (ms: number) => Math.max(0, Math.min(100, ((ms - from) / span) * 100))
  const periods: GanttPeriod[] = []
  const push = (start: number, end: number) =>
    periods.push({ start: new Date(start), last: new Date(end - DAY_MS), left: pct(start), width: pct(end) - pct(start), current: today >= start && today < end })
  if (unit === 'weeks') {
    for (let start = from; start < to; ) {
      // a próxima segunda-feira
      const end = Math.min(to, start + (7 - ((new Date(start).getUTCDay() + 6) % 7)) * DAY_MS)
      push(start, end)
      start = end
    }
  } else {
    for (let start = from; start < to; ) {
      const d = new Date(start)
      const end = Math.min(to, Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
      push(start, end)
      start = end
    }
  }
  const marks: GanttMark[] = []
  const weekends: GanttScale['weekends'] = []
  for (let day = from; day < to; day += DAY_MS) {
    const weekend = isWeekend(day)
    if (unit === 'weeks' && weekend) weekends.push({ left: pct(day), width: pct(day + DAY_MS) - pct(day) })
    const shown = unit === 'weeks' || new Date(day).getUTCDay() === 1
    if (shown && day !== today) marks.push({ date: new Date(day), left: pct(day + DAY_MS / 2), weekend })
  }
  return {
    unit,
    from: new Date(from),
    to: new Date(to),
    days: Math.round(span / DAY_MS),
    periods,
    marks,
    weekends,
    today: today >= from && today < to ? pct(today + DAY_MS / 2) : null,
  }
}

/** Mínimo por dia (por semanas) para os números dos dias caberem, e por semana (por meses) para o dia da segunda. */
export const GANTT_DAY_MIN_PX = 16
export const GANTT_WEEK_MIN_PX = 24

/**
 * Largura mínima das barras: os números dos dias (ou das segundas) cabem e a faixa atual cabe o seu rótulo
 * ("Esta semana · 23–29 nov", `currentLabelPx`). Abaixo disso a linha do tempo rola para o lado.
 */
export function ganttMinWidth(scale: GanttScale, currentLabelPx = 0): number {
  const base = scale.unit === 'weeks' ? scale.days * GANTT_DAY_MIN_PX : Math.ceil((scale.days / 7) * GANTT_WEEK_MIN_PX)
  const current = scale.periods.find((p) => p.current)
  const forLabel = current && current.width > 0 ? Math.ceil((currentLabelPx * 100) / current.width) : 0
  return Math.max(base, forLabel)
}

/**
 * Marcas de baixo que não esbarram em HOJE: com as barras medindo `chartPx`, some a marca cujo centro fica a
 * menos de meia largura de HOJE mais meia largura da marca.
 */
export function marksClearOfToday(scale: GanttScale, chartPx: number, todayPx = 30, markPx = 16): GanttMark[] {
  const today = scale.today
  if (today === null || chartPx <= 0) return scale.marks
  return scale.marks.filter((mark) => (Math.abs(mark.left - today) / 100) * chartPx >= (todayPx + markPx) / 2)
}

/* ------------------------------------------------------------------ coluna dos títulos */

/** Passo das setas ← → no divisor. */
export const GANTT_LABEL_STEP = 20
/** Largura média de um caractere de 12px (estimativa enquanto não há medida, como nos testes sem layout). */
const CHAR_PX = 6.6
/** Folga entre o título e as barras (o `pr-3` do título). */
export const GANTT_LABEL_GAP = 12

/** Largura estimada do título mais longo (sem layout para medir). */
export function estimateLabelWidth(texts: readonly string[], extra = 0): number {
  const longest = texts.reduce((max, text) => Math.max(max, text.trim().length), 0)
  return Math.ceil(longest * CHAR_PX + GANTT_LABEL_GAP + extra)
}

/**
 * Coluna dos títulos: nunca menor que o título mais longo (`minimum`, medido); o divisor só alarga (`chosen`),
 * até sobrar o mínimo das barras (`max`; sem medida, sem teto). Largura guardada menor que o mínimo não vale.
 */
export function labelColumnWidth(minimum: number, chosen: number | null, max = Number.POSITIVE_INFINITY): number {
  return Math.round(Math.max(minimum, Math.min(chosen ?? 0, max)))
}

/** Largura escolhida no divisor: até o mínimo volta à automática (null); acima, dentro do teto. */
export function chooseLabelWidth(next: number, minimum: number, max = Number.POSITIVE_INFINITY): number | null {
  const width = labelColumnWidth(minimum, next, max)
  return width <= Math.round(minimum) ? null : width
}

/** Largura guardada no navegador: número positivo ou null (= automática). */
export const toLabelWidth = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null)
