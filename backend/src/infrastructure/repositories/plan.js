/**
 * Repositórios Postgres do Gerenciamento de Projetos (quadro do projeto): grupos, etiquetas de status e
 * de recurso, elementos/subelementos, dependências e configuração do quadro (GP-1/GP-2), atualizações e
 * arquivos do painel do elemento (GP-3), Diário e Gestão dos problemas (GP-4) e colunas
 * personalizadas (GP-5).
 *
 * Datas de elemento, diário e problema são "dia puro" (AAAA-MM-DD, gravadas à meia-noite UTC). Vínculos
 * sem chave estrangeira (parent_id de grupo/elemento/atualização, status_id do elemento) são texto: vazio
 * é '' no banco e null na entidade, como no PocketBase.
 */

const { appError } = require('../../core/errors')
const { newId, ident, toDbDate, toJson, insertRow, updateRow, findRow, findRows, deleteRow } = require('../sql')
const { storedFileName } = require('../storage')

const POSITION_STEP = 1024
const UNIQUE_VIOLATION = '23505'

/* ------------------------------------------------------------------ conversões */

const asText = (value) => (value === null || value === undefined ? '' : value)
const asRef = (value) => value || null
const asNumber = (value) => value || 0
const asBool = (value) => !!value
const asDate = (value) => toDbDate(value)
const asJson = (fallback) => (value) => toJson(value || fallback)
/** AAAA-MM-DD → meia-noite UTC (vazio = NULL). */
const asDay = (value) => (value ? toDbDate(`${String(value).slice(0, 10)}T00:00:00.000Z`) : null)
/** Date do banco → AAAA-MM-DD (ou null). */
const dayOf = (date) => (date ? date.toISOString().slice(0, 10) : null)

/**
 * Colunas a gravar a partir da entidade: `spec` = { campo: [coluna, conversão] }. `skipUndefined`
 * ignora campos com valor undefined (os repositórios que no PocketBase conferiam `!== undefined`);
 * nos demais, undefined limpa o campo, como o `record.set` fazia.
 */
function columnsOf(data, spec, skipUndefined) {
  const out = {}
  Object.keys(data || {}).forEach((key) => {
    if (!spec[key] || (skipUndefined && data[key] === undefined)) return
    out[spec[key][0]] = spec[key][1](data[key])
  })
  return out
}

/** findById/create/update/delete comuns. `update` de id inexistente: NOT_FOUND (o PocketBase também falhava). */
function basicRepository(db, table, toEntity, spec, skipUndefined) {
  return {
    async findById(id) {
      const row = await findRow(db, table, id)
      return row ? toEntity(row) : null
    },
    async create(data) {
      return toEntity(await insertRow(db, table, columnsOf(data, spec, skipUndefined)))
    },
    async update(id, patch) {
      const row = await updateRow(db, table, id, columnsOf(patch, spec, skipUndefined))
      if (!row) throw appError('NOT_FOUND')
      return toEntity(row)
    },
    async delete(id) {
      await deleteRow(db, table, id)
    },
  }
}

/** Converte a violação de índice único (gravações concorrentes) no erro que a aplicação daria. */
async function uniqueAs(fn, toError) {
  try {
    return await fn()
  } catch (err) {
    if (err && err.code === UNIQUE_VIOLATION) throw toError()
    throw err
  }
}

/** Reescreve as posições em passos iguais, na ordem atual (posição, criação). */
async function renumberWhere(db, table, where, params) {
  await db.exec(
    `UPDATE ${ident(table)} AS t SET "position" = o.n * ${POSITION_STEP}
     FROM (SELECT "id", row_number() OVER (ORDER BY "position", "created", "id") AS n FROM ${ident(table)} WHERE ${where}) AS o
     WHERE t."id" = o."id"`,
    params,
  )
}

/** { item_id: total } de uma consulta agrupada por elemento. */
async function countsByItem(db, table, projectId, extraWhere) {
  const rows = await db.query(
    `SELECT "item_id", count(*) AS total FROM ${ident(table)} WHERE "project_id" = $1${extraWhere ? ` AND ${extraWhere}` : ''} GROUP BY "item_id"`,
    [projectId],
  )
  const out = {}
  rows.forEach((row) => {
    out[row.item_id] = row.total
  })
  return out
}

