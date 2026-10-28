/**
 * Repositórios Postgres das tarefas e do que pendura nelas: tags, valores personalizados, comentários,
 * anexos (arquivos no Storage), notificações, sprints, marcos e relações.
 *
 * Convenções (ADR-044): texto vazio é '' (nunca NULL); relação vazia é NULL (FK); datas voltam como
 * Date. Exclusões em cascata, SET NULL e a lixeira dos arquivos ficam com as FKs e os gatilhos do banco.
 */

const { appError } = require('../../core/errors')
const { newId, ident, direction, likePattern, toDbDate, toJson, insertRow, updateRow, findRow, findRows, deleteRow } = require('../sql')
const { storedFileName } = require('../storage')
const { POSITION_STEP } = require('../../domain/workflow')

/** Mapa { chave: [itens] } agrupado por `keyOf`. */
function groupBy(list, keyOf) {
  const map = {}
  list.forEach((item) => {
    const key = keyOf(item)
    map[key] = (map[key] || []).concat(item)
  })
  return map
}

/** Mapa { coluna: total } de linhas { [column]: id, total }. */
function countMap(rows, column) {
  const counts = {}
  rows.forEach((row) => {
    counts[row[column]] = row.total
  })
  return counts
}

/** INSERT de várias linhas numa consulta só (todas com as mesmas colunas). */
async function insertMany(db, table, columns, rows) {
  if (rows.length === 0) return
  const params = []
  const tuples = rows.map((row) => {
    const slots = columns.map((column) => {
      params.push(row[column])
      return `$${params.length}`
    })
    return `(${slots.join(', ')})`
  })
  await db.exec(`INSERT INTO ${ident(table)} (${columns.map(ident).join(', ')}) VALUES ${tuples.join(', ')}`, params)
}

/**
 * Grava as colunas e devolve a linha (tabelas com "updated"). Como o save do PocketBase, uma gravação
 * sem colunas também renova "updated" e avisa o tempo real. Id inexistente: NOT_FOUND.
 */
async function saveRow(db, table, id, values) {
  const row = Object.keys(values).length
    ? await updateRow(db, table, id, values)
    : await db.one(`UPDATE ${ident(table)} SET "updated" = clock_timestamp() WHERE "id" = $1 RETURNING *`, [id])
  if (!row) throw appError('NOT_FOUND')
  return row
}

/** Dia puro (AAAA-MM-DD) de uma data guardada à meia-noite UTC. */
function dayOf(date) {
  return date ? date.toISOString().slice(0, 10) : null
}

/** Dia puro (AAAA-MM-DD) -> meia-noite UTC; vazio -> NULL. */
function dayToDb(value) {
  return value ? toDbDate(`${String(value).slice(0, 10)}T00:00:00.000Z`) : null
}

