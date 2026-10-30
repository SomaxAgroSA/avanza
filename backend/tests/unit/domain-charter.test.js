const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const charter = require('../../pb_hooks/src/domain/charter')

const result = (patch) => Object.assign({ kind: 'result', baseline: 0, target: 100, current: null, startDate: '2026-10-01', dueDate: '2026-10-31', frequency: 'none', createdAt: new Date('2026-10-01T00:00:00.000Z') }, patch)

describe('domain/charter — funcionalidades', () => {
  it('avanço pelas tarefas vinculadas, sem contar as canceladas', () => {
    assert.deepEqual(charter.taskProgress(['done', 'in_progress', 'todo', 'cancelled']), { done: 1, total: 3, started: 2 })
    assert.deepEqual(charter.taskProgress([]), { done: 0, total: 0, started: 0 })
  })

  it('estado automático: planejada → em desenvolvimento → entregue', () => {
    const auto = { state: 'auto' }
    assert.equal(charter.featureState(auto, []), 'planned')
    assert.equal(charter.featureState(auto, ['todo', 'backlog']), 'planned')
    assert.equal(charter.featureState(auto, ['todo', 'in_progress']), 'in_progress')
    assert.equal(charter.featureState(auto, ['done', 'todo']), 'in_progress')
    assert.equal(charter.featureState(auto, ['done', 'cancelled']), 'delivered')
  })

  it('estado escolhido à mão vale sobre o cálculo', () => {
    assert.equal(charter.featureState({ state: 'cancelled' }, ['done']), 'cancelled')
    assert.equal(charter.featureState({ state: 'delivered' }, ['todo']), 'delivered')
  })
})

describe('domain/charter — resultados esperados', () => {
  it('sem medição = sem dados; chegou à meta = cumprido', () => {
    assert.equal(charter.resultSituation(result({}), '2026-10-15'), 'no_data')
    assert.equal(charter.resultSituation(result({ current: 100 }), '2026-10-15'), 'achieved')
    assert.equal(charter.resultSituation(result({ current: 120 }), '2026-11-15'), 'achieved')
  })

  it('no caminho = no ritmo de uma reta entre início e prazo; abaixo = atrasado', () => {
    // 15/10 = metade do período → esperado 46,7 (14 de 30 dias)
    assert.equal(charter.resultSituation(result({ current: 50 }), '2026-10-15'), 'on_track')
    assert.equal(charter.resultSituation(result({ current: 30 }), '2026-10-15'), 'late')
    assert.equal(charter.resultSituation(result({ current: 99 }), '2026-11-01'), 'late')
  })

  it('meta abaixo da partida = quanto menos, melhor', () => {
    const down = result({ baseline: 10, target: 2 })
    assert.equal(charter.resultSituation(Object.assign({}, down, { current: 5 }), '2026-10-15'), 'on_track')
    assert.equal(charter.resultSituation(Object.assign({}, down, { current: 9 }), '2026-10-15'), 'late')
    assert.equal(charter.resultSituation(Object.assign({}, down, { current: 2 }), '2026-10-15'), 'achieved')
    assert.equal(charter.resultPercent(Object.assign({}, down, { current: 6 })), 50)
  })

  it('sem prazo, quem ainda não chegou à meta fica no caminho', () => {
    assert.equal(charter.resultSituation(result({ current: 1, dueDate: null }), '2027-01-01'), 'on_track')
  })

  it('percentual da partida até a meta, limitado entre 0 e 100', () => {
    assert.equal(charter.resultPercent(result({ current: 68, target: 90, baseline: 40 })), 56)
    assert.equal(charter.resultPercent(result({ current: 150 })), 100)
    assert.equal(charter.resultPercent(result({ current: -5 })), 0)
    assert.equal(charter.resultPercent(result({})), 0)
  })

  it('sem medir: passou do intervalo da frequência (conta da criação se nunca mediu)', () => {
    assert.equal(charter.isStale(result({ frequency: 'weekly', measuredAt: '2026-10-01' }), '2026-10-08'), false)
    assert.equal(charter.isStale(result({ frequency: 'weekly', measuredAt: '2026-10-01' }), '2026-10-09'), true)
    assert.equal(charter.isStale(result({ frequency: 'monthly' }), '2026-11-15'), true)
    assert.equal(charter.isStale(result({ frequency: 'none' }), '2027-10-01'), false)
  })
})

describe('domain/charter — objetivos e ficha', () => {
  it('objetivo automático pelos vínculos', () => {
    const auto = { state: 'auto' }
    assert.equal(charter.objectiveState(auto, []), 'pending')
    assert.equal(charter.objectiveState(auto, [{ kind: 'feature', state: 'planned' }]), 'pending')
    assert.equal(charter.objectiveState(auto, [{ kind: 'feature', state: 'in_progress' }]), 'in_progress')
    assert.equal(charter.objectiveState(auto, [{ kind: 'feature', state: 'delivered' }, { kind: 'result', state: 'achieved' }]), 'achieved')
    assert.equal(charter.objectiveState(auto, [{ kind: 'feature', state: 'delivered' }, { kind: 'result', state: 'late' }]), 'at_risk')
    assert.equal(charter.objectiveState(auto, [{ kind: 'feature', state: 'delivered' }, { kind: 'feature', state: 'cancelled' }]), 'achieved')
    assert.equal(charter.objectiveState({ state: 'at_risk' }, [{ kind: 'feature', state: 'delivered' }]), 'at_risk')
  })

  it('completude pelas quatro seções', () => {
    assert.deepEqual(charter.completeness('', []), { sections: { objectives: false, features: false, scope: false, results: false }, done: 0, total: 4, percent: 0 })
    const c = charter.completeness('Centralizar a gestão comercial', [{ kind: 'scope_out' }, { kind: 'feature' }])
    assert.deepEqual(c.sections, { objectives: true, features: true, scope: false, results: false })
    assert.equal(c.percent, 50)
  })

  it('avalia a ficha inteira: estados efetivos, resumo e completude', () => {
    const items = [
      { id: 'f1', kind: 'feature', state: 'auto', taskIds: ['t1', 't2'] },
      { id: 'f2', kind: 'feature', state: 'auto', taskIds: ['t3'] },
      { id: 'f3', kind: 'feature', state: 'cancelled', taskIds: [] },
      result({ id: 'r1', current: 30 }),
      result({ id: 'r2', current: 100 }),
      { id: 'o1', kind: 'objective', state: 'auto', linkIds: ['f1', 'r1', 'gone'] },
      { id: 's1', kind: 'scope_in' },
    ]
    const categories = { t1: 'done', t2: 'done', t3: 'todo' }
    const out = charter.evaluate('', items, (ids) => ids.filter((id) => categories[id]).map((id) => categories[id]), '2026-10-15')
    const byId = Object.fromEntries(out.items.map((i) => [i.id, i]))
    assert.equal(byId.f1.effectiveState, 'delivered')
    assert.equal(byId.f2.effectiveState, 'planned')
    assert.equal(byId.r1.situation, 'late')
    assert.equal(byId.o1.effectiveState, 'at_risk')
    assert.deepEqual(out.summary, { features_total: 2, features_delivered: 1, tasks_total: 3, tasks_done: 2, results_total: 2, results_on_track: 1, results_late: 1, results_stale: 0 })
    assert.equal(out.completeness.percent, 100)
  })
})
