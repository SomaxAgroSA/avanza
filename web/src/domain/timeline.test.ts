import { describe, expect, it } from 'vitest'
import {
  barBox,
  dayFromIso,
  dropSpan,
  estimateTextWidth,
  groupTimelineTasks,
  headerTiers,
  isConflict,
  isoFromDay,
  layoutLabels,
  shiftSpan,
  taskSpan,
  timelineRange,
  todayOf,
} from './timeline'
import type { TaskSummary } from './tasks'

const utc = (day: string) => new Date(`${day}T00:00:00.000Z`)
const d = dayFromIso

function task(id: string, extra: Partial<TaskSummary> = {}): TaskSummary {
  return { id, code: id, number: Number(id.replace(/\D/g, '')) || 1, title: id, startDate: null, dueDate: null, sprint: null, assignee: null, status: null, type: null, ...extra } as TaskSummary
}

describe('domain/timeline — dias e barras', () => {
  it('dia civil como número e de volta (AAAA-MM-DD)', () => {
    expect(isoFromDay(d('2026-10-01'))).toBe('2026-10-01')
    expect(d('2026-10-02') - d('2026-10-01')).toBe(1)
    // "hoje" é o dia do calendário local, não o instante UTC
    expect(isoFromDay(todayOf(new Date(2026, 9, 1, 23, 30)))).toBe('2026-10-01')
  })

  it('período da barra (espelha o backend): início→prazo; uma data = um dia; nenhuma = sem datas', () => {
    expect(taskSpan({ startDate: utc('2026-10-01'), dueDate: utc('2026-10-04') })).toEqual({ start: d('2026-10-01'), end: d('2026-10-04') })
    expect(taskSpan({ startDate: null, dueDate: utc('2026-10-04') })).toEqual({ start: d('2026-10-04'), end: d('2026-10-04') })
    expect(taskSpan({ startDate: null, dueDate: null })).toBeNull()
  })

  it('conflito: começa antes do prazo da tarefa de que depende (mesmo dia pode)', () => {
    const a = { start: d('2026-10-01'), end: d('2026-10-05') }
    expect(isConflict(a, { start: d('2026-10-03'), end: d('2026-10-08') })).toBe(true)
    expect(isConflict(a, { start: d('2026-10-05'), end: d('2026-10-08') })).toBe(false)
    expect(isConflict(a, null)).toBe(false)
  })

  it('posição e largura da barra na escala (dias inteiros)', () => {
    const range = { start: d('2026-10-01'), end: d('2026-10-31') }
    expect(barBox({ start: d('2026-10-03'), end: d('2026-10-05') }, range.start, 20)).toEqual({ left: 40, width: 60 })
  })

  it('arrastar move as duas datas; puxar uma ponta muda só ela, sem inverter', () => {
    const span = { start: d('2026-10-03'), end: d('2026-10-05') }
    expect(shiftSpan(span, 2, 'move')).toEqual({ start: d('2026-10-05'), end: d('2026-10-07') })
    expect(shiftSpan(span, -1, 'start')).toEqual({ start: d('2026-10-02'), end: d('2026-10-05') })
    expect(shiftSpan(span, 3, 'end')).toEqual({ start: d('2026-10-03'), end: d('2026-10-08') })
    // a ponta do início não passa do prazo (e vice-versa)
    expect(shiftSpan(span, 9, 'start')).toEqual({ start: d('2026-10-05'), end: d('2026-10-05') })
    expect(shiftSpan(span, -9, 'end')).toEqual({ start: d('2026-10-03'), end: d('2026-10-03') })
  })

  it('soltar tarefa sem datas: começa no dia e dura pela estimativa (8 h por dia; mínimo 1 dia)', () => {
    expect(dropSpan(d('2026-10-10'), null)).toEqual({ start: d('2026-10-10'), end: d('2026-10-10') })
    expect(dropSpan(d('2026-10-10'), 20)).toEqual({ start: d('2026-10-10'), end: d('2026-10-12') })
  })

  it('período exibido: das datas (e hoje) com folga antes e depois, com mínimo de 6 semanas', () => {
    const today = d('2026-10-10')
    const range = timelineRange([d('2026-10-01'), d('2026-12-20')], today)
    expect(range.start).toBe(d('2026-10-01') - 7)
    expect(range.end).toBe(d('2026-12-20') + 21)
    const empty = timelineRange([], today)
    expect(empty.end - empty.start + 1).toBeGreaterThanOrEqual(42)
    expect(empty.start).toBeLessThan(today)
  })
})

