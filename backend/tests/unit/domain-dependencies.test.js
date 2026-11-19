const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const dep = require('../../src/domain/dependencies')

const day = (value) => new Date(`${value}T00:00:00.000Z`)
const TODAY = '2026-11-19'

const FVB = { id: 'p_fvb', key: 'FVB', name: 'Fuerza de Ventas Brasil', dueDate: day('2026-12-31') }
const DRE = { id: 'p_dre', key: 'DRE', name: 'DRE Somax Paraguay', dueDate: null }
const OTRO = { id: 'p_otro', key: 'OTR', name: 'Otro', dueDate: null }

const TI = { key: 'ti', name: 'TI' }
const FIN = { key: 'financas', name: 'Finanças' }

const task = (id, projectId, code, assigneeId, extra) =>
  Object.assign({ id, projectId, code, title: `Tarefa ${code}`, assigneeId, dueDate: null, createdAt: day('2026-11-17'), startedAt: null }, extra || {})

function scenario(overrides) {
  const tasks = [
    task('t39', 'p_fvb', 'FVB-39', 'u_victor'), // entrega de TI sem prazo
    task('t38', 'p_fvb', 'FVB-38', 'u_victor', { dueDate: day('2027-01-04') }), // depois do encerramento do projeto: só o prazo dela conta
    task('t133', 'p_fvb', 'FVB-133', 'u_victor', { dueDate: day('2026-11-20') }), // amanhã: em dia (verde)
    task('t31', 'p_fvb', 'FVB-31', 'u_douglas', { dueDate: day('2026-11-20') }), // relacionada (a validar)
    task('t40', 'p_dre', 'DRE-40', 'u_ana', { dueDate: day('2026-11-20') }), // bloqueada, de outro projeto
    task('t41', 'p_dre', 'DRE-41', 'u_it_dre', { dueDate: day('2026-11-18') }), // Responsável TI do DRE: vencida
    task('t42', 'p_dre', 'DRE-42', 'u_lucia', { dueDate: day('2026-11-25') }), // Finanças
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
      areas: [
        { key: 'ti', name: 'TI', user_ids: ['u_victor'] },
        { key: 'financas', name: 'Finanças', user_ids: ['u_lucia'] },
      ],
      itMembers: { p_dre: ['u_it_dre'] },
      today: TODAY,
      linkableProjectIds: ['p_fvb'],
    },
    overrides || {},
  )
}

describe('domain/dependencies — risco pelo prazo da própria tarefa', () => {
  it('sem prazo → vencida → em dia (o encerramento do projeto não entra)', () => {
    assert.deepEqual(dep.RISKS, ['none_due', 'overdue', 'ok'])
    assert.equal(dep.deliveryRisk(null, TODAY), 'none_due')
    assert.equal(dep.deliveryRisk('2026-11-18', TODAY), 'overdue')
    assert.equal(dep.deliveryRisk('2026-11-19', TODAY), 'ok')
    assert.equal(dep.deliveryRisk('2026-11-20', TODAY), 'ok')
    assert.equal(dep.deliveryRisk('2027-01-04', TODAY), 'ok')
  })

  it('área da entrega: a lista de cada área, ou o Responsável TI do próprio projeto (área TI)', () => {
    const areas = [
      { key: 'ti', name: 'TI', user_ids: ['u1'] },
      { key: 'financas', name: 'Finanças', user_ids: ['u3'] },
    ]
    assert.deepEqual(dep.areaOf({ assigneeId: 'u1', projectId: 'p1' }, areas, {}), TI)
    assert.deepEqual(dep.areaOf({ assigneeId: 'u3', projectId: 'p1' }, areas, {}), FIN)
    assert.deepEqual(dep.areaOf({ assigneeId: 'u2', projectId: 'p1' }, areas, { p1: ['u2'] }), TI)
    assert.equal(dep.areaOf({ assigneeId: 'u2', projectId: 'p2' }, areas, { p1: ['u2'] }), null)
    assert.equal(dep.areaOf({ assigneeId: null, projectId: 'p1' }, areas, {}), null)
    // TI renomeada continua sendo a área do Responsável TI
    assert.deepEqual(dep.areaOf({ assigneeId: 'u2', projectId: 'p1' }, [{ key: 'ti', name: 'Informática', user_ids: [] }], { p1: ['u2'] }), { key: 'ti', name: 'Informática' })
  })
})

