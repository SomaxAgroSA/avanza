/**
 * Repositórios Postgres da documentação (expansão, Onda 2): espaços, páginas, versões e arquivos.
 * Árvore, busca e recentes leem só as colunas necessárias (o conteúdo JSON não é carregado).
 * Arquivos ficam no Storage ("doc_files/<id>/<nome guardado>"); ao apagar o registro (inclusive em
 * cascata), um gatilho manda a chave para a lixeira do Storage. Vínculos página ↔ tarefa em
 * "doc_page_tasks" (saem junto com a página ou a tarefa).
 */

const { appError } = require('../../core/errors')
const { storedFileName } = require('../storage')
const { newId, toDbDate, toJson, likePattern, insertRow, updateRow, findRow, deleteRow } = require('../sql')

/** Executa `fn` e troca a violação do índice único `index` (23505) pelo erro de aplicação `code`. */
async function uniqueAs(index, code, fn) {
  try {
    return await fn()
  } catch (err) {
    if (err && err.code === '23505' && err.constraint === index) throw appError(code)
    throw err
  }
}

/**
 * Colunas a gravar a partir de `data` conforme `fields` ({ chave: [coluna, tipo] }): texto vazio é '',
 * relação/data vazia é NULL, JSON vazio é NULL.
 */
function columns(fields, data) {
  const values = {}
  Object.keys(data).forEach((key) => {
    const spec = fields[key]
    if (!spec) return
    const value = data[key]
    const empty = value === undefined || value === null
    if (spec[1] === 'text') values[spec[0]] = empty ? '' : value
    else if (spec[1] === 'relation') values[spec[0]] = value || null
    else if (spec[1] === 'number') values[spec[0]] = Number(value) || 0
    else if (spec[1] === 'date') values[spec[0]] = toDbDate(value)
    else if (spec[1] === 'json') values[spec[0]] = empty ? null : toJson(value)
  })
  return values
}

function createDocSpaceRepository(db) {
  const TABLE = 'doc_spaces'
  const FIELDS = {
    key: ['key', 'text'],
    name: ['name', 'text'],
    description: ['description', 'text'],
    icon: ['icon', 'text'],
    color: ['color', 'text'],
    projectId: ['project_id', 'relation'],
    visibility: ['visibility', 'text'],
    // texto (não é chave estrangeira): a página inicial é criada depois do espaço
    homePageId: ['home_page_id', 'text'],
    createdBy: ['created_by', 'relation'],
  }

  function toEntity(row) {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      icon: row.icon,
      color: row.color,
      projectId: row.project_id || null,
      visibility: row.visibility,
      homePageId: row.home_page_id || null,
      createdBy: row.created_by || null,
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
      const row = await db.one('SELECT * FROM doc_spaces WHERE "key" = $1', [key])
      return row ? toEntity(row) : null
    },
    async list() {
      return (await db.query('SELECT * FROM doc_spaces ORDER BY name ASC, id ASC')).map(toEntity)
    },
    async listByProject(projectId) {
      return (await db.query('SELECT * FROM doc_spaces WHERE project_id = $1 ORDER BY name ASC, id ASC', [projectId])).map(toEntity)
    },
    async create(data) {
      return toEntity(await uniqueAs('idx_doc_spaces_key', 'DOC_SPACE_KEY_IN_USE', () => insertRow(db, TABLE, columns(FIELDS, data))))
    },
    async update(id, patch) {
      const row = await uniqueAs('idx_doc_spaces_key', 'DOC_SPACE_KEY_IN_USE', () => updateRow(db, TABLE, id, columns(FIELDS, patch)))
      return row ? toEntity(row) : null
    },
    /** Páginas, versões e arquivos saem junto (relações em cascata). */
    async delete(id) {
      await deleteRow(db, TABLE, id)
    },
  }
}