function createTaskRepository(db) {
  // horas: 0 = não informado (a coluna numérica não aceita nulo, como no PocketBase)
  const hours = (value) => (value > 0 ? value : null)

  /** Entidade da tarefa; a linha enxuta do quadro/backlog não traz a descrição (''). */
  function toEntity(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      number: row.number,
      code: row.code,
      title: row.title,
      description: row.description || '',
      typeId: row.task_type_id,
      statusId: row.status_id,
      priorityId: row.priority_id,
      creatorId: row.creator_id || null,
      assigneeId: row.assignee_id || null,
      reporterId: row.reporter_id || null,
      parentTaskId: row.parent_task_id || null,
      forkedFromTaskId: row.forked_from_task_id || null,
      sprintId: row.sprint_id || null,
      startDate: row.start_date,
      dueDate: row.due_date,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      estimatedHours: hours(row.estimated_hours),
      actualHours: hours(row.actual_hours),
      checklist: row.checklist || [],
      position: row.position,
      createdAt: row.created,
      updatedAt: row.updated,
    }
  }

  /** Colunas do cartão (quadro e backlog): tudo menos a descrição. */
  const CARD_COLUMNS = [
    'id', 'project_id', 'number', 'code', 'title', 'task_type_id', 'status_id', 'priority_id', 'creator_id', 'assignee_id',
    'reporter_id', 'parent_task_id', 'forked_from_task_id', 'sprint_id', 'start_date', 'due_date', 'started_at', 'completed_at',
    'estimated_hours', 'actual_hours', 'checklist', 'position', 'created', 'updated',
  ]
    .map(ident)
    .join(', ')

  /** Colunas de encerramento do quadro: as mais recentes primeiro (sem data por último). */
  const CLOSED_ORDER = 'completed_at DESC NULLS LAST, updated DESC, id ASC'

  const TEXTS ={ code: 'code', title: 'title', description: 'description' }
  const RELATIONS = {
    projectId: 'project_id',
    typeId: 'task_type_id',
    statusId: 'status_id',
    priorityId: 'priority_id',
    creatorId: 'creator_id',
    assigneeId: 'assignee_id',
    reporterId: 'reporter_id',
    parentTaskId: 'parent_task_id',
    forkedFromTaskId: 'forked_from_task_id',
    sprintId: 'sprint_id',
  }
  const DATES = { startDate: 'start_date', dueDate: 'due_date', startedAt: 'started_at', completedAt: 'completed_at' }
  const NUMBERS = { estimatedHours: 'estimated_hours', actualHours: 'actual_hours' }

  function columnsOf(data) {
    const values = {}
    Object.keys(data).forEach((key) => {
      const value = data[key]
      if (value === undefined) return
      if (key === 'number') values.number = value === null ? 0 : value
      else if (TEXTS[key]) values[TEXTS[key]] = value === null ? '' : value
      else if (RELATIONS[key]) values[RELATIONS[key]] = value || null
      else if (DATES[key]) values[DATES[key]] = toDbDate(value)
      else if (NUMBERS[key]) values[NUMBERS[key]] = value === null ? 0 : value
      else if (key === 'checklist') values.checklist = toJson(value || [])
      else if (key === 'position') values.position = value
    })
    return values
  }

  /** Ordenação pública -> expressões SQL (whitelist; nada vem do cliente sem passar por aqui). */
  const ORDER = {
    code: (dir) => [`tasks.number ${dir}`],
    title: (dir) => [`tasks.title ${dir}`],
    created: (dir) => [`tasks.created ${dir}`],
    updated: (dir) => [`tasks.updated ${dir}`],
    // sem prazo sempre por último (no PocketBase, '' ficava de fora com "(due_date = '') ASC")
    due_date: (dir) => ['(tasks.due_date IS NULL) ASC', `tasks.due_date ${dir}`],
    priority: (dir) => [`(SELECT p."order" FROM task_priorities p WHERE p.id = tasks.priority_id) ${dir}`],
    status: (dir) => [`(SELECT s."order" FROM task_statuses s WHERE s.id = tasks.status_id) ${dir}`],
  }

  /** Filtros da listagem geral -> { where, params }. */
  function listFilters(query) {
    const where = []
    const params = []
    const param = (value) => {
      params.push(value)
      return `$${params.length}`
    }
    if (!query.scope.viewAll) where.push(`tasks.project_id IN (SELECT project_id FROM project_members WHERE user_id = ${param(query.scope.userId)})`)
    if (query.projectId) where.push(`tasks.project_id = ${param(query.projectId)}`)
    if (query.typeId) where.push(`tasks.task_type_id = ${param(query.typeId)}`)
    if (query.priorityId) where.push(`tasks.priority_id = ${param(query.priorityId)}`)
    if (query.assigneeId) where.push(`tasks.assignee_id = ${param(query.assigneeId)}`)
    if (query.tagId) where.push(`tasks.id IN (SELECT task_id FROM task_tag_relations WHERE tag_id = ${param(query.tagId)})`)
    if (query.sprintId) where.push(query.sprintId === 'none' ? 'tasks.sprint_id IS NULL' : `tasks.sprint_id = ${param(query.sprintId)}`)
    if (query.statusIds) where.push(query.statusIds.length ? `tasks.status_id = ANY(${param(query.statusIds)}::text[])` : '1 = 0')
    if (query.search) {
      const q = param(likePattern(query.search.text))
      const parts = [`tasks.title ILIKE ${q}`, `tasks.code ILIKE ${q}`]
      if (query.search.fieldIds.length > 0) {
        parts.push(`tasks.id IN (SELECT task_id FROM task_custom_values WHERE field_id = ANY(${param(query.search.fieldIds)}::text[]) AND value_text ILIKE ${q})`)
      }
      where.push(`(${parts.join(' OR ')})`)
    }
    return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params }
  }

  const repo = {
    async findById(id) {
      const row = await findRow(db, 'tasks', id)
      return row ? toEntity(row) : null
    },

    /** Maior posição na coluna (null se vazia). */
    async maxPosition(projectId, statusId) {
      const row = await db.one('SELECT MAX(position) AS n FROM tasks WHERE project_id = $1 AND status_id = $2', [projectId, statusId])
      return row.n === null ? null : row.n
    },

    /** Reescreve as posições da coluna em passos iguais (quando não cabe mais nada entre dois cards). */
    async renumber(projectId, statusId) {
      await db.exec(
        `UPDATE tasks AS t SET position = r.rn * ${POSITION_STEP}
         FROM (SELECT id, row_number() OVER (ORDER BY position ASC, number ASC) AS rn FROM tasks WHERE project_id = $1 AND status_id = $2) AS r
         WHERE t.id = r.id`,
        [projectId, statusId],
      )
    },

    async countByStatus(projectId) {
      const rows = await db.query('SELECT status_id, COUNT(*) AS total FROM tasks WHERE project_id = $1 GROUP BY status_id', [projectId])
      return countMap(rows, 'status_id')
    },

    /** Total por status somando os projetos indicados (quadro de todos os projetos). */
    async countByStatusIn(projectIds) {
      if (projectIds.length === 0) return {}
      const rows = await db.query('SELECT status_id, COUNT(*) AS total FROM tasks WHERE project_id = ANY($1::text[]) GROUP BY status_id', [projectIds])
      return countMap(rows, 'status_id')
    },

    /** Todas as tarefas do projeto (timeline), pela numeração, até `limit` (0 = todas). */
    async listByProject(projectId, limit) {
      const rows = await db.query('SELECT * FROM tasks WHERE project_id = $1 ORDER BY number ASC LIMIT $2', [projectId, limit || null])
      return rows.map(toEntity)
    },

    /**
     * Cards de uma coluna: ordem manual; nas colunas de encerramento, os mais recentes. Consulta enxuta
     * (só as colunas do cartão): o quadro é a chamada mais frequente e a mais pesada em projetos grandes
     * — ver docs/plano-migracao-supabase.md §3 e §4.
     */
    async listForBoard(projectId, statusId, options) {
      // no SQLite a data vazia ('') ficava por último no DESC; no Postgres o NULL viria primeiro
      const order = options.closed ? CLOSED_ORDER : 'position ASC, number ASC'
      const rows = await db.query(`SELECT ${CARD_COLUMNS} FROM tasks WHERE project_id = $1 AND status_id = $2 ORDER BY ${order} LIMIT $3`, [
        projectId,
        statusId,
        options.limit || null,
      ])
      return rows.map(toEntity)
    },

    /**
     * Cards de uma coluna somando vários projetos (quadro de todos os projetos), na mesma consulta enxuta.
     * A posição é de cada projeto: nas colunas abertas os cards se intercalam pela posição (o topo de
     * cada projeto primeiro); nas de encerramento, os mais recentes de todos.
     */
    async listForBoardIn(projectIds, statusId, options) {
      if (projectIds.length === 0) return []
      const order = options.closed ? CLOSED_ORDER : 'position ASC, number ASC, id ASC'
      const rows = await db.query(`SELECT ${CARD_COLUMNS} FROM tasks WHERE project_id = ANY($1::text[]) AND status_id = $2 ORDER BY ${order} LIMIT $3`, [
        projectIds,
        statusId,
        options.limit || null,
      ])
      return rows.map(toEntity)
    },

    /** Backlog: tarefas nos status indicados, em ordem manual (limit 0 = todas); mesma consulta enxuta do quadro. */
    async listBacklog(projectId, statusIds, limit) {
      if (statusIds.length === 0) return []
      const rows = await db.query(
        `SELECT ${CARD_COLUMNS} FROM tasks WHERE project_id = $1 AND status_id = ANY($2::text[]) ORDER BY position ASC, number ASC LIMIT $3`,
        [projectId, statusIds, limit || null],
      )
      return rows.map(toEntity)
    },

    /** Maior posição entre os status indicados (null se não houver tarefas). */
    async maxPositionIn(projectId, statusIds) {
      if (statusIds.length === 0) return null
      const row = await db.one('SELECT MAX(position) AS n FROM tasks WHERE project_id = $1 AND status_id = ANY($2::text[])', [projectId, statusIds])
      return row.n === null ? null : row.n
    },

    /** Renumera juntas as tarefas dos status indicados (backlog com mais de um status). */
    async renumberMany(projectId, statusIds) {
      if (statusIds.length === 0) return
      await db.exec(
        `UPDATE tasks AS t SET position = r.rn * ${POSITION_STEP}
         FROM (SELECT id, row_number() OVER (ORDER BY position ASC, number ASC) AS rn FROM tasks WHERE project_id = $1 AND status_id = ANY($2::text[])) AS r
         WHERE t.id = r.id`,
        [projectId, statusIds],
      )
    },

    async findManyByIds(ids) {
      return (await findRows(db, 'tasks', ids)).map(toEntity)
    },

    /** Linhas enxutas para relatórios (só as colunas usadas nos cálculos). */
    async listForReport(query) {
      const where = []
      const params = []
      const param = (value) => {
        params.push(value)
        return `$${params.length}`
      }
      if (!query.scope.viewAll) where.push(`project_id IN (SELECT project_id FROM project_members WHERE user_id = ${param(query.scope.userId)})`)
      if (!query.includeArchived) where.push('project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)')
      if (query.projectId) where.push(`project_id = ${param(query.projectId)}`)
      if (query.assigneeId) where.push(query.assigneeId === 'none' ? 'assignee_id IS NULL' : `assignee_id = ${param(query.assigneeId)}`)
      if (query.typeId) where.push(`task_type_id = ${param(query.typeId)}`)
      if (query.priorityId) where.push(`priority_id = ${param(query.priorityId)}`)
      if (query.statusId) where.push(`status_id = ${param(query.statusId)}`)
      const rows = await db.query(
        `SELECT id, project_id, task_type_id, status_id, priority_id, assignee_id, created, started_at, completed_at, due_date FROM tasks
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
        params,
      )
      return rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        typeId: r.task_type_id,
        statusId: r.status_id,
        priorityId: r.priority_id,
        assigneeId: r.assignee_id || null,
        createdAt: r.created,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        dueDate: r.due_date,
      }))
    },

    async listChildren(parentId) {
      return (await db.query('SELECT * FROM tasks WHERE parent_task_id = $1 ORDER BY number ASC', [parentId])).map(toEntity)
    },

    async listForks(taskId) {
      return (await db.query('SELECT * FROM tasks WHERE forked_from_task_id = $1 ORDER BY number ASC', [taskId])).map(toEntity)
    },

    /** Progresso das subtarefas por pai: { total, done } (done = status encerrado). */
    async subtaskStats(parentIds, closedStatusIds) {
      const map = {}
      if (parentIds.length === 0) return map
      const rows = await db.query(
        `SELECT parent_task_id, COUNT(*) AS total, COUNT(*) FILTER (WHERE status_id = ANY($2::text[])) AS done
         FROM tasks WHERE parent_task_id = ANY($1::text[]) GROUP BY parent_task_id`,
        [parentIds, closedStatusIds || []],
      )
      rows.forEach((row) => {
        map[row.parent_task_id] = { done: row.done, total: row.total }
      })
      return map
    },

    async listBySprint(sprintId) {
      return (await db.query('SELECT * FROM tasks WHERE sprint_id = $1 ORDER BY number ASC', [sprintId])).map(toEntity)
    },

    /** Tarefas com responsável e prazo antes de `before`, em status abertos (lembretes diários). */
    async listForReminders(query) {
      if (query.statusIds.length === 0) return []
      const rows = await db.query(
        'SELECT * FROM tasks WHERE due_date IS NOT NULL AND due_date < $1 AND assignee_id IS NOT NULL AND status_id = ANY($2::text[])',
        [toDbDate(query.before), query.statusIds],
      )
      return rows.map(toEntity)
    },

    /**
     * Próximo número da tarefa no projeto. Trava a linha do projeto até o fim da transação: duas criações
     * simultâneas no mesmo projeto calculam o número uma depois da outra (o SQLite serializava as
     * gravações; o Postgres não). NO KEY UPDATE não segura as FKs que apontam para o projeto.
     */
    async nextNumber(projectId) {
      await db.query('SELECT id FROM projects WHERE id = $1 FOR NO KEY UPDATE', [projectId])
      const row = await db.one('SELECT COALESCE(MAX(number), 0) AS n FROM tasks WHERE project_id = $1', [projectId])
      return row.n + 1
    },

    async list(query) {
      const { where, params } = listFilters(query)
      const order = []
      query.sort.forEach((s) => {
        if (ORDER[s.column]) ORDER[s.column](direction(s.direction)).forEach((o) => order.push(o))
      })
      order.push('tasks.created ASC', 'tasks.id ASC')
      const page = params.concat([query.pagination.perPage, query.pagination.offset])
      const rows = await db.query(
        `SELECT tasks.* FROM tasks ${where} ORDER BY ${order.join(', ')} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        page,
      )
      const count = await db.one(`SELECT COUNT(*) AS total FROM tasks ${where}`, params)
      return { items: rows.map(toEntity), total: count.total }
    },

    async create(data) {
      return toEntity(await insertRow(db, 'tasks', columnsOf(data)))
    },

    /** Mesmo sem colunas próprias, renova o "updated" (ordenação por atividade). */
    async update(id, patch) {
      return toEntity(await saveRow(db, 'tasks', id, columnsOf(patch)))
    },

    async delete(id) {
      // valores, tags, comentários, anexos, relações e notificações saem em cascata (FKs)
      await deleteRow(db, 'tasks', id)
    },
  }
  return repo
}

