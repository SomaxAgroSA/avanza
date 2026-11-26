import { describe, expect, it } from 'vitest'
import {
  GANTT_DAY_MIN_PX,
  GANTT_WEEK_MIN_PX,
  chooseLabelWidth,
  estimateLabelWidth,
  ganttMinWidth,
  ganttScale,
  labelColumnWidth,
  marksClearOfToday,
} from './gantt-scale'

const d = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`)
const iso = (date: Date) => date.toISOString().slice(0, 10)

describe('escala das linhas do tempo (§52)', () => {
  it('por semanas: semanas de segunda a domingo, a atual em destaque, cada dia embaixo (menos hoje), fins de semana', () => {
    const scale = ganttScale(d('2026-11-16'), d('2026-12-14'), d('2026-11-26'), 'weeks')
    expect(scale.days).toBe(28)
    expect(scale.periods.map((p) => [iso(p.start), iso(p.last), p.current])).toEqual([
      ['2026-11-16', '2026-11-22', false],
      ['2026-11-23', '2026-11-29', true],
      ['2026-11-30', '2026-12-06', false],
      ['2026-12-07', '2026-12-13', false],
    ])
    expect(scale.periods.map((p) => p.left)).toEqual([0, 25, 50, 75])
    expect(scale.periods.every((p) => p.width === 25)).toBe(true)
    // 28 dias, menos hoje (no lugar vai HOJE)
    expect(scale.marks).toHaveLength(27)
    expect(scale.marks.map((m) => iso(m.date))).not.toContain('2026-11-26')
    expect(scale.marks.filter((m) => m.weekend).map((m) => m.date.getUTCDay())).toEqual([6, 0, 6, 0, 6, 0, 6, 0])
    expect(scale.weekends).toHaveLength(8)
    expect(scale.weekends[0]!.left).toBeCloseTo((5 / 28) * 100)
    // hoje: o centro do dia 26/11 (11º dia)
    expect(scale.today).toBeCloseTo((10.5 / 28) * 100)
  })

  it('por meses: os meses (o atual em destaque), as segundas-feiras embaixo, sem fins de semana sombreados', () => {
    const scale = ganttScale(d('2026-09-01'), d('2027-05-01'), d('2026-11-26'), 'months')
    expect(scale.periods.map((p) => iso(p.start).slice(0, 7))).toEqual(['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04'])
    expect(scale.periods.filter((p) => p.current).map((p) => iso(p.start))).toEqual(['2026-11-01'])
    expect(iso(scale.periods[1]!.last)).toBe('2026-10-31')
    expect(scale.marks.every((m) => m.date.getUTCDay() === 1)).toBe(true)
    expect(scale.marks.map((m) => iso(m.date)).slice(0, 3)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21'])
    expect(scale.weekends).toEqual([])
  })

  it('hoje fora da janela: sem HOJE', () => {
    expect(ganttScale(d('2026-11-16'), d('2026-11-23'), d('2026-12-01'), 'weeks').today).toBeNull()
  })

  it('mínimo das barras: 16px por dia (ou 24px por semana) e o rótulo da faixa atual cabe', () => {
    const weeks = ganttScale(d('2026-11-16'), d('2026-12-14'), d('2026-11-26'), 'weeks')
    expect(ganttMinWidth(weeks)).toBe(28 * GANTT_DAY_MIN_PX)
    // "Esta semana · 23–29 nov" de ~170px numa semana de 25%: as barras precisam de 680px
    expect(ganttMinWidth(weeks, 170)).toBe(680)
    const months = ganttScale(d('2026-09-01'), d('2027-05-01'), d('2026-11-26'), 'months')
    expect(ganttMinWidth(months)).toBe(Math.ceil((months.days / 7) * GANTT_WEEK_MIN_PX))
  })

  it('a marca que esbarra em HOJE some (pela largura das barras); sem medida, ficam todas', () => {
    const months = ganttScale(d('2026-09-01'), d('2027-05-01'), d('2026-11-26'), 'months')
    // 24px por semana: a segunda 23/11 (3 dias antes) e a 30/11 (4 dias depois) esbarram em HOJE
    const tight = marksClearOfToday(months, ganttMinWidth(months)).map((m) => iso(m.date))
    expect(tight).not.toContain('2026-11-23')
    expect(tight).not.toContain('2026-11-30')
    expect(tight).toContain('2026-11-16')
    expect(tight).toContain('2026-12-07')
    // com bem mais espaço, ficam
    const wide = marksClearOfToday(months, 6000).map((m) => iso(m.date))
    expect(wide).toContain('2026-11-23')
    expect(wide).toContain('2026-11-30')
    expect(marksClearOfToday(months, 0)).toHaveLength(months.marks.length)
  })
})

describe('coluna dos títulos (§52): o título mais longo, o divisor só alarga', () => {
  it('estimativa sem medida: pelo texto mais longo mais a folga', () => {
    expect(estimateLabelWidth(['Curta', 'Um título bem mais longo'])).toBe(Math.ceil(24 * 6.6 + 12))
    expect(estimateLabelWidth(['Alfa'], 20)).toBe(Math.ceil(4 * 6.6 + 12 + 20))
    expect(estimateLabelWidth([])).toBe(12)
  })

  it('nunca abaixo do título mais longo; a escolhida só vale se for maior (até o teto)', () => {
    expect(labelColumnWidth(310, null)).toBe(310)
    // largura guardada antiga, menor que o título mais longo: não vale
    expect(labelColumnWidth(310, 200)).toBe(310)
    expect(labelColumnWidth(310, 420.4)).toBe(420)
    expect(labelColumnWidth(310, 2000, 900)).toBe(900)
    // tela estreita: o teto fica abaixo do título — vale o título (a linha do tempo rola)
    expect(labelColumnWidth(310, 500, 120)).toBe(310)
  })

  it('o divisor: até o mínimo volta à automática (null)', () => {
    expect(chooseLabelWidth(290, 310)).toBeNull()
    expect(chooseLabelWidth(310, 310)).toBeNull()
    expect(chooseLabelWidth(330, 310)).toBe(330)
    expect(chooseLabelWidth(2000, 310, 900)).toBe(900)
    expect(chooseLabelWidth(500, 310, 120)).toBeNull()
  })
})
