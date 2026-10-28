/**
 * Repositórios PocketBase da documentação (expansão, Onda 2): espaços, páginas, versões e arquivos.
 * Árvore, busca e recentes leem só as colunas necessárias (o conteúdo JSON não é carregado).
 */

const { toDate, toPbDate, findOrNull } = require('./pb-helpers')
const { appError } = require('../core/errors')

function parseJson(record, field) {
  const raw = record.getString(field)
  if (!raw || raw === 'null') return null
  try {
    return JSON.parse(raw)
  } catch (_) {
    return null
  }
}

const sqlDate = (text) => (text ? new Date(String(text).replace(' ', 'T')) : null)

function createDocSpaceRepository(app) {
  const COLLECTION = 'doc_spaces'
  const FIELDS = { key: 'key', name: 'name', description: 'description', icon: 'icon', color: 'color', projectId: 'project_id', visibility: 'visibility', homePageId: 'home_page_id', createdBy: 'created_by' }

  function toEntity(record) {
    return {
      id: record.id,
      key: record.getString('key'),
      name: record.getString('name'),
      description: record.getString('description'),
      icon: record.getString('icon'),
      color: record.getString('color'),
      projectId: record.getString('project_id') || null,
      visibility: record.getString('visibility'),
      homePageId: record.getString('home_page_id') || null,
      createdBy: record.getString('created_by') || null,
      createdAt: toDate(record.getDateTime('created')),
      updatedAt: toDate(record.getDateTime('updated')),
    }
  }

  function apply(record, data) {
    Object.keys(data).forEach((key) => {
      if (FIELDS[key]) record.set(FIELDS[key], data[key] === null ? '' : data[key])
    })
  }

  return {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    findByKey(key) {
      const record = findOrNull(() => app.findFirstRecordByData(COLLECTION, 'key', key))
      return record ? toEntity(record) : null
    },
    list() {
      return app.findRecordsByFilter(COLLECTION, "id != ''", 'name', 0, 0).map(toEntity)
    },
    create(data) {
      const record = new Record(app.findCollectionByNameOrId(COLLECTION))
      apply(record, data)
      app.save(record)
      return toEntity(record)
    },
    update(id, patch) {
      const record = app.findRecordById(COLLECTION, id)
      apply(record, patch)
      app.save(record)
      return toEntity(record)
    },
    /** Páginas, versões e arquivos saem junto (relações em cascata). */
    delete(id) {
      app.delete(app.findRecordById(COLLECTION, id))
    },
  }
}

function createDocPageRepository(app) {
  const COLLECTION = 'doc_pages'
  const FIELDS = {
    spaceId: 'space_id',
    parentId: 'parent_id',
    title: 'title',
    position: 'position',
    status: 'status',
    contentText: 'content_text',
    searchText: 'search_text',
    version: 'version',
    publishedBy: 'published_by',
    draftTitle: 'draft_title',
    draftBy: 'draft_by',
    createdBy: 'created_by',
  }
  const JSON_FIELDS = { content: 'content', draft: 'draft' }
  const DATES = { publishedAt: 'published_at', draftAt: 'draft_at' }

  function toEntity(record) {
    return {
      id: record.id,
      spaceId: record.getString('space_id'),
      parentId: record.getString('parent_id') || null,
      title: record.getString('title'),
      position: record.getFloat('position'),
      status: record.getString('status'),
      content: parseJson(record, 'content'),
      contentText: record.getString('content_text'),
      searchText: record.getString('search_text'),
      version: record.getInt('version'),
      publishedAt: toDate(record.getDateTime('published_at')),
      publishedBy: record.getString('published_by') || null,
      draft: parseJson(record, 'draft'),
      draftTitle: record.getString('draft_title'),
      draftBy: record.getString('draft_by') || null,
      draftAt: toDate(record.getDateTime('draft_at')),
      createdBy: record.getString('created_by') || null,
      createdAt: toDate(record.getDateTime('created')),
      updatedAt: toDate(record.getDateTime('updated')),
    }
  }

  function apply(record, data) {
    Object.keys(data).forEach((key) => {
      const value = data[key]
      if (FIELDS[key]) record.set(FIELDS[key], value === null ? '' : value)
      else if (JSON_FIELDS[key]) record.set(JSON_FIELDS[key], value === null ? null : value)
      else if (DATES[key]) record.set(DATES[key], toPbDate(value))
    })
  }

  /** Linhas enxutas (sem o conteúdo) para árvore/busca/recentes. */
  function lean(columns, where, order, limit) {
    const shape = {}
    columns.forEach((c) => {
      shape[c] = c === 'position' ? 0 : ''
    })
    const rows = arrayOf(new DynamicModel(shape))
    const db = app.db()
    const select = db.select(...columns).from(COLLECTION).where(where)
    if (order) select.orderBy(order)
    if (limit) select.limit(limit)
    select.all(rows)
    return rows
  }

  const TREE_COLUMNS = ['id', 'space_id', 'parent_id', 'title', 'position', 'status', 'draft_at', 'published_at', 'updated']

  return {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    listTree(spaceId) {
      return lean(TREE_COLUMNS, $dbx.hashExp({ space_id: spaceId })).map((r) => ({
        id: r.id,
        spaceId: r.space_id,
        parentId: r.parent_id || null,
        title: r.title,
        position: r.position,
        status: r.status,
        draftAt: sqlDate(r.draft_at),
        publishedAt: sqlDate(r.published_at),
        updatedAt: sqlDate(r.updated),
      }))
    },
    countPublishedBySpaces(ids) {
      const out = {}
      if (!ids.length) return out
      const rows = arrayOf(new DynamicModel({ space_id: '', total: 0 }))
      app
        .db()
        .select('space_id', 'COUNT(*) AS total')
        .from(COLLECTION)
        .where($dbx.and($dbx.in.apply(null, ['space_id'].concat(ids)), $dbx.hashExp({ status: 'published' })))
        .groupBy('space_id')
        .all(rows)
      rows.forEach((r) => {
        out[r.space_id] = r.total
      })
      return out
    },
    create(data) {
      const record = new Record(app.findCollectionByNameOrId(COLLECTION))
      apply(record, data)
      app.save(record)
      return toEntity(record)
    },
    update(id, patch) {
      const record = app.findRecordById(COLLECTION, id)
      apply(record, patch)
      app.save(record)
      return toEntity(record)
    },
    /** Versões e arquivos das páginas saem junto (relações em cascata). */
    deleteMany(ids) {
      if (!ids.length) return
      app.findRecordsByIds(COLLECTION, ids).forEach((record) => app.delete(record))
    },
    renumber(ids) {
      ids.forEach((id, index) => {
        const record = app.findRecordById(COLLECTION, id)
        record.set('position', (index + 1) * 1024)
        app.save(record)
      })
    },
    /** Publicadas nos espaços, com o texto "dobrado" (sem acento/maiúsculas) contendo o termo. */
    search(spaceIds, folded, limit) {
      const where = $dbx.and($dbx.in.apply(null, ['space_id'].concat(spaceIds)), $dbx.hashExp({ status: 'published' }), $dbx.like('search_text', folded))
      return lean(['id', 'space_id', 'title', 'content_text', 'published_at'], where, 'published_at DESC', limit).map((r) => ({
        id: r.id,
        spaceId: r.space_id,
        title: r.title,
        contentText: r.content_text,
        publishedAt: sqlDate(r.published_at),
      }))
    },
    recent(spaceIds, limit) {
      const where = $dbx.and($dbx.in.apply(null, ['space_id'].concat(spaceIds)), $dbx.hashExp({ status: 'published' }))
      return lean(['id', 'space_id', 'title', 'published_at', 'published_by'], where, 'published_at DESC', limit).map((r) => ({
        id: r.id,
        spaceId: r.space_id,
        title: r.title,
        publishedAt: sqlDate(r.published_at),
        publishedBy: r.published_by || null,
      }))
    },
  }
}

