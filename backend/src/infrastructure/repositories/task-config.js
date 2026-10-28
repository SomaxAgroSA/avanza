/**
 * Repositórios Postgres da configuração das tarefas: campos personalizados (e opções), tipos de tarefa
 * (e os campos de cada tipo), status/prioridades (cadastros com ordem e padrão) e tags.
 */

const { appError } = require('../../core/errors')
const { ident, likePattern, toJson, insertRow, updateRow, findRow, findRows, deleteRow, newId } = require('../sql')

/**
 * Executa `fn` trocando violações do Postgres (23505 = índice único, 23503 = chave estrangeira) nas
 * restrições de `map` ({ [restrição]: código }) pelo erro de aplicação.
 */
async function mapViolations(map, fn) {
  try {
    return await fn()
  } catch (err) {
    const known = !!err && (err.code === '23505' || err.code === '23503') && Object.prototype.hasOwnProperty.call(map, err.constraint)
    if (known) throw appError(map[err.constraint])
    throw err
  }
}

/**
 * Colunas a gravar a partir de `data` conforme `fields` ({ chave: [coluna, tipo] }), com os vazios do
 * PocketBase: texto '', número 0, booleano false, JSON NULL. `skipUndefined` ignora as chaves sem valor.
 */
function columns(fields, data, skipUndefined) {
  const values = {}
  Object.keys(data).forEach((key) => {
    const spec = fields[key]
    const value = data[key]
    if (!spec || (skipUndefined && value === undefined)) return
    const empty = value === undefined || value === null
    if (spec[1] === 'text') values[spec[0]] = empty ? '' : value
    else if (spec[1] === 'number') values[spec[0]] = Number(value) || 0
    else if (spec[1] === 'bool') values[spec[0]] = !!value
    else if (spec[1] === 'json') values[spec[0]] = empty ? null : toJson(value)
  })
  return values
}

/** Grava `"order"` = posição na lista (0, 1, 2…) numa instrução só. */
async function setOrderOf(db, table, ids) {
  if (!ids || ids.length === 0) return
  await db.exec(
    `UPDATE ${ident(table)} AS t SET "order" = v.ord - 1 FROM unnest($1::text[]) WITH ORDINALITY AS v(id, ord) WHERE t.id = v.id`,
    [ids],
  )
}

/** { valor de `keyColumn`: quantidade } das linhas de `table` cujo `keyColumn` está em `ids`. */
async function countBy(db, table, keyColumn, ids) {
  const counts = {}
  if (!ids || ids.length === 0) return counts
  const column = ident(keyColumn)
  const rows = await db.query(`SELECT ${column} AS k, count(*) AS total FROM ${ident(table)} WHERE ${column} = ANY($1::text[]) GROUP BY ${column}`, [ids])
  rows.forEach((row) => {
    counts[row.k] = row.total
  })
  return counts
}

