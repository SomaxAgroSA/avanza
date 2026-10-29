/**
 * Preferências por pessoa (GET/PUT /api/v1/auth/preferences/{key}) contra a API real: cada um vê e grava
 * só as suas, por tela; nulo volta ao padrão; chave e formato validados. E o Painel executivo marca os
 * projetos de que a pessoa participa (`member`), usado pelo configurador "só os meus".
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const PASSWORD = 'SenhaTeste123'

describe('API preferências', { timeout: 180000 }, () => {
  let pb
  let admin
  let gil

  before(async () => {
    pb = await startServer()
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    const roles = (await admin.get('/roles')).body.data
    await admin.post('/users', { name: 'Gil', email: 'gil@example.com', password: PASSWORD, role_id: roles.find((r) => r.code === 'MANAGER').id })
    gil = createClient(pb.api)
    await gil.login('gil@example.com', PASSWORD)
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('padrão nulo; grava por tela e por pessoa; nulo apaga', async () => {
    assert.deepEqual((await gil.get('/auth/preferences/project_filter.kanban')).body.data, { key: 'project_filter.kanban', value: null })

    const saved = await gil.put('/auth/preferences/project_filter.kanban', { value: { statuses: ['paused', 'active'], members_only: true } })
    assert.equal(saved.status, 200, JSON.stringify(saved.body))
    assert.deepEqual(saved.body.data.value, { statuses: ['active', 'paused'], members_only: true })
    await gil.put('/auth/preferences/project_filter.kanban', { value: { statuses: ['planning'], members_only: false } })
    assert.deepEqual((await gil.get('/auth/preferences/project_filter.kanban')).body.data.value, { statuses: ['planning'], members_only: false })

    // outra tela e outra pessoa não mudam
    assert.equal((await gil.get('/auth/preferences/project_filter.timeline')).body.data.value, null)
    assert.equal((await admin.get('/auth/preferences/project_filter.kanban')).body.data.value, null)

    await gil.put('/auth/preferences/project_filter.kanban', { value: null })
    assert.equal((await gil.get('/auth/preferences/project_filter.kanban')).body.data.value, null)
  })

  it('valida a chave, o formato e exige o header das mutações', async () => {
    const bad = await gil.put('/auth/preferences/project_filter.outra', { value: {} })
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error.details.fields.key, 'invalid_option')
    assert.equal((await gil.put('/auth/preferences/project_filter.tasks', { value: { statuses: ['x'] } })).body.error.details.fields['value.statuses'], 'invalid_option')
    assert.equal((await gil.put('/auth/preferences/project_filter.tasks', {})).body.error.details.fields.value, 'required')
    assert.equal((await gil.put('/auth/preferences/project_filter.tasks', { value: {} }, { csrf: false })).status, 403)
    assert.equal((await createClient(pb.api).get('/auth/preferences/project_filter.tasks')).status, 401)
  })

  it('painel executivo: projetos marcados com member (dono ou membro)', async () => {
    const mine = (await gil.post('/projects', { name: 'Do Gil', key: 'GIL' })).body.data
    const other = (await admin.post('/projects', { name: 'Do Admin', key: 'ADM' })).body.data
    const data = (await admin.get('/executive')).body.data
    assert.equal(data.projects.find((p) => p.id === other.id).member, true)
    assert.equal(data.projects.find((p) => p.id === mine.id).member, false)
  })
})