function createTaskTagRepository(db) {
  return {
    async listByTasks(taskIds) {
      if (taskIds.length === 0) return {}
      const rows = await db.query('SELECT task_id, tag_id FROM task_tag_relations WHERE task_id = ANY($1::text[])', [taskIds])
      const map = {}
      rows.forEach((row) => {
        map[row.task_id] = (map[row.task_id] || []).concat(row.tag_id)
      })
      return map
    },
    async replace(taskId, tagIds) {
      await db.exec('DELETE FROM task_tag_relations WHERE task_id = $1', [taskId])
      await insertMany(db, 'task_tag_relations', ['id', 'task_id', 'tag_id'], tagIds.map((tagId) => ({ id: newId(), task_id: taskId, tag_id: tagId })))
    },
  }
}

function createTaskValueRepository(db) {
  /** Cópias indexadas do valor conforme o tipo do campo (busca, filtro e ordenação). */
  function indexColumns(type, value) {
    const columns = { value_text: '', value_number: 0, value_date: null, value_bool: false }
    if (value === null || value === undefined) return columns
    if (type === 'number' || type === 'decimal') columns.value_number = value
    else if (type === 'boolean') columns.value_bool = value === true
    else if (type === 'date' || type === 'datetime') columns.value_date = toDbDate(value)
    else if (Array.isArray(value)) columns.value_text = value.join(',').slice(0, 500)
    else columns.value_text = String(value).slice(0, 500)
    return columns
  }

  const COLUMNS = ['id', 'task_id', 'field_id', 'value', 'value_text', 'value_number', 'value_date', 'value_bool']

  return {
    async listByTasks(taskIds) {
      if (taskIds.length === 0) return {}
      const rows = await db.query('SELECT task_id, field_id, value FROM task_custom_values WHERE task_id = ANY($1::text[])', [taskIds])
      const map = {}
      rows.forEach((row) => {
        map[row.task_id] = map[row.task_id] || {}
        map[row.task_id][row.field_id] = row.value
      })
      return map
    },

    /** Substitui todos os valores da tarefa. `values` = { fieldId: valor }; `types` = { fieldId: tipo }. */
    async replace(taskId, values, types) {
      await db.exec('DELETE FROM task_custom_values WHERE task_id = $1', [taskId])
      const rows = Object.keys(values).map((fieldId) =>
        Object.assign({ id: newId(), task_id: taskId, field_id: fieldId, value: toJson(values[fieldId]) }, indexColumns((types || {})[fieldId], values[fieldId])),
      )
      await insertMany(db, 'task_custom_values', COLUMNS, rows)
    },
  }
}