describe('domain/timeline — grupos e régua', () => {
  it('agrupa por sprint (na ordem das sprints; sem sprint por último) e ordena por início', () => {
    const s1 = { id: 's1', name: 'Sprint 1', state: 'active' as const }
    const s2 = { id: 's2', name: 'Sprint 2', state: 'planned' as const }
    const tasks = [
      task('T1', { sprint: s2, startDate: utc('2026-10-05') }),
      task('T2', { sprint: null }),
      task('T3', { sprint: s1, startDate: utc('2026-10-09') }),
      task('T4', { sprint: s1, startDate: utc('2026-10-02') }),
    ]
    const groups = groupTimelineTasks(tasks, 'sprint', [s1, s2])
    expect(groups.map((g) => [g.key, g.tasks.map((t) => t.id)])).toEqual([
      ['s1', ['T4', 'T3']],
      ['s2', ['T1']],
      ['none', ['T2']],
    ])
    expect(groupTimelineTasks(tasks, 'none', []).map((g) => g.tasks.length)).toEqual([4])
  })

  it('agrupa por responsável (pelo nome; sem responsável por último)', () => {
    const ana = { id: 'u2', name: 'Ana', email: '', avatarUrl: null }
    const bia = { id: 'u1', name: 'Bia', email: '', avatarUrl: null }
    const groups = groupTimelineTasks([task('T1', { assignee: bia }), task('T2', { assignee: null }), task('T3', { assignee: ana })], 'assignee', [])
    expect(groups.map((g) => g.key)).toEqual(['u2', 'u1', 'none'])
  })

  it('régua: meses em cima e dias embaixo no zoom dia; semanas começam na segunda', () => {
    const range = { start: d('2026-09-28'), end: d('2026-10-04') }
    const day = headerTiers(range, 'day')
    expect(day.top.map((s) => [isoFromDay(s.start), isoFromDay(s.end)])).toEqual([
      ['2026-09-28', '2026-09-30'],
      ['2026-10-01', '2026-10-04'],
    ])
    expect(day.bottom).toHaveLength(7)
    const week = headerTiers({ start: d('2026-09-30'), end: d('2026-10-12') }, 'week')
    // 30/09 é quarta: a 1ª semana é cortada no início do período; a próxima começa na segunda 05/10
    expect(week.bottom.map((s) => isoFromDay(s.start))).toEqual(['2026-09-30', '2026-10-05', '2026-10-12'])
  })
})

