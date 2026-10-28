/**
 * Documentação (expansão, Onda 2) — testes de API contra um PocketBase real.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, createClient } = require('../support/server-harness')

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 5000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 5000 },
]
/** PNG 1x1 válido. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const paragraph = (value, marks) => ({ type: 'paragraph', content: [marks ? { type: 'text', text: value, marks } : { type: 'text', text: value }] })

describe('API Documentação', { timeout: 180000 }, () => {
  let pb
  let admin
  let mario
  let lia
  let otto
  let project

  before(async () => {
    pb = await startServer()
    await pb.updateSettings({ rateLimits: { enabled: true, rules: RULES } })
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
    const l = await make('Lia', 'lia@example.com', 'VIEWER')
    const o = await make('Otto', 'otto@example.com', 'MEMBER')
    mario = m.client
    lia = l.client
    otto = o.client
    project = (await admin.post('/projects', { name: 'CRM', key: 'CRM' })).body.data
    await admin.post(`/projects/${project.id}/members`, { user_id: m.user.id, role: 'member' })
    await admin.post(`/projects/${project.id}/members`, { user_id: l.user.id, role: 'viewer' })
  })

  after(async () => {
    if (pb) await pb.stop()
  })

  it('espaço, página em rascunho, publicação, versões, restauração e busca sem acento', async () => {
    const space = await admin.post('/docs/spaces', { key: 'MANUAL', name: 'Manuais', description: 'Guias de uso', visibility: 'company' })
    assert.equal(space.status, 201, JSON.stringify(space.body))
    assert.equal((await admin.post('/docs/spaces', { key: 'MANUAL', name: 'Outro', visibility: 'company' })).body.error.code, 'DOC_SPACE_KEY_IN_USE')
    assert.equal((await mario.post('/docs/spaces', { key: 'NOVO', name: 'Novo', visibility: 'company' })).status, 403)

    const page = (await mario.post(`/docs/spaces/${space.body.data.id}/pages`, { title: 'Agenda' })).body.data
    assert.equal(page.status, 'draft')
    // leitor (sem docs.edit) não vê rascunho
    assert.equal((await lia.get(`/docs/pages/${page.id}`)).status, 404)
    const tree = (await mario.get('/docs/spaces/MANUAL')).body.data
    assert.ok(tree.pages.some((p) => p.id === page.id && p.has_draft))

    const unsafe = { type: 'doc', content: [paragraph('Veja', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]), paragraph('O cadastro exige a validação do CNPJ.')] }
    assert.equal((await mario.put(`/docs/pages/${page.id}/draft`, { title: 'Agenda', content: unsafe })).status, 200)
    const draft = (await mario.get(`/docs/pages/${page.id}/draft`)).body.data
    assert.equal(draft.content.content[0].content[0].marks, undefined)
    const published = await mario.post(`/docs/pages/${page.id}/publish`, {})
    assert.equal(published.status, 200, JSON.stringify(published.body))
    assert.equal(published.body.data.version, 1)
    assert.equal((await otto.get(`/docs/pages/${page.id}`)).body.data.title, 'Agenda')

    await mario.post(`/docs/pages/${page.id}/publish`, { title: 'Agenda', content: { type: 'doc', content: [paragraph('Segunda versão')] } })
    const versions = (await lia.get(`/docs/pages/${page.id}/versions`)).body.data
    assert.deepEqual(versions.map((v) => v.version), [2, 1])
    const restored = (await mario.post(`/docs/pages/${page.id}/versions/1/restore`)).body.data
    assert.equal(restored.version, 3)
    assert.match(JSON.stringify(restored.content), /validação do CNPJ/)

    const results = (await otto.get('/docs/search?q=VALIDACAO')).body.data
    assert.deepEqual(results.map((r) => r.title), ['Agenda'])
    assert.match(results[0].snippet, /validação do CNPJ/)
    assert.ok((await otto.get('/docs/recent')).body.data.some((r) => r.page_id === page.id))
    const spaces = (await otto.get('/docs/spaces')).body.data
    assert.equal(spaces.find((x) => x.key === 'MANUAL').page_count, 2)
  })

  it('árvore: mover sem ciclo, excluir com subpáginas; inicial protegida', async () => {
    const space = (await admin.post('/docs/spaces', { key: 'ARVORE', name: 'Árvore', visibility: 'company' })).body.data
    const create = (title, parent) => mario.post(`/docs/spaces/${space.id}/pages`, { title, parent_id: parent }).then((r) => r.body.data)
    const a = await create('A')
    const b = await create('B', a.id)
    const c = await create('C')
    assert.equal((await mario.put(`/docs/pages/${a.id}/move`, { parent_id: b.id })).body.error.code, 'DOC_PAGE_CYCLE')
    const moved = await mario.put(`/docs/pages/${c.id}/move`, { parent_id: null, next_id: a.id })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    const roots = (await mario.get('/docs/spaces/ARVORE')).body.data.pages.filter((p) => !p.parent_id && !p.is_home).map((p) => p.title)
    assert.deepEqual(roots, ['C', 'A'])
    assert.equal((await mario.del(`/docs/pages/${a.id}`)).body.data.deleted, 2)
    assert.equal((await admin.del(`/docs/pages/${space.home_page_id}`)).body.error.code, 'DOC_PAGE_IS_HOME')
  })

  it('espaço do projeto e arquivos: imagem pelo conteúdo, download para quem vê; fora do projeto não', async () => {
    const space = (await admin.post('/docs/spaces', { key: 'CRMDOC', name: 'Docs do CRM', project_id: project.id, visibility: 'project' })).body.data
    assert.ok(!(await otto.get('/docs/spaces')).body.data.some((x) => x.key === 'CRMDOC'))
    assert.equal((await otto.get('/docs/spaces/CRMDOC')).status, 404)
    const page = (await mario.post(`/docs/spaces/${space.id}/pages`, { title: 'Tela de agenda' })).body.data

    const form = new FormData()
    form.append('files', new Blob([PNG], { type: 'image/png' }), 'tela.png')
    const upload = await mario.post(`/docs/pages/${page.id}/files`, form)
    assert.equal(upload.status, 201, JSON.stringify(upload.body))
    const file = upload.body.data[0]
    assert.equal(file.url, `/api/v1/docs/files/${file.id}`)

    const fake = new FormData()
    fake.append('files', new Blob([Buffer.from('<html>')], { type: 'image/png' }), 'fake.png')
    assert.equal((await mario.post(`/docs/pages/${page.id}/files`, fake)).body.error.details.fields.files, 'type_mismatch')

    await mario.post(`/docs/pages/${page.id}/publish`, { title: 'Tela de agenda', content: { type: 'doc', content: [{ type: 'image', attrs: { src: file.url, alt: 'Agenda' } }] } })
    const download = await lia.get(`/docs/files/${file.id}`, { raw: true })
    assert.equal(download.status, 200)
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(download.bytes, PNG)
    assert.equal((await otto.get(`/docs/files/${file.id}`, { raw: true })).status, 404)
  })
})
