const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createDocSpaceService } = require('../../src/application/doc-spaces')
const { createDocPageService } = require('../../src/application/doc-pages')
const { createPrincipal } = require('../../src/domain/rbac')

async function ctxOf(deps, user) {
  const role = await deps.roleRepository.findById(user.roleId)
  return {
    principal: createPrincipal({ userId: user.id, roleId: role.id, roleCode: role.code, permissions: await deps.roleRepository.getPermissionCodes(role.id) }),
    ip: '1.1.1.1',
    userAgent: 'ua',
    correlationId: 'c',
  }
}

async function codeOf(fn) {
  try {
    await fn()
  } catch (err) {
    return err.code === 'VALIDATION_ERROR' ? `${err.code}:${JSON.stringify(err.details.fields)}` : err.code
  }
  return 'OK'
}

const text = (value) => ({ type: 'text', text: value })
const doc = (...paragraphs) => ({ type: 'doc', content: paragraphs.map((p) => ({ type: 'paragraph', content: [text(p)] })) })
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

async function setup() {
  const deps = createFakeDeps()
  const gabi = await seedUser(deps, { roleCode: 'MANAGER', name: 'Gabi' })
  const mario = await seedUser(deps, { roleCode: 'MEMBER', name: 'Mário' })
  const lia = await seedUser(deps, { roleCode: 'VIEWER', name: 'Lia' })
  const otto = await seedUser(deps, { roleCode: 'MEMBER', name: 'Otto' })
  const project = await deps.projectRepository.create({ name: 'CRM', key: 'CRM', ownerId: gabi.id, createdBy: gabi.id, status: 'active', priority: 'medium' })
  for (const [u, role] of [
    [gabi, 'manager'],
    [mario, 'member'],
    [lia, 'viewer'],
  ]) {
    await deps.projectMemberRepository.add({ projectId: project.id, userId: u.id, role })
  }
  const ctx = { gabi: await ctxOf(deps, gabi), mario: await ctxOf(deps, mario), lia: await ctxOf(deps, lia), otto: await ctxOf(deps, otto) }
  return { deps, ctx, project, spaces: createDocSpaceService(deps), pages: createDocPageService(deps) }
}

describe('application/doc-spaces', () => {
  it('gestor cria espaço da empresa com página inicial publicada; membro não cria', async () => {
    const s = await setup()
    const space = await s.spaces.createSpace(s.ctx.gabi, { key: 'MANUAL', name: 'Manuais', description: 'Guias de uso', icon: 'book', color: 'blue', visibility: 'company' })
    assert.equal(space.key, 'MANUAL')
    assert.ok(space.home_page_id)
    const home = await s.pages.getPage(s.ctx.otto, space.home_page_id)
    assert.deepEqual([home.title, home.status, home.version], ['Manuais', 'published', 1])
    assert.equal(await codeOf(() => s.spaces.createSpace(s.ctx.mario, { key: 'OUTRO', name: 'Outro', visibility: 'company' })), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.spaces.createSpace(s.ctx.gabi, { key: 'MANUAL', name: 'Repetido', visibility: 'company' })), 'DOC_SPACE_KEY_IN_USE')
    assert.equal(await codeOf(() => s.spaces.createSpace(s.ctx.gabi, { key: 'manual', name: 'X', visibility: 'company' })), 'VALIDATION_ERROR:{"key":"invalid_format"}')
    // qualquer pessoa com docs.view lê espaço da empresa
    assert.deepEqual((await s.spaces.listSpaces(s.ctx.otto)).map((x) => x.key), ['MANUAL'])
    const audit = s.deps.store.audit.find((e) => e.action === 'doc_space.created')
    assert.equal(audit.entityType, 'doc_space')
  })

  it('espaço só do projeto: fora do projeto não enxerga; leitor lê; membro edita; só gestor configura', async () => {
    const s = await setup()
    const space = await s.spaces.createSpace(s.ctx.gabi, { key: 'CRMDOC', name: 'Docs do CRM', project_id: s.project.id, visibility: 'project' })
    assert.deepEqual(await s.spaces.listSpaces(s.ctx.otto), [])
    assert.equal(await codeOf(() => s.spaces.getSpace(s.ctx.otto, 'CRMDOC')), 'DOC_SPACE_NOT_FOUND')
    assert.deepEqual((await s.spaces.getSpace(s.ctx.lia, 'CRMDOC')).capabilities, { edit: false, manage: false })
    assert.deepEqual((await s.spaces.getSpace(s.ctx.mario, 'CRMDOC')).capabilities, { edit: true, manage: false })
    assert.equal(await codeOf(() => s.spaces.updateSpace(s.ctx.mario, space.id, { name: 'X' })), 'FORBIDDEN')
    const updated = await s.spaces.updateSpace(s.ctx.gabi, space.id, { name: 'Documentação do CRM', visibility: 'company' })
    assert.equal(updated.visibility, 'company')
    assert.deepEqual((await s.spaces.listSpaces(s.ctx.otto)).map((x) => x.key), ['CRMDOC'])
    assert.equal(await codeOf(() => s.spaces.createSpace(s.ctx.gabi, { key: 'SEMPROJ', name: 'X', visibility: 'project' })), 'VALIDATION_ERROR:{"visibility":"project_required"}')
  })
})