function createCustomFieldRepository(db) {
  const TABLE = 'custom_fields'
  const FIELDS = {
    name: ['name', 'text'],
    label: ['label', 'text'],
    type: ['type', 'text'],
    description: ['description', 'text'],
    config: ['config', 'json'],
    defaultValue: ['default_value', 'json'],
    searchable: ['searchable', 'bool'],
    filterable: ['filterable', 'bool'],
    sortable: ['sortable', 'bool'],
  }
  const UNIQUE = { idx_custom_fields_name: 'FIELD_NAME_IN_USE' }

  function toEntity(row) {
    return {
      id: row.id,
      name: row.name,
      label: row.label,
      type: row.type,
      description: row.description,
      config: row.config || {},
      defaultValue: row.default_value,
      searchable: row.searchable,
      filterable: row.filterable,
      sortable: row.sortable,
      createdAt: row.created,
      updatedAt: row.updated,
    }
  }

  function toOption(row) {
    return {
      id: row.id,
      fieldId: row.field_id,
      label: row.label,
      color: row.color || 'gray',
      order: row.order,
      isActive: row.is_active,
    }
  }

  return {
    async findById(id) {
      const row = await findRow(db, TABLE, id)
      return row ? toEntity(row) : null
    },
    async findByName(name) {
      const row = await db.one('SELECT * FROM custom_fields WHERE name = $1', [name])
      return row ? toEntity(row) : null
    },
    async findManyByIds(ids) {
      return (await findRows(db, TABLE, ids)).map(toEntity)
    },
    async list(query) {
      const where = []
      const params = []
      if (query.type) {
        params.push(query.type)
        where.push(`type = $${params.length}`)
      }
      if (query.search) {
        params.push(likePattern(query.search))
        where.push(`(label ILIKE $${params.length} OR name ILIKE $${params.length})`)
      }
      const filter = where.length ? `WHERE ${where.join(' AND ')}` : ''
      return (await db.query(`SELECT * FROM custom_fields ${filter} ORDER BY label ASC, id ASC`, params)).map(toEntity)
    },
    async create(data) {
      return toEntity(await mapViolations(UNIQUE, () => insertRow(db, TABLE, columns(FIELDS, data, false))))
    },
    async update(id, patch) {
      const row = await mapViolations(UNIQUE, () => updateRow(db, TABLE, id, columns(FIELDS, patch, false)))
      return row ? toEntity(row) : null
    },
    /** Opções, valores nas tarefas e vínculos com tipos saem em cascata. */
    async delete(id) {
      await deleteRow(db, TABLE, id)
    },
    async listOptions(fieldIds) {
      if (!fieldIds || fieldIds.length === 0) return []
      const rows = await db.query('SELECT * FROM custom_field_options WHERE field_id = ANY($1::text[]) ORDER BY "order" ASC, created ASC, id ASC', [fieldIds])
      return rows.map(toOption)
    },
    /** Substitui as opções: mantém IDs informados, cria novas e remove as ausentes. */
    async syncOptions(fieldId, options) {
      // trava o campo: duas trocas simultâneas das opções não se misturam
      await db.query('SELECT id FROM custom_fields WHERE id = $1 FOR NO KEY UPDATE', [fieldId])
      const existing = new Set((await db.query('SELECT id FROM custom_field_options WHERE field_id = $1', [fieldId])).map((row) => row.id))
      const keep = options.filter((o) => o.id).map((o) => o.id)
      await db.exec('DELETE FROM custom_field_options WHERE field_id = $1 AND NOT (id = ANY($2::text[]))', [fieldId, keep])
      // id de outra opção (ou de outro campo) não é reaproveitado: vira opção nova
      const ids = options.map((o) => (o.id && existing.has(o.id) ? o.id : newId()))
      const latest = {}
      options.forEach((o, index) => {
        latest[ids[index]] = { id: ids[index], label: o.label || '', color: o.color || '', order: index, is_active: !!o.isActive }
      })
      const rows = await db.query(
        `INSERT INTO custom_field_options (id, field_id, label, color, "order", is_active)
         SELECT x.id, $1, x.label, x.color, x."order", x.is_active
         FROM jsonb_to_recordset($2::jsonb) AS x(id text, label text, color text, "order" integer, is_active boolean)
         ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, color = EXCLUDED.color, "order" = EXCLUDED."order", is_active = EXCLUDED.is_active
         RETURNING *`,
        [fieldId, toJson(Object.keys(latest).map((id) => latest[id]))],
      )
      const byId = {}
      rows.forEach((row) => {
        byId[row.id] = toOption(row)
      })
      return ids.map((id) => byId[id])
    },
  }
}

function createTaskTypeRepository(db) {
  const TABLE = 'task_types'
  const FIELDS = {
    key: ['key', 'text'],
    name: ['name', 'text'],
    description: ['description', 'text'],
    translations: ['translations', 'json'],
    icon: ['icon', 'text'],
    color: ['color', 'text'],
    order: ['order', 'number'],
    isActive: ['is_active', 'bool'],
  }
  const VIOLATIONS = { idx_task_types_key: 'TASK_TYPE_KEY_IN_USE', fk_tasks_task_type_id: 'TASK_TYPE_IN_USE' }

  function toEntity(row) {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      translations: row.translations || {},
      icon: row.icon,
      color: row.color,
      order: row.order,
      isActive: row.is_active,
      createdAt: row.created,
      updatedAt: row.updated,
    }
  }

  return {
    async findById(id) {
      const row = await findRow(db, TABLE, id)
      return row ? toEntity(row) : null
    },
    async findByKey(key) {
      const row = await db.one('SELECT * FROM task_types WHERE "key" = $1', [key])
      return row ? toEntity(row) : null
    },
    async list(query) {
      const filter = query && query.includeInactive ? '' : 'WHERE is_active = true'
      return (await db.query(`SELECT * FROM task_types ${filter} ORDER BY "order" ASC, name ASC, id ASC`)).map(toEntity)
    },
    async maxOrder() {
      return (await db.one('SELECT COALESCE(MAX("order"), -1) AS max FROM task_types')).max
    },
    async create(data) {
      return toEntity(await mapViolations(VIOLATIONS, () => insertRow(db, TABLE, columns(FIELDS, data, false))))
    },
    async update(id, patch) {
      const row = await mapViolations(VIOLATIONS, () => updateRow(db, TABLE, id, columns(FIELDS, patch, false)))
      return row ? toEntity(row) : null
    },
    /** Vínculos com campos saem em cascata; tarefas do tipo impedem (TASK_TYPE_IN_USE). */
    async delete(id) {
      await mapViolations(VIOLATIONS, () => deleteRow(db, TABLE, id))
    },
    async setOrder(ids) {
      await setOrderOf(db, TABLE, ids)
    },
    /** Tarefas que usam o tipo. */
    async countTasks(id) {
      return (await db.one('SELECT count(*) AS total FROM tasks WHERE task_type_id = $1', [id])).total
    },
  }
}

