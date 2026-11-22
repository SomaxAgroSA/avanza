/**
 * Exportar a documentação em PDF (§43, ADR-059) — testes de API: `GET /docs/export` pela rota inteira,
 * com a ordem de leitura, só o publicado e as mesmas regras de leitura da tela (espaço e módulo).
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...texts) => ({ type: 'doc', content: texts.map(paragraph) })

describe('API Exportar documentação (PDF)', { timeout: 180000 }, () => {
  let pb
  let admin
  let mario
  let otto
  let project
  let marketing

  before(async () => {
    pb = await startServer()
    admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    const roles = (await admin.get('/roles')).body.data
    const make = async (name, email, role) => {
      const created = (await admin.post('/users', { name, email, password: 'SenhaTeste123', role_id: roles.find((r) => r.code === role).id })).body.data
      const client = createClient(pb.api)
      await client.login(email, 'SenhaTeste123')
      return { client, user: created }
    }
    const m = await make('Mário', 'mario@example.com', 'MEMBER')
    const o = await make('Otto', 'otto@example.com', 'MEMBER')
    mario = m.client
    otto = o.client
    project = (await admin.post('/projects', { name: 'Página Web', key: 'PWGS' })).body.data
    await admin.post(`/projects/${project.id}/members`, { user_id: m.user.id, role: 'member' })
    marketing = (await admin.post('/docs/modules', { name: 'Marketing', color: 'blue' })).body.data
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  async function publish(spaceId, title, parentId, texts) {
    const page = (await mario.post(`/docs/spaces/${spaceId}/pages`, { title, parent_id: parentId })).body.data
    const res = await mario.post(`/docs/pages/${page.id}/publish`, { title, content: doc(...(texts || [title])) })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    return res.body.data
  }

  it('espaço: só o publicado, na ordem da árvore, com versão, autor, palavras e o conteúdo', async () => {
    const space = (await admin.post('/docs/spaces', { key: 'WEB', name: 'Página Web Grupo Somax', description: 'Relevamento das webs', visibility: 'company', module_id: marketing.id })).body.data
    const mapa = await publish(space.id, 'Mapa geral', null, ['Mapa geral e tecnologia usada'])
    const brasil = await publish(space.id, 'Somax Brasil', mapa.id)
    await publish(space.id, 'Anexo: Catálogo', null)
    const draft = (await mario.post(`/docs/spaces/${space.id}/pages`, { title: 'Rascunho' })).body.data
    // rascunho pendente numa página publicada: sai o publicado
    await mario.put(`/docs/pages/${brasil.id}/draft`, { title: 'Brasil (novo)', content: doc('não publicado') })

    const res = await otto.get('/docs/export?space=WEB')
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const [exported] = res.body.data.spaces
    assert.deepEqual([exported.key, exported.description, exported.module.name], ['WEB', 'Relevamento das webs', 'Marketing'])
    assert.deepEqual(
      exported.pages.map((p) => [p.title, p.depth]),
      [
        ['Página Web Grupo Somax', 1],
        ['Mapa geral', 1],
        ['Somax Brasil', 2],
        ['Anexo: Catálogo', 1],
      ],
    )
    const page = exported.pages.find((p) => p.id === brasil.id)
    assert.deepEqual(page.content, doc('Somax Brasil'))
    assert.deepEqual([page.version, page.published_by.name, page.parent_id], [1, 'Mário', mapa.id])
    assert.equal(exported.pages.find((p) => p.id === mapa.id).words, 5)
    assert.equal(exported.pages.some((p) => p.id === draft.id), false)
  })

  it('mesmas regras de leitura: espaço do projeto, módulo e validação', async () => {
    const hidden = (await admin.post('/docs/spaces', { key: 'BASTID', name: 'Bastidores', visibility: 'project', project_id: project.id, module_id: marketing.id })).body.data
    await publish(hidden.id, 'Plano interno', null)

    const outsider = await otto.get('/docs/export?space=BASTID')
    assert.equal(outsider.status, 404)
    assert.equal(outsider.body.error.code, 'DOC_SPACE_NOT_FOUND')
    assert.deepEqual((await mario.get('/docs/export?space=BASTID')).body.data.spaces[0].project, { id: project.id, key: 'PWGS', name: 'Página Web' })

    // módulo: só os espaços que a pessoa lê, pelo nome
    assert.deepEqual((await otto.get(`/docs/export?module=${marketing.id}`)).body.data.spaces.map((s) => s.key), ['WEB'])
    const forMario = (await mario.get(`/docs/export?module=${marketing.id}`)).body.data
    assert.deepEqual(forMario.module, { id: marketing.id, name: 'Marketing', color: 'blue' })
    assert.deepEqual(forMario.spaces.map((s) => s.key), ['BASTID', 'WEB'])

    assert.equal((await otto.get('/docs/export')).body.error.details.fields.space, 'required')
    assert.equal((await otto.get(`/docs/export?space=WEB&module=${marketing.id}`)).status, 400)
    assert.equal((await otto.get('/docs/export?module=naoexiste12345')).body.error.code, 'DOC_MODULE_NOT_FOUND')
  })
})
