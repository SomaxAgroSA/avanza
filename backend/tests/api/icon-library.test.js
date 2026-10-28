/**
 * Biblioteca de ícones (regras de negócio §25) contra a API real: importar (settings.manage), listar
 * (todos), usar no projeto, no tipo de tarefa e no espaço da Documentação, e remover só o que ninguém usa.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

describe('API biblioteca de ícones', { timeout: 180000 }, () => {
  let pb
  let admin
  let member

  before(async () => {
    pb = await startServer()
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    const roles = (await admin.get('/roles')).body.data
    await admin.post('/users', { name: 'Mário', email: 'mario@example.com', password: 'SenhaTeste123', role_id: roles.find((r) => r.code === 'MEMBER').id })
    member = createClient(pb.api)
    await member.login('mario@example.com', 'SenhaTeste123')
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('importa, todos veem, usa nos três lugares e só remove o que ninguém usa', async () => {
    assert.equal((await member.post('/settings/icons', { names: ['tractor'] })).status, 403)
    assert.equal((await admin.post('/projects', { name: 'Fazenda', key: 'FAZ', icon: 'tractor' })).body.error.code, 'VALIDATION_ERROR')

    const imported = await admin.post('/settings/icons', { names: ['tractor', 'sprout'] })
    assert.equal(imported.status, 200, JSON.stringify(imported.body))
    assert.deepEqual(imported.body.data.map((i) => i.name).sort(), ['sprout', 'tractor'])
    assert.deepEqual((await member.get('/icons')).body.data.map((i) => i.name).sort(), ['sprout', 'tractor'])

    const project = (await admin.post('/projects', { name: 'Fazenda', key: 'FAZ', icon: 'tractor' })).body.data
    assert.equal(project.icon, 'tractor')
    assert.equal((await admin.post('/task-types', { key: 'COLHEITA', name: 'Colheita', icon: 'sprout', color: 'green' })).body.data.icon, 'sprout')
    assert.equal((await admin.post('/docs/spaces', { key: 'AGRO', name: 'Agro', visibility: 'company', icon: 'tractor' })).body.data.icon, 'tractor')

    const tractor = (await admin.get('/icons')).body.data.find((i) => i.name === 'tractor')
    assert.deepEqual(tractor.usage, { projects: 1, task_types: 0, doc_spaces: 1 })
    const blocked = await admin.del('/settings/icons/tractor')
    assert.equal(blocked.status, 409)
    assert.equal(blocked.body.error.code, 'ICON_IN_USE')
    assert.deepEqual(blocked.body.error.details, { projects: 1, task_types: 0, doc_spaces: 1 })

    await admin.post('/settings/icons', { names: ['wheat'] })
    assert.equal((await member.del('/settings/icons/wheat')).status, 403)
    assert.deepEqual((await admin.del('/settings/icons/wheat')).body.data, { removed: true })
    assert.equal((await admin.del('/settings/icons/wheat')).body.error.code, 'ICON_NOT_FOUND')

    const history = (await admin.get('/audit-logs?entity_type=icon_library')).body.data.map((e) => e.action)
    assert.deepEqual(history, ['icon_library.removed', 'icon_library.imported', 'icon_library.imported'])
  })
})
