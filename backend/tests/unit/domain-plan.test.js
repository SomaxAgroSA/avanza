const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const plan = require('../../src/domain/plan')

const day = (text) => new Date(`${text}T00:00:00.000Z`)

describe('domain/plan — grupos', () => {
  it('valida nome e cor', () => {
    assert.deepEqual(plan.groupIssues({ name: '  ', color: 'blue' }), { name: 'required' })
    assert.deepEqual(plan.groupIssues({ name: 'x'.repeat(121), color: 'blue' }), { name: 'too_long' })
    assert.deepEqual(plan.groupIssues({ name: 'Execução', color: 'neon' }), { color: 'invalid_option' })
    assert.deepEqual(plan.groupIssues({ name: 'Execução', color: 'green' }), {})
    assert.deepEqual(plan.groupIssues({ color: 'red' }, true), {})
  })

  it('numera como no plano: 1.0, 2.0, 2.1, 2.2 — pela posição, subgrupos dentro do grupo', () => {
    const groups = [
      { id: 'exec', parentId: null, position: 3072, name: 'Execução' },
      { id: 'ini', parentId: null, position: 1024, name: 'Iniciação' },
      { id: 'plan', parentId: null, position: 2048, name: 'Planejamento' },
      { id: 'regras', parentId: 'plan', position: 2048, name: 'Levantar regras' },
      { id: 'pp', parentId: 'plan', position: 1024, name: 'Plano do projeto' },
    ]
    assert.deepEqual(plan.orderGroups(groups).map((g) => g.id), ['ini', 'plan', 'pp', 'regras', 'exec'])
    assert.deepEqual(plan.numberGroups(groups), { ini: '1.0', plan: '2.0', pp: '2.1', regras: '2.2', exec: '3.0' })
  })

  it('no máximo 2 níveis e sem ciclo', () => {
    const groups = [
      { id: 'a', parentId: null },
      { id: 'b', parentId: null },
      { id: 'a1', parentId: 'a' },
    ]
    assert.equal(plan.groupParentIssue(groups, 'a', 'b'), null)
    assert.equal(plan.groupParentIssue(groups, 'a1', 'b'), 'too_deep')
    assert.equal(plan.groupParentIssue(groups, 'b', 'a'), 'too_deep')
    assert.equal(plan.groupParentIssue(groups, 'b', 'b'), 'cycle')
    assert.equal(plan.groupParentIssue(groups, 'x', 'b'), 'invalid_option')
    assert.equal(plan.groupParentIssue(groups, null, 'a1'), null)
  })
})

describe('domain/plan — etiquetas', () => {
  it('status: nome, cor e categoria; recurso: nome (único sem acento/maiúsculas) e cor', () => {
    assert.deepEqual(plan.statusIssues({ name: 'Feito', color: 'green', category: 'done' }), {})
    assert.deepEqual(plan.statusIssues({ name: '', color: 'green', category: 'x' }), { name: 'required', category: 'invalid_option' })
    assert.deepEqual(plan.resourceIssues({ name: 'Gerente de Projetos' }), {})
    assert.deepEqual(plan.resourceIssues({ name: 'x'.repeat(61) }), { name: 'too_long' })
    assert.equal(plan.nameKey('  Gerênte de PROJETOS '), 'gerente de projetos')
  })

  it('status iniciais como no Monday, no idioma de quem abre o quadro', () => {
    assert.deepEqual(plan.defaultStatuses('pt-BR').map((s) => `${s.name}:${s.category}`), ['Planejado:todo', 'Em progresso:in_progress', 'Confirmar:review', 'Parado:blocked', 'Feito:done'])
    assert.equal(plan.defaultStatuses('en')[4].name, 'Done')
    assert.equal(plan.defaultStatuses('xx')[0].name, 'Planejado')
  })
})