describe('domain/timeline — rótulos dos marcos sem sobreposição', () => {
  const lanesOf = (result: ReturnType<typeof layoutLabels>) => Object.fromEntries(result.slots.map((s) => [s.id, s.lane]))

  it('marcos distantes ficam todos na faixa 0, com a largura inteira', () => {
    const result = layoutLabels([
      { id: 'a', left: 0, width: 100 },
      { id: 'b', left: 120, width: 80 },
    ])
    expect(result.lanes).toBe(1)
    expect(result.slots).toEqual([
      { id: 'a', lane: 0, width: 100, truncated: false },
      { id: 'b', lane: 0, width: 80, truncated: false },
    ])
  })

  it('rótulo que encostaria no anterior vai para a próxima faixa; a faixa 0 é reaproveitada assim que fica livre', () => {
    const result = layoutLabels([
      { id: 'a', left: 0, width: 100 },
      { id: 'b', left: 30, width: 100 },
      { id: 'c', left: 60, width: 100 },
      { id: 'd', left: 110, width: 50 },
    ])
    expect(result.lanes).toBe(3)
    expect(lanesOf(result)).toEqual({ a: 0, b: 1, c: 2, d: 0 })
    expect(result.slots.every((s) => !s.truncated)).toBe(true)
  })

  it('respeita o espaço mínimo entre rótulos da mesma faixa', () => {
    expect(lanesOf(layoutLabels([{ id: 'a', left: 0, width: 100 }, { id: 'b', left: 103, width: 40 }], { gap: 6 }))).toEqual({ a: 0, b: 1 })
    expect(lanesOf(layoutLabels([{ id: 'a', left: 0, width: 100 }, { id: 'b', left: 106, width: 40 }], { gap: 6 }))).toEqual({ a: 0, b: 0 })
  })

  it('distribui pela posição na régua, não pela ordem recebida', () => {
    const result = layoutLabels([
      { id: 'late', left: 300, width: 50 },
      { id: 'b', left: 20, width: 100 },
      { id: 'a', left: 0, width: 100 },
    ])
    expect(result.slots.map((s) => s.id)).toEqual(['a', 'b', 'late'])
    expect(lanesOf(result)).toEqual({ a: 0, b: 1, late: 0 })
  })

  it('no máximo de faixas, encurta o rótulo da faixa que começou antes (reticências) e o novo fica inteiro', () => {
    const result = layoutLabels(
      [
        { id: 'a', left: 0, width: 150 },
        { id: 'b', left: 40, width: 150 },
        { id: 'c', left: 80, width: 150 },
      ],
      { maxLanes: 2, gap: 6 },
    )
    expect(result.lanes).toBe(2)
    expect(result.slots).toEqual([
      { id: 'a', lane: 0, width: 74, truncated: true },
      { id: 'b', lane: 1, width: 150, truncated: false },
      { id: 'c', lane: 0, width: 150, truncated: false },
    ])
  })

  it('o rótulo encurtado nunca fica menor que o mínimo (o losango continua visível)', () => {
    const result = layoutLabels(
      [
        { id: 'a', left: 0, width: 120 },
        { id: 'b', left: 0, width: 120 },
      ],
      { maxLanes: 1, gap: 6, minWidth: 20 },
    )
    expect(result.slots[0]).toEqual({ id: 'a', lane: 0, width: 20, truncated: true })
    expect(result.slots[1]).toEqual({ id: 'b', lane: 0, width: 120, truncated: false })
  })

  it('rótulo que ficaria curto demais para ler mostra só o losango', () => {
    const boxes = [
      { id: 'a', left: 0, width: 120 },
      { id: 'b', left: 40, width: 120 },
    ]
    expect(layoutLabels(boxes, { maxLanes: 1, gap: 6, minWidth: 20, minReadable: 50 }).slots[0]).toEqual({ id: 'a', lane: 0, width: 20, truncated: true })
    expect(layoutLabels(boxes, { maxLanes: 1, gap: 6, minWidth: 20, minReadable: 30 }).slots[0]).toEqual({ id: 'a', lane: 0, width: 34, truncated: true })
  })

  it('sem marcos, nenhuma faixa', () => {
    expect(layoutLabels([])).toEqual({ lanes: 0, slots: [] })
  })

  it('estimativa da largura do texto cresce com o texto e com letras largas', () => {
    expect(estimateTextWidth('', 11)).toBe(0)
    expect(estimateTextWidth('Aceptación de usuario', 11)).toBeGreaterThan(estimateTextWidth('MVP', 11))
    expect(estimateTextWidth('WWWW', 11)).toBeGreaterThan(estimateTextWidth('iiii', 11))
    expect(estimateTextWidth('Go-live', 22)).toBeCloseTo(estimateTextWidth('Go-live', 11) * 2)
  })
})
