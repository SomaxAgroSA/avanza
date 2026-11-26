import { describe, expect, it } from 'vitest'
import type { DemandStatus } from './demands'
import type { TaskSummary } from './tasks'
import { taskGantt, toGanttGroupBy, toLabelWidth } from './task-gantt'

const person = (id: string, name: string) => ({ id, name, email: `${id}@x`, avatarUrl: null })
const jorge = person('u3', 'Jorge Benitez')
const victor = person('u5', 'Victor Martinetti')
const dre = { id: 'p1', key: 'DRE', name: 'DRE SOMAX PARAGUAY' }

function task(id: string, step: DemandStatus, extra: Partial<TaskSummary> & { dueAt?: Date | null } = {}): TaskSummary {
  const { dueAt = null, ...rest } = extra
  return {
    id,
    code: id.toUpperCase(),
    number: 1,
    title: `Tarefa ${id}`,
    project: null,
    type: null,
    status: null,
    priority: null,
    sprint: null,
    creator: null,
    assignee: null,
    reporter: null,
    parentTaskId: null,
    startDate: null,
    dueDate: null,
    estimatedHours: null,
    actualHours: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(2026, 10, 18, 9, 0),
    updatedAt: null,
    tags: [],
    checklistProgress: { done: 0, total: 0 },
    commentCount: 0,
    attachmentCount: 0,
    subtaskProgress: { done: 0, total: 0 },
    blocked: false,
    inReport: true,
    itVisible: false,
    urgency: null,
    area: null,
    demand: { status: step, owner: null, dueAt, openedAt: null },
    ...rest,
  }
}

const now = new Date(2026, 10, 25, 10, 0)

describe('Linha do tempo das tarefas (ajuste 25/11)', () => {
  it('sem prazo não entra (conta para a nota); concluídas não entram nem contam', () => {
    const { model, undated } = taskGantt([task('a', 'unassigned'), task('b', 'done', { dueAt: new Date(2026, 10, 30, 17) }), task('c', 'assigned', { assignee: jorge })], 'person', now)
    expect(model).toBeNull()
    expect(undated).toBe(2)
  })

  it('por pessoa: grupos pelo nome (sem atribuir por último), barras do início planejado (ou da abertura) até o prazo', () => {
    const { model, undated } = taskGantt(
      [
        task('v1', 'assigned', { assignee: victor, dueAt: new Date(2026, 10, 24, 17), estimatedHours: 1 }),
        task('j1', 'in_progress', { assignee: jorge, startDate: new Date(Date.UTC(2026, 10, 21)), dueDate: new Date(Date.UTC(2026, 10, 26)), estimatedHours: 4 }),
        task('j2', 'to_validate', { assignee: jorge, dueAt: new Date(2026, 10, 24, 12), estimatedHours: 2 }),
        task('u1', 'unassigned', { dueDate: new Date(Date.UTC(2026, 11, 5)) }),
        task('n1', 'assigned', { assignee: victor }),
      ],
      'person',
      now,
    )
    expect(undated).toBe(1)
    expect(model!.groups.map((g) => g.person?.name ?? '—')).toEqual(['Jorge Benitez', 'Victor Martinetti', '—'])
    const [jorgeGroup, victorGroup] = model!.groups
    // ordem pelo prazo
    expect(jorgeGroup!.rows.map((r) => r.task.id)).toEqual(['j2', 'j1'])
    expect(jorgeGroup!.hours).toBe(6)
    const j1 = jorgeGroup!.rows[1]!
    expect(j1.start.toISOString().slice(0, 10)).toBe('2026-11-21')
    expect(j1.dueDay.toISOString().slice(0, 10)).toBe('2026-11-26')
    expect(j1.late).toBe(false)
    expect(j1.step).toBe('in_progress')
    // sem início planejado: começa na abertura
    const v1 = victorGroup!.rows[0]!
    expect(v1.start.toISOString().slice(0, 10)).toBe('2026-11-18')
    expect(v1.late).toBe(true)
    expect(v1.dueAt).toEqual(new Date(2026, 10, 24, 17))
    // posições dentro da janela: semanas inteiras, de segunda (16/11) a domingo (06/12)
    expect(model!.monthly).toBe(false)
    const { scale } = model!
    expect(scale.unit).toBe('weeks')
    expect(scale.from.toISOString().slice(0, 10)).toBe('2026-11-16')
    expect(scale.to.toISOString().slice(0, 10)).toBe('2026-12-07')
    expect(scale.periods.map((p) => `${p.start.toISOString().slice(5, 10)}..${p.last.toISOString().slice(5, 10)}${p.current ? '*' : ''}`)).toEqual([
      '11-16..11-22',
      '11-23..11-29*',
      '11-30..12-06',
    ])
    // embaixo, cada dia menos hoje (25/11: no lugar vai HOJE); sábados e domingos sombreados
    expect(scale.marks).toHaveLength(20)
    expect(scale.marks.some((m) => m.date.toISOString().startsWith('2026-11-25'))).toBe(false)
    expect(scale.weekends).toHaveLength(6)
    for (const row of model!.groups.flatMap((g) => g.rows)) {
      expect(row.left).toBeGreaterThanOrEqual(0)
      expect(row.left + row.width).toBeLessThanOrEqual(100.0001)
    }
    expect(j1.left).toBeLessThan(scale.today!)
    expect(j1.left + j1.width).toBeGreaterThan(scale.today!)
  })

  it('por projeto: o projeto da tarefa; a demanda interna (sem projeto) por último', () => {
    const { model } = taskGantt(
      [task('d1', 'assigned', { dueAt: new Date(2026, 10, 28, 9) }), task('p1', 'assigned', { project: dre, dueAt: new Date(2026, 10, 27, 9) })],
      'project',
      now,
    )
    expect(model!.groups.map((g) => g.project?.name ?? '')).toEqual(['DRE SOMAX PARAGUAY', ''])
    expect(model!.groups[1]!.key).toBe('')
  })

  it('janela longa marca os meses', () => {
    const { model } = taskGantt([task('a', 'assigned', { startDate: new Date(Date.UTC(2026, 6, 1)), dueDate: new Date(Date.UTC(2027, 1, 10)) })], 'person', now)
    expect(model!.monthly).toBe(true)
    // por meses (§52): os meses em cima (o atual em destaque), as segundas-feiras embaixo, sem fins de semana
    const { scale } = model!
    expect(scale.unit).toBe('months')
    expect(scale.periods.map((p) => p.start.getUTCDate())).toEqual(scale.periods.map(() => 1))
    expect(scale.periods).toHaveLength(8)
    expect(scale.periods.filter((p) => p.current).map((p) => p.start.toISOString().slice(0, 7))).toEqual(['2026-11'])
    expect(scale.marks.every((m) => m.date.getUTCDay() === 1)).toBe(true)
    expect(scale.weekends).toEqual([])
  })

  it('agrupamento guardado desconhecido vira por pessoa', () => {
    expect(toGanttGroupBy('project')).toBe('project')
    expect(toGanttGroupBy('team')).toBe('person')
  })
})

describe('coluna dos títulos: largura guardada (a regra da coluna está em gantt-scale, §52)', () => {
  it('guardada no navegador: só número positivo; o resto é a automática (null)', () => {
    expect(toLabelWidth(321.6)).toBe(322)
    expect(toLabelWidth(null)).toBeNull()
    expect(toLabelWidth('300')).toBeNull()
    expect(toLabelWidth(-5)).toBeNull()
    expect(toLabelWidth(Number.NaN)).toBeNull()
  })
})
