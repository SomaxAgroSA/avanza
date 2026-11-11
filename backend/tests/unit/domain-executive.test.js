const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const executive = require('../../src/domain/executive')

const day = (value) => new Date(`${value}T12:00:00Z`)

function input(overrides) {
  return Object.assign(
    {
      projects: [
        { id: 'a', key: 'AAA', name: 'A', ownerId: null, archivedAt: null },
        { id: 'b', key: 'BBB', name: 'B', ownerId: null, archivedAt: null },
        { id: 'z', key: 'ZZZ', name: 'Z', ownerId: null, archivedAt: day('2026-06-01') },
      ],
      owners: {},
      plans: {},
      planItems: [],
      planCategoryOf: () => null,
      issues: [],
      milestones: [],
      taskRows: [],
      statuses: { open: { category: 'todo', name: 'A fazer' }, done: { category: 'done', name: 'Feito' } },
      taskContext: { bugTypeIds: [], criticalPriorityId: null, now: day('2026-10-29') },
      period: { from: null, to: day('2026-10-29') },
      today: '2026-10-29',
      tzOffset: 0,
    },
    overrides,
  )
}

const plan = (level) => ({
  summary: { total: 2, done: 1, open: 1, overdue: 0, stuck: 0, canceled: 0, progress: 50 },
  schedule: { on_time: 1, overdue: 0, unscheduled: 0, done: 1 },
  effort: { estimated: 10, actual: null, remaining: 10 },
  health: { level, factors: [] },
})