/* ------------------------------------------------------------------ grupos */

/** Grupos do quadro (um nível de subgrupo; `parent_id` '' = grupo raiz). */
function createProjectGroupRepository(db) {
  const TABLE = 'project_groups'
  const toEntity = (row) => ({
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id || null,
    name: row.name,
    color: row.color,
    position: row.position,
    createdBy: row.created_by || null,
    createdAt: row.created,
    updatedAt: row.updated,
  })
  const SPEC = {
    projectId: ['project_id', asRef],
    parentId: ['parent_id', asText],
    name: ['name', asText],
    color: ['color', asText],
    createdBy: ['created_by', asRef],
    position: ['position', asNumber],
  }

  return Object.assign(basicRepository(db, TABLE, toEntity, SPEC, false), {
    async findManyByIds(ids) {
      return (await findRows(db, TABLE, ids)).map(toEntity)
    },
    async listByProject(projectId) {
      const rows = await db.query('SELECT * FROM project_groups WHERE project_id = $1 ORDER BY position, created, id', [projectId])
      return rows.map(toEntity)
    },
    /** Maior posição entre os grupos irmãos (null se não houver). */
    async maxPosition(projectId, parentId) {
      const row = await db.one('SELECT max(position) AS n FROM project_groups WHERE project_id = $1 AND parent_id = $2', [projectId, parentId || ''])
      return row.n
    },
    async renumber(projectId, parentId) {
      await renumberWhere(db, TABLE, '"project_id" = $1 AND "parent_id" = $2', [projectId, parentId || ''])
    },
  })
}

/* ------------------------------------------------------------------ etiquetas */

function createPlanStatusRepository(db) {
  const toEntity = (row) => ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    color: row.color,
    category: row.category,
    position: row.position,
  })
  const SPEC = {
    projectId: ['project_id', asRef],
    name: ['name', asText],
    color: ['color', asText],
    category: ['category', asText],
    position: ['position', asNumber],
  }
  return Object.assign(basicRepository(db, 'plan_statuses', toEntity, SPEC, false), {
    async listByProject(projectId) {
      return (await db.query('SELECT * FROM plan_statuses WHERE project_id = $1 ORDER BY position, created, id', [projectId])).map(toEntity)
    },
    async listByProjects(projectIds) {
      if (!projectIds || projectIds.length === 0) return []
      return (await db.query('SELECT * FROM plan_statuses WHERE project_id = ANY($1::text[]) ORDER BY position, created, id', [projectIds])).map(toEntity)
    },
  })
}

function createPlanResourceRepository(db) {
  const toEntity = (row) => ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    nameKey: row.name_key,
    color: row.color,
  })
  const SPEC = {
    projectId: ['project_id', asRef],
    name: ['name', asText],
    nameKey: ['name_key', asText],
    color: ['color', asText],
  }
  const base = basicRepository(db, 'plan_resources', toEntity, SPEC, false)
  // nome único por projeto (idx_plan_resources_name): a concorrente perde como se tivesse conferido antes
  const nameInUse = () => appError('PLAN_RESOURCE_NAME_IN_USE')
  return {
    findById: base.findById,
    async findByKey(projectId, nameKey) {
      const row = await db.one('SELECT * FROM plan_resources WHERE project_id = $1 AND name_key = $2', [projectId, nameKey])
      return row ? toEntity(row) : null
    },
    async listByProject(projectId) {
      return (await db.query('SELECT * FROM plan_resources WHERE project_id = $1 ORDER BY name, id', [projectId])).map(toEntity)
    },
    create: (data) => uniqueAs(() => base.create(data), nameInUse),
    update: (id, patch) => uniqueAs(() => base.update(id, patch), nameInUse),
    /** O PocketBase tirava o id excluído de plan_items.resource_ids; aqui é feito junto. */
    async delete(id) {
      await db.exec('UPDATE plan_items SET resource_ids = resource_ids - $1::text WHERE resource_ids ? $1::text', [id])
      await base.delete(id)
    },
  }
}