function createDocPageRepository(db) {
  const TABLE = 'doc_pages'
  const FIELDS = {
    spaceId: ['space_id', 'relation'],
    // texto (não é chave estrangeira): a árvore é mantida pela aplicação
    parentId: ['parent_id', 'text'],
    title: ['title', 'text'],
    position: ['position', 'number'],
    status: ['status', 'text'],
    content: ['content', 'json'],
    contentText: ['content_text', 'text'],
    searchText: ['search_text', 'text'],
    version: ['version', 'number'],
    publishedAt: ['published_at', 'date'],
    publishedBy: ['published_by', 'relation'],
    draft: ['draft', 'json'],
    draftTitle: ['draft_title', 'text'],
    draftBy: ['draft_by', 'relation'],
    draftAt: ['draft_at', 'date'],
    createdBy: ['created_by', 'relation'],
  }

  function toEntity(row) {
    return {
      id: row.id,
      spaceId: row.space_id,
      parentId: row.parent_id || null,
      title: row.title,
      position: row.position,
      status: row.status,
      content: row.content,
      contentText: row.content_text,
      searchText: row.search_text,
      version: row.version,
      publishedAt: row.published_at,
      publishedBy: row.published_by || null,
      draft: row.draft,
      draftTitle: row.draft_title,
      draftBy: row.draft_by || null,
      draftAt: row.draft_at,
      createdBy: row.created_by || null,
      createdAt: row.created,
      updatedAt: row.updated,
    }
  }

  return {
    async findById(id) {
      const row = await findRow(db, TABLE, id)
      return row ? toEntity(row) : null
    },
    /** Linhas enxutas (sem o conteúdo) da árvore do espaço. */
    async listTree(spaceId) {
      const rows = await db.query(
        'SELECT id, space_id, parent_id, title, position, status, draft_at, published_at, updated FROM doc_pages WHERE space_id = $1 ORDER BY parent_id ASC, position ASC, id ASC',
        [spaceId],
      )
      return rows.map((r) => ({
        id: r.id,
        spaceId: r.space_id,
        parentId: r.parent_id || null,
        title: r.title,
        position: r.position,
        status: r.status,
        draftAt: r.draft_at,
        publishedAt: r.published_at,
        updatedAt: r.updated,
      }))
    },
    /** { spaceId: páginas publicadas } — só os espaços com alguma. */
    async countPublishedBySpaces(ids) {
      const out = {}
      if (!ids || ids.length === 0) return out
      const rows = await db.query(
        "SELECT space_id, count(*) AS total FROM doc_pages WHERE space_id = ANY($1::text[]) AND status = 'published' GROUP BY space_id",
        [ids],
      )
      rows.forEach((r) => {
        out[r.space_id] = r.total
      })
      return out
    },
    async create(data) {
      return toEntity(await insertRow(db, TABLE, columns(FIELDS, data)))
    },
    async update(id, patch) {
      const row = await updateRow(db, TABLE, id, columns(FIELDS, patch))
      return row ? toEntity(row) : null
    },
    /** Versões e arquivos das páginas saem junto (relações em cascata). */
    async deleteMany(ids) {
      if (!ids || ids.length === 0) return
      await db.exec('DELETE FROM doc_pages WHERE id = ANY($1::text[])', [ids])
    },
    /** Posições 1024, 2048, … na ordem de `ids`, numa instrução só. */
    async renumber(ids) {
      if (!ids || ids.length === 0) return
      await db.exec('UPDATE doc_pages AS p SET position = v.ord * 1024 FROM unnest($1::text[]) WITH ORDINALITY AS v(id, ord) WHERE p.id = v.id', [ids])
    },
    /** Publicadas nos espaços, com o texto "dobrado" (sem acento/maiúsculas) contendo o termo. */
    async search(spaceIds, folded, limit) {
      if (!spaceIds || spaceIds.length === 0) return []
      const rows = await db.query(
        `SELECT id, space_id, title, content_text, published_at FROM doc_pages
         WHERE space_id = ANY($1::text[]) AND status = 'published' AND search_text ILIKE $2
         ORDER BY published_at DESC NULLS LAST, id ASC LIMIT $3`,
        [spaceIds, likePattern(folded), limit || null],
      )
      return rows.map((r) => ({
        id: r.id,
        spaceId: r.space_id,
        title: r.title,
        contentText: r.content_text,
        publishedAt: r.published_at,
      }))
    },
    async recent(spaceIds, limit) {
      if (!spaceIds || spaceIds.length === 0) return []
      const rows = await db.query(
        `SELECT id, space_id, title, published_at, published_by FROM doc_pages
         WHERE space_id = ANY($1::text[]) AND status = 'published'
         ORDER BY published_at DESC NULLS LAST, id ASC LIMIT $2`,
        [spaceIds, limit || null],
      )
      return rows.map((r) => ({
        id: r.id,
        spaceId: r.space_id,
        title: r.title,
        publishedAt: r.published_at,
        publishedBy: r.published_by || null,
      }))
    },
  }
}