function createDocPageVersionRepository(app) {
  const COLLECTION = 'doc_page_versions'

  function toEntity(record, withContent) {
    return {
      id: record.id,
      pageId: record.getString('page_id'),
      version: record.getInt('version'),
      title: record.getString('title'),
      content: withContent ? parseJson(record, 'content') : undefined,
      author: record.getString('author') || null,
      createdAt: toDate(record.getDateTime('created')),
    }
  }

  return {
    create(data) {
      const record = new Record(app.findCollectionByNameOrId(COLLECTION))
      record.set('page_id', data.pageId)
      record.set('version', data.version)
      record.set('title', data.title)
      record.set('content', data.content)
      record.set('author', data.author || '')
      app.save(record)
      return toEntity(record, true)
    },
    listByPage(pageId) {
      return app.findRecordsByFilter(COLLECTION, 'page_id = {:p}', '-version', 0, 0, { p: pageId }).map((r) => toEntity(r, false))
    },
    find(pageId, version) {
      const found = app.findRecordsByFilter(COLLECTION, 'page_id = {:p} && version = {:v}', '', 1, 0, { p: pageId, v: version })
      return found.length ? toEntity(found[0], true) : null
    },
  }
}

function createDocFileRepository(app) {
  const COLLECTION = 'doc_files'

  function toEntity(record) {
    return {
      id: record.id,
      spaceId: record.getString('space_id'),
      pageId: record.getString('page_id'),
      name: record.getString('name'),
      mime: record.getString('mime'),
      kind: record.getString('kind'),
      size: record.getInt('size'),
      uploadedBy: record.getString('uploaded_by') || null,
      createdAt: toDate(record.getDateTime('created')),
    }
  }

  return {
    /** `data.handle` é o arquivo enviado; o PocketBase revalida tipo e tamanho ao salvar. */
    create(data) {
      const record = new Record(app.findCollectionByNameOrId(COLLECTION))
      record.set('space_id', data.spaceId)
      record.set('page_id', data.pageId)
      record.set('file', data.handle)
      record.set('name', data.name)
      record.set('mime', data.mime)
      record.set('kind', data.kind)
      record.set('size', data.size)
      record.set('uploaded_by', data.uploadedBy || '')
      try {
        app.save(record)
      } catch (_err) {
        throw appError('VALIDATION_ERROR', undefined, { fields: { files: 'invalid_file' }, name: data.name })
      }
      return toEntity(record)
    },
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    fileKeyOf(id) {
      const record = app.findRecordById(COLLECTION, id)
      return `${record.baseFilesPath()}/${record.getString('file')}`
    },
  }
}

function createDocRepositories(app) {
  return {
    docSpaceRepository: createDocSpaceRepository(app),
    docPageRepository: createDocPageRepository(app),
    docPageVersionRepository: createDocPageVersionRepository(app),
    docFileRepository: createDocFileRepository(app),
  }
}

module.exports = { createDocRepositories }