/* ------------------------------------------------------------------ elementos */

function createPlanItemRepository(db) {
  const TABLE = 'plan_items'
  const toEntity = (row) => ({
    id: row.id,
    projectId: row.project_id,
    groupId: row.group_id,
    parentId: row.parent_id || null,
    name: row.name,
    statusId: row.status_id || null,
    startDate: dayOf(row.start_date),
    endDate: dayOf(row.end_date),
    dueDate: dayOf(row.due_date),
    ownerId: row.owner_id || null,
    resourceIds: row.resource_ids || [],
    metrics: row.metrics || {},
    custom: row.custom || {},
    progress: row.progress,
    progressSet: row.progress_set,
    position: row.position,
    createdBy: row.created_by || null,
    completedAt: row.completed_at || null,
    createdAt: row.created,
    updatedAt: row.updated,
  })
  const SPEC = {
    projectId: ['project_id', asRef],
    groupId: ['group_id', asRef],
    parentId: ['parent_id', asText],
    name: ['name', asText],
    statusId: ['status_id', asText],
    ownerId: ['owner_id', asRef],
    createdBy: ['created_by', asRef],
    startDate: ['start_date', asDay],
    endDate: ['end_date', asDay],
    dueDate: ['due_date', asDay],
    resourceIds: ['resource_ids', asJson([])],
    metrics: ['metrics', asJson({})],
    custom: ['custom', asJson({})],
    progress: ['progress', asNumber],
    progressSet: ['progress_set', asBool],
    position: ['position', asNumber],
  }
  /** Irmãos: elementos do grupo (sem pai) ou subelementos do pai. */
  const siblings = (groupId, parentId) =>
    parentId ? { where: '"parent_id" = $1', params: [parentId] } : { where: '"group_id" = $1 AND "parent_id" = \'\'', params: [groupId] }

  return Object.assign(basicRepository(db, TABLE, toEntity, SPEC, false), {
    /** `limit` vazio = todos. */
    async listByProject(projectId, limit) {
      const rows = await db.query('SELECT * FROM plan_items WHERE project_id = $1 ORDER BY position, created, id LIMIT $2', [projectId, limit || null])
      return rows.map(toEntity)
    },
    /** Elementos de vários projetos (painel executivo). */
    async listByProjects(projectIds) {
      if (!projectIds || projectIds.length === 0) return []
      return (await db.query('SELECT * FROM plan_items WHERE project_id = ANY($1::text[]) ORDER BY position, created, id', [projectIds])).map(toEntity)
    },
    async listByGroups(groupIds) {
      if (!groupIds || groupIds.length === 0) return []
      const rows = await db.query('SELECT * FROM plan_items WHERE group_id = ANY($1::text[]) ORDER BY position, created, id', [groupIds])
      return rows.map(toEntity)
    },
    async listChildren(parentId) {
      return (await db.query('SELECT * FROM plan_items WHERE parent_id = $1 ORDER BY position, created, id', [parentId])).map(toEntity)
    },
    /** Maior posição entre irmãos (mesmo grupo e mesmo pai; null se não houver). */
    async maxPosition(groupId, parentId) {
      const row = await db.one('SELECT max(position) AS n FROM plan_items WHERE group_id = $1 AND parent_id = $2', [groupId, parentId || ''])
      return row.n
    },
    /** Elementos que usam a etiqueta de status/recurso (para limpar ao excluir a etiqueta). */
    async listByStatus(statusId) {
      return (await db.query('SELECT * FROM plan_items WHERE status_id = $1 ORDER BY id', [statusId])).map(toEntity)
    },
    async listByResource(resourceId) {
      return (await db.query('SELECT * FROM plan_items WHERE resource_ids ? $1::text ORDER BY id', [resourceId])).map(toEntity)
    },
    /** Irmãos na ordem: elementos do grupo (parentId vazio) ou subelementos do pai. */
    async listSiblings(groupId, parentId) {
      const { where, params } = siblings(groupId, parentId)
      return (await db.query(`SELECT * FROM plan_items WHERE ${where} ORDER BY position, created, id`, params)).map(toEntity)
    },
    /** Reescreve as posições dos irmãos em passos iguais (quando não cabe mais nada entre dois). */
    async renumber(groupId, parentId) {
      const { where, params } = siblings(groupId, parentId)
      await renumberWhere(db, TABLE, where, params)
    },
  })
}