function createTaskTypeFieldRepository(db) {
  function toEntity(row) {
    return {
      typeId: row.task_type_id,
      fieldId: row.field_id,
      order: row.order,
      required: row.required,
      visible: row.visible,
      showOnCard: row.show_on_card,
      requiredStatusIds: row.required_status_ids || [],
    }
  }

  return {
    async listByType(typeId) {
      return (await db.query('SELECT * FROM task_type_fields WHERE task_type_id = $1 ORDER BY "order" ASC, id ASC', [typeId])).map(toEntity)
    },
    async replace(typeId, items) {
      // trava o tipo: duas trocas simultâneas não se misturam (nem colidem no índice tipo+campo)
      await db.query('SELECT id FROM task_types WHERE id = $1 FOR NO KEY UPDATE', [typeId])
      await db.exec('DELETE FROM task_type_fields WHERE task_type_id = $1', [typeId])
      if (!items || items.length === 0) return
      const rows = items.map((item) => ({
        id: newId(),
        field_id: item.fieldId,
        order: Number(item.order) || 0,
        required: !!item.required,
        visible: !!item.visible,
        show_on_card: !!item.showOnCard,
        required_status_ids: item.requiredStatusIds || [],
      }))
      await db.exec(
        `INSERT INTO task_type_fields (id, task_type_id, field_id, "order", required, visible, show_on_card, required_status_ids)
         SELECT x.id, $1, x.field_id, x."order", x.required, x.visible, x.show_on_card, x.required_status_ids
         FROM jsonb_to_recordset($2::jsonb) AS x(id text, field_id text, "order" integer, required boolean, visible boolean, show_on_card boolean, required_status_ids jsonb)`,
        [typeId, toJson(rows)],
      )
    },
    /** { fieldId: [typeId, …] } dos tipos que usam cada campo. */
    async typesUsingFields(fieldIds) {
      const map = {}
      if (!fieldIds || fieldIds.length === 0) return map
      const rows = await db.query('SELECT field_id, task_type_id FROM task_type_fields WHERE field_id = ANY($1::text[]) ORDER BY created ASC, id ASC', [fieldIds])
      rows.forEach((row) => {
        map[row.field_id] = (map[row.field_id] || []).concat(row.task_type_id)
      })
      return map
    },
    /** { typeId: quantidade de campos } — só os tipos com campos. */
    async countByTypes(typeIds) {
      return countBy(db, 'task_type_fields', 'task_type_id', typeIds)
    },
  }
}

// erros de cada cadastro (chave repetida; em uso pelas tarefas)
const LOOKUP_ERRORS = {
  task_statuses: { keyInUse: 'STATUS_KEY_IN_USE', inUse: 'STATUS_IN_USE' },
  task_priorities: { keyInUse: 'PRIORITY_KEY_IN_USE', inUse: 'PRIORITY_IN_USE' },
}

/**
 * Status e prioridades: mesmas colunas; status têm ainda categoria, limite WIP e destinos permitidos.
 * @param {string} table 'task_statuses' | 'task_priorities'
 * @param {{ hasCategory: boolean, taskColumn: string }} options coluna de `tasks` que referencia o cadastro
 */