function createCommentRepository(db) {
  function toEntity(row) {
    return {
      id: row.id,
      taskId: row.task_id,
      userId: row.user_id,
      content: row.content,
      mentions: row.mentions || [],
      editedAt: row.edited_at,
      deletedAt: row.deleted_at,
      createdAt: row.created,
      updatedAt: row.updated,
    }
  }

  function columnsOf(data) {
    const values = {}
    if (data.taskId !== undefined) values.task_id = data.taskId || null
    if (data.userId !== undefined) values.user_id = data.userId || null
    if (data.content !== undefined) values.content = data.content === null ? '' : data.content
    if (data.mentions !== undefined) values.mentions = toJson(data.mentions)
    if (data.editedAt !== undefined) values.edited_at = toDbDate(data.editedAt)
    if (data.deletedAt !== undefined) values.deleted_at = toDbDate(data.deletedAt)
    return values
  }

  return {
    async findById(id) {
      const row = await findRow(db, 'comments', id)
      return row ? toEntity(row) : null
    },
    async listByTask(taskId) {
      return (await db.query('SELECT * FROM comments WHERE task_id = $1 ORDER BY created ASC, id ASC', [taskId])).map(toEntity)
    },
    async create(data) {
      return toEntity(await insertRow(db, 'comments', columnsOf(data)))
    },
    async update(id, patch) {
      return toEntity(await saveRow(db, 'comments', id, columnsOf(patch)))
    },
    /** Comentários não excluídos por tarefa. */
    async countByTasks(taskIds) {
      if (taskIds.length === 0) return {}
      const rows = await db.query(
        'SELECT task_id, COUNT(*) AS total FROM comments WHERE task_id = ANY($1::text[]) AND deleted_at IS NULL GROUP BY task_id',
        [taskIds],
      )
      return countMap(rows, 'task_id')
    },
  }
}

