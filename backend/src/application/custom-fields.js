/**
 * Casos de uso da biblioteca de campos personalizados.
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const rbac = require('../domain/rbac')
const contentLocale = require('../domain/content-locale')
const cf = require('../domain/custom-field')
const { buildAuditEntry } = require('./audit')
const { iso } = require('./presenters')

const READ_PERMISSIONS = ['settings.manage', 'tasks.view']
/** Quem adiciona opção pela tarefa: quem configura os campos ou quem cria/edita tarefas. */
const ADD_OPTION_PERMISSIONS = ['settings.manage', 'tasks.create', 'tasks.edit']
const FLAGS = ['searchable', 'filterable', 'sortable']
const MAX_OPTIONS = 200

const BASE_SCHEMA = {
  label: [rules.required(), rules.maxLength(80)],
  description: [rules.maxLength(255)],
  searchable: [rules.boolean()],
  filterable: [rules.boolean()],
  sortable: [rules.boolean()],
}

function assertCanRead(principal) {
  rbac.assertAuthenticated(principal)
  if (!READ_PERMISSIONS.some((code) => rbac.can(principal, code))) throw appError('FORBIDDEN')
}

function invalid(field, code, extra) {
  return appError('VALIDATION_ERROR', undefined, Object.assign({ fields: { [field]: code } }, extra || {}))
}

/** Valida a lista de opções de campos de seleção. Retorna opções normalizadas (camelCase). */
function normalizeOptions(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw invalid('options', 'required')
  if (raw.length > MAX_OPTIONS) throw invalid('options', 'too_many')
  const seen = []
  return raw.map((option, index) => {
    const o = option && typeof option === 'object' ? option : {}
    const label = typeof o.label === 'string' ? o.label.trim() : ''
    if (!label) throw invalid('options', 'required', { index })
    if (label.length > cf.MAX_OPTION_LABEL) throw invalid('options', 'too_long', { index })
    const lower = label.toLowerCase()
    if (seen.indexOf(lower) >= 0) throw invalid('options', 'duplicate_option', { index })
    seen.push(lower)
    const color = o.color === undefined ? 'gray' : o.color
    if (cf.OPTION_COLORS.indexOf(color) < 0) throw invalid('options', 'invalid_option', { index })
    return {
      id: typeof o.id === 'string' && o.id ? o.id : null,
      label,
      color,
      isActive: o.is_active !== false,
      isDefault: o.is_default === true,
    }
  })
}

/** Padrão de campos de seleção = opções marcadas como padrão (após salvar, já com IDs). */
function defaultFromOptions(type, normalized, saved) {
  const ids = []
  normalized.forEach((o, index) => {
    if (o.isDefault) {
      if (!o.isActive) throw invalid('default_value', 'inactive_option')
      ids.push(saved[index].id)
    }
  })
  if (type === 'select') {
    if (ids.length > 1) throw invalid('default_value', 'single_default')
    return ids[0] || null
  }
  return ids.length > 0 ? ids : null
}

function validateDefault(type, config, value) {
  if (cf.isEmptyValue(value)) return null
  if (!cf.typeInfo(type).defaultValue) throw invalid('default_value', 'not_supported')
  const result = cf.validateValue({ type, config, options: [] }, value)
  if (result.error) throw invalid('default_value', result.error)
  return result.value
}

