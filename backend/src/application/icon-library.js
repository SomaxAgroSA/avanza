/**
 * Biblioteca de ícones da plataforma (regras de negócio §25): quem tem `settings.manage` importa ícones da
 * galeria (Lucide) e remove os que ninguém usa; todos os autenticados veem a lista (os seletores de ícone
 * mostram os padrões do lugar + a biblioteca).
 *
 * Porta: `iconLibraryRepository` { list, exists(name), addMany(names, userId) → nomes novos,
 * remove(name), usage(names) → { [name]: { projects, task_types, doc_spaces } } }.
 */

const { appError } = require('../core/errors')
const rbac = require('../domain/rbac')
const iconDomain = require('../domain/icons')
const { buildAuditEntry } = require('./audit')
const { iso, toUserSummary } = require('./presenters')

const PERMISSION = 'settings.manage'
const ENTITY = 'icon_library'
const ENTITY_ID = 'library'
const NO_USE = { projects: 0, task_types: 0, doc_spaces: 0 }

function invalid(fields) {
  return appError('VALIDATION_ERROR', undefined, { fields })
}

/**
 * Ícone escolhido num projeto, tipo ou espaço: padrão do lugar, o que o item já tinha ou um da biblioteca.
 * O formato já passou por domain/icons.js#iconRule.
 */
async function assertIconAvailable(deps, icon, builtins, current) {
  if (!icon || icon === current || builtins.indexOf(icon) >= 0) return
  if (!(await deps.iconLibraryRepository.exists(icon))) throw invalid({ icon: 'invalid_option' })
}

function createIconLibraryService(deps) {
  const icons = deps.iconLibraryRepository

  async function present(list) {
    const usage = list.length ? await icons.usage(list.map((icon) => icon.name)) : {}
    const ids = list.map((icon) => icon.createdBy).filter((id, i, all) => id && all.indexOf(id) === i)
    const users = {}
    if (ids.length) (await deps.userRepository.findManyByIds(ids)).forEach((u) => (users[u.id] = u))
    return list.map((icon) => ({
      name: icon.name,
      created_at: iso(icon.createdAt),
      created_by: icon.createdBy && users[icon.createdBy] ? toUserSummary(users[icon.createdBy]) : null,
      usage: Object.assign({}, NO_USE, usage[icon.name] || {}),
    }))
  }

  async function list(ctx) {
    rbac.assertAuthenticated(ctx.principal)
    return present(await icons.list())
  }

  /** `{ names }`: até 60 por vez; os que já estão na biblioteca são ignorados. */
  async function importIcons(ctx, input) {
    rbac.assertCan(ctx.principal, PERMISSION)
    const names = input && Array.isArray(input.names) ? input.names : null
    if (!names || names.length === 0) throw invalid({ names: 'required' })
    if (names.length > iconDomain.MAX_IMPORT) throw invalid({ names: 'too_many' })
    names.forEach((name, index) => {
      const issue = iconDomain.iconNameIssue(name)
      if (issue) throw appError('VALIDATION_ERROR', undefined, { fields: { names: issue }, index })
    })
    const unique = names.filter((name, i) => names.indexOf(name) === i)
    await deps.unitOfWork.run(async (repos) => {
      const added = await repos.iconLibraryRepository.addMany(unique, ctx.principal.userId)
      if (added.length) {
        await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: ENTITY, entityId: ENTITY_ID, action: 'icon_library.imported', newValue: { icons: added.join(', ') } }))
      }
    })
    return list(ctx)
  }

  /** Só sai da biblioteca o ícone que nenhum projeto, tipo ou espaço usa (ICON_IN_USE com as contagens). */
  async function removeIcon(ctx, name) {
    rbac.assertCan(ctx.principal, PERMISSION)
    if (!name || !(await icons.exists(name))) throw appError('ICON_NOT_FOUND')
    const usage = Object.assign({}, NO_USE, (await icons.usage([name]))[name] || {})
    if (usage.projects + usage.task_types + usage.doc_spaces > 0) throw appError('ICON_IN_USE', undefined, usage)
    await deps.unitOfWork.run(async (repos) => {
      await repos.iconLibraryRepository.remove(name)
      await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: ENTITY, entityId: ENTITY_ID, action: 'icon_library.removed', oldValue: { icons: name } }))
    })
    return { removed: true }
  }

  return { list, importIcons, removeIcon }
}

module.exports = { createIconLibraryService, assertIconAvailable }
