/**
 * Repositórios Postgres de projetos e membros (antes collections `projects` e `project_members` do
 * PocketBase). Membros, tarefas, espaços de documentação etc. saem com o projeto pelas chaves
 * estrangeiras (ON DELETE CASCADE).
 */

const { appError } = require('../../core/errors')
const { newId, ident, direction, likePattern, toDbDate, insertRow, updateRow, findRow, findRows, deleteRow } = require('../sql')
const { storedFileName } = require('../storage')
const { VIEW_STATUSES } = require('../../domain/project')

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
    platformUrl: ['platform_url', 'text'],
    status: ['status', 'text'],
    priority: ['priority', 'text'],
    urgency: ['urgency', 'text'],
    areaId: ['area_id', 'relation'],
    parentId: ['parent_id', 'relation'],
    ownerId: ['owner_id', 'relation'],
    // responsável (quem leva o projeto adiante; não dá permissão)
    leadId: ['lead_id', 'relation'],
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
      platformUrl: row.platform_url || '',
      status: row.status,
      priority: row.priority,
      urgency: row.urgency || null,
      areaId: row.area_id || null,
      parentId: row.parent_id || null,
      ownerId: row.owner_id,
      leadId: row.lead_id || null,
      createdBy: row.created_by || '',
      startDate: row.start_date,
      dueDate: row.due_date,
      archivedAt: row.archived_at,
      createdAt: row.created,
      updatedAt: row.updated,
    }
  }

  /**
   * Colunas ordenadas por expressão (lista de projetos): status na ordem do fluxo, prioridade e urgência
   * pela gravidade, departamento, dono e responsável pelo nome, membros pela quantidade. Vazios sempre por último.
   */
  const SORT_EXPRESSIONS = {
    status: "CASE \"status\" WHEN 'planning' THEN 1 WHEN 'active' THEN 2 WHEN 'paused' THEN 3 WHEN 'completed' THEN 4 WHEN 'cancelled' THEN 5 END",
    priority: "CASE \"priority\" WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'critical' THEN 4 END",
    urgency: "CASE \"urgency\" WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 END",
    area: '(SELECT lower(a."name") FROM "areas" a WHERE a."id" = projects."area_id")',
    owner: '(SELECT lower(u."name") FROM "users" u WHERE u."id" = projects."owner_id")',
    lead: '(SELECT lower(u."name") FROM "users" u WHERE u."id" = projects."lead_id")',
    members: '(SELECT count(*) FROM "project_members" m WHERE m."project_id" = projects."id")',
  }

  function sortClause(sort) {
    const parts = (sort || []).map((s) => {
      const dir = direction(s.direction)
      if (SORT_EXPRESSIONS[s.column]) return `${SORT_EXPRESSIONS[s.column]} ${dir} NULLS LAST`
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
      // em andamento / terminados: o status do projeto decide (domain/project.js#VIEW_STATUSES)
      if (VIEW_STATUSES[query.view]) where.push(`status = ANY(${param(VIEW_STATUSES[query.view].slice())}::text[])`)
      if (query.search) {
        const pattern = param(likePattern(query.search))
        where.push(`(name ILIKE ${pattern} OR "key" ILIKE ${pattern})`)
      }
      if (query.status) where.push(`status = ${param(query.status)}`)
      if (query.priority) where.push(`priority = ${param(query.priority)}`)
      if (query.urgency) where.push(`urgency = ${param(query.urgency === 'none' ? '' : query.urgency)}`)
      if (query.areaId) where.push(query.areaId === 'none' ? 'area_id IS NULL' : `area_id = ${param(query.areaId)}`)
      // `none` = só projetos sem pai (§34)
      if (query.parentId) where.push(query.parentId === 'none' ? 'parent_id IS NULL' : `parent_id = ${param(query.parentId)}`)
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

    /**
     * Projetos abertos (não arquivados) que a pessoa enxerga, pela chave: todos com `viewAll`; senão,
     * os que ela é dona ou membro (mesma regra de domain/project.js#resolveAccess). `ids` restringe.
     */
    async listVisible(query) {
      const where = ['archived_at IS NULL']
      const params = []
      const param = (value) => {
        params.push(value)
        return `$${params.length}`
      }
      if (!query.viewAll) {
        const user = param(query.userId)
        where.push(`(owner_id = ${user} OR id IN (SELECT project_id FROM project_members WHERE user_id = ${user}))`)
      }
      if (query.ids) where.push(`id = ANY(${param(query.ids)}::text[])`)
      const rows = await db.query(`SELECT * FROM projects WHERE ${where.join(' AND ')} ORDER BY "key" ASC, "id" ASC`, params)
      return rows.map(toEntity)
    },

    /** Todos os projetos, inclusive arquivados, pela chave (painel executivo); `ids` restringe. */
    async listAll(query) {
      const ids = query && query.ids
      const rows = ids ? await db.query('SELECT * FROM projects WHERE id = ANY($1::text[]) ORDER BY "key" ASC, "id" ASC', [ids]) : await db.query('SELECT * FROM projects ORDER BY "key" ASC, "id" ASC')
      return rows.map(toEntity)
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

    /** { projetoPai: quantidade de subprojetos (inclusive arquivados) } — só os pais com filhos (§34). */
    async countChildren(ids) {
      const counts = {}
      if (!ids || ids.length === 0) return counts
      const rows = await db.query('SELECT parent_id, count(*)::int AS total FROM projects WHERE parent_id = ANY($1::text[]) GROUP BY parent_id', [ids])
      rows.forEach((row) => {
        counts[row.parent_id] = row.total
      })
      return counts
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

/** Arquivos do projeto (regras §22); o conteúdo fica no Storage em "project_files/<id>/<nome guardado>". */
function createProjectFileRepository(db, ctx) {
  function toEntity(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      mime: row.mime,
      kind: row.kind,
      size: row.size,
      uploadedBy: row.uploaded_by || null,
      createdAt: row.created,
    }
  }

  return {
    async findById(id) {
      const row = await findRow(db, 'project_files', id)
      return row ? toEntity(row) : null
    },
    /** Mais recentes primeiro. */
    async listByProject(projectId) {
      return (await db.query('SELECT * FROM project_files WHERE project_id = $1 ORDER BY created DESC, id DESC', [projectId])).map(toEntity)
    },
    /**
     * `data.handle` é o arquivo enviado ({ buffer, mime, name } — http/files.js). Tipo e tamanho já foram
     * conferidos pelo caso de uso (pelo conteúdo, não pela extensão).
     */
    async create(data) {
      const handle = data.handle || {}
      const id = newId()
      const file = storedFileName(handle.name || data.name)
      await ctx.storage.put(`project_files/${id}/${file}`, handle.buffer, data.mime || handle.mime)
      const row = await insertRow(db, 'project_files', {
        id,
        project_id: data.projectId,
        file,
        name: data.name || '',
        mime: data.mime || '',
        kind: data.kind || '',
        size: data.size || 0,
        uploaded_by: data.uploadedBy || null,
      })
      return toEntity(row)
    },
    /** O gatilho do banco manda o arquivo para a lixeira do Storage. */
    async delete(id) {
      await deleteRow(db, 'project_files', id)
    },
    /** Chave do arquivo no Storage (para servir o download). */
    async fileKeyOf(id) {
      const row = await findRow(db, 'project_files', id)
      if (!row) throw appError('PROJECT_FILE_NOT_FOUND')
      return `project_files/${row.id}/${row.file}`
    },
  }
}

module.exports = { createProjectRepository, createProjectMemberRepository, createProjectFileRepository }
