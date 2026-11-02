import { describe, expect, it } from 'vitest'
import { buildProjectReport, calendarDays, defaultReportOptions, workdays, type ReportOptions } from './project-report'
import type { JournalEntry } from './plan-management'
import type { Plan, PlanItem } from './plan'
import type { StatusCategory } from './workflow'
import type { TaskSummary } from './tasks'
import type { Milestone } from './timeline'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function task(n: number, category: StatusCategory, start: string | null, extra: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: `t${n}`,
    number: n,
    code: `GCS-${n}`,
    title: `tarefa ${n}`,
    status: { id: category, key: category, name: category, color: 'gray', category },
    assignee: null,
    startDate: start ? day(start) : null,
    dueDate: start ? day(start) : null,
    inReport: true,
    urgency: null,
    ...extra,
  } as TaskSummary
}

function milestone(id: string, dueDate: string, state: Milestone['state']): Milestone {
  return { id, projectId: 'p', name: `marco ${id}`, description: '', dueDate, state, createdAt: null, updatedAt: null }
}

function journal(id: string, entryDate: string): JournalEntry {
  return { id, entryDate, content: id, author: null, createdAt: null, updatedAt: null, capabilities: { edit: false, delete: false } }
}

function item(id: string, groupId: string, statusId: string | null, start: string | null, end: string | null, extra: Partial<PlanItem> = {}): PlanItem {
  return { id, groupId, parentId: null, name: `fase ${id}`, statusId, startDate: start, endDate: end, dueDate: null, position: 0, progress: { value: 40, source: 'subitems' }, ...extra } as PlanItem
}

const plan = {
  statuses: [
    { id: 'ok', name: 'Hecho', color: 'green', category: 'done', position: 1 },
    { id: 'wip', name: 'En curso', color: 'amber', category: 'in_progress', position: 0 },
  ],
  groups: [
    { id: 'g', parentId: null, name: 'Cronograma', color: 'green', position: 0, number: '1', summary: null },
    { id: 'g2', parentId: 'g', name: 'Sub', color: 'green', position: 1, number: '1.1', summary: null },
    { id: 'x', parentId: null, name: 'Otro', color: 'blue', position: 2, number: '2', summary: null },
  ],
  items: [
    item('f1', 'g', 'ok', '2026-09-22', '2026-09-24', { position: 0 }),
    item('f2', 'g', 'wip', '2026-10-20', null, { position: 1 }),
    item('f3', 'g2', null, null, null),
    item('sub', 'g', 'ok', '2026-09-22', '2026-09-22', { parentId: 'f1' }),
    item('fora', 'x', 'ok', '2026-09-22', '2026-09-22'),
  ],
} as unknown as Plan

const options = (patch: Partial<ReportOptions> = {}): ReportOptions => ({ ...defaultReportOptions('2026-10-29'), ...patch })

describe('project-report', () => {
  it('conta dias corridos e úteis com as duas pontas', () => {
    expect(calendarDays('2026-09-22', '2026-10-29')).toBe(38)
    expect(workdays('2026-09-22', '2026-10-29')).toBe(28)
    expect(workdays('2026-10-24', '2026-10-25')).toBe(0)
  })

  it('só entram as tarefas marcadas para o informe; indicadores ignoram canceladas no total', () => {
    const report = buildProjectReport({
      projectStart: '2026-09-22',
      tasks: [task(1, 'done', '2026-10-01'), task(2, 'in_progress', '2026-10-20'), task(3, 'done', '2026-10-02', { inReport: false }), task(4, 'cancelled', '2026-10-03')],
      milestones: [milestone('a', '2026-10-05', 'done'), milestone('b', '2026-10-27', 'pending')],
      journal: [],
      plan: null,
      options: options(),
    })
    expect(report.kpis).toMatchObject({ days: 38, workdays: 28, tasksDone: 1, tasksTotal: 2, milestonesDone: 1, milestonesTotal: 2 })
    expect(report.tasks.map((g) => [g.state, g.tasks.map((t) => t.code)])).toEqual([
      ['in_progress', ['GCS-2']],
      ['done', ['GCS-1']],
      ['cancelled', ['GCS-4']],
    ])
    expect(report.next.milestones.map((m) => m.id)).toEqual(['b'])
    expect(report.next.tasks.map((t) => t.code)).toEqual(['GCS-2'])
    expect(report.chronology.days.flatMap((d) => d.items).some((i) => i.id === 't3')).toBe(false)
  })

  it('o período recorta tarefas, marcos e Diário; tarefa sem data só entra sem período', () => {
    const input = {
      projectStart: null,
      tasks: [task(1, 'done', '2026-10-01'), task(2, 'done', '2026-10-20'), task(3, 'todo', null)],
      milestones: [milestone('a', '2026-10-05', 'done'), milestone('b', '2026-10-27', 'pending')],
      journal: [journal('j1', '2026-09-30'), journal('j2', '2026-10-21')],
      plan: null,
    }
    const cut = buildProjectReport({ ...input, options: options({ from: '2026-10-15', to: '2026-10-25' }) })
    expect(cut.tasks.flatMap((g) => g.tasks).map((t) => t.code)).toEqual(['GCS-2'])
    expect(cut.milestones).toEqual([])
    expect(cut.chronology.days.map((d) => d.date)).toEqual(['2026-10-20', '2026-10-21'])
    expect([cut.start, cut.end]).toEqual(['2026-10-15', '2026-10-25'])

    const all = buildProjectReport({ ...input, options: options() })
    expect(all.tasks.flatMap((g) => g.tasks).map((t) => t.code)).toEqual(['GCS-3', 'GCS-1', 'GCS-2'])
    // sem início do projeto: começa no fato mais antigo
    expect(all.start).toBe('2026-09-30')
  })

  it('fases: elementos de primeiro nível do grupo escolhido (e subgrupos), com situação e avanço', () => {
    const report = buildProjectReport({ projectStart: '2026-09-22', tasks: [], milestones: [], journal: [], plan, options: options({ phaseGroupId: 'g' }) })
    expect(report.phases.map((p) => [p.id, p.statusName, p.done, p.progress, p.days])).toEqual([
      ['f1', 'Hecho', true, 100, 3],
      ['f2', 'En curso', false, 40, 10],
      ['f3', null, false, 40, null],
    ])
    expect(report.kpis).toMatchObject({ phasesDone: 1, phasesTotal: 3 })
    expect(buildProjectReport({ projectStart: null, tasks: [], milestones: [], journal: [], plan, options: options() }).phases).toEqual([])
  })

  it('equipe: responsáveis das tarefas do informe, sem repetir', () => {
    const ana = { id: 'a', name: 'Ana', email: '', avatarUrl: null }
    const report = buildProjectReport({
      projectStart: null,
      tasks: [task(1, 'done', '2026-10-01', { assignee: ana }), task(2, 'done', '2026-10-02', { assignee: ana }), task(3, 'done', '2026-10-03', { assignee: { ...ana, id: 'b', name: 'Bruno' } })],
      milestones: [],
      journal: [],
      plan: null,
      options: options(),
    })
    expect(report.team).toEqual(['Ana', 'Bruno'])
  })
})
