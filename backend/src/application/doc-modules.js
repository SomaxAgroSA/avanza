/**
 * Módulos da documentação (regras de negócio §43): lista da empresa para organizar os espaços.
 * - Listar: `docs.view`; cada módulo traz quantos espaços a pessoa vê nele.
 * - Criar, renomear, trocar a cor, reordenar e excluir: `docs.manage`.
 * - Excluir não apaga espaço: os espaços do módulo ficam "Sem módulo".
 * - Auditoria: doc_module.created/updated/deleted (a exclusão grava quantos espaços saíram do módulo).
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const rbac = require('../domain/rbac')
const modulesDomain = require('../domain/doc-modules')
const { OPTION_COLORS } = require('../domain/custom-field')
const { buildAuditEntry, diff } = require('./audit')
const { iso } = require('./presenters')
const { createDocAccess } = require('./doc-access')

const RULES = {
  name: [rules.required(), rules.string(), rules.maxLength(modulesDomain.MODULE_NAME_MAX)],
  // paleta fixa (sem cor livre): o módulo é uma etiqueta da tela inicial
  color: [rules.oneOf(OPTION_COLORS)],
  position: [rules.custom((value) => modulesDomain.positionIssue(value))],
}

function createDocModuleService(deps) {
  const modules = deps.docModuleRepository
  const access = createDocAccess(deps)

  function present(item, spaceCount) {
    return {
      id: item.id,
      name: item.name,
      color: item.color || 'blue',
      position: item.position || 0,
      space_count: spaceCount || 0,
      created_at: iso(item.createdAt),
      updated_at: iso(item.updatedAt),
    }
  }

  function assertManager(ctx) {
    rbac.assertAuthenticated(ctx.principal)
    rbac.assertCan(ctx.principal, 'docs.manage')
  }

  async function load(id) {
    const item = typeof id === 'string' && id ? await modules.findById(id) : null
    if (!item) throw appError('DOC_MODULE_NOT_FOUND')
    return item
  }

  /** Nome livre (outro módulo não pode ter a mesma chave). */
  async function assertNameFree(name, currentId) {
    const key = modulesDomain.nameKey(name)
    const taken = (await modules.list()).some((m) => m.id !== currentId && modulesDomain.nameKey(m.name) === key)
    if (taken) throw appError('DOC_MODULE_NAME_IN_USE')
    return key
  }

  /** Espaços que a pessoa vê, contados por módulo. */
  async function visibleCounts(ctx) {
    const counts = {}
    for (const item of await access.readableSpaces(ctx)) {
      if (item.space.moduleId) counts[item.space.moduleId] = (counts[item.space.moduleId] || 0) + 1
    }
    return counts
  }

  async function audit(repos, ctx, entityId, action, oldValue, newValue) {
    await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'doc_module', entityId, action, oldValue, newValue }))
  }

  async function listModules(ctx) {
    rbac.assertAuthenticated(ctx.principal)
    rbac.assertCan(ctx.principal, 'docs.view')
    const counts = await visibleCounts(ctx)
    return modulesDomain.sortModules(await modules.list()).map((m) => present(m, counts[m.id]))
  }

  async function createModule(ctx, input) {
    assertManager(ctx)
    const data = assertValid(input || {}, { name: RULES.name, color: RULES.color })
    const nameKey = await assertNameFree(data.name)
    const last = modulesDomain.sortModules(await modules.list()).pop()
    const position = last ? (last.position || 0) + 1 : 0
    const created = await deps.unitOfWork.run(async (repos) => {
      const item = await repos.docModuleRepository.create({ name: data.name, nameKey, color: data.color || 'blue', position, createdBy: ctx.principal.userId })
      await audit(repos, ctx, item.id, 'doc_module.created', null, { name: item.name, color: item.color })
      return item
    })
    return present(created, 0)
  }

  async function updateModule(ctx, id, input) {
    assertManager(ctx)
    const item = await load(id)
    const source = input || {}
    const schema = {}
    Object.keys(RULES).forEach((key) => {
      if (source[key] !== undefined) schema[key] = RULES[key]
    })
    const data = assertValid(source, schema)
    const patch = {}
    if (data.name !== undefined && data.name !== item.name) {
      patch.name = data.name
      patch.nameKey = await assertNameFree(data.name, item.id)
    }
    if (data.color !== undefined && data.color !== item.color) patch.color = data.color
    const change = diff({ name: item.name, color: item.color }, { name: patch.name, color: patch.color }, ['name', 'color'])
    const oldValue = Object.assign({}, change ? change.oldValue : {})
    const newValue = Object.assign({}, change ? change.newValue : {})
    let order = null
    if (data.position !== undefined) {
      const list = await modules.list()
      const current = modulesDomain.sortModules(list).map((m) => m.id)
      const next = modulesDomain.reorder(list, item.id, data.position)
      if (next.join() !== current.join()) {
        order = next
        oldValue.position = current.indexOf(item.id)
        newValue.position = next.indexOf(item.id)
      }
    }
    if (!change && !order) return present(item, (await visibleCounts(ctx))[item.id])
    await deps.unitOfWork.run(async (repos) => {
      if (Object.keys(patch).length > 0) await repos.docModuleRepository.update(item.id, patch)
      if (order) await repos.docModuleRepository.setPositions(order)
      await audit(repos, ctx, item.id, 'doc_module.updated', oldValue, newValue)
    })
    return present(await modules.findById(item.id), (await visibleCounts(ctx))[item.id])
  }

  async function deleteModule(ctx, id) {
    assertManager(ctx)
    const item = await load(id)
    const moved = await deps.unitOfWork.run(async (repos) => {
      const spaces = await repos.docSpaceRepository.clearModule(item.id)
      await repos.docModuleRepository.delete(item.id)
      await audit(repos, ctx, item.id, 'doc_module.deleted', { name: item.name, color: item.color, spaces }, null)
      return spaces
    })
    return { deleted: true, spaces: moved }
  }

  return { listModules, createModule, updateModule, deleteModule }
}

module.exports = { createDocModuleService }
