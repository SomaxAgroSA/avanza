const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const timeline = require('../../src/domain/timeline')

const d = (day) => new Date(`${day}T00:00:00.000Z`)

describe('domain/timeline — datas da tarefa', () => {
  it('início planejado não pode passar do prazo (mesmo dia pode)', () => {
    assert.equal(timeline.datesIssue(d('2026-10-05'), d('2026-10-01')), 'after_due_date')
    assert.equal(timeline.datesIssue(d('2026-10-01'), d('2026-10-01')), null)
    assert.equal(timeline.datesIssue(d('2026-10-01'), null), null)
    assert.equal(timeline.datesIssue(null, d('2026-10-01')), null)
  })

  it('período da barra: início→prazo; só uma das datas vira barra de um dia; sem datas = fora da linha', () => {
    assert.deepEqual(timeline.spanOf({ startDate: d('2026-10-01'), dueDate: d('2026-10-04') }), { start: '2026-10-01', end: '2026-10-04' })
    assert.deepEqual(timeline.spanOf({ startDate: null, dueDate: d('2026-10-04') }), { start: '2026-10-04', end: '2026-10-04' })
    assert.deepEqual(timeline.spanOf({ startDate: d('2026-10-01'), dueDate: null }), { start: '2026-10-01', end: '2026-10-01' })
    assert.equal(timeline.spanOf({ startDate: null, dueDate: null }), null)
  })
})

describe('domain/timeline — dependências', () => {
  const relations = [
    // A bloqueia B → A antes de B
    { id: 'r1', type: 'blocks', sourceId: 'A', targetId: 'B' },
    // C depende de B → B antes de C
    { id: 'r2', type: 'depends_on', sourceId: 'C', targetId: 'B' },
    // relação simples não é dependência
    { id: 'r3', type: 'relates', sourceId: 'A', targetId: 'C' },
    // outra ponta fora do projeto: não desenha
    { id: 'r4', type: 'blocks', sourceId: 'A', targetId: 'X' },
    // repetida (mesmo par pelos dois tipos): uma seta só
    { id: 'r5', type: 'depends_on', sourceId: 'B', targetId: 'A' },
  ]

  it('setas de quem vem antes para quem vem depois, só entre tarefas da linha do tempo, sem repetir', () => {
    assert.deepEqual(
      timeline.dependencyEdges(relations, ['A', 'B', 'C']).map((e) => [e.id, e.from, e.to]),
      [
        ['r1', 'A', 'B'],
        ['r2', 'B', 'C'],
      ],
    )
  })

  it('conflito quando a tarefa começa antes do prazo daquela de que depende', () => {
    const tasks = {
      A: { startDate: d('2026-10-01'), dueDate: d('2026-10-05') },
      B: { startDate: d('2026-10-03'), dueDate: d('2026-10-08') },
      C: { startDate: d('2026-10-08'), dueDate: d('2026-10-10') },
      D: { startDate: null, dueDate: null },
    }
    // B começa dia 3, antes do prazo de A (dia 5)
    assert.equal(timeline.isConflict(tasks.A, tasks.B), true)
    // C começa no mesmo dia do prazo de B: permitido (entrega e início no mesmo dia)
    assert.equal(timeline.isConflict(tasks.B, tasks.C), false)
    // sem datas não há como conflitar
    assert.equal(timeline.isConflict(tasks.A, tasks.D), false)
  })
})

describe('domain/timeline — marcos', () => {
  it('valida nome, data e situação', () => {
    assert.deepEqual(timeline.MILESTONE_STATES, ['pending', 'done'])
    assert.equal(timeline.milestoneNameIssue(''), 'required')
    assert.equal(timeline.milestoneNameIssue('x'.repeat(121)), 'too_long')
    assert.equal(timeline.milestoneNameIssue('Go-live'), null)
  })
})
