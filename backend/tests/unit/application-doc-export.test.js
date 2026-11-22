const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createDocSpaceService } = require('../../src/application/doc-spaces')
const { createDocPageService } = require('../../src/application/doc-pages')
const { createDocModuleService } = require('../../src/application/doc-modules')
const { createDocExportService } = require('../../src/application/doc-export')
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

const doc = (...paragraphs) => ({ type: 'doc', content: paragraphs.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })) })

async function setup() {
  const deps = createFakeDeps()
  const gabi = await seedUser(deps, { roleCode: 'MANAGER', name: 'Gabi' })
  const lia = await seedUser(deps, { roleCode: 'VIEWER', name: 'Lia' })
  const otto = await seedUser(deps, { roleCode: 'MEMBER', name: 'Otto' })
  const project = await deps.projectRepository.create({ name: 'Página Web', key: 'PWGS', ownerId: gabi.id, createdBy: gabi.id, status: 'active', priority: 'medium' })
  await deps.projectMemberRepository.add({ projectId: project.id, userId: gabi.id, role: 'manager' })
  await deps.projectMemberRepository.add({ projectId: project.id, userId: lia.id, role: 'viewer' })
  const ctx = { gabi: await ctxOf(deps, gabi), lia: await ctxOf(deps, lia), otto: await ctxOf(deps, otto) }
  return {
    deps,
    ctx,
    project,
    spaces: createDocSpaceService(deps),
    pages: createDocPageService(deps),
    modules: createDocModuleService(deps),
    exporter: createDocExportService(deps),
  }
}

/** Espaço com: inicial, "Mapa geral" (com "Paraguai" e "Brasil"), "Rascunho" nunca publicado (com o anexo publicado). */
async function webSpace(s, extra) {
  const space = await s.spaces.createSpace(s.ctx.gabi, Object.assign({ key: 'PWGS', name: 'Página Web Grupo Somax', description: 'Relevamento das webs', visibility: 'company' }, extra))
  const publish = async (title, parentId, text) => {
    const created = await s.pages.createPage(s.ctx.gabi, space.id, { title, parent_id: parentId })
    return s.pages.publishPage(s.ctx.gabi, created.id, { title, content: doc(text || title) })
  }
  const mapa = await publish('Mapa geral', null, 'Mapa geral e tecnologia usada')
  const py = await publish('Somax Paraguai', mapa.id, 'Uma página por empresa')
  const br = await publish('Somax Brasil', mapa.id)
  const draft = await s.pages.createPage(s.ctx.gabi, space.id, { title: 'Rascunho' })
  const annex = await publish('Anexo: Catálogo', draft.id)
  return { space, mapa, py, br, draft, annex }
}

