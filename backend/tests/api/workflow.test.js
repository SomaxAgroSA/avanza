/**
 * Status e prioridades — testes de API contra um PocketBase real.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 5000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 5000 },
]

describe('API /api/v1/statuses e /priorities', { timeout: 120000 }, () => {
  let pb
  let admin
  let viewer

  before(async () => {
    pb = await startServer()
    await pb.updateSettings({ rateLimits: { enabled: true, rules: RULES } })
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    const roles = (await admin.get('/roles')).body.data
    await admin.post('/users', { name: 'Leitor', email: 'leitor@example.com', password: 'SenhaTeste123', role_id: roles.find((r) => r.code === 'VIEWER').id })
    viewer = createClient(pb.api)
    await viewer.login('leitor@example.com', 'SenhaTeste123')
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('carga inicial: fluxo da diretriz e prioridades com um único padrão', async () => {
    const statuses = await viewer.get('/statuses')
    assert.equal(statuses.status, 200, JSON.stringify(statuses.body))
    assert.deepEqual(statuses.body.data.map((s) => [s.key, s.category]), [
      ['BACKLOG', 'backlog'],
      ['TRIAGEM', 'todo'],
      ['ANALISE', 'todo'],
      ['PRIORIZADO', 'todo'],
      ['DESENVOLVIMENTO', 'in_progress'],
      ['HOMOLOGACAO', 'in_progress'],
      ['PRODUCAO', 'in_progress'],
      ['CONCLUIDO', 'done'],
      ['CANCELADO', 'cancelled'],
    ])
    assert.deepEqual(statuses.body.data.filter((s) => s.is_default).map((s) => s.key), ['BACKLOG'])

    const priorities = (await viewer.get('/priorities')).body.data
    assert.deepEqual(priorities.map((p) => p.key), ['CRITICA', 'ALTA', 'MEDIA', 'BAIXA'])
    assert.equal(priorities.find((p) => p.is_default).key, 'MEDIA')
    assert.equal(priorities[0].category, undefined)
  })

  it('CRUD, troca de padrão, reordenação e auditoria', async () => {
    const created = await admin.post('/statuses', { key: 'bloqueado', name: 'Bloqueado', category: 'in_progress', color: 'red' })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    assert.equal(created.body.data.key, 'BLOQUEADO')
    assert.equal((await admin.post('/statuses', { key: 'BLOQUEADO', name: 'X', category: 'todo' })).body.error.code, 'STATUS_KEY_IN_USE')

    const low = (await admin.get('/priorities')).body.data.find((p) => p.key === 'BAIXA')
    const becameDefault = await admin.patch(`/priorities/${low.id}`, { is_default: true })
    assert.equal(becameDefault.body.data.is_default, true)
    assert.deepEqual((await admin.get('/priorities')).body.data.filter((p) => p.is_default).map((p) => p.key), ['BAIXA'])
    assert.equal((await admin.del(`/priorities/${low.id}`)).body.error.code, 'PRIORITY_IS_DEFAULT')

    const ids = (await admin.get('/statuses?include_inactive=1')).body.data.map((s) => s.id)
    const reordered = await admin.put('/statuses/order', { ids: ids.slice().reverse() })
    assert.equal(reordered.status, 200, JSON.stringify(reordered.body))
    assert.equal(reordered.body.data[0].key, 'BLOQUEADO')

    const removed = await admin.del(`/statuses/${created.body.data.id}`)
    assert.equal(removed.status, 200, JSON.stringify(removed.body))
    const audit = (await admin.get('/audit-logs?entity_type=status')).body.data.map((a) => a.action)
    assert.deepEqual(audit.slice(0, 3), ['status.deleted', 'status.reordered', 'status.created'])
  })

  it('áreas responsáveis: carga inicial sem padrão, CRUD, reordenação, auditoria e permissões', async () => {
    const seeded = (await viewer.get('/areas')).body.data
    assert.deepEqual(seeded.map((a) => a.key), ['INTELIGENCIA', 'TI', 'DESARROLLO', 'MARKETING', 'CONTABILIDAD', 'ADMINISTRACION', 'FERTILIZANTES', 'LOGISTICA', 'SUPPLY', 'COMEX', 'CREDITOS'])
    assert.equal(seeded[1].name, 'Dpto. TI')
    assert.equal(seeded.some((a) => a.is_default), false)

    const created = await admin.post('/areas', { key: 'juridico', name: 'Jurídico', color: 'violet', is_default: true })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    assert.deepEqual([created.body.data.key, created.body.data.is_default], ['JURIDICO', false])
    assert.equal((await admin.post('/areas', { key: 'JURIDICO', name: 'X' })).body.error.code, 'AREA_KEY_IN_USE')
    assert.equal((await admin.patch(`/areas/${created.body.data.id}`, { is_active: false })).body.data.is_active, false)
    assert.equal((await viewer.get('/areas')).body.data.some((a) => a.key === 'JURIDICO'), false)
    assert.equal((await viewer.post('/areas', { key: 'X1', name: 'X' })).status, 403)
    assert.equal((await admin.get('/areas/naoexiste12345')).body.error.code, 'AREA_NOT_FOUND')

    const ids = (await admin.get('/areas?include_inactive=1')).body.data.map((a) => a.id)
    const reordered = await admin.put('/areas/order', { ids: ids.slice().reverse() })
    assert.equal(reordered.status, 200, JSON.stringify(reordered.body))
    assert.equal(reordered.body.data[0].key, 'JURIDICO')
    assert.equal((await admin.del(`/areas/${created.body.data.id}`)).status, 200)
    const audit = (await admin.get('/audit-logs?entity_type=area')).body.data.map((a) => a.action)
    assert.deepEqual(audit.slice(0, 4), ['area.deleted', 'area.reordered', 'area.updated', 'area.created'])
  })

  it('leitor não altera nem vê inativos; rotas protegidas por CSRF', async () => {
    assert.equal((await viewer.post('/priorities', { key: 'X1', name: 'X' })).status, 403)
    const statuses = (await admin.get('/statuses')).body.data
    const target = statuses.find((s) => !s.is_default)
    await admin.patch(`/statuses/${target.id}`, { is_active: false })
    assert.equal((await viewer.get('/statuses?include_inactive=1')).body.data.some((s) => s.id === target.id), false)
    assert.equal((await admin.get('/statuses?include_inactive=1')).body.data.some((s) => s.id === target.id), true)
    const noCsrf = await admin.patch(`/statuses/${target.id}`, { name: 'X' }, { csrf: false })
    assert.equal(noCsrf.status, 403)
  })
})
