/**
 * Quadro do projeto — GP-4: relatórios e saúde do projeto (sempre com os fatores que a compõem).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { planReport, levelOf, HEALTH_FACTORS } = require('../../src/domain/plan-report')

const CATEGORY = { st_todo: 'todo', st_doing: 'in_progress', st_stuck: 'blocked', st_done: 'done', st_cancel: 'canceled' }
const item = (id, extra) => Object.assign({ id, groupId: 'g1', parentId: null, statusId: 'st_todo', startDate: null, endDate: null, resourceIds: [], metrics: {} }, extra)

function build(items, extra) {
  const options = Object.assign(
    {
      items,
      categoryOf: (i) => CATEGORY[i.statusId] || null,
      progress: {},
      groups: [
        { id: 'g1', name: 'Iniciação', number: '1.0', color: 'blue' },
        { id: 'g2', name: 'Planejamento', number: '2.0', color: 'green' },
      ],
      resources: [
        { id: 'r1', name: 'Gerente de Projetos', color: 'indigo' },
        { id: 'r2', name: 'Cliente', color: 'amber' },
      ],
      issues: [],
      pending: {},
      today: '2024-02-10',
    },
    extra,
  )
  return planReport(options)
}

describe('domain/plan-report — resumo, cronograma, esforço, recursos e grupos', () => {
  const items = [
    item('a', { statusId: 'st_done', startDate: '2024-01-26', endDate: '2024-01-27', resourceIds: ['r1'], metrics: { estimated_hours: 4, actual_hours: 6 } }),
    item('b', { statusId: 'st_doing', startDate: '2024-02-01', endDate: '2024-02-05', resourceIds: ['r1', 'r2'], metrics: { estimated_hours: 10 } }),
    item('b1', { parentId: 'b', metrics: { estimated_hours: 2, actual_hours: 3 } }),
    item('c', { statusId: 'st_stuck', startDate: '2024-02-08', endDate: '2024-02-20', metrics: { estimated_hours: 6 } }),
    item('d', { groupId: 'g2' }),
    item('e', { groupId: 'g2', statusId: 'st_cancel', metrics: { estimated_hours: 50 } }),
  ]
  const progress = { a: { value: 100 }, b: { value: 40 }, c: { value: 0 }, d: { value: 0 }, e: { value: 0 } }

  it('resumo: total, feitos, pendentes, atrasados, parados e progresso (cancelados fora da conta)', () => {
    const r = build(items, { progress })
    assert.deepEqual(r.summary, { total: 5, done: 1, open: 3, overdue: 1, stuck: 1, canceled: 1, progress: 40 })
  })

  it('cronograma dos abertos: no prazo, atrasados (fim antes de hoje) e sem datas', () => {
    assert.deepEqual(build(items, { progress }).schedule, { on_time: 1, overdue: 1, unscheduled: 1, done: 1 })
  })

  it('esforço: estimado, realizado (o do elemento ou a soma dos subelementos), restante e desvio dos feitos', () => {
    assert.deepEqual(build(items, { progress }).effort, { estimated: 20, actual: 9, remaining: 11, deviation: { hours: 2, percent: 50 } })
    assert.equal(build([item('x')]).effort.deviation, null)
  })

  it('recursos: elementos e esforço por recurso (elemento com dois recursos conta nos dois); sem recurso por último', () => {
    assert.deepEqual(
      build(items, { progress }).resources.map((r) => [r.resource_id, r.items, r.open, r.estimated]),
      [
        ['r1', 2, 1, 14],
        ['r2', 1, 1, 10],
        [null, 2, 2, 6],
      ],
    )
  })

  it('grupos: progresso, esforço e atrasos de cada um, na ordem do quadro', () => {
    const [g1, g2] = build(items, { progress }).groups
    assert.deepEqual([g1.group_id, g1.items, g1.done, g1.overdue, g1.progress, g1.estimated, g1.actual], ['g1', 3, 1, 1, 40, 20, 9])
    assert.deepEqual([g2.group_id, g2.items, g2.progress, g2.estimated], ['g2', 1, 0, null])
  })
})

describe('domain/plan-report — saúde do projeto', () => {
  it('níveis por limite: ok, atenção, crítico', () => {
    assert.equal(levelOf(0, 10, 25), 'ok')
    assert.equal(levelOf(10, 10, 25), 'ok')
    assert.equal(levelOf(11, 10, 25), 'attention')
    assert.equal(levelOf(26, 10, 25), 'critical')
  })

  it('projeto em dia: todos os fatores ok', () => {
    const r = build([item('a', { statusId: 'st_done', startDate: '2024-02-01', endDate: '2024-02-02', metrics: { estimated_hours: 4, actual_hours: 4 } }), item('b', { startDate: '2024-02-12', endDate: '2024-02-15' })], {
      progress: { a: { value: 100 }, b: { value: 0 } },
    })
    assert.equal(r.health.level, 'ok')
    assert.deepEqual(r.health.factors.map((f) => f.key), HEALTH_FACTORS)
    assert.ok(r.health.factors.every((f) => f.level === 'ok'))
  })

  it('a saúde é o pior fator: atraso, progresso abaixo do planejado, parados, estouro de esforço e problemas em aberto', () => {
    const r = build(
      [
        item('a', { statusId: 'st_done', startDate: '2024-01-01', endDate: '2024-01-05', metrics: { estimated_hours: 10, actual_hours: 14 } }),
        item('b', { startDate: '2024-01-10', endDate: '2024-01-20', metrics: { estimated_hours: 10 } }),
        item('c', { statusId: 'st_stuck', startDate: '2024-02-01', endDate: '2024-02-28' }),
      ],
      {
        progress: { a: { value: 100 }, b: { value: 20 }, c: { value: 0 } },
        issues: [{ state: 'pending' }, { state: 'in_progress' }, { state: 'resolved' }],
      },
    )
    const by = Object.fromEntries(r.health.factors.map((f) => [f.key, f]))
    assert.equal(by.schedule.level, 'critical') // 1 de 2 abertos com data está atrasado (50%)
    assert.equal(by.schedule.value, 50)
    // a e b já deviam ter terminado (100% esperado; c pesa 0 sem esforço): planejado 100% × feito 60%
    assert.deepEqual([by.progress.planned, by.progress.actual, by.progress.value, by.progress.level], [100, 60, 40, 'critical'])
    assert.equal(by.stuck.level, 'critical') // 1 de 2 abertos parado
    assert.equal(by.effort.level, 'critical') // +40% nos feitos
    assert.equal(by.effort.value, 40)
    assert.equal(by.issues.level, 'attention') // 2 em aberto
    assert.equal(by.issues.value, 2)
    assert.equal(r.health.level, 'critical')
  })

  it('progresso × planejado: o esperado pelo tempo decorrido de cada elemento, ponderado pelo esforço', () => {
    // a: 10 dias, hoje é o 5º → 50% esperado; b ainda não começou → 0%; peso igual
    const r = build([item('a', { startDate: '2024-02-06', endDate: '2024-02-15' }), item('b', { startDate: '2024-03-01', endDate: '2024-03-02' })], { progress: { a: { value: 10 }, b: { value: 0 } } })
    const factor = r.health.factors.find((f) => f.key === 'progress')
    assert.deepEqual([factor.planned, factor.actual, factor.value, factor.level], [25, 5, 20, 'attention'])
  })

  it('sem dados para o fator: "sem dados" e não pesa na saúde', () => {
    const r = build([item('a')])
    const by = Object.fromEntries(r.health.factors.map((f) => [f.key, f.level]))
    assert.deepEqual(by, { schedule: 'none', progress: 'none', stuck: 'ok', effort: 'none', issues: 'ok' })
    assert.equal(r.health.level, 'ok')
  })
})