describe('domain/plan — elementos', () => {
  it('valida e normaliza o corpo; null limpa; 0 é valor válido', () => {
    const ok = plan.itemInput({ name: ' Reunião inicial ', start_date: '2026-01-26', estimated_hours: 1.555, duration_days: 0, resource_ids: ['r1', 'r1', 'r2'], status_id: null }, false)
    assert.deepEqual(ok.issues, {})
    assert.deepEqual(ok.data, { name: 'Reunião inicial', status_id: null, start_date: '2026-01-26', estimated_hours: 1.56, duration_days: 0, resource_ids: ['r1', 'r2'] })
    assert.deepEqual(plan.itemInput({}, false).issues, { name: 'required' })
    assert.deepEqual(plan.itemInput({ estimated_hours: -1, progress: 101, duration_days: 1.5, start_date: '26/01' }, true).issues, {
      start_date: 'invalid_date',
      estimated_hours: 'too_small',
      duration_days: 'not_integer',
      progress: 'too_large',
    })
    assert.deepEqual(plan.itemInput({ estimated_hours: null, progress: null }, true).data, { estimated_hours: null, progress: null })
    assert.equal(plan.datesIssue('2026-01-27', '2026-01-26'), 'end_before_start')
    assert.equal(plan.datesIssue('2026-01-26', null), null)
  })

  it('subelemento: pai do mesmo projeto e de primeiro nível', () => {
    assert.equal(plan.parentIssue({ id: 'p', projectId: 'x', parentId: null }, 'x', 'n'), null)
    assert.equal(plan.parentIssue({ id: 'p', projectId: 'y', parentId: null }, 'x', 'n'), 'invalid_option')
    assert.equal(plan.parentIssue({ id: 'p', projectId: 'x', parentId: 'q' }, 'x', 'n'), 'too_deep')
    assert.equal(plan.parentIssue({ id: 'p', projectId: 'x', parentId: null }, 'x', 'p'), 'cycle')
    assert.equal(plan.parentIssue(null, 'x', 'n'), 'invalid_option')
  })

  it('duração: pelo cronograma (os dois dias contam); uma data = 1; sem datas, a informada', () => {
    assert.equal(plan.durationOf({ startDate: '2026-01-27', endDate: '2026-01-30' }), 4)
    assert.equal(plan.durationOf({ startDate: day('2026-01-26'), endDate: null }), 1)
    assert.equal(plan.durationOf({ metrics: { duration_days: 3 } }), 3)
    assert.equal(plan.durationOf({ metrics: { duration_days: 0 } }), 0)
    assert.equal(plan.durationOf({}), null)
  })
})

