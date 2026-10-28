/**
 * Casos de uso de tags (cadastro global; as tarefas apenas referenciam).
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const rbac = require('../domain/rbac')
const cf = require('../domain/custom-field')
const taskDomain = require('../domain/task')
const { buildAuditEntry } = require('./audit')
const { iso } = require('./presenters')
const { READ_PERMISSIONS } = require('./custom-fields')

const nameRule = rules.custom((value) => taskDomain.tagNameIssue(value))

function createTagService(deps) {
  const tags = deps.tagRepository

  function assertCanRead(principal) {
    rbac.assertAuthenticated(principal)
    if (!READ_PERMISSIONS.some((code) => rbac.can(principal, code))) throw appError('FORBIDDEN')
  }

  async function findOrFail(id) {
    const tag = id ? await tags.findById(id) : null
    if (!tag) throw appError('TAG_NOT_FOUND')
    return tag
  }

  function present(tag, count) {
    const dto = { id: tag.id, name: tag.name, color: tag.color || 'gray', created_at: iso(tag.createdAt), updated_at: iso(tag.updatedAt) }
    if (count !== undefined) dto.task_count = count
    return dto
  }

  async function assertUniqueName(name, exceptId) {
    const existing = await tags.findByKey(taskDomain.tagKey(name))
    if (existing && existing.id !== exceptId) throw appError('TAG_NAME_IN_USE')
  }

  async function audit(repos, ctx, id, action, oldValue, newValue) {
    await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'tag', entityId: id, action, oldValue, newValue }))
  }

  async function listTags(ctx) {
    assertCanRead(ctx.principal)
    const list = await tags.list()
    const counts = list.length > 0 ? await tags.countTasks(list.map((t) => t.id)) : {}
    return list.map((t) => present(t, counts[t.id] || 0))
  }

  async function createTag(ctx, input) {
    rbac.assertCan(ctx.principal, 'settings.manage')
    const data = assertValid(input, { name: [rules.required(), nameRule], color: [rules.oneOf(cf.OPTION_COLORS)] })
    const name = data.name.trim()
    await assertUniqueName(name)
    const created = await deps.unitOfWork.run(async (repos) => {
      const tag = await repos.tagRepository.create({ name, nameKey: taskDomain.tagKey(name), color: data.color || 'gray' })
      await audit(repos, ctx, tag.id, 'tag.created', null, { name, color: tag.color })
      return tag
    })
    return present(created, 0)
  }

  async function updateTag(ctx, id, input) {
    rbac.assertCan(ctx.principal, 'settings.manage')
    const tag = await findOrFail(id)
    const source = input || {}
    const schema = {}
    if (source.name !== undefined) schema.name = [nameRule]
    if (source.color !== undefined) schema.color = [rules.oneOf(cf.OPTION_COLORS)]
    const data = assertValid(source, schema)
    const patch = {}
    if (data.name !== undefined && data.name.trim() !== tag.name) {
      patch.name = data.name.trim()
      patch.nameKey = taskDomain.tagKey(patch.name)
      await assertUniqueName(patch.name, tag.id)
    }
    if (data.color !== undefined && data.color !== tag.color) patch.color = data.color
    if (Object.keys(patch).length === 0) return present(tag)
    const saved = await deps.unitOfWork.run(async (repos) => {
      const result = await repos.tagRepository.update(tag.id, patch)
      const before = {}
      const after = {}
      ;['name', 'color'].forEach((key) => {
        if (patch[key] !== undefined) {
          before[key] = tag[key]
          after[key] = patch[key]
        }
      })
      await audit(repos, ctx, tag.id, 'tag.updated', before, after)
      return result
    })
    return present(saved)
  }

  /** Excluir remove a tag das tarefas (relação em cascata). */
  async function deleteTag(ctx, id) {
    rbac.assertCan(ctx.principal, 'settings.manage')
    const tag = await findOrFail(id)
    await deps.unitOfWork.run(async (repos) => {
      await repos.tagRepository.delete(tag.id)
      await audit(repos, ctx, tag.id, 'tag.deleted', { name: tag.name }, null)
    })
    return { deleted: true }
  }

  return { listTags, createTag, updateTag, deleteTag }
}

module.exports = { createTagService }
