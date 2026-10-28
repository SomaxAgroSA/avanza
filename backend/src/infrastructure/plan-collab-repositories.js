/**
 * Repositórios PocketBase do painel do elemento do quadro (Gerenciamento de Projetos, GP-3):
 * atualizações (conversa com respostas) e os arquivos colados/anexados nelas. Contagens por projeto em uma consulta (contador
 * da linha no quadro).
 */

const { toDate, toPbDate, findOrNull } = require('./pb-helpers')
const { appError } = require('../core/errors')

/** { item_id: total } de uma consulta agrupada. */
function countsBy(app, collection, projectId, extraWhere) {
  const rows = arrayOf(new DynamicModel({ item_id: '', total: 0 }))
  const where = extraWhere ? $dbx.and($dbx.hashExp({ project_id: projectId }), extraWhere) : $dbx.hashExp({ project_id: projectId })
  app.db().select('item_id', 'COUNT(*) AS total').from(collection).where(where).groupBy('item_id').all(rows)
  const out = {}
  rows.forEach((row) => {
    out[row.item_id] = row.total
  })
  return out
}

function createPlanUpdateRepository(app) {
  const COLLECTION = 'plan_item_updates'
  const toEntity = (record) => ({
    id: record.id,
    projectId: record.getString('project_id'),
    itemId: record.getString('item_id'),
    parentId: record.getString('parent_id') || null,
    authorId: record.getString('author_id') || null,
    content: record.getString('content'),
    mentions: record.getStringSlice('mentions'),
    editedAt: toDate(record.getDateTime('edited_at')),
    deletedAt: toDate(record.getDateTime('deleted_at')),
    createdAt: toDate(record.getDateTime('created')),
  })
  const apply = (record, data) => {
    if (data.projectId !== undefined) record.set('project_id', data.projectId)
    if (data.itemId !== undefined) record.set('item_id', data.itemId)
    if (data.parentId !== undefined) record.set('parent_id', data.parentId || '')
    if (data.authorId !== undefined) record.set('author_id', data.authorId || '')
    if (data.content !== undefined) record.set('content', data.content)
    if (data.mentions !== undefined) record.set('mentions', data.mentions || [])
    if (data.editedAt !== undefined) record.set('edited_at', data.editedAt ? toPbDate(data.editedAt) : '')
    if (data.deletedAt !== undefined) record.set('deleted_at', data.deletedAt ? toPbDate(data.deletedAt) : '')
  }
  return {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    listByItem(itemId) {
      return app.findRecordsByFilter(COLLECTION, 'item_id = {:i}', 'created', 0, 0, { i: itemId }).map(toEntity)
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
    /** Atualizações não excluídas por elemento do projeto. */
    countByProject(projectId) {
      return countsBy(app, COLLECTION, projectId, $dbx.exp("deleted_at = '' OR deleted_at IS NULL"))
    },
  }
}

function createPlanFileRepository(app) {
  const COLLECTION = 'plan_item_files'
  const toEntity = (record) => ({
    id: record.id,
    projectId: record.getString('project_id'),
    itemId: record.getString('item_id'),
    updateId: record.getString('update_id') || null,
    name: record.getString('name'),
    mime: record.getString('mime'),
    kind: record.getString('kind'),
    size: record.getInt('size'),
    uploadedBy: record.getString('uploaded_by') || null,
    createdAt: toDate(record.getDateTime('created')),
  })
  return {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    listByItem(itemId) {
      return app.findRecordsByFilter(COLLECTION, 'item_id = {:i}', '-created', 0, 0, { i: itemId }).map(toEntity)
    },
    /** `data.handle` é o arquivo enviado; o PocketBase revalida tipo e tamanho ao salvar. */
    create(data) {
      const record = new Record(app.findCollectionByNameOrId(COLLECTION))
      record.set('project_id', data.projectId)
      record.set('item_id', data.itemId)
      record.set('update_id', data.updateId || '')
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
    delete(id) {
      app.delete(app.findRecordById(COLLECTION, id))
    },
    fileKeyOf(id) {
      const record = app.findRecordById(COLLECTION, id)
      return `${record.baseFilesPath()}/${record.getString('file')}`
    },
    countByProject(projectId) {
      return countsBy(app, COLLECTION, projectId)
    },
  }
}

function createPlanCollabRepositories(app) {
  return {
    planUpdateRepository: createPlanUpdateRepository(app),
    planFileRepository: createPlanFileRepository(app),
  }
}

module.exports = { createPlanCollabRepositories }