function createCustomFieldService(deps) {
  const fields = deps.customFieldRepository
  const typeFields = deps.taskTypeFieldRepository

  function presentOption(o) {
    return { id: o.id, label: o.label, color: o.color, order: o.order, is_active: o.isActive !== false }
  }

  function present(field, options, usedBy) {
    return {
      id: field.id,
      name: field.name,
      label: field.label,
      type: field.type,
      description: field.description || '',
      config: field.config || {},
      default_value: field.defaultValue === undefined ? null : field.defaultValue,
      searchable: !!field.searchable,
      filterable: !!field.filterable,
      sortable: !!field.sortable,
      options: (options || []).map(presentOption),
      used_by: usedBy || [],
      created_at: iso(field.createdAt),
      updated_at: iso(field.updatedAt),
    }
  }

  /** Monta DTOs com opções e "usado em" em poucas consultas. */
  async function presentMany(list) {
    const ids = list.map((f) => f.id)
    const options = ids.length > 0 ? await fields.listOptions(ids) : []
    const usage = ids.length > 0 ? await typeFields.typesUsingFields(ids) : {}
    const typeIds = []
    Object.keys(usage).forEach((fieldId) => usage[fieldId].forEach((id) => typeIds.indexOf(id) < 0 && typeIds.push(id)))
    const types = {}
    for (const id of typeIds) {
      const type = await deps.taskTypeRepository.findById(id)
      if (type) types[id] = { id: type.id, key: type.key, name: contentLocale.localize(type, deps.locale, ['name']).name }
    }
    return list.map((field) =>
      present(
        field,
        options.filter((o) => o.fieldId === field.id),
        (usage[field.id] || []).map((id) => types[id]).filter(Boolean),
      ),
    )
  }

  async function findOrFail(id) {
    const field = id ? await fields.findById(id) : null
    if (!field) throw appError('FIELD_NOT_FOUND')
    return field
  }

  function flagsFor(type, data, current) {
    const info = cf.typeInfo(type)
    const out = {}
    FLAGS.forEach((flag) => {
      const value = data[flag] !== undefined ? data[flag] : current ? !!current[flag] : false
      if (value && !info[flag]) throw invalid(flag, 'not_supported')
      out[flag] = value
    })
    return out
  }

  function auditView(dto) {
    return {
      label: dto.label,
      description: dto.description,
      config: dto.config,
      default_value: dto.default_value,
      searchable: dto.searchable,
      filterable: dto.filterable,
      sortable: dto.sortable,
      options: dto.options.map((o) => (o.is_active ? o.label : `${o.label} (inativa)`)),
    }
  }

  function changes(before, after) {
    const oldValue = {}
    const newValue = {}
    Object.keys(after).forEach((key) => {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        oldValue[key] = before[key]
        newValue[key] = after[key]
      }
    })
    return Object.keys(newValue).length > 0 ? { oldValue, newValue } : null
  }

  // ------------------------------------------------------------------

  async function listFields(ctx, query) {
    assertCanRead(ctx.principal)
    const q = query || {}
    const filters = assertValid(
      { search: q.search || undefined, type: q.type || undefined },
      { search: [rules.maxLength(100)], type: [rules.oneOf(cf.FIELD_TYPES)] },
    )
    return presentMany(await fields.list({ search: filters.search, type: filters.type }))
  }

  async function getField(ctx, id) {
    assertCanRead(ctx.principal)
    return (await presentMany([await findOrFail(id)]))[0]
  }

  async function createField(ctx, input) {
    rbac.assertCan(ctx.principal, 'settings.manage')
    const source = input || {}
    const data = assertValid(source, Object.assign({ type: [rules.required(), rules.oneOf(cf.FIELD_TYPES)] }, BASE_SCHEMA))

    const name = source.name ? String(source.name).trim() : cf.slugifyName(data.label)
    const nameIssue = cf.nameIssue(name)
    if (nameIssue) throw invalid('name', nameIssue)
    if (await fields.findByName(name)) throw appError('FIELD_NAME_IN_USE')

    const config = cf.normalizeConfig(data.type, source.config)
    if (config.error) throw invalid('config', config.error)
    const info = cf.typeInfo(data.type)
    const options = info.options ? normalizeOptions(source.options) : null
    const defaultValue = info.options ? null : validateDefault(data.type, config.value, source.default_value)
    const flags = flagsFor(data.type, data)

    const created = await deps.unitOfWork.run(async (repos) => {
      const field = await repos.customFieldRepository.create(
        Object.assign({ name, label: data.label, type: data.type, description: data.description || '', config: config.value, defaultValue }, flags),
      )
      if (options) {
        const saved = await repos.customFieldRepository.syncOptions(field.id, options)
        await repos.customFieldRepository.update(field.id, { defaultValue: defaultFromOptions(data.type, options, saved) })
      }
      await repos.auditRepository.record(
        buildAuditEntry(ctx, {
          entityType: 'custom_field',
          entityId: field.id,
          action: 'custom_field.created',
          newValue: { name, label: data.label, type: data.type },
        }),
      )
      return field
    })
    return getField(ctx, created.id)
  }

  async function updateField(ctx, id, input) {
    rbac.assertCan(ctx.principal, 'settings.manage')
    const field = await findOrFail(id)
    const source = input || {}
    if (source.name !== undefined && source.name !== field.name) throw invalid('name', 'immutable')
    if (source.type !== undefined && source.type !== field.type) throw invalid('type', 'immutable')

    const schema = {}
    Object.keys(BASE_SCHEMA).forEach((key) => {
      if (source[key] !== undefined) schema[key] = BASE_SCHEMA[key]
    })
    const data = assertValid(source, schema)
    const info = cf.typeInfo(field.type)

    const config = source.config !== undefined ? cf.normalizeConfig(field.type, source.config) : { value: field.config }
    if (config.error) throw invalid('config', config.error)
    const options = info.options && source.options !== undefined ? normalizeOptions(source.options) : null
    let defaultValue = field.defaultValue
    if (!info.options) {
      defaultValue = validateDefault(field.type, config.value, source.default_value !== undefined ? source.default_value : field.defaultValue)
    }
    const flags = flagsFor(field.type, data, field)
    const before = auditView(await getField(ctx, id))

    await deps.unitOfWork.run(async (repos) => {
      const patch = Object.assign(
        { config: config.value, defaultValue },
        flags,
        data.label !== undefined ? { label: data.label } : {},
        data.description !== undefined ? { description: data.description } : {},
      )
      if (options) patch.defaultValue = defaultFromOptions(field.type, options, await repos.customFieldRepository.syncOptions(field.id, options))
      await repos.customFieldRepository.update(field.id, patch)
    })

    const after = await getField(ctx, id)
    const diff = changes(before, auditView(after))
    if (diff) {
      await deps.auditRepository.record(
        buildAuditEntry(ctx, { entityType: 'custom_field', entityId: field.id, action: 'custom_field.updated', oldValue: diff.oldValue, newValue: diff.newValue }),
      )
    }
    return after
  }

  async function deleteField(ctx, id) {
    rbac.assertCan(ctx.principal, 'settings.manage')
    const field = await findOrFail(id)
    const usedBy = (await presentMany([field]))[0].used_by
    if (usedBy.length > 0) throw appError('FIELD_IN_USE', undefined, { types: usedBy.map((t) => t.key) })
    await deps.unitOfWork.run(async (repos) => {
      await repos.customFieldRepository.delete(field.id)
      await repos.auditRepository.record(
        buildAuditEntry(ctx, {
          entityType: 'custom_field',
          entityId: field.id,
          action: 'custom_field.deleted',
          oldValue: { name: field.name, label: field.label, type: field.type },
        }),
      )
    })
    return { deleted: true }
  }

  /**
   * "Adicionar opção" no formulário da tarefa (campo de seleção com `allow_create_options`).
   * Rótulo igual a uma opção existente (sem diferenciar maiúsculas e acentos) devolve essa opção —
   * reativada, se estava inativa — em vez de duplicar. A nova entra no fim, com a cor seguinte da paleta.
   * Retorna { option, created }.
   */
  async function addOption(ctx, id, input) {
    rbac.assertAuthenticated(ctx.principal)
    if (!ADD_OPTION_PERMISSIONS.some((code) => rbac.can(ctx.principal, code))) throw appError('FORBIDDEN')
    const field = await findOrFail(id)
    if (!cf.acceptsNewOptions(field)) throw appError('FIELD_OPTIONS_LOCKED')
    const raw = (input || {}).label
    if (raw !== undefined && raw !== null && typeof raw !== 'string') throw invalid('label', 'invalid_type')
    const label = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
    if (!label) throw invalid('label', 'required')
    if (label.length > cf.MAX_OPTION_LABEL) throw invalid('label', 'too_long')

    const result = await deps.unitOfWork.run(async (repos) => {
      const options = await repos.customFieldRepository.lockOptions(field.id)
      const key = cf.optionKey(label)
      const existing = options.find((o) => cf.optionKey(o.label) === key)
      if (existing && existing.isActive !== false) return { option: existing, created: false }
      const record = async (oldValue, newValue) =>
        repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'custom_field', entityId: field.id, action: 'custom_field.option_added', oldValue, newValue }))
      if (existing) {
        const option = await repos.customFieldRepository.updateOption(existing.id, { isActive: true })
        await record({ option: existing.label, is_active: false }, { option: existing.label, is_active: true })
        return { option, created: false }
      }
      if (options.length >= MAX_OPTIONS) throw invalid('options', 'too_many')
      const last = options.reduce((max, o) => (!max || o.order >= max.order ? o : max), null)
      const option = await repos.customFieldRepository.createOption(field.id, {
        label,
        color: cf.nextOptionColor(last ? last.color : null),
        order: last ? last.order + 1 : 0,
        isActive: true,
      })
      await record(null, { option: option.label, color: option.color })
      return { option, created: true }
    })
    return { option: presentOption(result.option), created: result.created }
  }

  return { listFields, getField, createField, updateField, deleteField, addOption, presentMany }
}

module.exports = { createCustomFieldService, READ_PERMISSIONS }
