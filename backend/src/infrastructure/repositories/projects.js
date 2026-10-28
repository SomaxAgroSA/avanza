/**
 * Repositórios Postgres de projetos e membros (antes collections `projects` e `project_members` do
 * PocketBase). Membros, tarefas, espaços de documentação etc. saem com o projeto pelas chaves
 * estrangeiras (ON DELETE CASCADE).
 */

const { appError } = require('../../core/errors')
const { ident, direction, likePattern, toDbDate, insertRow, updateRow, findRow, findRows, deleteRow } = require('../sql')

/** Violação de índice único do Postgres (23505) no índice `index`. */
function isUniqueViolation(err, index) {
  return !!err && err.code === '23505' && err.constraint === index
}

/** Executa `fn` e troca a violação do índice único `index` pelo erro de aplicação `code`. */
async function uniqueAs(index, code, fn) {
  try {
    return await fn()
  } catch (err) {
    if (isUniqueViolation(err, index)) throw appError(code)
    throw err
  }
}

/**
 * Colunas a gravar a partir de `data` ({ chaveDaEntidade: valor }) conforme `fields`
 * ({ chave: [coluna, tipo] }): texto vazio é '' e relação/data vazia é NULL (como o PocketBase gravava).
 */
function columns(fields, data) {
  const values = {}
  Object.keys(data).forEach((key) => {
    const spec = fields[key]
    if (!spec) return
    const value = data[key]
    if (spec[1] === 'text') values[spec[0]] = value === undefined || value === null ? '' : value
    else if (spec[1] === 'relation') values[spec[0]] = value || null
    else if (spec[1] === 'date') values[spec[0]] = toDbDate(value)
  })
  return values
}

