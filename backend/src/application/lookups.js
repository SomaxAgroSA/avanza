/**
 * Casos de uso de status e prioridades de tarefas e das áreas responsáveis.
 *
 * Um único serviço atende às três listas (`kind` = 'status' | 'priority' | 'area'): as regras são as mesmas
 * (ver domain/workflow.js); só o status tem categoria e a área não tem padrão (`is_default` não se aplica).
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const rbac = require('../domain/rbac')
const cf = require('../domain/custom-field')
const { colorRule } = require('../domain/color')
const workflow = require('../domain/workflow')
const { buildAuditEntry, diff } = require('./audit')
const { iso } = require('./presenters')
const { READ_PERMISSIONS } = require('./custom-fields')

const keyRule = rules.custom((value) => (typeof value !== 'string' ? 'invalid_type' : cf.typeKeyIssue(cf.normalizeTypeKey(value))))

function invalid(field, code) {
  return appError('VALIDATION_ERROR', undefined, { fields: { [field]: code } })
}

function createLookupService(deps, kind) {
  const spec = workflow.LOOKUP_KINDS[kind]
  if (!spec) throw new Error(`Unknown lookup kind: ${kind}`)
  const repository = () => deps[spec.repository]

  const fieldRules = {
    name: [rules.required(), rules.maxLength(60)],
    description: [rules.maxLength(255)],
    color: [colorRule(cf.OPTION_COLORS)],
    is_active: [rules.boolean()],
    is_default: [rules.boolean()],
  }
  if (spec.noDefault) delete fieldRules.is_default
  if (spec.hasCategory) {
    fieldRules.category = [rules.required(), rules.oneOf(workflow.STATUS_CATEGORIES)]
    // Kanban: limite WIP da coluna (0 = sem limite) e destinos permitidos (vazio = qualquer)
    fieldRules.wip_limit = [
      rules.custom((value) => {
        if (typeof value !== 'number' || Math.floor(value) !== value) return 'invalid_type'
        if (value < 0) return 'too_small'
        return value > 999 ? 'too_large' : null
      }),
    ]
    fieldRules.allowed_next = [rules.stringArray(50)]
  }

  /** Destinos precisam existir e não podem incluir o próprio status. */
  async function assertAllowedNext(ids, selfId) {
    if (ids === undefined) return
    const known = (await repository().list({ includeInactive: true })).map((item) => item.id)
    const unique = ids.filter((id, i) => ids.indexOf(id) === i)
    if (unique.length !== ids.length || ids.some((id) => id === selfId || known.indexOf(id) < 0)) throw invalid('allowed_next', 'invalid_option')
  }

  /** Destinos legíveis no histórico (chaves em vez de IDs). */
  async function nextLabel(ids) {
    const all = await repository().list({ includeInactive: true })
    return (ids || [])
      .map((id) => (all.find((item) => item.id === id) || { key: id }).key)
      .sort()
      .join(', ')
  }

  function assertCanRead(principal) {
    rbac.assertAuthenticated(principal)
    if (!READ_PERMISSIONS.some((code) => rbac.can(principal, code))) throw appError('FORBIDDEN')
  }

  async function findOrFail(id) {
    const item = id ? await repository().findById(id) : null
    if (!item) throw appError(spec.errors.notFound)
    return item
  }

  function present(item) {
    const dto = {
      id: item.id,
      key: item.key,
      name: item.name,
      description: item.description || '',
      color: item.color || 'gray',
      order: item.order,
      is_active: item.isActive !== false,
      is_default: !!item.isDefault,
      created_at: iso(item.createdAt),
      updated_at: iso(item.updatedAt),
    }
    if (spec.hasCategory) {
      dto.category = item.category
      dto.wip_limit = item.wipLimit || 0
      dto.allowed_next = item.allowedNext || []
    }
    return dto
  }

  async function audit(repos, ctx, entityId, action, oldValue, newValue) {
    await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: spec.entityType, entityId, action: `${spec.entityType}.${action}`, oldValue, newValue }))
  }

  async function snapshot(item) {
    const value = { name: item.name, description: item.description || '', color: item.color, is_active: item.isActive !== false, is_default: !!item.isDefault }
    if (spec.noDefault) delete value.is_default
    if (spec.hasCategory) {
      value.category = item.category
      value.wip_limit = item.wipLimit || 0
      value.allowed_next = await nextLabel(item.allowedNext)
    }
    return value
  }

  // ------------------------------------------------------------------

  async function list(ctx, query) {
    assertCanRead(ctx.principal)
    const q = query || {}
    const includeInactive = q.include_inactive === '1' && rbac.can(ctx.principal, 'settings.manage')
    return (await repository().list({ includeInactive })).map(present)
  }

  async function get(ctx, id) {
    assertCanRead(ctx.principal)
    return present(await findOrFail(id))
  }

  async function create(ctx, input) {
    rbac.assertCan(ctx.principal, 'settings.manage')
    const data = assertValid(input, Object.assign({ key: [rules.required(), keyRule] }, fieldRules))
    const key = cf.normalizeTypeKey(data.key)
    if (await repository().findByKey(key)) throw appError(spec.errors.keyInUse)
    await assertAllowedNext(data.allowed_next, null)

    const all = await repository().list({ includeInactive: true })
    const isActive = data.is_active !== false
    // sem padrão ainda (primeiro item), o novo item assume o papel
    const isDefault = !spec.noDefault && (data.is_default === true || !all.some((item) => item.isDefault))
    if (isDefault && !isActive) throw invalid(data.is_default === true ? 'is_default' : 'is_active', 'default_must_be_active')

    const created = await deps.unitOfWork.run(async (repos) => {
      const repo = repos[spec.repository]
      if (isDefault) await repo.clearDefault()
      const item = await repo.create({
        key,
        name: data.name,
        description: data.description || '',
        color: data.color || 'gray',
        category: spec.hasCategory ? data.category : undefined,
        wipLimit: spec.hasCategory ? data.wip_limit || 0 : undefined,
        allowedNext: spec.hasCategory ? data.allowed_next || [] : undefined,
        order: (await repo.maxOrder()) + 1,
        isActive,
        isDefault,
      })
      await audit(repos, ctx, item.id, 'created', null, Object.assign({ key }, await snapshot(item)))
      return item
    })
    return present(created)
  }

  async function update(ctx, id, input) {
    rbac.assertCan(ctx.principal, 'settings.manage')
    const item = await findOrFail(id)
    const source = input || {}
    if (source.key !== undefined && cf.normalizeTypeKey(String(source.key)) !== item.key) throw invalid('key', 'immutable')
    const schema = {}
    Object.keys(fieldRules).forEach((key) => {
      if (source[key] !== undefined) schema[key] = fieldRules[key]
    })
    const data = assertValid(source, schema)

    const next = {
      isActive: data.is_active === undefined ? item.isActive !== false : data.is_active,
      isDefault: data.is_default === undefined ? !!item.isDefault : data.is_default,
    }
    const issue = workflow.defaultIssue({ isDefault: !!item.isDefault }, next)
    if (issue) throw invalid(issue.field, issue.code)

    await assertAllowedNext(data.allowed_next, item.id)

    const before = await snapshot(item)
    // destinos comparados pela forma legível (a lista de IDs mudaria sempre por referência)
    const comparable = Object.assign({}, data)
    if (data.allowed_next !== undefined) comparable.allowed_next = await nextLabel(data.allowed_next)
    const change = diff(before, comparable, Object.keys(before))
    if (!change) return present(item)

    const saved = await deps.unitOfWork.run(async (repos) => {
      const repo = repos[spec.repository]
      if (change.newValue.is_default === true) await repo.clearDefault()
      const patch = {}
      Object.keys(change.newValue).forEach((key) => {
        if (key === 'allowed_next') patch.allowedNext = data.allowed_next
        else if (key === 'wip_limit') patch.wipLimit = change.newValue[key]
        else patch[key === 'is_active' ? 'isActive' : key === 'is_default' ? 'isDefault' : key] = change.newValue[key]
      })
      const result = await repo.update(item.id, patch)
      await audit(repos, ctx, item.id, 'updated', change.oldValue, change.newValue)
      return result
    })
    return present(saved)
  }

  async function remove(ctx, id) {
    rbac.assertCan(ctx.principal, 'settings.manage')
    const item = await findOrFail(id)
    if (item.isDefault) throw appError(spec.errors.isDefault)
    const tasks = await repository().countTasks(item.id)
    // a área também é usada por projetos
    const projects = repository().countProjects ? await repository().countProjects(item.id) : 0
    if (tasks > 0 || projects > 0) throw appError(spec.errors.inUse, undefined, spec.noDefault ? { tasks, projects } : { tasks })
    await deps.unitOfWork.run(async (repos) => {
      await repos[spec.repository].delete(item.id)
      await audit(repos, ctx, item.id, 'deleted', Object.assign({ key: item.key }, await snapshot(item)), null)
    })
    return { deleted: true }
  }

  /** Reordena todos os itens (a lista precisa conter todos os IDs exatamente uma vez). */
  async function reorder(ctx, ids) {
    rbac.assertCan(ctx.principal, 'settings.manage')
    const data = assertValid({ ids }, { ids: [rules.required(), rules.stringArray(200)] })
    const all = await repository().list({ includeInactive: true })
    const known = all.map((item) => item.id)
    const unique = data.ids.filter((v, i) => data.ids.indexOf(v) === i)
    if (unique.length !== data.ids.length || unique.length !== known.length || unique.some((v) => known.indexOf(v) < 0)) {
      throw invalid('ids', 'invalid_order')
    }
    await deps.unitOfWork.run(async (repos) => {
      await repos[spec.repository].setOrder(unique)
      const keys = unique.map((v) => all.find((item) => item.id === v).key)
      await audit(repos, ctx, 'order', 'reordered', { order: all.map((item) => item.key) }, { order: keys })
    })
    return list(ctx, { include_inactive: '1' })
  }

  return { list, get, create, update, delete: remove, reorder }
}

module.exports = { createLookupService }