function createDocPageVersionRepository(db) {
  const TABLE = 'doc_page_versions'

  function toEntity(row, withContent) {
    return {
      id: row.id,
      pageId: row.page_id,
      version: row.version,
      title: row.title,
      content: withContent ? row.content : undefined,
      author: row.author || null,
      createdAt: row.created,
    }
  }

  return {
    /** A mesma versão gravada duas vezes (publicações simultâneas) vira CONFLICT. */
    async create(data) {
      const row = await uniqueAs('idx_doc_versions_page', 'CONFLICT', () =>
        insertRow(db, TABLE, {
          page_id: data.pageId,
          version: Number(data.version) || 0,
          title: data.title || '',
          content: data.content === undefined || data.content === null ? null : toJson(data.content),
          author: data.author || null,
        }),
      )
      return toEntity(row, true)
    },
    /** Versões da página, da mais nova para a mais antiga (sem o conteúdo). */
    async listByPage(pageId) {
      const rows = await db.query('SELECT id, page_id, version, title, author, created FROM doc_page_versions WHERE page_id = $1 ORDER BY version DESC', [pageId])
      return rows.map((row) => toEntity(row, false))
    },
    async find(pageId, version) {
      const row = await db.one('SELECT * FROM doc_page_versions WHERE page_id = $1 AND version = $2', [pageId, version])
      return row ? toEntity(row, true) : null
    },
  }
}

function createDocFileRepository(db, ctx) {
  const TABLE = 'doc_files'

  function toEntity(row) {
    return {
      id: row.id,
      spaceId: row.space_id,
      pageId: row.page_id,
      name: row.name,
      mime: row.mime,
      kind: row.kind,
      size: row.size,
      uploadedBy: row.uploaded_by || null,
      createdAt: row.created,
    }
  }

  return {
    /**
     * `data.handle` é o arquivo enviado ({ buffer, mime, name, size }); tipo e tamanho já foram
     * conferidos pelo caso de uso. Grava no Storage e depois o registro (mesmo id na chave).
     */
    async create(data) {
      const handle = data.handle || {}
      const id = newId()
      const stored = storedFileName(data.name || handle.name)
      try {
        await ctx.storage.put(`${TABLE}/${id}/${stored}`, handle.buffer, data.mime || handle.mime)
      } catch (err) {
        // recusa do Storage pelo arquivo (tamanho/tipo): mesmo erro de quando o PocketBase revalidava
        if (err && (err.status === 400 || err.status === 413)) {
          throw appError('VALIDATION_ERROR', undefined, { fields: { files: 'invalid_file' }, name: data.name })
        }
        throw err
      }
      const row = await insertRow(db, TABLE, {
        id,
        space_id: data.spaceId,
        page_id: data.pageId,
        file: stored,
        name: data.name || '',
        mime: data.mime || '',
        kind: data.kind || '',
        size: Number(data.size) || 0,
        uploaded_by: data.uploadedBy || null,
      })
      return toEntity(row)
    },
    async findById(id) {
      const row = await findRow(db, TABLE, id)
      return row ? toEntity(row) : null
    },
    /** Chave do arquivo no Storage. */
    async fileKeyOf(id) {
      const row = id ? await db.one('SELECT file FROM doc_files WHERE id = $1', [id]) : null
      if (!row || !row.file) throw appError('DOC_FILE_NOT_FOUND')
      return `${TABLE}/${id}/${row.file}`
    },
  }
}

/** Vínculos página ↔ tarefa (um par só uma vez). */
function createDocPageTaskRepository(db) {
  const toEntity = (row) => ({ id: row.id, pageId: row.page_id, taskId: row.task_id, createdBy: row.created_by || null, createdAt: row.created })
  return {
    async listByPages(pageIds) {
      if (!pageIds || pageIds.length === 0) return []
      return (await db.query('SELECT * FROM doc_page_tasks WHERE page_id = ANY($1::text[]) ORDER BY created ASC, id ASC', [pageIds])).map(toEntity)
    },
    async listByTask(taskId) {
      return (await db.query('SELECT * FROM doc_page_tasks WHERE task_id = $1 ORDER BY created ASC, id ASC', [taskId])).map(toEntity)
    },
    async find(pageId, taskId) {
      const row = await db.one('SELECT * FROM doc_page_tasks WHERE page_id = $1 AND task_id = $2', [pageId, taskId])
      return row ? toEntity(row) : null
    },
    /** Cria o vínculo; o par que já existe não muda (devolve null). */
    async add(data) {
      const row = await db.one(
        'INSERT INTO doc_page_tasks (id, page_id, task_id, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT (page_id, task_id) DO NOTHING RETURNING *',
        [newId(), data.pageId, data.taskId, data.createdBy || null],
      )
      return row ? toEntity(row) : null
    },
    async remove(pageId, taskId) {
      return (await db.exec('DELETE FROM doc_page_tasks WHERE page_id = $1 AND task_id = $2', [pageId, taskId])) > 0
    },
  }
}

module.exports = { createDocSpaceRepository, createDocPageRepository, createDocPageVersionRepository, createDocFileRepository, createDocPageTaskRepository }