/** Anexos das tarefas e dos comentários; o arquivo fica no Storage em "attachments/<id>/<nome guardado>". */
function createAttachmentRepository(db, ctx) {
  const keyOf = (row) => `attachments/${row.id}/${row.file}`

  function toEntity(row) {
    return {
      id: row.id,
      taskId: row.task_id,
      name: row.name,
      mime: row.mime,
      kind: row.kind,
      size: row.size,
      uploadedBy: row.uploaded_by || null,
      commentId: row.comment_id || null,
      createdAt: row.created,
    }
  }

  const repo = {
    async findById(id) {
      const row = await findRow(db, 'attachments', id)
      return row ? toEntity(row) : null
    },
    async findManyByIds(ids) {
      return (await findRows(db, 'attachments', ids)).map(toEntity)
    },
    /** Só os anexos da tarefa (os de comentário aparecem no comentário). */
    async listByTask(taskId) {
      return (await db.query('SELECT * FROM attachments WHERE task_id = $1 AND comment_id IS NULL ORDER BY created ASC, id ASC', [taskId])).map(toEntity)
    },
    async listByComments(commentIds) {
      if (commentIds.length === 0) return {}
      const rows = await db.query('SELECT * FROM attachments WHERE comment_id = ANY($1::text[]) ORDER BY created ASC, id ASC', [commentIds])
      return groupBy(rows.map(toEntity), (item) => item.commentId)
    },
    /** O gatilho do banco manda os arquivos para a lixeira do Storage. */
    async deleteByComment(commentId) {
      await db.exec('DELETE FROM attachments WHERE comment_id = $1', [commentId])
    },
    /**
     * `data.handle` é o arquivo enviado ({ buffer, mime, name, size } — http/files.js). Tipo e tamanho
     * já foram conferidos pelo caso de uso (pelo conteúdo, não pela extensão).
     */
    async create(data) {
      const handle = data.handle || {}
      const id = newId()
      const file = storedFileName(handle.name || data.name)
      await ctx.storage.put(`attachments/${id}/${file}`, handle.buffer, data.mime || handle.mime)
      const row = await insertRow(db, 'attachments', {
        id,
        task_id: data.taskId,
        file,
        name: data.name || '',
        mime: data.mime || '',
        kind: data.kind || '',
        size: data.size || 0,
        uploaded_by: data.uploadedBy || null,
        comment_id: data.commentId || null,
      })
      return toEntity(row)
    },
    /** O gatilho do banco manda o arquivo para a lixeira do Storage. */
    async delete(id) {
      await deleteRow(db, 'attachments', id)
    },
    /** Anexos da tarefa (fora dos comentários) por tarefa. */
    async countByTasks(taskIds) {
      if (taskIds.length === 0) return {}
      const rows = await db.query(
        'SELECT task_id, COUNT(*) AS total FROM attachments WHERE task_id = ANY($1::text[]) AND comment_id IS NULL GROUP BY task_id',
        [taskIds],
      )
      return countMap(rows, 'task_id')
    },
    /** Copia o arquivo (bytes) para outra tarefa; usado pelo fork. */
    async copyTo(id, target) {
      const source = await findRow(db, 'attachments', id)
      if (!source) throw appError('ATTACHMENT_NOT_FOUND')
      const bytes = await ctx.storage.read(keyOf(source))
      if (!bytes) throw new Error(`Arquivo do anexo ${id} não encontrado no Storage`)
      return repo.create({
        taskId: target.taskId,
        handle: { buffer: bytes, mime: source.mime, name: source.name, size: bytes.length },
        name: source.name,
        mime: source.mime,
        kind: source.kind,
        size: source.size,
        uploadedBy: target.uploadedBy,
        commentId: null,
      })
    },
    /** Chave do arquivo no Storage (para servir o download). */
    async fileKeyOf(id) {
      const row = await findRow(db, 'attachments', id)
      if (!row) throw appError('ATTACHMENT_NOT_FOUND')
      return keyOf(row)
    },
  }
  return repo
}