describe('domain/executive', () => {
  it('portfólio só com ativos, críticos primeiro; sem quadro o progresso vem das tarefas', () => {
    const out = executive.buildDashboard(
      input({
        plans: { b: plan('critical') },
        taskRows: [
          { id: 't1', projectId: 'a', statusId: 'done', completedAt: day('2026-10-01'), createdAt: day('2026-09-01') },
          { id: 't2', projectId: 'a', statusId: 'open', createdAt: day('2026-09-02') },
          { id: 't3', projectId: 'z', statusId: 'done', completedAt: day('2026-05-01'), createdAt: day('2026-04-01') },
        ],
      }),
    )
    assert.deepEqual(out.portfolio.map((r) => r.project.key), ['BBB', 'AAA'])
    assert.deepEqual(out.portfolio[1].progress, { value: 50, source: 'tasks' })
    assert.deepEqual(out.portfolio[0].progress, { value: 50, source: 'plan' })
    assert.equal(out.summary.active_projects, 2)
    assert.equal(out.summary.deliveries.tasks, 2)
    assert.deepEqual(out.kanban.funnel, { backlog: 0, todo: 1, in_progress: 0, done: 1, cancelled: 0 })
    assert.deepEqual(out.achievements.map((a) => [a.project.key, a.project.archived]), [['AAA', false], ['ZZZ', true]])
  })

  it('período: só entregas dentro dele; marcos feitos pela data', () => {
    const out = executive.buildDashboard(
      input({
        period: { from: day('2026-10-01'), to: day('2026-10-29') },
        taskRows: [
          { id: 't1', projectId: 'a', statusId: 'done', completedAt: day('2026-10-05'), createdAt: day('2026-09-01') },
          { id: 't2', projectId: 'a', statusId: 'done', completedAt: day('2026-08-05'), createdAt: day('2026-08-01') },
        ],
        milestones: [
          { id: 'm1', projectId: 'a', name: 'Feito em out', dueDate: '2026-10-10', state: 'done' },
          { id: 'm2', projectId: 'a', name: 'Feito antes', dueDate: '2026-09-10', state: 'done' },
          { id: 'm3', projectId: 'b', name: 'Próximo', dueDate: '2026-11-10', state: 'pending' },
        ],
      }),
    )
    assert.deepEqual(out.summary.deliveries, { tasks: 1, plan_items: 0, milestones: 1 })
    assert.deepEqual(out.plan.upcoming_milestones.map((m) => m.name), ['Próximo'])
    assert.equal(out.portfolio.find((r) => r.project.key === 'BBB').next_milestone.name, 'Próximo')
  })

  it('série: semanal até 120 dias, mensal acima; começa no registro mais antigo sem `from`', () => {
    const rows = [{ id: 't1', projectId: 'a', statusId: 'done', completedAt: day('2026-10-28'), createdAt: day('2026-10-20') }]
    const weekly = executive.timeline({ taskRows: rows, isTaskDone: () => true, planDone: [], period: { from: null, to: day('2026-10-29') }, tzOffset: 0 })
    assert.equal(weekly.bucket, 'week')
    assert.deepEqual(weekly.points.map((p) => p.start), ['2026-10-19', '2026-10-26'])
    assert.deepEqual(weekly.points.map((p) => [p.tasks_created, p.tasks_completed]), [[1, 0], [0, 1]])

    const monthly = executive.timeline({ taskRows: rows, isTaskDone: () => true, planDone: [{ completedAt: day('2026-02-03') }], period: { from: null, to: day('2026-10-29') }, tzOffset: 0 })
    assert.equal(monthly.bucket, 'month')
    assert.equal(monthly.points[0].start, '2026-02-01')
    assert.equal(monthly.points.length, 9)
    assert.equal(monthly.points[0].plan_items_completed, 1)
  })

  it('portfólio traz área, urgência, tarefas em andamento e bloqueadas', () => {
    const out = executive.buildDashboard(
      input({
        projects: [{ id: 'a', key: 'AAA', name: 'A', ownerId: null, archivedAt: null, areaId: 'ar1', urgency: 'high', status: 'active', priority: 'high' }],
        areas: { ar1: { id: 'ar1', name: 'Comercial', color: null } },
        statuses: { open: { category: 'todo' }, doing: { category: 'in_progress' }, done: { category: 'done' } },
        taskRows: [
          { id: 't1', projectId: 'a', statusId: 'doing', createdAt: day('2026-10-01'), blocked: true },
          { id: 't2', projectId: 'a', statusId: 'doing', createdAt: day('2026-10-01') },
          { id: 't3', projectId: 'a', statusId: 'open', createdAt: day('2026-10-01') },
        ],
      }),
    )
    const row = out.portfolio[0]
    assert.deepEqual(row.project.area, { id: 'ar1', name: 'Comercial', color: null })
    assert.equal(row.project.urgency, 'high')
    assert.equal(row.tasks.in_progress, 2)
    assert.equal(row.tasks.blocked, 1)
    assert.equal(row.tasks.open, 3)
  })

  it('série: em andamento e vencidas no fim de cada semana, pelas datas; canceladas e arquivados fora', () => {
    const out = executive.buildDashboard(
      input({
        statuses: { open: { category: 'todo' }, doing: { category: 'in_progress' }, done: { category: 'done' }, gone: { category: 'cancelled' } },
        period: { from: day('2026-10-05'), to: day('2026-10-18') },
        today: '2026-10-18',
        taskRows: [
          // começou na 1ª semana e concluiu na 2ª: em andamento só no fim da 1ª
          { id: 't1', projectId: 'a', statusId: 'done', createdAt: day('2026-10-01'), startedAt: day('2026-10-06'), completedAt: day('2026-10-14') },
          // prazo 08/10, ainda aberta: vencida nas duas semanas, em andamento desde 13/10
          { id: 't2', projectId: 'a', statusId: 'doing', createdAt: day('2026-10-01'), startedAt: day('2026-10-13'), dueDate: day('2026-10-08') },
          // criada na 2ª semana: não conta na 1ª
          { id: 't3', projectId: 'b', statusId: 'open', createdAt: day('2026-10-15'), dueDate: day('2026-10-16') },
          // cancelada e projeto arquivado: fora do estoque
          { id: 't4', projectId: 'a', statusId: 'gone', createdAt: day('2026-10-01'), startedAt: day('2026-10-06') },
          { id: 't5', projectId: 'z', statusId: 'doing', createdAt: day('2026-10-01'), startedAt: day('2026-10-06') },
        ],
      }),
    )
    const points = out.timeline.points
    assert.deepEqual(points.map((p) => p.start), ['2026-10-05', '2026-10-12'])
    assert.deepEqual(points.map((p) => p.tasks_in_progress), [1, 1])
    assert.deepEqual(points.map((p) => p.tasks_overdue), [1, 2])
  })

  it('nada no escopo: tudo zerado, sem erro', () => {
    const out = executive.buildDashboard(input({ projects: [] }))
    assert.equal(out.summary.active_projects, 0)
    assert.equal(out.summary.progress, null)
    assert.deepEqual(out.portfolio, [])
    assert.deepEqual(out.timeline, { bucket: 'week', points: [] })
  })
})
