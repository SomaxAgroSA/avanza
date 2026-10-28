const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const report = require('../../src/domain/report')

const at = (iso) => new Date(iso)

// status por categoria
const statuses = {
  bk: { category: 'backlog' },
  todo: { category: 'todo' },
  dev: { category: 'in_progress' },
  done: { category: 'done' },
  cancel: { category: 'cancelled' },
}

function row(id, extra) {
  return Object.assign(
    { id, projectId: 'p1', typeId: 'story', statusId: 'todo', priorityId: 'low', assigneeId: null, createdAt: at('2026-09-01T12:00:00Z'), startedAt: null, completedAt: null, dueDate: null, blocked: false },
    extra,
  )
}

const ctx = {
  statuses,
  bugTypeIds: ['bug'],
  criticalPriorityId: 'crit',
  from: at('2026-09-10T03:00:00Z'),
  to: at('2026-09-20T02:59:59Z'),
  now: at('2026-09-20T15:00:00Z'),
  // Brasília: UTC-3 (getTimezoneOffset = 180)
  tzOffset: 180,
}

const rows = [
  row('1', { statusId: 'bk' }),
  row('2', { statusId: 'dev', blocked: true, dueDate: at('2026-09-19T00:00:00Z') }),
  // vence hoje (dia local 20/09): não está atrasada
  row('3', { statusId: 'todo', dueDate: at('2026-09-20T00:00:00Z') }),
  row('4', { typeId: 'bug', priorityId: 'crit', statusId: 'dev', createdAt: at('2026-09-12T12:00:00Z') }),
  // concluída no período: lead 48h, cycle 24h
  row('5', { typeId: 'bug', statusId: 'done', createdAt: at('2026-09-11T12:00:00Z'), startedAt: at('2026-09-12T12:00:00Z'), completedAt: at('2026-09-13T12:00:00Z') }),
  // concluída no período: lead 96h, sem início registrado
  row('6', { statusId: 'done', createdAt: at('2026-09-10T12:00:00Z'), completedAt: at('2026-09-14T12:00:00Z') }),
  // concluída fora do período e vencida (não conta como atrasada: está encerrada)
  row('7', { statusId: 'done', completedAt: at('2026-09-05T12:00:00Z'), dueDate: at('2026-09-01T00:00:00Z') }),
  row('8', { statusId: 'cancel', completedAt: at('2026-09-15T12:00:00Z') }),
]

describe('domain/report — indicadores', () => {
  it('situação atual (agora) e o que aconteceu no período', () => {
    const r = report.indicators(rows, ctx)
    assert.deepEqual(
      { total: r.total, open: r.open, backlog: r.backlog, todo: r.todo, in_progress: r.in_progress, blocked: r.blocked, overdue: r.overdue, critical_bugs: r.critical_bugs },
      { total: 8, open: 4, backlog: 1, todo: 1, in_progress: 2, blocked: 1, overdue: 1, critical_bugs: 1 },
    )
    assert.deepEqual({ created: r.created, completed: r.completed, cancelled: r.cancelled }, { created: 3, completed: 2, cancelled: 1 })
  })

  it('tempos médios (em horas) só das concluídas no período, com a amostra', () => {
    const r = report.indicators(rows, ctx)
    assert.deepEqual(r.lead_time, { hours: 72, count: 2 })
    assert.deepEqual(r.cycle_time, { hours: 24, count: 1 })
    assert.deepEqual(r.bug_resolution, { hours: 48, count: 1 })
    // criada já concluída: conclusão instantes antes da criação não vira tempo negativo
    const instant = report.indicators([row('i', { statusId: 'done', createdAt: at('2026-09-15T12:00:00.500Z'), completedAt: at('2026-09-15T12:00:00.000Z') })], ctx)
    assert.deepEqual(instant.lead_time, { hours: 0, count: 1 })
    const empty = report.indicators([row('x')], ctx)
    assert.deepEqual(empty.lead_time, { hours: null, count: 0 })
  })
})