function createNotificationRepository(db) {
  function toEntity(row) {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      taskId: row.task_id || null,
      planItemId: row.plan_item_id || null,
      projectId: row.project_id || null,
      actorId: row.actor_id || null,
      data: row.data || {},
      dedupeKey: row.dedupe_key,
      readAt: row.read_at,
      createdAt: row.created,
    }
  }

  return {
    /**
     * Com `dedupeKey`, no máximo uma por pessoa (índice único parcial idx_notifications_dedupe): se outra
     * transação gravou a mesma chave primeiro, nada é inserido e volta a notificação que já existe.
     */
    async create(data) {
      const userId = data.userId
      const dedupeKey = data.dedupeKey || ''
      const row = await db.one(
        `INSERT INTO notifications (id, user_id, type, task_id, plan_item_id, project_id, actor_id, data, dedupe_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key != '' DO NOTHING
         RETURNING *`,
        [newId(), userId, data.type || '', data.taskId || null, data.planItemId || null, data.projectId || null, data.actorId || null, toJson(data.data || {}), dedupeKey],
      )
      if (row) return toEntity(row)
      return toEntity(await db.one('SELECT * FROM notifications WHERE user_id = $1 AND dedupe_key = $2', [userId, dedupeKey]))
    },
    async existsKey(userId, key) {
      return !!(await db.one('SELECT 1 AS found FROM notifications WHERE user_id = $1 AND dedupe_key = $2 LIMIT 1', [userId, key]))
    },
    async findById(id) {
      const row = await findRow(db, 'notifications', id)
      return row ? toEntity(row) : null
    },
    /** Mais recentes primeiro. */
    async listByUser(userId, query) {
      const where = query.unreadOnly ? 'user_id = $1 AND read_at IS NULL' : 'user_id = $1'
      const rows = await db.query(`SELECT * FROM notifications WHERE ${where} ORDER BY created DESC, id DESC LIMIT $2 OFFSET $3`, [
        userId,
        query.pagination.perPage,
        query.pagination.offset,
      ])
      const count = await db.one(`SELECT COUNT(*) AS total FROM notifications WHERE ${where}`, [userId])
      return { items: rows.map(toEntity), total: count.total }
    },
    async countUnread(userId) {
      return (await db.one('SELECT COUNT(*) AS total FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId])).total
    },
    async markRead(id, at) {
      await db.exec('UPDATE notifications SET read_at = $2 WHERE id = $1', [id, toDbDate(at)])
    },
    /** Quantas foram marcadas. */
    async markAllRead(userId, at) {
      return db.exec('UPDATE notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL', [userId, toDbDate(at)])
    },
  }
}

function createSprintRepository(db) {
  function toEntity(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      goal: row.goal,
      startDate: dayOf(row.start_date),
      endDate: dayOf(row.end_date),
      state: row.state,
      order: row.order,
      createdBy: row.created_by || null,
      createdAt: row.created,
      updatedAt: row.updated,
    }
  }

  const TEXTS = { name: 'name', goal: 'goal', state: 'state' }
  const RELATIONS = { projectId: 'project_id', createdBy: 'created_by' }
  function columnsOf(data) {
    const values = {}
    Object.keys(data).forEach((key) => {
      const value = data[key]
      if (value === undefined) return
      if (TEXTS[key]) values[TEXTS[key]] = value === null ? '' : value
      else if (RELATIONS[key]) values[RELATIONS[key]] = value || null
      else if (key === 'order') values.order = value === null ? 0 : value
      // dia puro (meia-noite UTC)
      else if (key === 'startDate') values.start_date = dayToDb(value)
      else if (key === 'endDate') values.end_date = dayToDb(value)
    })
    return values
  }

  return {
    async findById(id) {
      const row = await findRow(db, 'sprints', id)
      return row ? toEntity(row) : null
    },
    async findManyByIds(ids) {
      return (await findRows(db, 'sprints', ids)).map(toEntity)
    },
    /** Encerradas por último; depois a ordem manual e a criação. */
    async listByProject(projectId, options) {
      const open = options && options.includeClosed ? '' : "AND state != 'closed'"
      const rows = await db.query(
        `SELECT * FROM sprints WHERE project_id = $1 ${open} ORDER BY (state = 'closed') ASC, "order" ASC, created ASC, id ASC`,
        [projectId],
      )
      return rows.map(toEntity)
    },
    async create(data) {
      return toEntity(await insertRow(db, 'sprints', columnsOf(data)))
    },
    async update(id, patch) {
      return toEntity(await saveRow(db, 'sprints', id, columnsOf(patch)))
    },
    /** As tarefas da sprint ficam sem sprint (FK com SET NULL). */
    async delete(id) {
      await deleteRow(db, 'sprints', id)
    },
  }
}