/* ------------------------------------------------------------------ dependências e configuração */

/** Dependências entre elementos do quadro (`blocks` | `relates`). */
function createPlanLinkRepository(db) {
  const toEntity = (row) => ({
    id: row.id,
    projectId: row.project_id,
    fromId: row.from_id,
    toId: row.to_id,
    type: row.type,
    createdBy: row.created_by || null,
    createdAt: row.created,
  })
  return {
    async findById(id) {
      const row = await findRow(db, 'plan_item_links', id)
      return row ? toEntity(row) : null
    },
    async listByProject(projectId) {
      return (await db.query('SELECT * FROM plan_item_links WHERE project_id = $1 ORDER BY created, id', [projectId])).map(toEntity)
    },
    async listByProjects(projectIds) {
      if (!projectIds || projectIds.length === 0) return []
      return (await db.query('SELECT * FROM plan_item_links WHERE project_id = ANY($1::text[]) ORDER BY created, id', [projectIds])).map(toEntity)
    },
    async create(data) {
      // par único (idx_plan_item_links_pair): a concorrente recebe o mesmo erro da conferência da aplicação
      const row = await uniqueAs(
        () =>
          insertRow(db, 'plan_item_links', {
            project_id: data.projectId,
            from_id: data.fromId,
            to_id: data.toId,
            type: asText(data.type),
            created_by: data.createdBy || null,
          }),
        () => appError('VALIDATION_ERROR', undefined, { fields: { item_id: 'duplicate' } }),
      )
      return toEntity(row)
    },
    async delete(id) {
      await deleteRow(db, 'plan_item_links', id)
    },
    /** Remove as ligações dos elementos (antes de excluí-los). */
    async deleteByItems(itemIds) {
      if (!itemIds || itemIds.length === 0) return
      await db.exec('DELETE FROM plan_item_links WHERE from_id = ANY($1::text[]) OR to_id = ANY($1::text[])', [itemIds])
    },
  }
}

