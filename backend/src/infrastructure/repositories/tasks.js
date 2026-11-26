/**
 * Repositórios Postgres das tarefas e do que pendura nelas: tags, valores personalizados, comentários,
 * anexos (arquivos no Storage), notificações, sprints, marcos e relações.
 *
 * Convenções (ADR-044): texto vazio é '' (nunca NULL); relação vazia é NULL (FK); datas voltam como
 * Date. Exclusões em cascata, SET NULL e a lixeira dos arquivos ficam com as FKs e os gatilhos do banco.
 */

const { appError } = require('../../core/errors')
const { newId, ident, direction, likePattern, toDbDate, toJson, insertRow, updateRow, findRow, findRows, deleteRow } = require('../sql')
const { dueRange } = require('../../domain/task')
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

/**
 * Tarefas que a pessoa enxerga sem `projects.view_all` (regras §33 e §36): as dos projetos em que é membro
 * sem ser Responsável TI e, nos projetos em que é Responsável TI, só as atribuídas a ela ou marcadas
 * "Visível para TI". `user` é o marcador do parâmetro ($n); `alias` o prefixo da tabela ('' ou 'tasks.').
 */
function visibleTasksClause(user, alias) {
  const t = alias || ''
  return (
    `(${t}project_id IN (SELECT project_id FROM project_members WHERE user_id = ${user} AND role <> 'it')` +
    ` OR ((${t}assignee_id = ${user} OR ${t}it_visible) AND ${t}project_id IN (SELECT project_id FROM project_members WHERE user_id = ${user} AND role = 'it')))`
  )
}

