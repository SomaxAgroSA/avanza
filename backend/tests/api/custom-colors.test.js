/**
 * Cor livre (regras de negócio §24) contra a API real: todo lugar com cor aceita a paleta dele e também
 * "#rrggbb" (guardado em minúsculas); outros formatos são recusados.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

describe('API cor livre', { timeout: 180000 }, () => {
  let pb
  let admin

  before(async () => {
    pb = await startServer()
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('tags, status, prioridades, tipos, opções, capa do projeto, espaços e Gestão de projetos aceitam #rrggbb', async () => {
    const ok = async (res, path) => {
      assert.ok(res.status === 200 || res.status === 201, `${path}: ${JSON.stringify(res.body)}`)
      return res.body.data
    }
    assert.equal((await ok(await admin.post('/tags', { name: 'Marca', color: '#1A7F37' }), 'tags')).color, '#1a7f37')
    assert.equal((await ok(await admin.post('/statuses', { key: 'REVISAO', name: 'Revisão', color: '#ff8800', category: 'in_progress' }), 'statuses')).color, '#ff8800')
    assert.equal((await ok(await admin.post('/priorities', { key: 'VIP', name: 'Cliente VIP', color: '#aa00ff' }), 'priorities')).color, '#aa00ff')
    assert.equal((await ok(await admin.post('/task-types', { key: 'marca', name: 'Marca', icon: 'flag', color: '#123456' }), 'task-types')).color, '#123456')
    const field = await ok(await admin.post('/custom-fields', { name: 'canal_cor', label: 'Canal', type: 'select', options: [{ label: 'Loja', color: '#00AAFF' }, { label: 'Site', color: 'teal' }] }), 'custom-fields')
    assert.deepEqual(field.options.map((o) => o.color), ['#00aaff', 'teal'])

    const project = await ok(await admin.post('/projects', { name: 'Cores', key: 'CORES', cover: '#0f766e' }), 'projects')
    assert.equal(project.cover, '#0f766e')
    assert.equal((await ok(await admin.post('/docs/spaces', { key: 'CORES', name: 'Cores', visibility: 'company', color: '#be185d' }), 'docs/spaces')).color, '#be185d')
    assert.equal((await ok(await admin.post(`/projects/${project.id}/groups`, { name: 'Fase 1', color: '#334155' }), 'groups')).color, '#334155')
    assert.equal((await ok(await admin.post(`/projects/${project.id}/plan/statuses`, { name: 'Em análise', color: '#b45309' }), 'plan/statuses')).color, '#b45309')

    // outros formatos não
    for (const color of ['#fff', 'purple', 'rgb(0,0,0)', '#12345g']) {
      assert.equal((await admin.post('/tags', { name: `Tag ${color}`, color })).body.error.code, 'VALIDATION_ERROR', color)
    }
    assert.equal((await admin.patch(`/projects/${project.id}`, { cover: 'magenta' })).body.error.code, 'VALIDATION_ERROR')
  })
})