/** Configuração do quadro por projeto (sem registro = padrão; um registro por projeto). */
function createPlanSettingsRepository(db) {
  const toEntity = (row) => {
    const baseline = row.baseline
    return {
      projectId: row.project_id,
      dependencyRule: row.dependency_rule,
      // linha de base do Cronograma (GP-4)
      baseline: baseline && baseline.saved_at ? { savedAt: new Date(baseline.saved_at), items: baseline.items || {} } : null,
      issueSeq: row.issue_seq,
    }
  }
  return {
    async findByProject(projectId) {
      const row = await db.one('SELECT * FROM plan_settings WHERE project_id = $1', [projectId])
      return row ? toEntity(row) : null
    },
    /** Cria ou altera só o que veio, num comando (gravações concorrentes não duplicam o registro). */
    async save(projectId, data) {
      const changed = {}
      if (data.dependencyRule !== undefined) changed.dependency_rule = asText(data.dependencyRule)
      if (data.baseline !== undefined) {
        changed.baseline = data.baseline ? toJson({ saved_at: new Date(data.baseline.savedAt).toISOString(), items: data.baseline.items }) : null
      }
      if (data.issueSeq !== undefined) changed.issue_seq = asNumber(data.issueSeq)
      const values = Object.assign({ id: newId(), project_id: projectId, dependency_rule: 'warn' }, changed)
      const columns = Object.keys(values)
      const sets = Object.keys(changed).length ? Object.keys(changed) : ['project_id']
      const row = await db.one(
        `INSERT INTO plan_settings (${columns.map(ident).join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
         ON CONFLICT ("project_id") DO UPDATE SET ${sets.map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`).join(', ')}
         RETURNING *`,
        columns.map((c) => values[c]),
      )
      return toEntity(row)
    },
  }
}

/* ------------------------------------------------------------------ painel do elemento (GP-3) */

/** Atualizações do elemento (conversa com respostas de um nível; exclusão lógica). */
function createPlanUpdateRepository(db) {
  const TABLE = 'plan_item_updates'
  const toEntity = (row) => ({
    id: row.id,
    projectId: row.project_id,
    itemId: row.item_id,
    parentId: row.parent_id || null,
    authorId: row.author_id || null,
    content: row.content,
    mentions: row.mentions || [],
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    createdAt: row.created,
  })
  const SPEC = {
    projectId: ['project_id', asRef],
    itemId: ['item_id', asRef],
    parentId: ['parent_id', asText],
    authorId: ['author_id', asRef],
    content: ['content', asText],
    mentions: ['mentions', asJson([])],
    editedAt: ['edited_at', asDate],
    deletedAt: ['deleted_at', asDate],
  }
  const base = basicRepository(db, TABLE, toEntity, SPEC, true)
  return {
    findById: base.findById,
    create: base.create,
    update: base.update,
    async listByItem(itemId) {
      return (await db.query('SELECT * FROM plan_item_updates WHERE item_id = $1 ORDER BY created, id', [itemId])).map(toEntity)
    },
    /** Atualizações não excluídas por elemento do projeto. */
    async countByProject(projectId) {
      return countsByItem(db, TABLE, projectId, '"deleted_at" IS NULL')
    },
  }
}

/** Arquivos colados/anexados nas atualizações (conteúdo no Storage: plan_item_files/<id>/<arquivo>). */
function createPlanFileRepository(db, ctx) {
  const TABLE = 'plan_item_files'
  // recusas do próprio Storage (tamanho/tipo): erro de validação, como o PocketBase dava ao salvar
  const REJECTED = new Set([400, 413, 415])
  const invalidFile = (name) => appError('VALIDATION_ERROR', undefined, { fields: { files: 'invalid_file' }, name })
  const toEntity = (row) => ({
    id: row.id,
    projectId: row.project_id,
    itemId: row.item_id,
    updateId: row.update_id || null,
    name: row.name,
    mime: row.mime,
    kind: row.kind,
    size: row.size,
    uploadedBy: row.uploaded_by || null,
    createdAt: row.created,
  })
  return {
    async findById(id) {
      const row = await findRow(db, TABLE, id)
      return row ? toEntity(row) : null
    },
    async listByItem(itemId) {
      return (await db.query('SELECT * FROM plan_item_files WHERE item_id = $1 ORDER BY created DESC, id DESC', [itemId])).map(toEntity)
    },
    /**
     * `data.handle` é o arquivo enviado ({ buffer, mime, name, size }); tipo e tamanho já foram
     * validados pela aplicação. O arquivo vai para o Storage antes do registro.
     */
    async create(data) {
      const handle = data.handle || {}
      if (!handle.buffer) throw invalidFile(data.name)
      const id = newId()
      const stored = storedFileName(handle.name || data.name)
      try {
        await ctx.storage.put(`${TABLE}/${id}/${stored}`, handle.buffer, data.mime || handle.mime)
      } catch (err) {
        if (REJECTED.has(err && err.status)) throw invalidFile(data.name)
        throw err
      }
      const row = await insertRow(db, TABLE, {
        id,
        project_id: data.projectId,
        item_id: data.itemId,
        update_id: data.updateId || null,
        file: stored,
        name: asText(data.name),
        mime: asText(data.mime),
        kind: asText(data.kind),
        size: asNumber(data.size),
        uploaded_by: data.uploadedBy || null,
      })
      return toEntity(row)
    },
    /** O gatilho manda o arquivo para a lixeira do Storage (storage_trash). */
    async delete(id) {
      await deleteRow(db, TABLE, id)
    },
    async fileKeyOf(id) {
      const row = await db.one('SELECT file FROM plan_item_files WHERE id = $1', [id])
      if (!row) throw appError('NOT_FOUND')
      return `${TABLE}/${id}/${row.file}`
    },
    async countByProject(projectId) {
      return countsByItem(db, TABLE, projectId)
    },
  }
}

/* ------------------------------------------------------------------ Gestão (GP-4) e colunas (GP-5) */

function createPlanJournalRepository(db) {
  const toEntity = (row) => ({
    id: row.id,
    projectId: row.project_id,
    entryDate: dayOf(row.entry_date),
    content: row.content,
    authorId: row.author_id || null,
    createdAt: row.created,
    updatedAt: row.updated,
  })
  const SPEC = {
    projectId: ['project_id', asRef],
    entryDate: ['entry_date', asDay],
    content: ['content', asText],
    authorId: ['author_id', asRef],
  }
  return Object.assign(basicRepository(db, 'plan_journal', toEntity, SPEC, true), {
    /** Mais recentes primeiro (sem data por último, como o '' do PocketBase). */
    async listByProject(projectId) {
      const rows = await db.query('SELECT * FROM plan_journal WHERE project_id = $1 ORDER BY entry_date DESC NULLS LAST, created DESC, id', [projectId])
      return rows.map(toEntity)
    },
  })
}

function createPlanIssueRepository(db) {
  const toEntity = (row) => ({
    id: row.id,
    projectId: row.project_id,
    number: row.number,
    openedOn: dayOf(row.opened_on),
    description: row.description,
    state: row.state,
    ownerId: row.owner_id || null,
    resolvedOn: dayOf(row.resolved_on),
    createdBy: row.created_by || null,
    createdAt: row.created,
    updatedAt: row.updated,
  })
  const SPEC = {
    projectId: ['project_id', asRef],
    number: ['number', asNumber],
    openedOn: ['opened_on', asDay],
    description: ['description', asText],
    state: ['state', asText],
    ownerId: ['owner_id', asRef],
    resolvedOn: ['resolved_on', asDay],
    createdBy: ['created_by', asRef],
  }
  return Object.assign(basicRepository(db, 'plan_issues', toEntity, SPEC, true), {
    async listByProject(projectId) {
      return (await db.query('SELECT * FROM plan_issues WHERE project_id = $1 ORDER BY number, id', [projectId])).map(toEntity)
    },
    async listByProjects(projectIds) {
      if (!projectIds || projectIds.length === 0) return []
      return (await db.query('SELECT * FROM plan_issues WHERE project_id = ANY($1::text[]) ORDER BY project_id, number, id', [projectIds])).map(toEntity)
    },
    /**
     * Maior número do projeto (0 se não houver). Trava o projeto até o fim da transação: quem cria
     * outro problema ao mesmo tempo espera e lê o número já gravado (o número é único por projeto).
     */
    async maxNumber(projectId) {
      await db.query('SELECT id FROM projects WHERE id = $1 FOR NO KEY UPDATE', [projectId])
      const row = await db.one('SELECT COALESCE(max(number), 0) AS n FROM plan_issues WHERE project_id = $1', [projectId])
      return row.n
    },
  })
}

function createPlanColumnRepository(db) {
  const toEntity = (row) => ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    type: row.type,
    settings: row.settings || {},
    position: row.position,
    createdBy: row.created_by || null,
    createdAt: row.created,
    updatedAt: row.updated,
  })
  const SPEC = {
    projectId: ['project_id', asRef],
    name: ['name', asText],
    type: ['type', asText],
    settings: ['settings', asJson({})],
    position: ['position', asNumber],
    createdBy: ['created_by', asRef],
  }
  return Object.assign(basicRepository(db, 'plan_columns', toEntity, SPEC, true), {
    async listByProject(projectId) {
      return (await db.query('SELECT * FROM plan_columns WHERE project_id = $1 ORDER BY position, created, id', [projectId])).map(toEntity)
    },
    /** Maior posição do quadro (0 se não houver). */
    async maxPosition(projectId) {
      const row = await db.one('SELECT COALESCE(max(position), 0) AS n FROM plan_columns WHERE project_id = $1', [projectId])
      return row.n
    },
  })
}

module.exports = {
  createProjectGroupRepository,
  createPlanStatusRepository,
  createPlanResourceRepository,
  createPlanItemRepository,
  createPlanLinkRepository,
  createPlanSettingsRepository,
  createPlanUpdateRepository,
  createPlanFileRepository,
  createPlanJournalRepository,
  createPlanIssueRepository,
  createPlanColumnRepository,
}
