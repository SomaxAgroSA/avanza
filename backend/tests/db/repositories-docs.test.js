const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { createTestDatabase, TEST_STORAGE } = require('../support/db-harness')
const { createStorage } = require('../../src/infrastructure/storage')
const { insertRow } = require('../../src/infrastructure/sql')
const docs = require('../../src/infrastructure/repositories/docs')

describe('repositórios da documentação', () => {
  let t
  let storage
  let spaces
  let pages
  let versions
  let files
  let author
  let project
  let company
  let projectSpace

  const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

  before(async () => {
    t = await createTestDatabase()
    storage = createStorage(Object.assign({}, TEST_STORAGE, { bucket: `avanza-t-${crypto.randomBytes(4).toString('hex')}` }))
    await storage.ensureBucket()
    const ctx = { storage }
    spaces = docs.createDocSpaceRepository(t.db, ctx)
    pages = docs.createDocPageRepository(t.db, ctx)
    versions = docs.createDocPageVersionRepository(t.db, ctx)
    files = docs.createDocFileRepository(t.db, ctx)
    const role = await t.db.one("SELECT id FROM roles WHERE code = 'ADMIN'")
    author = await insertRow(t.db, 'users', { email: 'autora@avanza.test', name: 'Autora', role_id: role.id, status: 'active' })
    project = await insertRow(t.db, 'projects', { name: 'P', key: 'DOC', owner_id: author.id })
  })
  after(async () => {
    await storage.dropBucket()
    await t.drop()
  })

  describe('espaços', () => {
    it('gravam relações vazias como NULL e a página inicial como texto', async () => {
      company = await spaces.create({ key: 'empresa', name: 'Empresa', description: '', icon: 'book', color: 'blue', projectId: null, visibility: 'company', createdBy: author.id })
      assert.equal(company.projectId, null)
      assert.equal(company.homePageId, null)
      assert.equal(company.createdBy, author.id)
      projectSpace = await spaces.create({ key: 'proj', name: 'Ajuda do projeto', description: 'x', icon: 'book', color: 'green', projectId: project.id, visibility: 'project', createdBy: null })
      assert.equal(projectSpace.projectId, project.id)
      assert.equal(projectSpace.createdBy, null)
      assert.equal((await spaces.findByKey('proj')).id, projectSpace.id)
      assert.equal(await spaces.findByKey('nada'), null)
      assert.deepEqual((await spaces.list()).map((s) => s.key), ['proj', 'empresa'])
      await assert.rejects(spaces.create({ key: 'empresa', name: 'Outra', visibility: 'company' }), { code: 'DOC_SPACE_KEY_IN_USE' })
    })
  })

  describe('páginas e versões', () => {
    let home
    let child
    let draft

    it('criam a árvore e listam as linhas enxutas (sem o conteúdo)', async () => {
      const now = new Date('2026-10-20T12:00:00.000Z')
      home = await pages.create({ spaceId: company.id, parentId: null, title: 'Início', position: 0, status: 'published', content: doc('Bem-vindo'), contentText: 'Bem-vindo', searchText: 'inicio bem-vindo', version: 1, publishedAt: now, publishedBy: author.id, createdBy: author.id })
      assert.equal(home.parentId, null)
      assert.deepEqual(home.content, doc('Bem-vindo'))
      assert.equal(home.draft, null)
      assert.equal(home.draftAt, null)
      assert.equal(home.publishedAt.toISOString(), now.toISOString())
      const saved = await spaces.update(company.id, { homePageId: home.id })
      assert.equal(saved.homePageId, home.id)
      child = await pages.create({ spaceId: company.id, parentId: home.id, title: 'Férias', position: 1024, status: 'published', content: doc('Política de férias'), contentText: 'Política de férias', searchText: 'ferias politica de ferias 100%', version: 1, publishedAt: new Date('2026-10-21T12:00:00.000Z'), publishedBy: author.id, createdBy: author.id })
      draft = await pages.create({ spaceId: company.id, parentId: home.id, title: 'Rascunho', position: 2048, status: 'draft', content: null, contentText: '', searchText: '', version: 0, draft: doc('ferias novas'), draftTitle: 'Rascunho', draftBy: author.id, draftAt: new Date(), createdBy: author.id })
      assert.equal(draft.content, null)
      assert.equal(draft.publishedAt, null)
      assert.equal(draft.publishedBy, null)
      const tree = await pages.listTree(company.id)
      assert.deepEqual(tree.map((p) => [p.title, p.parentId, p.position]), [
        ['Início', null, 0],
        ['Férias', home.id, 1024],
        ['Rascunho', home.id, 2048],
      ])
      assert.deepEqual(Object.keys(tree[0]).sort(), ['draftAt', 'id', 'parentId', 'position', 'publishedAt', 'spaceId', 'status', 'title', 'updatedAt'])
      assert.ok(tree[2].draftAt instanceof Date)
      assert.deepEqual(await pages.listTree(projectSpace.id), [])
    })

    it('contam publicadas por espaço (só os que têm)', async () => {
      assert.deepEqual(await pages.countPublishedBySpaces([company.id, projectSpace.id]), { [company.id]: 2 })
      assert.deepEqual(await pages.countPublishedBySpaces([]), {})
    })

    it('atualizam: publicar limpa o rascunho (NULL) e mover troca pai e posição', async () => {
      const published = await pages.update(draft.id, { title: 'Novas férias', content: doc('ferias novas'), contentText: 'ferias novas', searchText: 'novas ferias ferias novas', status: 'published', version: 1, publishedAt: new Date('2026-10-22T12:00:00.000Z'), publishedBy: author.id, draft: null, draftTitle: '', draftBy: null, draftAt: null })
      assert.equal(published.draft, null)
      assert.equal(published.draftBy, null)
      assert.equal(published.draftAt, null)
      assert.equal(published.status, 'published')
      const moved = await pages.update(draft.id, { parentId: null, position: 512.5 })
      assert.equal(moved.parentId, null)
      assert.equal(moved.position, 512.5)
      assert.equal(await pages.update('naoexiste12345', { title: 'x' }), null)
      await pages.renumber([draft.id, home.id])
      const tree = await pages.listTree(company.id)
      assert.deepEqual(tree.filter((p) => !p.parentId).map((p) => [p.title, p.position]), [
        ['Novas férias', 1024],
        ['Início', 2048],
      ])
    })

    it('buscam no texto dobrado das publicadas (mais recentes primeiro, com limite e sem curingas)', async () => {
      const found = await pages.search([company.id, projectSpace.id], 'ferias', 10)
      assert.deepEqual(found.map((p) => p.title), ['Novas férias', 'Férias'])
      assert.deepEqual(Object.keys(found[0]).sort(), ['contentText', 'id', 'publishedAt', 'spaceId', 'title'])
      assert.deepEqual((await pages.search([company.id], 'ferias', 1)).map((p) => p.title), ['Novas férias'])
      assert.deepEqual((await pages.search([company.id], 'FERIAS NOVAS', 10)).map((p) => p.title), ['Novas férias'])
      assert.deepEqual((await pages.search([company.id], '100%', 10)).map((p) => p.title), ['Férias'])
      assert.deepEqual(await pages.search([company.id], '_', 10), [])
      assert.deepEqual(await pages.search([projectSpace.id], 'ferias', 10), [])
      assert.deepEqual(await pages.search([], 'ferias', 10), [])
    })

    it('recentes: publicadas, mais novas primeiro', async () => {
      const list = await pages.recent([company.id], 2)
      assert.deepEqual(list.map((p) => p.title), ['Novas férias', 'Férias'])
      assert.deepEqual(list[0], { id: draft.id, spaceId: company.id, title: 'Novas férias', publishedAt: new Date('2026-10-22T12:00:00.000Z'), publishedBy: author.id })
      assert.equal((await pages.recent([company.id], 10)).length, 3)
    })

    it('versões: gravam o conteúdo, listam sem ele (mais nova primeiro) e recusam número repetido', async () => {
      const v1 = await versions.create({ pageId: child.id, version: 1, title: 'Férias', content: doc('v1'), author: author.id })
      assert.deepEqual(v1.content, doc('v1'))
      await versions.create({ pageId: child.id, version: 2, title: 'Férias 2', content: doc('v2'), author: null })
      const listed = await versions.listByPage(child.id)
      assert.deepEqual(listed.map((v) => [v.version, v.title, v.author, v.content]), [
        [2, 'Férias 2', null, undefined],
        [1, 'Férias', author.id, undefined],
      ])
      assert.deepEqual((await versions.find(child.id, 2)).content, doc('v2'))
      assert.equal(await versions.find(child.id, 3), null)
      await assert.rejects(versions.create({ pageId: child.id, version: 2, title: 'De novo', content: doc('x'), author: author.id }), { code: 'CONFLICT' })
    })
  })

  describe('arquivos', () => {
    it('gravam no Storage com o id do registro na chave e leem de volta', async () => {
      const [home] = await pages.listTree(company.id).then((tree) => tree.filter((p) => p.title === 'Início'))
      const bytes = Buffer.from('\x89PNG imagem de teste')
      const handle = { buffer: bytes, mime: 'image/png', name: 'Captura de Tela 1.PNG', size: bytes.length }
      const file = await files.create({ spaceId: company.id, pageId: home.id, handle, name: 'Captura de Tela 1.PNG', mime: 'image/png', kind: 'image', size: bytes.length, uploadedBy: author.id })
      assert.deepEqual(Object.keys(file).sort(), ['createdAt', 'id', 'kind', 'mime', 'name', 'pageId', 'size', 'spaceId', 'uploadedBy'])
      assert.equal(file.name, 'Captura de Tela 1.PNG')
      assert.equal(file.size, bytes.length)
      assert.deepEqual(await files.findById(file.id), file)
      const key = await files.fileKeyOf(file.id)
      assert.match(key, new RegExp(`^doc_files/${file.id}/captura_de_tela_1_[a-z0-9]{10}\\.png$`))
      assert.deepEqual(await storage.read(key), bytes)
      await assert.rejects(files.fileKeyOf('naoexiste12345'), { code: 'DOC_FILE_NOT_FOUND' })
      assert.equal(await files.findById('naoexiste12345'), null)
    })

    it('apagar páginas leva versões e arquivos (a chave vai para a lixeira do Storage)', async () => {
      const page = await pages.create({ spaceId: company.id, parentId: null, title: 'Temporária', position: 9999, status: 'draft', createdBy: author.id })
      await versions.create({ pageId: page.id, version: 1, title: 'Temporária', content: doc('t'), author: author.id })
      const handle = { buffer: Buffer.from('conteudo'), mime: 'text/plain', name: 'nota.txt', size: 8 }
      const file = await files.create({ spaceId: company.id, pageId: page.id, handle, name: 'nota.txt', mime: 'text/plain', kind: 'file', size: 8, uploadedBy: null })
      assert.equal(file.uploadedBy, null)
      const key = await files.fileKeyOf(file.id)
      await pages.deleteMany([page.id])
      await pages.deleteMany([])
      assert.equal(await pages.findById(page.id), null)
      assert.deepEqual(await versions.listByPage(page.id), [])
      assert.equal(await files.findById(file.id), null)
      assert.ok(await t.db.one('SELECT key FROM storage_trash WHERE key = $1', [key]))
    })

    it('apagar o espaço leva páginas, versões e arquivos', async () => {
      const space = await spaces.create({ key: 'tmp', name: 'Tmp', visibility: 'company', createdBy: author.id })
      const page = await pages.create({ spaceId: space.id, title: 'P', status: 'published', publishedAt: new Date(), createdBy: author.id })
      await versions.create({ pageId: page.id, version: 1, title: 'P', content: null, author: author.id })
      await spaces.delete(space.id)
      assert.equal(await spaces.findById(space.id), null)
      assert.equal(await pages.findById(page.id), null)
      assert.deepEqual(await versions.listByPage(page.id), [])
    })
  })
})
