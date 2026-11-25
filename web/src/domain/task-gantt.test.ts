import { describe, expect, it } from 'vitest'
import type { DemandStatus } from './demands'
import type { TaskSummary } from './tasks'
import { taskGantt, toGanttGroupBy } from './task-gantt'

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
    // posições dentro da janela, que começa numa segunda-feira
    expect(model!.monthly).toBe(false)
    expect(model!.ticks[0]!.date.getUTCDay()).toBe(1)
    expect(model!.ticks[0]!.left).toBe(0)
    for (const row of model!.groups.flatMap((g) => g.rows)) {
      expect(row.left).toBeGreaterThanOrEqual(0)
      expect(row.left + row.width).toBeLessThanOrEqual(100.0001)
    }
    expect(j1.left).toBeLessThan(model!.today)
    expect(j1.left + j1.width).toBeGreaterThan(model!.today)
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
    expect(model!.ticks.map((t) => t.date.getUTCDate())).toEqual(model!.ticks.map(() => 1))
    expect(model!.ticks).toHaveLength(8)
  })

  it('agrupamento guardado desconhecido vira por pessoa', () => {
    expect(toGanttGroupBy('project')).toBe('project')
    expect(toGanttGroupBy('team')).toBe('person')
  })
})