function createLookupRepository(db, _ctx, table, options) {
  const TABLE = ident(table)
  const taskColumn = ident(options.taskColumn)
  const FIELDS = {
    key: ['key', 'text'],
    name: ['name', 'text'],
    description: ['description', 'text'],
    color: ['color', 'text'],
    order: ['order', 'number'],
    isActive: ['is_active', 'bool'],
    isDefault: ['is_default', 'bool'],
  }
  if (options.hasCategory) {
    FIELDS.category = ['category', 'text']
    FIELDS.wipLimit = ['wip_limit', 'number']
    FIELDS.allowedNext = ['allowed_next', 'json']
  }
  const errors = LOOKUP_ERRORS[table] || {}
  const VIOLATIONS = {}
  if (errors.keyInUse) VIOLATIONS[`idx_${table}_key`] = errors.keyInUse
  if (errors.inUse) VIOLATIONS[`fk_tasks_${options.taskColumn}`] = errors.inUse

  function toEntity(row) {
    const entity = {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      color: row.color,
      order: row.order,
      isActive: row.is_active,
      isDefault: row.is_default,
      createdAt: row.created,
      updatedAt: row.updated,
    }
    if (options.hasCategory) {
      entity.category = row.category
      entity.wipLimit = row.wip_limit
      entity.allowedNext = row.allowed_next || []
    }
    return entity
  }

  return {
    async findById(id) {
      const row = await findRow(db, table, id)
      return row ? toEntity(row) : null
    },
    async findByKey(key) {
      const row = await db.one(`SELECT * FROM ${TABLE} WHERE "key" = $1`, [key])
      return row ? toEntity(row) : null
    },
    async list(query) {
      const filter = query && query.includeInactive ? '' : 'WHERE is_active = true'
      return (await db.query(`SELECT * FROM ${TABLE} ${filter} ORDER BY "order" ASC, name ASC, id ASC`)).map(toEntity)
    },
    async maxOrder() {
      return (await db.one(`SELECT COALESCE(MAX("order"), -1) AS max FROM ${TABLE}`)).max
    },
    async create(data) {
      return toEntity(await mapViolations(VIOLATIONS, () => insertRow(db, table, columns(FIELDS, data, true))))
    },
    async update(id, patch) {
      const row = await mapViolations(VIOLATIONS, () => updateRow(db, table, id, columns(FIELDS, patch, true)))
      return row ? toEntity(row) : null
    },
    /** Tarefas que ainda usam o item impedem a exclusão (chave estrangeira RESTRICT). */
    async delete(id) {
      await mapViolations(VIOLATIONS, () => deleteRow(db, table, id))
    },
    async setOrder(ids) {
      await setOrderOf(db, table, ids)
    },
    /**
     * Tira o padrão de todos. Trava as linhas do cadastro antes (até o fim da transação): duas trocas
     * de padrão ao mesmo tempo não deixam dois itens padrão. NO KEY UPDATE não bloqueia as tarefas que
     * apenas referenciam o item.
     */
    async clearDefault() {
      await db.query(`SELECT id FROM ${TABLE} ORDER BY id FOR NO KEY UPDATE`)
      await db.exec(`UPDATE ${TABLE} SET is_default = false WHERE is_default = true`)
    },
    async countTasks(id) {
      return (await db.one(`SELECT count(*) AS total FROM tasks WHERE ${taskColumn} = $1`, [id])).total
    },
  }
}

function createTagRepository(db) {
  const TABLE = 'tags'
  const FIELDS = { name: ['name', 'text'], nameKey: ['name_key', 'text'], color: ['color', 'text'] }
  const UNIQUE = { idx_tags_name_key: 'TAG_NAME_IN_USE' }

  function toEntity(row) {
    return {
      id: row.id,
      name: row.name,
      nameKey: row.name_key,
      color: row.color,
      createdAt: row.created,
      updatedAt: row.updated,
    }
  }

  return {
    async findById(id) {
      const row = await findRow(db, TABLE, id)
      return row ? toEntity(row) : null
    },
    async findByKey(key) {
      const row = await db.one('SELECT * FROM tags WHERE name_key = $1', [key])
      return row ? toEntity(row) : null
    },
    async findManyByIds(ids) {
      return (await findRows(db, TABLE, ids)).map(toEntity)
    },
    async list() {
      return (await db.query('SELECT * FROM tags ORDER BY name ASC, id ASC')).map(toEntity)
    },
    async create(data) {
      return toEntity(await mapViolations(UNIQUE, () => insertRow(db, TABLE, columns(FIELDS, data, true))))
    },
    async update(id, patch) {
      const row = await mapViolations(UNIQUE, () => updateRow(db, TABLE, id, columns(FIELDS, patch, true)))
      return row ? toEntity(row) : null
    },
    /** Relações com tarefas saem em cascata. */
    async delete(id) {
      await deleteRow(db, TABLE, id)
    },
    /** { tagId: tarefas } — só as tags em uso. */
    async countTasks(ids) {
      return countBy(db, 'task_tag_relations', 'tag_id', ids)
    },
  }
}

module.exports = { createCustomFieldRepository, createTaskTypeRepository, createTaskTypeFieldRepository, createLookupRepository, createTagRepository }
