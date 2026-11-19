const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const ti = require('../../src/domain/ti-dependencies')

const day = (value) => new Date(`${value}T00:00:00.000Z`)
const TODAY = '2026-11-19'

const FVB = { id: 'p_fvb', key: 'FVB', name: 'Fuerza de Ventas Brasil', dueDate: day('2026-12-31') }
const DRE = { id: 'p_dre', key: 'DRE', name: 'DRE Somax Paraguay', dueDate: null }
const OTRO = { id: 'p_otro', key: 'OTR', name: 'Otro', dueDate: null }

const task = (id, projectId, code, assigneeId, extra) =>
  Object.assign({ id, projectId, code, title: `Tarefa ${code}`, assigneeId, dueDate: null, createdAt: day('2026-11-17'), startedAt: null }, extra || {})

function scenario(overrides) {
  const tasks = [
    task('t39', 'p_fvb', 'FVB-39', 'u_victor'), // entrega de TI sem prazo
    task('t38', 'p_fvb', 'FVB-38', 'u_victor', { dueDate: day('2027-01-04') }), // depois do encerramento
    task('t133', 'p_fvb', 'FVB-133', 'u_victor', { dueDate: day('2026-11-26') }), // em 7 dias
    task('t31', 'p_fvb', 'FVB-31', 'u_douglas', { dueDate: day('2026-11-20') }), // relacionada (a validar)
    task('t40', 'p_dre', 'DRE-40', 'u_ana', { dueDate: day('2026-11-20') }), // bloqueada, de outro projeto
    task('t41', 'p_dre', 'DRE-41', 'u_it_dre', { dueDate: day('2026-11-18') }), // Responsável TI do DRE: vencida
    task('t50', 'p_otro', 'OTR-50', 'u_douglas'), // sem nada a ver
  ]
  return Object.assign(
    {
      projects: [FVB, DRE, OTRO],
      tasks,
      relations: [
        { id: 'r1', type: 'depends_on', sourceId: 't40', targetId: 't39' }, // DRE-40 depende de FVB-39
        { id: 'r2', type: 'relates', sourceId: 't39', targetId: 't31' }, // só relacionada: a validar
        { id: 'r3', type: 'duplicates', sourceId: 't50', targetId: 't133' }, // não conta
      ],
      itPeople: ['u_victor'],
      itMembers: { p_dre: ['u_it_dre'] },
      today: TODAY,
      linkableProjectIds: ['p_fvb'],
    },
    overrides || {},
  )
}

describe('domain/ti-dependencies — risco do prazo', () => {
  it('sem prazo → depois da entrega do projeto → vencida → até 3 dias → em dia', () => {
    assert.equal(ti.deliveryRisk(null, '2026-12-31', TODAY), 'none_due')
    assert.equal(ti.deliveryRisk('2027-01-04', '2026-12-31', TODAY), 'after_project_due')
    assert.equal(ti.deliveryRisk('2026-11-18', '2026-12-31', TODAY), 'overdue')
    assert.equal(ti.deliveryRisk('2026-11-19', null, TODAY), 'due_soon')
    assert.equal(ti.deliveryRisk('2026-11-22', null, TODAY), 'due_soon')
    assert.equal(ti.deliveryRisk('2026-11-23', null, TODAY), 'ok')
    // projeto já vencido e entrega depois dele: conta como "depois do encerramento"
    assert.equal(ti.deliveryRisk('2026-11-25', '2026-11-10', TODAY), 'after_project_due')
  })

  it('pessoa de TI: lista da plataforma ou Responsável TI do próprio projeto', () => {
    assert.equal(ti.isTiDelivery({ assigneeId: 'u1', projectId: 'p1' }, ['u1'], {}), true)
    assert.equal(ti.isTiDelivery({ assigneeId: 'u2', projectId: 'p1' }, [], { p1: ['u2'] }), true)
    assert.equal(ti.isTiDelivery({ assigneeId: 'u2', projectId: 'p2' }, [], { p1: ['u2'] }), false)
    assert.equal(ti.isTiDelivery({ assigneeId: null, projectId: 'p1' }, ['u1'], {}), false)
  })
})