describe('domain/report — recortes e série', () => {
  it('agrupa por dimensão com abertas, atrasadas, bloqueadas, criadas, concluídas e lead time', () => {
    const groups = report.breakdown(rows, 'type', ctx)
    assert.deepEqual(
      groups.map((g) => [g.key, g.total, g.open, g.completed, g.lead_time.hours]),
      [
        ['story', 6, 3, 1, 96],
        ['bug', 2, 1, 1, 48],
      ],
    )
    const byAssignee = report.breakdown([row('a', { assigneeId: 'u1' }), row('b')], 'assignee', ctx)
    assert.deepEqual(byAssignee.map((g) => g.key).sort(), ['', 'u1'])
    assert.throws(() => report.breakdown(rows, 'cor', ctx))
  })

  it('série diária no fuso da pessoa (criadas × concluídas); semanal em períodos longos', () => {
    const series = report.series(rows, ctx)
    assert.equal(series.bucket, 'day')
    assert.equal(series.points.length, 10)
    assert.deepEqual(series.points[0], { date: '2026-09-10', created: 1, completed: 0 })
    assert.deepEqual(series.points.find((p) => p.date === '2026-09-13'), { date: '2026-09-13', created: 0, completed: 1 })

    const long = report.series(rows, Object.assign({}, ctx, { from: at('2026-06-01T03:00:00Z') }))
    assert.equal(long.bucket, 'week')
    // semanas começam na segunda-feira
    assert.equal(long.points[0].date, '2026-06-01')
  })

  it('dia local e período', () => {
    assert.equal(report.localDay(at('2026-09-20T02:00:00Z'), 180), '2026-09-19')
    assert.equal(report.localDay(at('2026-09-20T03:00:00Z'), 180), '2026-09-20')
    assert.equal(report.periodIssue(at('2026-09-10T00:00:00Z'), at('2026-09-01T00:00:00Z')), 'to_before_from')
    assert.equal(report.periodIssue(at('2025-01-01T00:00:00Z'), at('2026-09-01T00:00:00Z')), 'too_long')
    assert.equal(report.periodIssue(at('2026-09-01T00:00:00Z'), at('2026-09-30T00:00:00Z')), null)
  })
})

describe('domain/report — tarefas de cada indicador (detalhamento)', () => {
  const ids = (metric) => report.selectForMetric(rows, metric, ctx).map((item) => item.row.id)

  it('o detalhamento de cada indicador tem exatamente as tarefas contadas no número', () => {
    const r = report.indicators(rows, ctx)
    const expected = {
      open: r.open,
      backlog: r.backlog,
      todo: r.todo,
      in_progress: r.in_progress,
      blocked: r.blocked,
      overdue: r.overdue,
      critical_bugs: r.critical_bugs,
      created: r.created,
      completed: r.completed,
      cancelled: r.cancelled,
      lead_time: r.lead_time.count,
      cycle_time: r.cycle_time.count,
      bug_resolution: r.bug_resolution.count,
    }
    assert.deepEqual(Object.keys(expected).sort(), [...report.METRICS].sort())
    report.METRICS.forEach((metric) => assert.equal(ids(metric).length, expected[metric], metric))
  })

  it('ordem de leitura: agora = há mais tempo abertas; atrasadas = prazo mais antigo; período = mais recentes', () => {
    assert.deepEqual(ids('open'), ['1', '2', '3', '4'])
    assert.deepEqual(ids('overdue'), ['2'])
    assert.deepEqual(ids('created'), ['4', '5', '6'])
    assert.deepEqual(ids('completed'), ['6', '5'])
  })

  it('indicadores de tempo trazem a duração de cada tarefa (horas)', () => {
    assert.deepEqual(
      report.selectForMetric(rows, 'lead_time', ctx).map((item) => [item.row.id, item.hours]),
      [
        ['6', 96],
        ['5', 48],
      ],
    )
    assert.deepEqual(
      report.selectForMetric(rows, 'cycle_time', ctx).map((item) => [item.row.id, item.hours]),
      [['5', 24]],
    )
    assert.deepEqual(ids('bug_resolution'), ['5'])
    assert.equal(report.selectForMetric(rows, 'open', ctx)[0].hours, null)
  })

  it('indicador desconhecido é erro de programação', () => {
    assert.throws(() => report.selectForMetric(rows, 'nope', ctx), /indicador inválido/)
  })
})