describe('domain/dependencies — por projeto', () => {
  it('entregas com a área, bloqueadas (até de outro projeto) e a validar; "relacionada" nunca bloqueia', () => {
    const out = dep.buildDependencies(scenario())
    const fvb = out.projects.find((p) => p.project.key === 'FVB')
    const dre = out.projects.find((p) => p.project.key === 'DRE')
    assert.equal(out.projects.some((p) => p.project.key === 'OTR'), false, 'projeto sem entregas nem dependências não aparece')

    // FVB: 3 entregas (FVB-31 é do Douglas: não é de nenhuma área); sem prazo primeiro, depois pelo prazo
    assert.deepEqual(
      fvb.deliveries.map((d) => [d.code, d.risk, d.days_left, d.blocks, d.area.key]),
      [
        ['FVB-39', 'none_due', null, 1, 'ti'],
        ['FVB-133', 'ok', 1, 0, 'ti'],
        ['FVB-38', 'ok', 46, 0, 'ti'],
      ],
    )
    const d39 = fvb.deliveries.find((d) => d.code === 'FVB-39')
    assert.equal(d39.waiting_days, 2)
    assert.deepEqual(d39.blocks_projects, [{ id: 'p_dre', key: 'DRE', name: 'DRE Somax Paraguay' }])
    assert.equal(d39.assignee_id, 'u_victor')
    assert.deepEqual(fvb.blocked, [])
    assert.deepEqual(
      fvb.pending.map((p) => [p.code, p.related_to.code, p.related_to.area.key, p.relation_id, p.can_confirm]),
      [['FVB-31', 'FVB-39', 'ti', 'r2', true]],
    )
    assert.deepEqual(fvb.counts, { deliveries: 3, blocked: 0, pending: 1, none_due: 1, overdue: 0 })

    // DRE: a tarefa bloqueada fica no projeto dela, com a entrega de FVB (e a área dela)
    assert.deepEqual(
      dre.blocked.map((b) => [b.code, b.waiting_on.map((w) => [w.code, w.project.key, w.relation_id, w.area.key])]),
      [['DRE-40', [['FVB-39', 'FVB', 'r1', 'ti']]]],
    )
    // vencida primeiro; Finanças também entra
    assert.deepEqual(
      dre.deliveries.map((d) => [d.code, d.risk, d.area.name]),
      [
        ['DRE-41', 'overdue', 'TI'],
        ['DRE-42', 'ok', 'Finanças'],
      ],
    )
    assert.deepEqual(out.totals, { deliveries: 5, blocked: 1, pending: 1, none_due: 1, overdue: 1, projects: 2 })
    assert.deepEqual(out.areas, [
      { key: 'ti', name: 'TI', deliveries: 4 },
      { key: 'financas', name: 'Finanças', deliveries: 1 },
    ])
    // projeto com bloqueio primeiro
    assert.equal(out.projects[0].project.key, 'DRE')
    assert.equal(JSON.stringify(out).includes('after_project_due'), false)
    assert.equal(JSON.stringify(out).includes('due_soon'), false)
  })

  it('onlyArea recorta numa área (compatibilidade de /ti-dependencies)', () => {
    const out = dep.buildDependencies(scenario({ onlyArea: 'ti' }))
    assert.equal(JSON.stringify(out).includes('DRE-42'), false)
    assert.deepEqual(out.areas, [{ key: 'ti', name: 'TI', deliveries: 4 }])
    assert.equal(out.totals.deliveries, 4)
    const fin = dep.buildDependencies(scenario({ onlyArea: 'financas' }))
    assert.deepEqual(
      fin.projects.map((p) => [p.project.key, p.deliveries.map((d) => d.code)]),
      [['DRE', ['DRE-42']]],
    )
  })

  it('"bloqueia" também conta; entrega concluída (fora das abertas) não bloqueia; sem permissão de relacionar não confirma', () => {
    const base = scenario()
    const withBlocks = dep.buildDependencies(
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
    const out = dep.buildDependencies(Object.assign(base, { relations: base.relations.concat([{ id: 'r5', type: 'depends_on', sourceId: 't31', targetId: 't39' }]) }))
    const fvb = out.projects.find((p) => p.project.key === 'FVB')
    assert.deepEqual(fvb.pending, [])
    assert.deepEqual(fvb.blocked.map((b) => b.code), ['FVB-31'])
    assert.equal(fvb.deliveries.find((d) => d.code === 'FVB-39').blocks, 2)
  })

  it('sem pessoas em nenhuma área, nada', () => {
    const out = dep.buildDependencies(scenario({ areas: [{ key: 'ti', name: 'TI', user_ids: [] }], itMembers: {} }))
    assert.deepEqual(out, { projects: [], areas: [{ key: 'ti', name: 'TI', deliveries: 0 }], totals: { deliveries: 0, blocked: 0, pending: 0, none_due: 0, overdue: 0, projects: 0 } })
  })
})