describe('application/doc-pages', () => {
  async function withSpace() {
    const s = await setup()
    const space = await s.spaces.createSpace(s.ctx.gabi, { key: 'MANUAL', name: 'Manuais', visibility: 'company' })
    return Object.assign(s, { space })
  }

  it('página nova é rascunho (só quem edita vê); publicar cria a versão 1; rascunho novo não aparece até publicar', async () => {
    const s = await withSpace()
    const page = await s.pages.createPage(s.ctx.mario, s.space.id, { title: 'Agenda', parent_id: null })
    assert.equal(page.status, 'draft')
    assert.ok(!(await s.spaces.getSpace(s.ctx.lia, 'MANUAL')).pages.some((p) => p.id === page.id))
    assert.ok((await s.spaces.getSpace(s.ctx.mario, 'MANUAL')).pages.some((p) => p.id === page.id))
    assert.equal(await codeOf(() => s.pages.getPage(s.ctx.lia, page.id)), 'DOC_PAGE_NOT_FOUND')

    await s.pages.saveDraft(s.ctx.mario, page.id, { title: 'Agenda', content: doc('Será visualizado a agenda por dia.') })
    const published = await s.pages.publishPage(s.ctx.mario, page.id, {})
    assert.deepEqual([published.status, published.version], ['published', 1])
    assert.match(JSON.stringify((await s.pages.getPage(s.ctx.lia, page.id)).content), /agenda por dia/)

    // editar de novo: o leitor continua vendo a versão publicada
    await s.pages.saveDraft(s.ctx.mario, page.id, { title: 'Agenda (revisada)', content: doc('Nova regra de semana.') })
    const reader = await s.pages.getPage(s.ctx.lia, page.id)
    assert.equal(reader.title, 'Agenda')
    assert.equal(reader.draft, null)
    const editor = await s.pages.getPage(s.ctx.mario, page.id)
    assert.equal(editor.draft.by.name, 'Mário')
    assert.equal((await s.pages.getDraft(s.ctx.mario, page.id)).title, 'Agenda (revisada)')
    const v2 = await s.pages.publishPage(s.ctx.mario, page.id, {})
    assert.deepEqual([v2.version, v2.title], [2, 'Agenda (revisada)'])
    assert.equal((await s.pages.getPage(s.ctx.mario, page.id)).draft, null)
    const actions = s.deps.store.audit.filter((e) => e.entityId === page.id).map((e) => e.action)
    assert.deepEqual(actions, ['doc_page.created', 'doc_page.published', 'doc_page.published'])
  })

  it('conteúdo é higienizado ao salvar; leitor não edita', async () => {
    const s = await withSpace()
    const page = await s.pages.createPage(s.ctx.mario, s.space.id, { title: 'Links' })
    const bad = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] }
    await s.pages.saveDraft(s.ctx.mario, page.id, { title: 'Links', content: bad })
    assert.equal((await s.pages.getDraft(s.ctx.mario, page.id)).content.content[0].content[0].marks, undefined)
    assert.equal(await codeOf(() => s.pages.saveDraft(s.ctx.mario, page.id, { title: 'X', content: { type: 'script' } })), 'VALIDATION_ERROR:{"content":"invalid_content"}')
    assert.equal(await codeOf(() => s.pages.saveDraft(s.ctx.mario, page.id, { title: '', content: null })), 'VALIDATION_ERROR:{"title":"required"}')
    assert.equal(await codeOf(() => s.pages.createPage(s.ctx.lia, s.space.id, { title: 'X' })), 'FORBIDDEN')
  })

  it('versões: lista, abre uma antiga e restaura (vira a próxima versão)', async () => {
    const s = await withSpace()
    const page = await s.pages.createPage(s.ctx.mario, s.space.id, { title: 'Regras' })
    await s.pages.publishPage(s.ctx.mario, page.id, { title: 'Regras', content: doc('Versão um') })
    await s.pages.publishPage(s.ctx.mario, page.id, { title: 'Regras', content: doc('Versão dois') })
    assert.deepEqual((await s.pages.listVersions(s.ctx.lia, page.id)).map((v) => v.version), [2, 1])
    assert.match(JSON.stringify((await s.pages.getVersion(s.ctx.lia, page.id, 1)).content), /Versão um/)
    const restored = await s.pages.restoreVersion(s.ctx.mario, page.id, 1)
    assert.equal(restored.version, 3)
    assert.match(JSON.stringify(restored.content), /Versão um/)
    assert.equal(await codeOf(() => s.pages.getVersion(s.ctx.lia, page.id, 9)), 'DOC_VERSION_NOT_FOUND')
    assert.ok(s.deps.store.audit.some((e) => e.action === 'doc_page.restored' && e.newValue.from_version === 1))
  })

  it('árvore: subpáginas, mover sem ciclo, ordem entre irmãs; excluir leva as subpáginas; a inicial não sai', async () => {
    const s = await withSpace()
    const a = await s.pages.createPage(s.ctx.mario, s.space.id, { title: 'A' })
    const b = await s.pages.createPage(s.ctx.mario, s.space.id, { title: 'B', parent_id: a.id })
    const c = await s.pages.createPage(s.ctx.mario, s.space.id, { title: 'C', parent_id: b.id })
    const d = await s.pages.createPage(s.ctx.mario, s.space.id, { title: 'D' })
    assert.equal(await codeOf(() => s.pages.movePage(s.ctx.mario, a.id, { parent_id: c.id })), 'DOC_PAGE_CYCLE')
    // D antes de A, na raiz
    await s.pages.movePage(s.ctx.mario, d.id, { parent_id: null, next_id: a.id })
    const roots = (await s.spaces.getSpace(s.ctx.mario, 'MANUAL')).pages
      .filter((p) => !p.parent_id && !p.is_home)
      .map((p) => p.title)
    assert.deepEqual(roots, ['D', 'A'])
    // C sobe para dentro de D
    const moved = await s.pages.movePage(s.ctx.mario, c.id, { parent_id: d.id })
    assert.equal(moved.parent_id, d.id)
    assert.deepEqual((await s.pages.getPage(s.ctx.mario, c.id)).ancestors.map((x) => x.title), ['D'])
    assert.equal((await s.pages.deletePage(s.ctx.mario, a.id)).deleted, 2)
    assert.equal(await codeOf(() => s.pages.getPage(s.ctx.mario, b.id)), 'DOC_PAGE_NOT_FOUND')
    assert.equal(await codeOf(() => s.pages.deletePage(s.ctx.gabi, s.space.home_page_id)), 'DOC_PAGE_IS_HOME')
  })

  it('busca sem acento, só no publicado e nos espaços visíveis; recentes', async () => {
    const s = await withSpace()
    const page = await s.pages.createPage(s.ctx.mario, s.space.id, { title: 'Parceiros' })
    await s.pages.publishPage(s.ctx.mario, page.id, { title: 'Parceiros', content: doc('O cadastro exige a validação do CNPJ antes de salvar.') })
    const draftOnly = await s.pages.createPage(s.ctx.mario, s.space.id, { title: 'Rascunho secreto' })
    await s.pages.saveDraft(s.ctx.mario, draftOnly.id, { title: 'Rascunho secreto', content: doc('validacao interna') })
    const results = await s.pages.search(s.ctx.otto, { q: 'VALIDACAO' })
    assert.deepEqual(results.map((r) => r.title), ['Parceiros'])
    assert.match(results[0].snippet, /validação do CNPJ/)
    assert.equal(results[0].space.key, 'MANUAL')
    // título também conta
    assert.deepEqual((await s.pages.search(s.ctx.otto, { q: 'parcei' })).map((r) => r.title), ['Parceiros'])
    assert.equal(await codeOf(() => s.pages.search(s.ctx.otto, { q: 'a' })), 'VALIDATION_ERROR:{"q":"too_short"}')
    assert.ok((await s.pages.recent(s.ctx.otto)).some((r) => r.title === 'Parceiros'))
  })

  it('arquivos da página: imagem validada pelo conteúdo; quem lê baixa; de fora não', async () => {
    const s = await setup()
    const space = await s.spaces.createSpace(s.ctx.gabi, { key: 'CRMDOC', name: 'Docs do CRM', project_id: s.project.id, visibility: 'project' })
    const page = await s.pages.createPage(s.ctx.mario, space.id, { title: 'Tela' })
    const [file] = await s.pages.uploadFiles(s.ctx.mario, page.id, [{ name: 'tela.png', size: 1200, head: PNG, handle: {} }])
    assert.equal(file.kind, 'image')
    assert.equal(file.url, `/api/v1/docs/files/${file.id}`)
    assert.equal(await codeOf(() => s.pages.uploadFiles(s.ctx.mario, page.id, [{ name: 'tela.png', size: 10, head: [0x3c, 0x68], handle: {} }])), 'VALIDATION_ERROR:{"files":"type_mismatch"}')
    // rascunho: leitor ainda não baixa; depois de publicar, sim
    assert.equal(await codeOf(() => s.pages.fileFor(s.ctx.lia, file.id)), 'DOC_FILE_NOT_FOUND')
    await s.pages.publishPage(s.ctx.mario, page.id, { title: 'Tela', content: { type: 'doc', content: [{ type: 'image', attrs: { src: file.url } }] } })
    assert.equal((await s.pages.fileFor(s.ctx.lia, file.id)).id, file.id)
    assert.equal(await codeOf(() => s.pages.fileFor(s.ctx.otto, file.id)), 'DOC_FILE_NOT_FOUND')
  })
})
