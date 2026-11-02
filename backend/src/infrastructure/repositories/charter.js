/**
 * Repositórios Postgres da Ficha do projeto (regras de negócio §30): a ficha (objetivo geral, uma por
 * projeto), os itens (objetivos, funcionalidades, escopo e resultados esperados) e as medições dos
 * resultados. Tudo sai com o projeto pelas chaves estrangeiras; as medições, também com o item.
 *
 * Datas de dia puro (início, prazo, medição) ficam à meia-noite UTC e voltam como AAAA-MM-DD. Os
 * vínculos (tarefas e itens) são listas de ids em jsonb; quem lê ignora os que não existem mais.
 */

const { newId, toDbDate, toJson, insertRow, updateRow, findRow, deleteRow } = require('../sql')
const { appError } = require('../../core/errors')

/** Dia puro (AAAA-MM-DD) de uma data guardada à meia-noite UTC. */
function dayOf(date) {
  return date ? date.toISOString().slice(0, 10) : null
}

/** Dia puro (AAAA-MM-DD) -> meia-noite UTC; vazio -> NULL. */
function dayToDb(value) {
  return value ? toDbDate(`${String(value).slice(0, 10)}T00:00:00.000Z`) : null
}

const idList = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [])

function createCharterRepository(db) {
  function toEntity(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      objective: row.objective,
      updatedBy: row.updated_by || null,
      createdAt: row.created,
      updatedAt: row.updated,
    }
  }

  return {
    async findByProject(projectId) {
      const row = await db.one('SELECT * FROM project_charters WHERE project_id = $1', [projectId])
      return row ? toEntity(row) : null
    },

    /** Cria ou atualiza a ficha do projeto (uma só por projeto, mesmo com gravações simultâneas). */
    async upsert(projectId, patch) {
      const objective = patch.objective === undefined || patch.objective === null ? '' : patch.objective
      const updatedBy = patch.updatedBy || null
      const row = await db.one(
        `INSERT INTO project_charters (id, project_id, objective, updated_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (project_id) DO UPDATE SET objective = EXCLUDED.objective, updated_by = EXCLUDED.updated_by, updated = clock_timestamp()
         RETURNING *`,
        [newId(), projectId, objective, updatedBy],
      )
      return toEntity(row)
    },
  }
}

function createCharterItemRepository(db) {
  function toEntity(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      kind: row.kind,
      title: row.title,
      description: row.description,
      position: row.position,
      state: row.state,
      ownerId: row.owner_id || null,
      taskIds: idList(row.task_ids),
      linkIds: idList(row.link_ids),
      unit: row.unit,
      baseline: row.baseline,
      target: row.target,
      current: row.current === null ? null : row.current,
      startDate: dayOf(row.start_date),
      dueDate: dayOf(row.due_date),
      frequency: row.frequency,
      measuredAt: dayOf(row.measured_at),
      createdBy: row.created_by || null,
      createdAt: row.created,
      updatedAt: row.updated,
    }
  }

  const TEXTS = { kind: 'kind', title: 'title', description: 'description', state: 'state', unit: 'unit', frequency: 'frequency' }
  const RELATIONS = { projectId: 'project_id', ownerId: 'owner_id', createdBy: 'created_by' }
  const NUMBERS = { baseline: 'baseline', target: 'target' }
  const DAYS = { startDate: 'start_date', dueDate: 'due_date', measuredAt: 'measured_at' }

  function columnsOf(data) {
    const values = {}
    Object.keys(data).forEach((key) => {
      const value = data[key]
      if (value === undefined) return
      if (TEXTS[key]) values[TEXTS[key]] = value === null ? '' : value
      else if (RELATIONS[key]) values[RELATIONS[key]] = value || null
      else if (NUMBERS[key]) values[NUMBERS[key]] = typeof value === 'number' ? value : 0
      else if (DAYS[key]) values[DAYS[key]] = dayToDb(value)
      else if (key === 'current') values.current = typeof value === 'number' ? value : null
      else if (key === 'position') values.position = value || 0
      else if (key === 'taskIds') values.task_ids = toJson(value || [])
      else if (key === 'linkIds') values.link_ids = toJson(value || [])
    })
    return values
  }

  return {
    async findById(id) {
      const row = await findRow(db, 'charter_items', id)
      return row ? toEntity(row) : null
    },
    /** Pela posição; empate pela criação. */
    async listByProject(projectId) {
      const rows = await db.query('SELECT * FROM charter_items WHERE project_id = $1 ORDER BY "position" ASC, created ASC, id ASC', [projectId])
      return rows.map(toEntity)
    },
    async create(data) {
      return toEntity(await insertRow(db, 'charter_items', columnsOf(Object.assign({ taskIds: [], linkIds: [] }, data))))
    },
    async update(id, patch) {
      const row = await updateRow(db, 'charter_items', id, columnsOf(patch))
      if (!row) throw appError('CHARTER_ITEM_NOT_FOUND')
      return toEntity(row)
    },
    async delete(id) {
      // as medições saem em cascata (FK)
      await deleteRow(db, 'charter_items', id)
    },
  }
}

function createCharterMeasurementRepository(db) {
  function toEntity(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      itemId: row.item_id,
      value: row.value,
      note: row.note,
      measuredAt: dayOf(row.measured_at),
      createdBy: row.created_by || null,
      createdAt: row.created,
    }
  }

  return {
    /** Mais recente primeiro (pela data da medição; empate pela gravação), até `limit` (0 = todas). */
    async listByItem(itemId, limit) {
      const rows = await db.query('SELECT * FROM charter_measurements WHERE item_id = $1 ORDER BY measured_at DESC, created DESC, id DESC LIMIT $2', [itemId, limit || null])
      return rows.map(toEntity)
    },
    async create(data) {
      const row = await insertRow(db, 'charter_measurements', {
        project_id: data.projectId,
        item_id: data.itemId,
        value: data.value,
        note: data.note || '',
        measured_at: dayToDb(data.measuredAt),
        created_by: data.createdBy || null,
      })
      return toEntity(row)
    },
  }
}

module.exports = { createCharterRepository, createCharterItemRepository, createCharterMeasurementRepository }