/** Tarefa enxuta do Equipo ahora (com o status para classificar e o fluxo do responsável, §45). */
function activityTask(r) {
  return {
    id: r.id,
    code: r.code,
    title: r.title,
    projectId: r.project_id,
    assigneeId: r.assignee_id || null,
    updatedAt: r.updated,
    // fluxo do responsável (§45): para quem chama filtrar as demandas internas que a pessoa enxerga
    reporterId: r.reporter_id || null,
    demandOwnerId: r.demand_owner_id || null,
    demandPastAssignees: r.demand_past_assignees || [],
    demandStatus: r.demand_status || '',
    status: { id: r.status_id, name: r.status_name, color: r.status_color, category: r.status_category },
  }
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
      planItemId: row.plan_item_id || null,
      areaId: row.area_id || null,
      // empresa própria: só a demanda interna (§46); a tarefa de projeto herda a do projeto
      companyId: row.company_id || null,
      startDate: row.start_date,
      dueDate: row.due_date,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      estimatedHours: hours(row.estimated_hours),
      actualHours: hours(row.actual_hours),
      checklist: row.checklist || [],
      reportExcluded: !!row.report_excluded,
      itVisible: !!row.it_visible,
      urgency: row.urgency || null,
      // demanda interna (§45): '' = tarefa de projeto
      demandStatus: row.demand_status || '',
      demandOwnerId: row.demand_owner_id || null,
      demandPastAssignees: row.demand_past_assignees || [],
      position: row.position,
      createdAt: row.created,
      updatedAt: row.updated,
    }
  }

  /** Colunas do cartão (quadro e backlog): tudo menos a descrição. */
  const CARD_COLUMNS = [
    'id', 'project_id', 'number', 'code', 'title', 'task_type_id', 'status_id', 'priority_id', 'creator_id', 'assignee_id',
    'reporter_id', 'parent_task_id', 'forked_from_task_id', 'sprint_id', 'plan_item_id', 'area_id', 'company_id', 'start_date', 'due_date', 'started_at', 'completed_at',
    'estimated_hours', 'actual_hours', 'checklist', 'report_excluded', 'it_visible', 'urgency', 'demand_status', 'demand_owner_id', 'demand_past_assignees',
    'position', 'created', 'updated',
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
    planItemId: 'plan_item_id',
    areaId: 'area_id',
    companyId: 'company_id',
    demandOwnerId: 'demand_owner_id',
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
      else if (key === 'reportExcluded') values.report_excluded = !!value
      else if (key === 'itVisible') values.it_visible = !!value
      // urgência vazia = '' (texto vazio, nunca NULL)
      else if (key === 'urgency') values.urgency = value || ''
      else if (key === 'demandStatus') values.demand_status = value || ''
      else if (key === 'demandPastAssignees') values.demand_past_assignees = (value || []).slice()
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
    if (!query.scope.viewAll) {
      const user = param(query.scope.userId)
      // fluxo do responsável (§45; demanda interna ou tarefa de projeto com responsável): quem pediu, o
      // responsável e quem executa (agora ou antes); na demanda interna, também quem está na mesma área do
      // responsável (`areaMates` = colegas de área de quem consulta, inclusive ela)
      const mates =
        query.scope.areaMates && query.scope.areaMates.length
          ? ` OR (tasks.demand_owner_id = ANY(${param(query.scope.areaMates)}::text[]) AND tasks.project_id IN (SELECT id FROM projects WHERE "kind" <> ''))`
          : ''
      where.push(
        `(${visibleTasksClause(user, 'tasks.')} OR (tasks.demand_status <> '' AND (tasks.reporter_id = ${user} OR tasks.demand_owner_id = ${user}` +
          ` OR tasks.assignee_id = ${user} OR ${user}::text = ANY(tasks.demand_past_assignees)${mates})))`,
      )
    }
    // Com projeto · Sem projeto (§45): sem projeto = a caixa de sistema das demandas internas
    if (query.kind === 'project') where.push(`tasks.project_id IN (SELECT id FROM projects WHERE "kind" = '')`)
    if (query.kind === 'demand') where.push(`tasks.project_id IN (SELECT id FROM projects WHERE "kind" <> '')`)
    // "Minhas tarefas": as atribuídas a mim e, nas demandas, também as que pedi ou recebi
    if (query.mineId) {
      const me = param(query.mineId)
      where.push(`(tasks.assignee_id = ${me} OR (tasks.demand_status <> '' AND (tasks.reporter_id = ${me} OR tasks.demand_owner_id = ${me})))`)
    }
    // caixas da tela Demandas: recebidas por mim, atribuídas a mim, pedidas por mim e Todas (`all`)
    if (query.demandBox) {
      const box = query.demandBox
      if (box.box === 'assigned') {
        // Atribuídas a mim (ajuste 23/11): as que estão comigo e as que passei a outra pessoa; das concluídas, só as recentes
        const me = param(box.userId)
        where.push(`tasks.demand_status <> '' AND (tasks.assignee_id = ${me} OR ${me}::text = ANY(tasks.demand_past_assignees))`)
        if (box.doneSince) where.push(`(tasks.demand_status <> 'done' OR tasks.completed_at IS NULL OR tasks.completed_at >= ${param(box.doneSince)})`)
      } else {
        const column = { received: 'demand_owner_id', requested: 'reporter_id' }[box.box]
        where.push(column ? `tasks.demand_status <> '' AND tasks.${column} = ${param(box.userId)}` : `tasks.demand_status <> ''`)
      }
    }
    if (query.demandOwnerId) where.push(`tasks.demand_owner_id = ${param(query.demandOwnerId)}`)
    if (query.demandStatuses) where.push(`tasks.demand_status = ANY(${param(query.demandStatuses)}::text[])`)
    if (query.projectId) where.push(`tasks.project_id = ${param(query.projectId)}`)
    if (query.typeId) where.push(`tasks.task_type_id = ${param(query.typeId)}`)
    // prioridade e urgência: um valor ou vários (lista = "ou")
    if (query.priorityId) where.push(`tasks.priority_id = ANY(${param([].concat(query.priorityId))}::text[])`)
    // pessoas: uma ou várias (lista = "ou"); `none` = sem ninguém
    const person = (column, value) => {
      const ids = [].concat(value)
      const known = ids.filter((id) => id !== 'none')
      const parts = []
      if (known.length) parts.push(`${column} = ANY(${param(known)}::text[])`)
      if (ids.indexOf('none') >= 0) parts.push(`${column} IS NULL`)
      return `(${parts.join(' OR ')})`
    }
    if (query.assigneeId) where.push(person('tasks.assignee_id', query.assigneeId))
    // Responsável (Lista de tarefas): quem recebe e distribui (§45) ou, sem ele, a pessoa atribuída
    if (query.responsibleId) where.push(person('COALESCE(tasks.demand_owner_id, tasks.assignee_id)', query.responsibleId))
    // Prazo em grupos (vencidas, hoje, próximos 7 dias, mais adiante, sem prazo): vários = "ou"
    if (query.due && query.due.groups.length) {
      const parts = query.due.groups.map((group) => {
        const range = dueRange(group, query.due.today)
        if (!range) return 'tasks.due_date IS NULL'
        const bounds = []
        if (range.from) bounds.push(`tasks.due_date >= ${param(toDbDate(range.from))}`)
        if (range.before) bounds.push(`tasks.due_date < ${param(toDbDate(range.before))}`)
        return `(${bounds.join(' AND ')})`
      })
      where.push(`(${parts.join(' OR ')})`)
    }
    if (query.tagId) where.push(`tasks.id IN (SELECT task_id FROM task_tag_relations WHERE tag_id = ${param(query.tagId)})`)
    if (query.sprintId) where.push(query.sprintId === 'none' ? 'tasks.sprint_id IS NULL' : `tasks.sprint_id = ${param(query.sprintId)}`)
    if (query.planItemId) where.push(`tasks.plan_item_id = ${param(query.planItemId)}`)
    if (query.inReport !== undefined) where.push(`tasks.report_excluded = ${param(!query.inReport)}`)
    if (query.itVisible !== undefined) where.push(`tasks.it_visible = ${param(!!query.itVisible)}`)
    if (query.urgency) where.push(`tasks.urgency = ANY(${param([].concat(query.urgency).map((u) => (u === 'none' ? '' : u)))}::text[])`)
    if (query.areaId) where.push(query.areaId === 'none' ? 'tasks.area_id IS NULL' : `tasks.area_id = ${param(query.areaId)}`)
    // empresa (§46): a da demanda interna ou, na tarefa de projeto, a do projeto
    if (query.companyId) {
      const company = 'COALESCE(tasks.company_id, (SELECT p.company_id FROM projects p WHERE p.id = tasks.project_id))'
      where.push(query.companyId === 'none' ? `${company} IS NULL` : `${company} = ${param(query.companyId)}`)
    }
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

    /** Tarefas por projeto e categoria de status: { [projectId]: { [category]: total } } (painel §41). */
    async countByProject(projectIds) {
      if (!projectIds || projectIds.length === 0) return {}
      const rows = await db.query(
        `SELECT t.project_id, s.category, COUNT(*) AS total FROM tasks t JOIN task_statuses s ON s.id = t.status_id
         WHERE t.project_id = ANY($1::text[]) GROUP BY t.project_id, s.category`,
        [projectIds],
      )
      const out = {}
      rows.forEach((row) => {
        out[row.project_id] = out[row.project_id] || {}
        out[row.project_id][row.category] = Number(row.total)
      })
      return out
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

    /**
     * Atividade da equipe (painel "Equipo ahora"): tarefas com responsável dos projetos indicados que estão
     * abertas ou mudaram desde `since` — com o status (nome, cor, categoria) para classificar.
     */
    async listActivity(projectIds, since) {
      if (!projectIds || projectIds.length === 0) return []
      const rows = await db.query(
        `SELECT t.id, t.code, t.title, t.project_id, t.assignee_id, t.updated, t.reporter_id, t.demand_owner_id, t.demand_past_assignees, t.demand_status,
                s.id AS status_id, s.name AS status_name, s.color AS status_color, s.category AS status_category
         FROM tasks t JOIN task_statuses s ON s.id = t.status_id
         WHERE t.project_id = ANY($1::text[]) AND t.assignee_id IS NOT NULL
           AND (s.category NOT IN ('done', 'cancelled') OR t.updated >= $2)
         ORDER BY t.updated DESC, t.id ASC`,
        [projectIds, since],
      )
      return rows.map(activityTask)
    },

    /**
     * Equipo ahora (§41): o que cada pessoa fez nas tarefas dos projetos desde `since`, do histórico da tarefa
     * (`audit_logs`, quem fez = `user_id`; sem as linhas sem pessoa). Uma linha por ação, da mais recente para
     * a mais antiga, com a tarefa (como em `listActivity`) e só o que a ação precisa do histórico: o status
     * de/para quando mudou, o começo do comentário e os nomes dos anexos.
     */
    async listActions(projectIds, since) {
      if (!projectIds || projectIds.length === 0) return []
      const rows = await db.query(
        `SELECT a.user_id AS actor_id, a.action, a.created AS action_at,
                (a.new_value ? 'task_status') AS status_changed, a.old_value->>'task_status' AS from_status, a.new_value->>'task_status' AS to_status,
                left(a.new_value->>'comment', 300) AS comment, left(a.new_value->>'attachments', 2000) AS attachments,
                t.id, t.code, t.title, t.project_id, t.assignee_id, t.updated, t.reporter_id, t.demand_owner_id, t.demand_past_assignees, t.demand_status,
                s.id AS status_id, s.name AS status_name, s.color AS status_color, s.category AS status_category
         FROM audit_logs a
         JOIN tasks t ON t.id = a.entity_id
         JOIN task_statuses s ON s.id = t.status_id
         WHERE a.entity_type = 'task' AND a.user_id IS NOT NULL AND a.created >= $2 AND t.project_id = ANY($1::text[])
         ORDER BY a.created DESC, a.id DESC`,
        [projectIds, since],
      )
      return rows.map((r) => ({
        userId: r.actor_id,
        action: r.action,
        at: r.action_at,
        statusChanged: !!r.status_changed,
        fromStatus: r.from_status || null,
        toStatus: r.to_status || null,
        comment: r.comment || '',
        attachments: r.attachments || '',
        task: activityTask(r),
      }))
    },

    /**
     * Equipo ahora (§41): a última ação de cada pessoa (`userIds`) por projeto, em qualquer data, nas tarefas
     * dos projetos `projectIds` ou nas tarefas `taskIds` (as demandas internas que quem consulta enxerga).
     * → [{ userId, projectId, at }]
     */
    async lastActions(userIds, projectIds, taskIds) {
      if (!userIds || userIds.length === 0) return []
      const rows = await db.query(
        `SELECT a.user_id, t.project_id, max(a.created) AS at
         FROM audit_logs a JOIN tasks t ON t.id = a.entity_id
         WHERE a.entity_type = 'task' AND a.user_id = ANY($1::text[])
           AND (t.project_id = ANY($2::text[]) OR t.id = ANY($3::text[]))
         GROUP BY a.user_id, t.project_id`,
        [userIds, projectIds || [], taskIds || []],
      )
      return rows.map((r) => ({ userId: r.user_id, projectId: r.project_id, at: r.at }))
    },

    /**
     * Linhas enxutas para relatórios (só as colunas usadas nos cálculos). Por padrão, só tarefas de projeto
     * (a tarefa de projeto com responsável continua: é do projeto). `demandsOnly`: só as demandas internas
     * (§45), com quem pediu, o responsável e quem já executou — quem chama filtra o que a pessoa enxerga
     * (application/task-access.js#visibleDemands); `scope` não vale para elas.
     */
    async listForReport(query) {
      const where = []
      const params = []
      const param = (value) => {
        params.push(value)
        return `$${params.length}`
      }
      if (query.demandsOnly) {
        where.push(`demand_status <> '' AND project_id IN (SELECT id FROM projects WHERE "kind" <> '')`)
      } else {
        if (query.scope && !query.scope.viewAll) where.push(visibleTasksClause(param(query.scope.userId), ''))
        where.push(`project_id IN (SELECT id FROM projects WHERE "kind" = '')`)
      }
      if (!query.includeArchived) where.push('project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)')
      if (query.projectId) where.push(`project_id = ${param(query.projectId)}`)
      if (query.projectIds) where.push(`project_id = ANY(${param(query.projectIds)}::text[])`)
      if (query.assigneeId) where.push(query.assigneeId === 'none' ? 'assignee_id IS NULL' : `assignee_id = ${param(query.assigneeId)}`)
      if (query.typeId) where.push(`task_type_id = ${param(query.typeId)}`)
      if (query.priorityId) where.push(`priority_id = ${param(query.priorityId)}`)
      if (query.statusId) where.push(`status_id = ${param(query.statusId)}`)
      const rows = await db.query(
        `SELECT id, project_id, task_type_id, status_id, priority_id, assignee_id, created, started_at, completed_at, due_date${query.withTitles ? ', code, title' : ''}${
          query.demandsOnly ? ', reporter_id, demand_owner_id, demand_past_assignees, demand_status' : ''
        } FROM tasks
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
        ...(query.withTitles ? { code: r.code, title: r.title } : {}),
        ...(query.demandsOnly
          ? { reporterId: r.reporter_id || null, demandOwnerId: r.demand_owner_id || null, demandPastAssignees: r.demand_past_assignees || [], demandStatus: r.demand_status }
          : {}),
      }))
    },

    /**
     * Demandas internas (§45) por caixa e passo da pessoa: { received, assigned, requested } com
     * { [demandStatus]: total } — recebidas (responsável), atribuídas (quem executa) e pedidas (quem pediu).
     * `options.all` soma a caixa Todas (`all`: todas as demandas, para quem tem `projects.view_all`).
     */
    async demandCounts(userId, options) {
      const all = !!(options && options.all)
      const rows = await db.query(
        `SELECT 'received' AS box, demand_status, count(*)::int AS total FROM tasks WHERE demand_status <> '' AND demand_owner_id = $1 GROUP BY demand_status
         UNION ALL SELECT 'assigned', demand_status, count(*)::int FROM tasks WHERE demand_status <> '' AND assignee_id = $1 GROUP BY demand_status
         UNION ALL SELECT 'requested', demand_status, count(*)::int FROM tasks WHERE demand_status <> '' AND reporter_id = $1 GROUP BY demand_status` +
          (all ? ` UNION ALL SELECT 'all', demand_status, count(*)::int FROM tasks WHERE demand_status <> '' GROUP BY demand_status` : ''),
        [userId],
      )
      const out = all ? { received: {}, assigned: {}, requested: {}, all: {} } : { received: {}, assigned: {}, requested: {} }
      rows.forEach((row) => {
        out[row.box][row.demand_status] = Number(row.total)
      })
      return out
    },

    /** Carga por pessoa (Carga da minha equipe, §45): { userId: { open, hours } } nas demandas dos passos indicados. */
    async demandLoad(userIds, statuses) {
      const out = {}
      if (!userIds || userIds.length === 0 || !statuses || statuses.length === 0) return out
      const rows = await db.query(
        `SELECT assignee_id, count(*)::int AS open, COALESCE(sum(estimated_hours), 0)::float AS hours FROM tasks
         WHERE demand_status = ANY($2::text[]) AND assignee_id = ANY($1::text[]) GROUP BY assignee_id`,
        [userIds, statuses],
      )
      rows.forEach((row) => {
        out[row.assignee_id] = { open: Number(row.open), hours: Number(row.hours) }
      })
      return out
    },

    /** Carga de todas as pessoas (Carga das equipes, caixa Todas): { userId: { open, hours } } nos passos indicados. */
    async demandLoadAll(statuses) {
      const out = {}
      if (!statuses || statuses.length === 0) return out
      const rows = await db.query(
        `SELECT assignee_id, count(*)::int AS open, COALESCE(sum(estimated_hours), 0)::float AS hours FROM tasks
         WHERE demand_status = ANY($1::text[]) AND assignee_id IS NOT NULL GROUP BY assignee_id`,
        [statuses],
      )
      rows.forEach((row) => {
        out[row.assignee_id] = { open: Number(row.open), hours: Number(row.hours) }
      })
      return out
    },

    /** Quem executa as demandas do responsável nos passos indicados (sem repetir). */
    async demandAssignees(ownerId, statuses) {
      if (!statuses || statuses.length === 0) return []
      const rows = await db.query(
        `SELECT DISTINCT assignee_id FROM tasks WHERE demand_status = ANY($2::text[]) AND demand_owner_id = $1 AND assignee_id IS NOT NULL ORDER BY assignee_id`,
        [ownerId, statuses],
      )
      return rows.map((row) => row.assignee_id)
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

    /** Tarefas ligadas a elementos da Gestão, contadas por elemento e status (progresso pelas tarefas). */
    async planItemStats(itemIds) {
      if (!itemIds || itemIds.length === 0) return []
      const rows = await db.query('SELECT plan_item_id, status_id, count(*)::int AS total FROM tasks WHERE plan_item_id = ANY($1::text[]) GROUP BY plan_item_id, status_id', [itemIds])
      return rows.map((row) => ({ planItemId: row.plan_item_id, statusId: row.status_id, total: row.total }))
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
      // parâmetros só da listagem (a contagem usa os do filtro): "minhas tarefas primeiro" entra no ORDER BY
      const listParams = params.slice()
      // fixadas primeiro (§50; a Lista de tarefas pede): a mais recente no topo, só entre as que passam no filtro
      if (query.pinnedFirst) order.push('(SELECT p.created FROM task_pins p WHERE p.task_id = tasks.id) DESC NULLS LAST')
      if (query.firstAssigneeId) {
        listParams.push(query.firstAssigneeId)
        order.push(`(tasks.assignee_id IS NOT DISTINCT FROM $${listParams.length}) DESC`)
      }
      query.sort.forEach((s) => {
        if (ORDER[s.column]) ORDER[s.column](direction(s.direction)).forEach((o) => order.push(o))
      })
      order.push('tasks.created ASC', 'tasks.id ASC')
      const page = listParams.concat([query.pagination.perPage, query.pagination.offset])
      const rows = await db.query(
        `SELECT tasks.* FROM tasks ${where} ORDER BY ${order.join(', ')} LIMIT $${listParams.length + 1} OFFSET $${listParams.length + 2}`,
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

/**
 * Tarefas fixadas no topo da Lista (§50, ADR-064): uma linha por tarefa fixada, com quem fixou e quando. O limite
 * (domain/task.js#MAX_PINNED) é conferido sob uma trava da transação, para que duas pessoas fixando ao mesmo tempo
 * não passem do máximo.
 */
function createTaskPinRepository(db) {
  const toEntity = (row) => ({ taskId: row.task_id, pinnedBy: row.pinned_by || null, createdAt: row.created })
  return {
    /** { taskId: { pinnedBy, createdAt } } das tarefas fixadas entre `taskIds`. */
    async listByTasks(taskIds) {
      if (taskIds.length === 0) return {}
      const rows = await db.query('SELECT * FROM task_pins WHERE task_id = ANY($1::text[])', [taskIds])
      const map = {}
      rows.forEach((row) => {
        map[row.task_id] = toEntity(row)
      })
      return map
    },
    async count() {
      return (await db.one('SELECT COUNT(*) AS total FROM task_pins')).total
    },
    /**
     * Fixa a tarefa: `{ status: 'pinned' | 'already' | 'full', pin }` — 'already' quando já estava fixada (nada
     * muda); 'full' quando já há `max` fixadas. A trava (por esquema) vale até o fim da transação.
     */
    async pin(taskId, userId, max) {
      await db.query("SELECT pg_advisory_xact_lock(hashtext(current_schema() || '.task_pins'))")
      const current = await db.one('SELECT * FROM task_pins WHERE task_id = $1', [taskId])
      if (current) return { status: 'already', pin: toEntity(current) }
      if ((await db.one('SELECT COUNT(*) AS total FROM task_pins')).total >= max) return { status: 'full', pin: null }
      const row = await db.one('INSERT INTO task_pins (task_id, pinned_by) VALUES ($1, $2) RETURNING *', [taskId, userId || null])
      return { status: 'pinned', pin: toEntity(row) }
    },
    /** Desafixa; devolve a fixação que existia (null = não estava fixada). */
    async unpin(taskId) {
      const row = await db.one('DELETE FROM task_pins WHERE task_id = $1 RETURNING *', [taskId])
      return row ? toEntity(row) : null
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
    /** A pessoa foi mencionada num comentário (não excluído) da tarefa? */
    async hasMention(taskId, userId) {
      const rows = await db.query('SELECT 1 FROM comments WHERE task_id = $1 AND deleted_at IS NULL AND mentions @> $2::jsonb LIMIT 1', [taskId, JSON.stringify([userId])])
      return rows.length > 0
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
      docPageId: row.doc_page_id || null,
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
        `INSERT INTO notifications (id, user_id, type, task_id, plan_item_id, doc_page_id, project_id, actor_id, data, dedupe_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key != '' DO NOTHING
         RETURNING *`,
        [newId(), userId, data.type || '', data.taskId || null, data.planItemId || null, data.docPageId || null, data.projectId || null, data.actorId || null, toJson(data.data || {}), dedupeKey],
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
    /** Lê as notificações da pessoa sobre uma página da Documentação (ela abriu a página). */
    async markReadByDocPage(userId, pageId, at) {
      return db.exec('UPDATE notifications SET read_at = $3 WHERE user_id = $1 AND doc_page_id = $2 AND read_at IS NULL', [userId, pageId, toDbDate(at)])
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
    async listByProjects(projectIds) {
      if (!projectIds || projectIds.length === 0) return []
      const rows = await db.query('SELECT * FROM project_milestones WHERE project_id = ANY($1::text[]) ORDER BY due_date ASC NULLS FIRST, created ASC, id ASC', [projectIds])
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
    /** Relações que tocam alguma das tarefas (qualquer tipo e sentido). */
    async listByTasks(taskIds) {
      if (taskIds.length === 0) return []
      const rows = await db.query(
        'SELECT * FROM task_relations WHERE source_task_id = ANY($1::text[]) OR target_task_id = ANY($1::text[]) ORDER BY created ASC, id ASC',
        [taskIds],
      )
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
  createTaskPinRepository,
  createTaskValueRepository,
  createCommentRepository,
  createAttachmentRepository,
  createNotificationRepository,
  createSprintRepository,
  createMilestoneRepository,
  createRelationRepository,
}