/** Marcos do projeto (timeline). `dueDate` em AAAA-MM-DD (dia puro, como nas sprints). */
function createMilestoneRepository(db) {
  function toEntity(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      dueDate: dayOf(row.due_date),
      state: row.state,
      createdBy: row.created_by || null,
      createdAt: row.created,
      updatedAt: row.updated,
    }
  }

  const TEXTS = { name: 'name', description: 'description', state: 'state' }
  const RELATIONS = { projectId: 'project_id', createdBy: 'created_by' }
  function columnsOf(data) {
    const values = {}
    Object.keys(data).forEach((key) => {
      const value = data[key]
      if (value === undefined) return
      if (TEXTS[key]) values[TEXTS[key]] = value === null ? '' : value
      else if (RELATIONS[key]) values[RELATIONS[key]] = value || null
      else if (key === 'dueDate') values.due_date = dayToDb(value)
    })
    return values
  }

  return {
    async findById(id) {
      const row = await findRow(db, 'project_milestones', id)
      return row ? toEntity(row) : null
    },
    /** Pela data (sem data primeiro, como o '' no SQLite); empate pela criação. */
    async listByProject(projectId) {
      const rows = await db.query('SELECT * FROM project_milestones WHERE project_id = $1 ORDER BY due_date ASC NULLS FIRST, created ASC, id ASC', [projectId])
      return rows.map(toEntity)
    },
    async create(data) {
      return toEntity(await insertRow(db, 'project_milestones', columnsOf(data)))
    },
    async update(id, patch) {
      return toEntity(await saveRow(db, 'project_milestones', id, columnsOf(patch)))
    },
    async delete(id) {
      await deleteRow(db, 'project_milestones', id)
    },
  }
}

