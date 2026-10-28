/**
 * Casos de uso de tipos de tarefa e da configuração de campos por tipo.
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const rbac = require('../domain/rbac')
const cf = require('../domain/custom-field')
const contentLocale = require('../domain/content-locale')
const { buildAuditEntry, diff } = require('./audit')
const { iso } = require('./presenters')
const { createCustomFieldService, READ_PERMISSIONS } = require('./custom-fields')

const MAX_TYPE_FIELDS = 100
/** Status em que um campo pode ser exigido (além de "obrigatório sempre"). */
const MAX_REQUIRED_STATUSES = 50

const keyRule = rules.custom((value) => (typeof value !== 'string' ? 'invalid_type' : cf.typeKeyIssue(cf.normalizeTypeKey(value))))

const FIELD_RULES = {
  name: [rules.required(), rules.maxLength(60)],
  description: [rules.maxLength(255)],
  icon: [rules.oneOf(cf.TASK_TYPE_ICONS)],
  color: [rules.oneOf(cf.OPTION_COLORS)],
  is_active: [rules.boolean()],
}

/** Campos traduzíveis do tipo (en/es) e seus limites — os mesmos do original. */
const TRANSLATABLE = { name: 60, description: 255 }

function invalid(field, code) {
  return appError('VALIDATION_ERROR', undefined, { fields: { [field]: code } })
}

function parseTranslations(raw) {
  const result = contentLocale.normalizeTranslations(raw, TRANSLATABLE)
  if (result.error) throw invalid('translations', result.error)
  return result.value
}

