const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createIconLibraryService } = require('../../src/application/icon-library')
const { createProjectService } = require('../../src/application/projects')
const { createTaskTypeService } = require('../../src/application/task-types')
const { createDocSpaceService } = require('../../src/application/doc-spaces')
const { createPrincipal } = require('../../src/domain/rbac')
const { iconNameIssue, iconRule } = require('../../src/domain/icons')

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

async function setup() {
  const deps = createFakeDeps()
  const admin = await seedUser(deps, { roleCode: 'ADMIN', name: 'Admin' })
  const member = await seedUser(deps, { roleCode: 'MEMBER', name: 'Mário' })
  return { deps, admin: await ctxOf(deps, admin), member: await ctxOf(deps, member), icons: createIconLibraryService(deps) }
}

describe('domain/icons', () => {
  it('nome do Lucide: minúsculas, números e hífens; padrão do lugar sempre vale', () => {
    assert.equal(iconNameIssue('file-spreadsheet'), null)
    assert.equal(iconNameIssue('a-arrow-down'), null)
    for (const bad of ['File', 'tractor ', '-x', 'x--y', 'x_y', '../x', 'a'.repeat(65)]) assert.equal(iconNameIssue(bad), 'invalid_format', bad)
    assert.equal(iconNameIssue(''), 'required')
    assert.deepEqual(iconRule(['chart'])('chart'), { value: 'chart' })
    assert.deepEqual(iconRule(['chart'])('<svg>'), { error: 'invalid_option' })
  })
})

describe('application/icon-library', () => {
  it('importa da galeria (settings.manage), ignora repetidos, lista para todos e registra no histórico', async () => {
    const { deps, admin, member, icons } = await setup()
    assert.equal(await codeOf(() => icons.importIcons(member, { names: ['tractor'] })), 'FORBIDDEN')
    const list = await icons.importIcons(admin, { names: ['tractor', 'sprout', 'tractor'] })
    assert.deepEqual(list.map((i) => i.name).sort(), ['sprout', 'tractor'])
    assert.equal(list[0].created_by.name, 'Admin')
    assert.deepEqual(list[0].usage, { projects: 0, task_types: 0, doc_spaces: 0 })
    assert.deepEqual(deps.store.audit.at(-1).newValue, { icons: 'tractor, sprout' })

    // de novo: nada novo, nada no histórico
    const before = deps.store.audit.length
    await icons.importIcons(admin, { names: ['sprout'] })
    assert.equal(deps.store.audit.length, before)
    assert.equal((await icons.list(member)).length, 2)

    assert.equal(await codeOf(() => icons.importIcons(admin, { names: [] })), 'VALIDATION_ERROR:{"names":"required"}')
    assert.equal(await codeOf(() => icons.importIcons(admin, { names: ['Tractor'] })), 'VALIDATION_ERROR:{"names":"invalid_format"}')
    assert.equal(await codeOf(() => icons.importIcons(admin, { names: Array.from({ length: 61 }, (_, i) => `x${i}`) })), 'VALIDATION_ERROR:{"names":"too_many"}')
  })

  it('projeto, tipo de tarefa e espaço aceitam o padrão do lugar ou um ícone da biblioteca; remover só o que ninguém usa', async () => {
    const { deps, admin, icons } = await setup()
    const projects = createProjectService(deps)
    const types = createTaskTypeService(deps)
    const spaces = createDocSpaceService(deps)

    // fora da biblioteca: recusado
    assert.equal(await codeOf(() => projects.createProject(admin, { name: 'Fazenda', key: 'FAZ', icon: 'tractor' })), 'VALIDATION_ERROR:{"icon":"invalid_option"}')
    await icons.importIcons(admin, { names: ['tractor', 'sprout'] })

    const project = await projects.createProject(admin, { name: 'Fazenda', key: 'FAZ', icon: 'tractor' })
    assert.equal(project.icon, 'tractor')
    const type = await types.createType(admin, { key: 'COLHEITA', name: 'Colheita', icon: 'sprout', color: 'green' })
    assert.equal(type.icon, 'sprout')
    const space = await spaces.createSpace(admin, { key: 'AGRO', name: 'Agro', visibility: 'company', icon: 'tractor' })
    assert.equal(space.icon, 'tractor')
    // padrão continua valendo
    assert.equal((await projects.updateProject(admin, project.id, { icon: 'rocket' })).icon, 'rocket')

    const usage = (await icons.list(admin)).find((i) => i.name === 'tractor').usage
    assert.deepEqual(usage, { projects: 0, task_types: 0, doc_spaces: 1 })
    const err = await icons.removeIcon(admin, 'tractor').catch((e) => e)
    assert.equal(err.code, 'ICON_IN_USE')
    assert.deepEqual(err.details, { projects: 0, task_types: 0, doc_spaces: 1 })

    await spaces.updateSpace(admin, space.id, { icon: 'book' })
    assert.deepEqual(await icons.removeIcon(admin, 'tractor'), { removed: true })
    assert.equal(deps.store.audit.at(-1).action, 'icon_library.removed')
    assert.equal(await codeOf(() => icons.removeIcon(admin, 'tractor')), 'ICON_NOT_FOUND')
    assert.equal(await codeOf(() => projects.updateProject(admin, project.id, { icon: 'tractor' })), 'VALIDATION_ERROR:{"icon":"invalid_option"}')
  })
})