function createRelationRepository(db) {
  function toEntity(row) {
    return {
      id: row.id,
      type: row.relation_type,
      sourceId: row.source_task_id,
      targetId: row.target_task_id,
      createdBy: row.created_by || null,
      createdAt: row.created,
    }
  }

  return {
    async findById(id) {
      const row = await findRow(db, 'task_relations', id)
      return row ? toEntity(row) : null
    },
    async listByTask(taskId) {
      const rows = await db.query('SELECT * FROM task_relations WHERE source_task_id = $1 OR target_task_id = $1 ORDER BY created ASC, id ASC', [taskId])
      return rows.map(toEntity)
    },
    /** Relações entre o mesmo par (qualquer sentido). */
    async listBetween(a, b) {
      const rows = await db.query(
        `SELECT * FROM task_relations
         WHERE (source_task_id = $1 AND target_task_id = $2) OR (source_task_id = $2 AND target_task_id = $1)
         ORDER BY created ASC, id ASC`,
        [a, b],
      )
      return rows.map(toEntity)
    },
    /** Arestas "vem antes" que saem dos ids (bloqueia: origem->destino; depende de: destino->origem). */
    async precedenceFrom(ids) {
      if (ids.length === 0) return []
      const rows = await db.query(
        `SELECT * FROM task_relations
         WHERE (relation_type = 'blocks' AND source_task_id = ANY($1::text[])) OR (relation_type = 'depends_on' AND target_task_id = ANY($1::text[]))`,
        [ids],
      )
      return rows.map(toEntity)
    },
    /** Quem bloqueia cada tarefa: [{ taskId, blockerId }]. */
    async blockersOf(taskIds) {
      if (taskIds.length === 0) return []
      const rows = await db.query(
        `SELECT * FROM task_relations
         WHERE (relation_type = 'blocks' AND target_task_id = ANY($1::text[])) OR (relation_type = 'depends_on' AND source_task_id = ANY($1::text[]))`,
        [taskIds],
      )
      return rows
        .map(toEntity)
        .map((rel) => (rel.type === 'blocks' ? { taskId: rel.targetId, blockerId: rel.sourceId } : { taskId: rel.sourceId, blockerId: rel.targetId }))
    },
    async create(data) {
      try {
        const row = await insertRow(db, 'task_relations', {
          source_task_id: data.sourceId,
          target_task_id: data.targetId,
          relation_type: data.type || '',
          created_by: data.createdBy || null,
        })
        return toEntity(row)
      } catch (err) {
        // mesma relação gravada por outra requisição ao mesmo tempo (idx_task_relations_unique)
        if (err && err.code === '23505') throw appError('RELATION_EXISTS')
        throw err
      }
    },
    async delete(id) {
      await deleteRow(db, 'task_relations', id)
    },
    async deleteByTask(taskId) {
      await db.exec('DELETE FROM task_relations WHERE source_task_id = $1 OR target_task_id = $1', [taskId])
    },
  }
}

module.exports = {
  createTaskRepository,
  createTaskTagRepository,
  createTaskValueRepository,
  createCommentRepository,
  createAttachmentRepository,
  createNotificationRepository,
  createSprintRepository,
  createMilestoneRepository,
  createRelationRepository,
}