function createTaskTypeService(deps) {
  const types = deps.taskTypeRepository
  const typeFields = deps.taskTypeFieldRepository
  const fieldService = createCustomFieldService(deps)

  function assertCanRead(principal) {
    rbac.assertAuthenticated(principal)
    if (!READ_PERMISSIONS.some((code) => rbac.can(principal, code))) throw appError('FORBIDDEN')
  }

  async function findOrFail(id) {
    const type = id ? await types.findById(id) : null
    if (!type) throw appError('TASK_TYPE_NOT_FOUND')
    return type
  }

  /** `name`/`description` no idioma da requisição; `translations` traz todas as versões (edição). */
  function present(type, fieldCount) {
    const shown = contentLocale.localize(type, deps.locale, Object.keys(TRANSLATABLE))
    return {
      id: type.id,
      key: type.key,
      name: shown.name,
      description: shown.description,
      translations: contentLocale.allVersions(type, Object.keys(TRANSLATABLE)),
      icon: type.icon || 'check-square',
      color: type.color || 'blue',
      order: type.order,
      is_active: type.isActive !== false,
      field_count: fieldCount,
      created_at: iso(type.createdAt),
      updated_at: iso(type.updatedAt),
    }
  }

  /** Tipo com os campos configurados (inclui definição completa e opções — base do formulário dinâmico). */
  async function presentDetail(type) {
    const links = await typeFields.listByType(type.id)
    const existing = {}
    ;(await deps.statusRepository.list({ includeInactive: true })).forEach((s) => {
      existing[s.id] = true
    })
    const definitions = {}
    ;(await fieldService.presentMany(await deps.customFieldRepository.findManyByIds(links.map((l) => l.fieldId)))).forEach((dto) => {
      definitions[dto.id] = dto
    })
    const configured = links
      .filter((link) => definitions[link.fieldId])
      .map((link) => ({
        field: definitions[link.fieldId],
        order: link.order,
        required: !!link.required,
        visible: link.visible !== false,
        show_on_card: !!link.showOnCard,
        // status excluído depois some da lista (não volta ao salvar)
        required_status_ids: (link.requiredStatusIds || []).filter((s) => existing[s]),
      }))
    return Object.assign(present(type, configured.length), { fields: configured })
  }

  async function audit(repos, ctx, entityId, action, oldValue, newValue) {
    await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'task_type', entityId, action, oldValue, newValue }))
  }

  // ------------------------------------------------------------------

  async function listTypes(ctx, query) {
    assertCanRead(ctx.principal)
    const q = query || {}
    const includeInactive = q.include_inactive === '1' && rbac.can(ctx.principal, 'settings.manage')
    const list = await types.list({ includeInactive })
    const counts = list.length > 0 ? await typeFields.countByTypes(list.map((t) => t.id)) : {}
    return list.map((t) => present(t, counts[t.id] || 0))
  }

  async function getType(ctx, id) {
    assertCanRead(ctx.principal)
    return presentDetail(await findOrFail(id))
  }

  async function createType(ctx, input) {
    rbac.assertCan(ctx.principal, 'settings.manage')
    const data = assertValid(input, Object.assign({ key: [rules.required(), keyRule] }, FIELD_RULES))
    const key = cf.normalizeTypeKey(data.key)
    const translations = parseTranslations((input || {}).translations)
    if (await types.findByKey(key)) throw appError('TASK_TYPE_KEY_IN_USE')

    const created = await deps.unitOfWork.run(async (repos) => {
      const type = await repos.taskTypeRepository.create({
        key,
        name: data.name,
        description: data.description || '',
        translations,
        icon: data.icon || 'check-square',
        color: data.color || 'blue',
        order: (await repos.taskTypeRepository.maxOrder()) + 1,
        isActive: data.is_active !== false,
      })
      await audit(repos, ctx, type.id, 'task_type.created', null, Object.assign({ key, name: type.name }, Object.keys(translations).length ? { translations } : {}))
      return type
    })
    return presentDetail(created)
  }

  async function updateType(ctx, id, input) {
    rbac.assertCan(ctx.principal, 'settings.manage')
    const type = await findOrFail(id)
    const source = input || {}
    if (source.key !== undefined && cf.normalizeTypeKey(String(source.key)) !== type.key) throw invalid('key', 'immutable')
    const schema = {}
    Object.keys(FIELD_RULES).forEach((key) => {
      if (source[key] !== undefined) schema[key] = FIELD_RULES[key]
    })
    const data = assertValid(source, schema)
    const before = { name: type.name, description: type.description, icon: type.icon, color: type.color, is_active: type.isActive !== false }
    let change = diff(before, data, Object.keys(before))
    // traduções: substituem as anteriores quando enviadas (objeto comparado pelo conteúdo)
    if (source.translations !== undefined) {
      const next = parseTranslations(source.translations)
      const previous = type.translations || {}
      if (JSON.stringify(next) !== JSON.stringify(previous)) {
        change = change || { oldValue: {}, newValue: {} }
        change.oldValue.translations = previous
        change.newValue.translations = next
      }
    }
    if (!change) return presentDetail(type)

    const updated = await deps.unitOfWork.run(async (repos) => {
      const patch = {}
      Object.keys(change.newValue).forEach((key) => {
        patch[key === 'is_active' ? 'isActive' : key] = change.newValue[key]
      })
      const saved = await repos.taskTypeRepository.update(type.id, patch)
      await audit(repos, ctx, type.id, 'task_type.updated', change.oldValue, change.newValue)
      return saved
    })
    return presentDetail(updated)
  }

  async function deleteType(ctx, id) {
    rbac.assertCan(ctx.principal, 'settings.manage')
    const type = await findOrFail(id)
    const tasks = await types.countTasks(type.id)
    if (tasks > 0) throw appError('TASK_TYPE_IN_USE', undefined, { tasks })
    await deps.unitOfWork.run(async (repos) => {
      await repos.taskTypeRepository.delete(type.id)
      await audit(repos, ctx, type.id, 'task_type.deleted', { key: type.key, name: type.name }, null)
    })
    return { deleted: true }
  }

  /** Reordena todos os tipos (a lista precisa conter todos os IDs exatamente uma vez). */
  async function reorderTypes(ctx, ids) {
    rbac.assertCan(ctx.principal, 'settings.manage')
    const data = assertValid({ ids }, { ids: [rules.required(), rules.stringArray(500)] })
    const all = await types.list({ includeInactive: true })
    const known = all.map((t) => t.id)
    const unique = data.ids.filter((v, i) => data.ids.indexOf(v) === i)
    if (unique.length !== data.ids.length || unique.length !== known.length || unique.some((v) => known.indexOf(v) < 0)) {
      throw invalid('ids', 'invalid_order')
    }
    await deps.unitOfWork.run(async (repos) => {
      await repos.taskTypeRepository.setOrder(unique)
      const keys = unique.map((v) => all.find((t) => t.id === v).key)
      await audit(repos, ctx, 'order', 'task_type.reordered', { order: all.map((t) => t.key) }, { order: keys })
    })
    return listTypes(ctx, { include_inactive: '1' })
  }

  /** Substitui a configuração de campos do tipo (ordem = posição na lista). */
  async function setTypeFields(ctx, id, items) {
    rbac.assertCan(ctx.principal, 'settings.manage')
    const type = await findOrFail(id)
    if (!Array.isArray(items)) throw invalid('fields', 'invalid_type')
    if (items.length > MAX_TYPE_FIELDS) throw invalid('fields', 'too_many')

    const seen = []
    const links = items.map((raw, index) => {
      const item = raw && typeof raw === 'object' ? raw : {}
      if (typeof item.field_id !== 'string' || !item.field_id) throw invalid('fields', 'invalid_type')
      if (seen.indexOf(item.field_id) >= 0) throw invalid('fields', 'duplicate_field')
      seen.push(item.field_id)
      ;['required', 'visible', 'show_on_card'].forEach((flag) => {
        if (item[flag] !== undefined && typeof item[flag] !== 'boolean') throw invalid('fields', 'invalid_type')
      })
      const statusIds = item.required_status_ids === undefined ? [] : item.required_status_ids
      if (!Array.isArray(statusIds) || statusIds.length > MAX_REQUIRED_STATUSES || statusIds.some((s) => typeof s !== 'string')) throw invalid('fields', 'invalid_type')
      const required = item.required === true
      const visible = item.visible !== false
      return {
        fieldId: item.field_id,
        order: index,
        required,
        visible,
        showOnCard: item.show_on_card === true,
        // obrigatório sempre torna a lista redundante; campo oculto nunca é exigido
        requiredStatusIds: required || !visible ? [] : statusIds.filter((s, i) => statusIds.indexOf(s) === i),
      }
    })
    const found = await deps.customFieldRepository.findManyByIds(seen)
    if (found.length !== seen.length) throw appError('FIELD_NOT_FOUND')

    const statusNames = {}
    ;(await deps.statusRepository.list({ includeInactive: true })).forEach((s) => {
      statusNames[s.id] = s.name
    })
    links.forEach((link) => {
      if (link.requiredStatusIds.some((s) => !statusNames[s])) throw invalid('fields', 'invalid_status')
    })

    const labels = {}
    found.forEach((f) => {
      labels[f.id] = f.label
    })
    const previous = await typeFields.listByType(type.id)
    const previousLabels = await deps.customFieldRepository.findManyByIds(previous.map((p) => p.fieldId))
    // "Versão *" = obrigatório sempre; "Parecer (Análise, Desenvolvimento)" = exigido nesses status
    const describe = (list, lookup) =>
      list.map((l) => {
        const where = (l.requiredStatusIds || []).map((s) => statusNames[s]).filter(Boolean)
        return (lookup[l.fieldId] || l.fieldId) + (l.required ? ' *' : '') + (where.length ? ` (${where.join(', ')})` : '')
      })
    const previousLookup = {}
    previousLabels.forEach((f) => {
      previousLookup[f.id] = f.label
    })

    await deps.unitOfWork.run(async (repos) => {
      await repos.taskTypeFieldRepository.replace(type.id, links)
      await audit(repos, ctx, type.id, 'task_type.fields_updated', { fields: describe(previous, previousLookup) }, { fields: describe(links, labels) })
    })
    return presentDetail(type)
  }

  return { listTypes, getType, createType, updateType, deleteType, reorderTypes, setTypeFields }
}

module.exports = { createTaskTypeService }