describe('application/doc-export', () => {
  it('espaço: páginas publicadas na ordem da árvore, com versão, autor, palavras e o conteúdo publicado', async () => {
    const s = await setup()
    const w = await webSpace(s)
    // rascunho pendente numa página publicada não entra: sai o publicado
    await s.pages.saveDraft(s.ctx.gabi, w.br.id, { title: 'Brasil (novo)', content: doc('ainda não publicado') })

    const result = await s.exporter.exportDocs(s.ctx.lia, { space: 'PWGS' })
    assert.equal(result.module, null)
    assert.equal(result.spaces.length, 1)
    const [space] = result.spaces
    assert.deepEqual([space.key, space.name, space.description, space.project], ['PWGS', 'Página Web Grupo Somax', 'Relevamento das webs', null])
    assert.deepEqual(
      space.pages.map((p) => [p.title, p.depth, p.parent_id]),
      [
        ['Página Web Grupo Somax', 1, null],
        ['Mapa geral', 1, null],
        ['Somax Paraguai', 2, w.mapa.id],
        ['Somax Brasil', 2, w.mapa.id],
        ['Anexo: Catálogo', 1, null],
      ],
    )
    const brasil = space.pages.find((p) => p.id === w.br.id)
    assert.deepEqual(brasil.content, doc('Somax Brasil'))
    assert.equal(brasil.version, 1)
    assert.equal(brasil.published_by.name, 'Gabi')
    assert.ok(brasil.published_at)
    assert.equal(space.pages.find((p) => p.id === w.mapa.id).words, 5)
    assert.equal(space.pages.some((p) => p.title === 'Rascunho'), false)
  })

  it('mesmas regras de leitura: espaço do projeto some para quem não vê o projeto', async () => {
    const s = await setup()
    await webSpace(s, { project_id: s.project.id, visibility: 'project' })
    assert.equal(await codeOf(() => s.exporter.exportDocs(s.ctx.otto, { space: 'PWGS' })), 'DOC_SPACE_NOT_FOUND')
    const seen = await s.exporter.exportDocs(s.ctx.lia, { space: 'PWGS' })
    assert.deepEqual(seen.spaces[0].project, { id: s.project.id, key: 'PWGS', name: 'Página Web' })
    assert.equal(await codeOf(() => s.exporter.exportDocs(s.ctx.lia, { space: 'NADA' })), 'DOC_SPACE_NOT_FOUND')
  })

  it('módulo: os espaços do módulo que a pessoa lê, pelo nome; valida a escolha', async () => {
    const s = await setup()
    const mkt = await s.modules.createModule(s.ctx.gabi, { name: 'Marketing', color: 'blue' })
    const other = await s.modules.createModule(s.ctx.gabi, { name: 'Finanças', color: 'green' })
    await webSpace(s, { module_id: mkt.id })
    await s.spaces.createSpace(s.ctx.gabi, { key: 'CAMP', name: 'Campanhas', visibility: 'company', module_id: mkt.id })
    await s.spaces.createSpace(s.ctx.gabi, { key: 'INTERNO', name: 'Bastidores', visibility: 'project', project_id: s.project.id, module_id: mkt.id })
    await s.spaces.createSpace(s.ctx.gabi, { key: 'FIN', name: 'Contas', visibility: 'company', module_id: other.id })

    const forOtto = await s.exporter.exportDocs(s.ctx.otto, { module: mkt.id })
    assert.deepEqual(forOtto.module, { id: mkt.id, name: 'Marketing', color: 'blue' })
    assert.deepEqual(
      forOtto.spaces.map((sp) => sp.key),
      ['CAMP', 'PWGS'],
    )
    assert.deepEqual(forOtto.spaces[0].module, { id: mkt.id, name: 'Marketing', color: 'blue' })
    assert.deepEqual(
      (await s.exporter.exportDocs(s.ctx.lia, { module: mkt.id })).spaces.map((sp) => sp.key),
      ['INTERNO', 'CAMP', 'PWGS'],
    )

    assert.equal(await codeOf(() => s.exporter.exportDocs(s.ctx.otto, { module: 'naoexiste' })), 'DOC_MODULE_NOT_FOUND')
    assert.equal(await codeOf(() => s.exporter.exportDocs(s.ctx.otto, {})), 'VALIDATION_ERROR:{"space":"required"}')
    assert.equal(await codeOf(() => s.exporter.exportDocs(s.ctx.otto, { space: 'PWGS', module: mkt.id })), 'VALIDATION_ERROR:{"module":"invalid_option"}')
  })

  it('sem docs.view: FORBIDDEN', async () => {
    const s = await setup()
    await webSpace(s)
    const role = await s.deps.roleRepository.findById(s.ctx.otto.principal.roleId)
    const blind = { principal: createPrincipal({ userId: s.ctx.otto.principal.userId, roleId: role.id, roleCode: role.code, permissions: ['projects.view'] }) }
    assert.equal(await codeOf(() => s.exporter.exportDocs(blind, { space: 'PWGS' })), 'FORBIDDEN')
  })
})