describe('domain/ti-dependencies — por projeto', () => {
  it('entregas, bloqueadas (até de outro projeto) e a validar; "relacionada" nunca bloqueia', () => {
    const out = ti.buildTiDependencies(scenario())
    const fvb = out.projects.find((p) => p.project.key === 'FVB')
    const dre = out.projects.find((p) => p.project.key === 'DRE')
    assert.equal(out.projects.some((p) => p.project.key === 'OTR'), false, 'projeto sem entregas nem dependências não aparece')

    // FVB: 3 entregas (FVB-31 é do Douglas: não é TI)
    assert.deepEqual(
      fvb.deliveries.map((d) => [d.code, d.risk, d.days_left, d.blocks]),
      [
        ['FVB-38', 'after_project_due', 46, 0],
        ['FVB-39', 'none_due', null, 1],
        ['FVB-133', 'ok', 7, 0],
      ],
    )
    const d39 = fvb.deliveries.find((d) => d.code === 'FVB-39')
    assert.equal(d39.waiting_days, 2)
    assert.deepEqual(d39.blocks_projects, [{ id: 'p_dre', key: 'DRE', name: 'DRE Somax Paraguay' }])
    assert.equal(d39.assignee_id, 'u_victor')
    assert.deepEqual(fvb.blocked, [])
    assert.deepEqual(
      fvb.pending.map((p) => [p.code, p.related_to.code, p.relation_id, p.can_confirm]),
      [['FVB-31', 'FVB-39', 'r2', true]],
    )
    assert.deepEqual(fvb.counts, { deliveries: 3, blocked: 0, pending: 1, none_due: 1, after_project_due: 1, overdue: 0, due_soon: 0 })

    // DRE: a tarefa bloqueada fica no projeto dela, com a entrega de FVB
    assert.deepEqual(
      dre.blocked.map((b) => [b.code, b.waiting_on.map((w) => [w.code, w.project.key, w.relation_id])]),
      [['DRE-40', [['FVB-39', 'FVB', 'r1']]]],
    )
    // e a entrega do Responsável TI do DRE (vencida)
    assert.deepEqual(dre.deliveries.map((d) => [d.code, d.risk]), [['DRE-41', 'overdue']])
    assert.deepEqual(out.totals, { deliveries: 4, blocked: 1, pending: 1, none_due: 1, after_project_due: 1, overdue: 1, due_soon: 0, projects: 2 })
    // projeto com bloqueio primeiro
    assert.equal(out.projects[0].project.key, 'DRE')
  })

  it('"bloqueia" também conta; entrega concluída (fora das abertas) não bloqueia; sem permissão de relacionar não confirma', () => {
    const base = scenario()
    const withBlocks = ti.buildTiDependencies(
      Object.assign(base, {
        tasks: base.tasks.filter((t) => t.id !== 't39'), // FVB-39 concluída
        relations: base.relations.concat([{ id: 'r4', type: 'blocks', sourceId: 't133', targetId: 't50' }]),
        linkableProjectIds: [],
      }),
    )
    assert.equal(withBlocks.projects.some((p) => p.blocked.some((b) => b.code === 'DRE-40')), false)
    const otro = withBlocks.projects.find((p) => p.project.key === 'OTR')
    assert.deepEqual(otro.blocked.map((b) => [b.code, b.waiting_on[0].code]), [['OTR-50', 'FVB-133']])
    // r2 (relates com FVB-39) sumiu junto com a entrega concluída
    assert.equal(withBlocks.totals.pending, 0)
  })

  it('relacionada e também bloqueada pela mesma entrega: não pede validação', () => {
    const base = scenario()
    const out = ti.buildTiDependencies(Object.assign(base, { relations: base.relations.concat([{ id: 'r5', type: 'depends_on', sourceId: 't31', targetId: 't39' }]) }))
    const fvb = out.projects.find((p) => p.project.key === 'FVB')
    assert.deepEqual(fvb.pending, [])
    assert.deepEqual(fvb.blocked.map((b) => b.code), ['FVB-31'])
    assert.equal(fvb.deliveries.find((d) => d.code === 'FVB-39').blocks, 2)
  })

  it('sem pessoas de TI, nada', () => {
    const out = ti.buildTiDependencies(scenario({ itPeople: [], itMembers: {} }))
    assert.deepEqual(out, { projects: [], totals: { deliveries: 0, blocked: 0, pending: 0, none_due: 0, after_project_due: 0, overdue: 0, due_soon: 0, projects: 0 } })
  })
})
