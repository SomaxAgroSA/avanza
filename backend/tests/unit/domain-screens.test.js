const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  SCREEN_GROUPS,
  SCREEN_KEYS,
  START_GROUPS,
  OPTIONAL_GROUPS,
  hiddenScreensIssue,
  screenStartsIssue,
  normalizeHidden,
  normalizeStarts,
  visibleItems,
} = require('../../src/domain/screens')

describe('"O que aparece" por perfil (domain/screens, §48)', () => {
  it('catálogo: chaves estáveis <grupo>.<item>, únicas, e os grupos com "Abre em"', () => {
    assert.equal(new Set(SCREEN_KEYS).size, SCREEN_KEYS.length)
    ;['projects.lists.finished', 'tasks.views.timeline', 'projects.blocks.team', 'projects.tabs.history', 'settings.menu.icons', 'tasks.filters.company', 'docs.actions.notify'].forEach((key) =>
      assert.ok(SCREEN_KEYS.includes(key), key),
    )
    assert.deepEqual(START_GROUPS, ['projects.lists', 'projects.ongoing_views', 'tasks.screens', 'tasks.boxes', 'tasks.views'])
    assert.deepEqual([...new Set(SCREEN_GROUPS.map((g) => g.module))], ['tracking', 'projects', 'tasks', 'docs', 'settings'])
  })

  it('o catálogo do web (web/src/domain/screens.ts) é o mesmo: grupos, itens e "Abre em"', () => {
    const source = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../../../web/src/domain/screens.ts'), 'utf8')
    const catalog = source.slice(source.indexOf('export const SCREEN_CATALOG = {'), source.indexOf('} as const'))
    const web = [...catalog.matchAll(/'([\w.]+)': \[([^\]]*)\]/g)].map((m) => ({ id: m[1], items: [...m[2].matchAll(/'(\w+)'/g)].map((item) => item[1]) }))
    assert.deepEqual(web, SCREEN_GROUPS.map((g) => ({ id: g.id, items: g.items.slice() })))
    const starts = source.match(/export const START_GROUPS = \[([^\]]*)\]/)[1]
    assert.deepEqual([...starts.matchAll(/'([\w.]+)'/g)].map((m) => m[1]), START_GROUPS)
    const optional = source.match(/export const OPTIONAL_GROUPS = \[([^\]]*)\]/)[1]
    assert.deepEqual([...optional.matchAll(/'([\w.]+)'/g)].map((m) => m[1]), OPTIONAL_GROUPS)
  })

  it('grupo opcional (§50): o "Fixar" das linhas da Lista pode sumir (as fixadas continuam no topo)', () => {
    assert.deepEqual(OPTIONAL_GROUPS, ['tasks.row_actions'])
    assert.ok(SCREEN_KEYS.includes('tasks.row_actions.pin'))
    assert.equal(hiddenScreensIssue(['tasks.row_actions.pin']), null)
    assert.deepEqual(visibleItems(['tasks.row_actions.pin'], 'tasks.row_actions'), [])
    assert.deepEqual(visibleItems([], 'tasks.row_actions'), ['pin'])
  })

  it('escondidas: só chaves conhecidas e sempre ao menos uma visível em cada grupo', () => {
    assert.equal(hiddenScreensIssue([]), null)
    assert.equal(hiddenScreensIssue(['projects.lists.all', 'projects.lists.finished', 'projects.lists.archived']), null)
    assert.equal(hiddenScreensIssue(['projects.lists.all', 'projects.lists.ongoing', 'projects.lists.finished', 'projects.lists.archived']), 'required')
    assert.equal(hiddenScreensIssue(['tasks.views.list', 'tasks.views.timeline']), 'required')
    assert.equal(hiddenScreensIssue(['projects.lists.mine']), 'invalid_option')
    assert.equal(hiddenScreensIssue('projects.lists.all'), 'invalid_type')
    assert.equal(hiddenScreensIssue([1]), 'invalid_type')
  })

  it('"Abre em": só nos grupos com escolha e com um item do grupo', () => {
    assert.equal(screenStartsIssue({}), null)
    assert.equal(screenStartsIssue({ 'projects.lists': 'ongoing', 'tasks.boxes': 'all' }), null)
    assert.equal(screenStartsIssue({ 'projects.lists': 'mine' }), 'invalid_option')
    assert.equal(screenStartsIssue({ 'docs.actions': 'pdf' }), 'invalid_option', 'grupo sem "Abre em"')
    assert.equal(screenStartsIssue({ outra: 'x' }), 'invalid_option')
    assert.equal(screenStartsIssue([]), 'invalid_type')
    assert.equal(screenStartsIssue(null), 'invalid_type')
  })

  it('normalizam: escondidas na ordem do catálogo sem repetidas; "Abre em" só com item visível', () => {
    assert.deepEqual(normalizeHidden(['tasks.views.timeline', 'projects.lists.all', 'tasks.views.timeline', 'outra']), ['projects.lists.all', 'tasks.views.timeline'])
    assert.deepEqual(normalizeHidden(undefined), [])
    assert.deepEqual(normalizeStarts({ 'tasks.boxes': 'all', 'projects.lists': 'ongoing', 'docs.actions': 'pdf' }, ['tasks.boxes.all']), { 'projects.lists': 'ongoing' })
    assert.deepEqual(normalizeStarts(null, []), {})
  })

  it('itens visíveis de um grupo (nunca vazio)', () => {
    assert.deepEqual(visibleItems(['projects.lists.all', 'projects.lists.archived'], 'projects.lists'), ['ongoing', 'finished'])
    assert.deepEqual(visibleItems(['tasks.views.list', 'tasks.views.timeline'], 'tasks.views'), ['list', 'timeline'])
    assert.deepEqual(visibleItems([], 'nada'), [])
  })
})