describe('domain/plan — progresso e totais', () => {
  const category = { plan: 'todo', work: 'in_progress', done: 'done', cancel: 'canceled' }
  const categoryOf = (item) => category[item.statusId] || null

  it('feito = 100; com subelementos, ponderado pelo trabalho (sem trabalho, média); senão o manual', () => {
    const items = [
      { id: 'e1', statusId: 'work', progressSet: true, progress: 10 },
      { id: 's1', parentId: 'e1', statusId: 'done', metrics: { estimated_hours: 6 } },
      { id: 's2', parentId: 'e1', statusId: 'work', progressSet: true, progress: 50, metrics: { estimated_hours: 2 } },
      { id: 's3', parentId: 'e1', statusId: 'cancel', metrics: { estimated_hours: 10 } },
      { id: 'e2', statusId: 'done' },
      { id: 'e3', statusId: null, progressSet: true, progress: 40 },
      { id: 'e4', statusId: 'plan' },
      { id: 'e5', statusId: 'plan' },
      { id: 's4', parentId: 'e5', statusId: 'done' },
      { id: 's5', parentId: 'e5', statusId: 'plan' },
    ]
    const p = plan.computeProgress(items, categoryOf)
    assert.deepEqual(p.e1, { value: 88, source: 'subitems' })
    assert.deepEqual(p.e2, { value: 100, source: 'done' })
    assert.deepEqual(p.e3, { value: 40, source: 'manual' })
    assert.deepEqual(p.e4, { value: 0, source: 'none' })
    assert.deepEqual(p.e5, { value: 50, source: 'subitems' })
  })

  it('tarefas ligadas mandam no progresso (antes dos subelementos e do manual); feito continua 100; contagens vão junto', () => {
    const items = [
      { id: 'e1', statusId: 'work', progressSet: true, progress: 10 },
      { id: 's1', parentId: 'e1', statusId: 'done' },
      { id: 'e2', statusId: 'done' },
      { id: 'e3', statusId: 'plan', progressSet: true, progress: 70 },
      { id: 's2', parentId: 'e3', statusId: 'plan' },
    ]
    const counts = { e1: { total: 4, done: 1 }, e2: { total: 2, done: 0 }, s2: { total: 3, done: 3 }, e3: { total: 0, done: 0 } }
    const p = plan.computeProgress(items, categoryOf, counts)
    assert.deepEqual(p.e1, { value: 25, source: 'tasks', tasks: { total: 4, done: 1 } })
    assert.deepEqual(p.e2, { value: 100, source: 'done', tasks: { total: 2, done: 0 } })
    assert.deepEqual(p.s2, { value: 100, source: 'tasks', tasks: { total: 3, done: 3 } })
    // sem tarefas (total 0): segue as regras de antes — subelementos
    assert.deepEqual(p.e3, { value: 100, source: 'subitems', tasks: { total: 0, done: 0 } })
  })

  it('contagem das tarefas por elemento: canceladas fora do total, concluídas pela categoria', () => {
    const cat = { a: 'todo', b: 'done', c: 'cancelled' }
    const counts = plan.taskCountsFrom(
      [
        { planItemId: 'e1', statusId: 'a', total: 2 },
        { planItemId: 'e1', statusId: 'b', total: 3 },
        { planItemId: 'e1', statusId: 'c', total: 5 },
        { planItemId: 'e2', statusId: 'c', total: 1 },
      ],
      (id) => cat[id],
    )
    assert.deepEqual(counts, { e1: { total: 5, done: 3 } })
  })

  it('rodapé do grupo: distribuição de status, período, somas de esforço e duração, progresso ponderado', () => {
    const items = [
      { id: 'a', statusId: 'done', startDate: null, endDate: null, metrics: { estimated_hours: 1.5, duration_days: 1 } },
      { id: 'b', statusId: 'done', startDate: '2026-01-26', endDate: '2026-01-26', metrics: { estimated_hours: 0.1 } },
      { id: 'c', statusId: 'work', startDate: '2026-01-27', endDate: '2026-01-30', metrics: { estimated_hours: 0.2 }, progressSet: true, progress: 50 },
      { id: 'd', statusId: null, startDate: '2026-02-10', endDate: null },
      { id: 's', parentId: 'c', statusId: 'done' },
    ]
    const summary = plan.groupSummary(items, plan.computeProgress(items, categoryOf), (i) => i.statusId)
    assert.deepEqual(summary.status_counts, [
      { status_id: 'done', count: 2 },
      { status_id: 'work', count: 1 },
      { status_id: null, count: 1 },
    ])
    assert.equal(summary.items, 4)
    assert.deepEqual([summary.start_date, summary.end_date], [day('2026-01-26'), day('2026-02-10')])
    assert.equal(summary.estimated_hours, 1.8)
    // 1 (manual) + 1 + 4 + 1
    assert.equal(summary.duration_days, 7)
    // c tem subelemento feito → 100; (1,5×100 + 0,1×100 + 0,2×100 + 0×0) / 1,8 = 100
    assert.equal(summary.progress, 100)
    assert.deepEqual(plan.groupSummary([], {}, () => null), { items: 0, status_counts: [], start_date: null, end_date: null, estimated_hours: null, duration_days: null, progress: 0, custom_sums: {} })
    // colunas numéricas personalizadas (GP-5): soma por coluna; sem valor nenhum, null
    const sums = plan.groupSummary([{ id: 'a', custom: { c1: 2.5 } }, { id: 'b', custom: { c1: 1 } }, { id: 's', parentId: 'a', custom: { c1: 100 } }], {}, () => null, null, ['c1', 'c2']).custom_sums
    assert.deepEqual(sums, { c1: 3.5, c2: null })
  })
})

describe('domain/plan — posição entre irmãos', () => {
  const siblings = [
    { id: 'a', position: 1024 },
    { id: 'b', position: 2048 },
    { id: 'c', position: 3072 },
  ]
  it('depois de, antes de, no fim; sem folga = null', () => {
    assert.equal(plan.placeAmong(siblings, { prevId: 'a' }), 1536)
    assert.equal(plan.placeAmong(siblings, { nextId: 'a' }), 0)
    assert.equal(plan.placeAmong(siblings, { nextId: 'c' }), 2560)
    assert.equal(plan.placeAmong(siblings, {}), 4096)
    assert.equal(plan.placeAmong([], {}), 1024)
    assert.equal(plan.placeAmong([{ id: 'a', position: 1 }, { id: 'b', position: 1 + 1e-7 }], { prevId: 'a' }), null)
  })
})