function createProjectRepository(db) {
  const TABLE = 'projects'
  const FIELDS = {
    name: ['name', 'text'],
    key: ['key', 'text'],
    description: ['description', 'text'],
    icon: ['icon', 'text'],
    cover: ['cover', 'text'],
    status: ['status', 'text'],
    priority: ['priority', 'text'],
    ownerId: ['owner_id', 'relation'],
    createdBy: ['created_by', 'relation'],
    startDate: ['start_date', 'date'],
    dueDate: ['due_date', 'date'],
    archivedAt: ['archived_at', 'date'],
  }
  // datas vazias eram '' no PocketBase (antes de qualquer data): vazias primeiro na ordem crescente
  const NULLABLE = new Set(['start_date', 'due_date', 'archived_at'])

  function toEntity(row) {
    return {
      id: row.id,
      name: row.name,
      key: row.key,
      description: row.description,
      icon: row.icon,
      cover: row.cover,
      status: row.status,
      priority: row.priority,
      ownerId: row.owner_id,
      createdBy: row.created_by || '',
      startDate: row.start_date,
      dueDate: row.due_date,
      archivedAt: row.archived_at,
      createdAt: row.created,
      updatedAt: row.updated,
    }
  }

  function sortClause(sort) {
    const parts = (sort || []).map((s) => {
      const dir = direction(s.direction)
      const nulls = NULLABLE.has(s.column) ? (dir === 'ASC' ? ' NULLS FIRST' : ' NULLS LAST') : ''
      return `${ident(s.column)} ${dir}${nulls}`
    })
    return `ORDER BY ${parts.concat(['"id" ASC']).join(', ')}`
  }

  return {
    async findById(id) {
      const row = await findRow(db, TABLE, id)
      return row ? toEntity(row) : null
    },

    async findByKey(key) {
      const row = await db.one('SELECT * FROM projects WHERE "key" = $1', [key])
      return row ? toEntity(row) : null
    },

    async list(query) {
      const where = []
      const params = []
      const param = (value) => {
        params.push(value)
        return `$${params.length}`
      }
      if (query.view === 'mine' || !query.scope.viewAll) {
        where.push(`id IN (SELECT project_id FROM project_members WHERE user_id = ${param(query.scope.userId)})`)
      }
      where.push(query.view === 'archived' ? 'archived_at IS NOT NULL' : 'archived_at IS NULL')
      if (query.search) {
        const pattern = param(likePattern(query.search))
        where.push(`(name ILIKE ${pattern} OR "key" ILIKE ${pattern})`)
      }
      if (query.status) where.push(`status = ${param(query.status)}`)
      if (query.priority) where.push(`priority = ${param(query.priority)}`)
      if (query.ownerId) where.push(`owner_id = ${param(query.ownerId)}`)

      const filter = `WHERE ${where.join(' AND ')}`
      const counted = await db.one(`SELECT count(*) AS total FROM projects ${filter}`, params)
      const page = params.concat([query.pagination.perPage, query.pagination.offset])
      const rows = await db.query(
        `SELECT * FROM projects ${filter} ${sortClause(query.sort)} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        page,
      )
      return { items: rows.map(toEntity), total: counted.total }
    },

    async create(data) {
      const row = await uniqueAs('idx_projects_key', 'PROJECT_KEY_IN_USE', () => insertRow(db, TABLE, columns(FIELDS, data)))
      return toEntity(row)
    },

    async update(id, patch) {
      const row = await uniqueAs('idx_projects_key', 'PROJECT_KEY_IN_USE', () => updateRow(db, TABLE, id, columns(FIELDS, patch)))
      return row ? toEntity(row) : null
    },

    async delete(id) {
      await deleteRow(db, TABLE, id)
    },

    async findManyByIds(ids) {
      return (await findRows(db, TABLE, ids)).map(toEntity)
    },
  }
}

function createProjectMemberRepository(db) {
  const TABLE = 'project_members'

  function toEntity(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      userId: row.user_id,
      role: row.role,
      createdAt: row.created,
    }
  }

  return {
    async find(projectId, userId) {
      const row = await db.one('SELECT * FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId])
      return row ? toEntity(row) : null
    },

    async listByProject(projectId) {
      return (await db.query('SELECT * FROM project_members WHERE project_id = $1 ORDER BY created ASC, id ASC', [projectId])).map(toEntity)
    },

    async add(data) {
      const row = await uniqueAs('idx_project_members_pair', 'MEMBER_ALREADY_EXISTS', () =>
        insertRow(db, TABLE, { project_id: data.projectId, user_id: data.userId, role: data.role || '' }),
      )
      return toEntity(row)
    },

    async updateRole(projectId, userId, role) {
      const row = await db.one('UPDATE project_members SET role = $3 WHERE project_id = $1 AND user_id = $2 RETURNING *', [projectId, userId, role || ''])
      return row ? toEntity(row) : null
    },

    async remove(projectId, userId) {
      await db.exec('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId])
    },

    async removeAllForProject(projectId) {
      await db.exec('DELETE FROM project_members WHERE project_id = $1', [projectId])
    },

    /** { projectId: quantidade } — só os projetos com membros. */
    async countByProjects(ids) {
      const counts = {}
      if (!ids || ids.length === 0) return counts
      const rows = await db.query(
        'SELECT project_id, count(*) AS total FROM project_members WHERE project_id = ANY($1::text[]) GROUP BY project_id',
        [ids],
      )
      rows.forEach((row) => {
        counts[row.project_id] = row.total
      })
      return counts
    },

    /** { projectId: papel } do usuário nos projetos informados. */
    async rolesForUser(userId, ids) {
      const roles = {}
      if (!ids || ids.length === 0) return roles
      const rows = await db.query('SELECT project_id, role FROM project_members WHERE user_id = $1 AND project_id = ANY($2::text[])', [userId, ids])
      rows.forEach((row) => {
        roles[row.project_id] = row.role
      })
      return roles
    },
  }
}

module.exports = { createProjectRepository, createProjectMemberRepository }
