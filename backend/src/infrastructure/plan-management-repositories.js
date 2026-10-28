/**
 * Repositórios PocketBase da Gestão do quadro (Gerenciamento de Projetos, GP-4: Diário do projeto e
 * Gestão dos problemas) e das colunas personalizadas (GP-5). Datas são "dia puro" (AAAA-MM-DD,
 * meia-noite UTC).
 */

const { toDate, findOrNull } = require('./pb-helpers')

const dayOf = (dateTime) => {
  const date = toDate(dateTime)
  return date ? date.toISOString().slice(0, 10) : null
}
const toDay = (value) => (value ? value + ' 00:00:00.000Z' : '')

function createPlanJournalRepository(app) {
  const COLLECTION = 'plan_journal'
  const toEntity = (record) => ({
    id: record.id,
    projectId: record.getString('project_id'),
    entryDate: dayOf(record.getDateTime('entry_date')),
    content: record.getString('content'),
    authorId: record.getString('author_id') || null,
    createdAt: toDate(record.getDateTime('created')),
    updatedAt: toDate(record.getDateTime('updated')),
  })
  const apply = (record, data) => {
    if (data.projectId !== undefined) record.set('project_id', data.projectId)
    if (data.entryDate !== undefined) record.set('entry_date', toDay(data.entryDate))
    if (data.content !== undefined) record.set('content', data.content)
    if (data.authorId !== undefined) record.set('author_id', data.authorId || '')
  }
  return {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    listByProject(projectId) {
      return app.findRecordsByFilter(COLLECTION, 'project_id = {:p}', '-entry_date,-created', 0, 0, { p: projectId }).map(toEntity)
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
    delete(id) {
      app.delete(app.findRecordById(COLLECTION, id))
    },
  }
}

function createPlanIssueRepository(app) {
  const COLLECTION = 'plan_issues'
  const toEntity = (record) => ({
    id: record.id,
    projectId: record.getString('project_id'),
    number: record.getInt('number'),
    openedOn: dayOf(record.getDateTime('opened_on')),
    description: record.getString('description'),
    state: record.getString('state'),
    ownerId: record.getString('owner_id') || null,
    resolvedOn: dayOf(record.getDateTime('resolved_on')),
    createdBy: record.getString('created_by') || null,
    createdAt: toDate(record.getDateTime('created')),
    updatedAt: toDate(record.getDateTime('updated')),
  })
  const apply = (record, data) => {
    if (data.projectId !== undefined) record.set('project_id', data.projectId)
    if (data.number !== undefined) record.set('number', data.number)
    if (data.openedOn !== undefined) record.set('opened_on', toDay(data.openedOn))
    if (data.description !== undefined) record.set('description', data.description)
    if (data.state !== undefined) record.set('state', data.state)
    if (data.ownerId !== undefined) record.set('owner_id', data.ownerId || '')
    if (data.resolvedOn !== undefined) record.set('resolved_on', toDay(data.resolvedOn))
    if (data.createdBy !== undefined) record.set('created_by', data.createdBy || '')
  }
  return {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    listByProject(projectId) {
      return app.findRecordsByFilter(COLLECTION, 'project_id = {:p}', 'number', 0, 0, { p: projectId }).map(toEntity)
    },
    /** Maior número do projeto (0 se não houver). */
    maxNumber(projectId) {
      const row = new DynamicModel({ n: 0 })
      app.db().select('COALESCE(MAX(number), 0) AS n').from(COLLECTION).where($dbx.hashExp({ project_id: projectId })).one(row)
      return row.n
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
    delete(id) {
      app.delete(app.findRecordById(COLLECTION, id))
    },
  }
}

function createPlanColumnRepository(app) {
  const COLLECTION = 'plan_columns'
  const toEntity = (record) => {
    let settings = {}
    try {
      settings = JSON.parse(record.getString('settings') || '{}') || {}
    } catch (_) {
      settings = {}
    }
    return {
      id: record.id,
      projectId: record.getString('project_id'),
      name: record.getString('name'),
      type: record.getString('type'),
      settings,
      position: record.getFloat('position'),
      createdBy: record.getString('created_by') || null,
      createdAt: toDate(record.getDateTime('created')),
      updatedAt: toDate(record.getDateTime('updated')),
    }
  }
  const apply = (record, data) => {
    if (data.projectId !== undefined) record.set('project_id', data.projectId)
    if (data.name !== undefined) record.set('name', data.name)
    if (data.type !== undefined) record.set('type', data.type)
    if (data.settings !== undefined) record.set('settings', data.settings || {})
    if (data.position !== undefined) record.set('position', data.position)
    if (data.createdBy !== undefined) record.set('created_by', data.createdBy || '')
  }
  return {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    listByProject(projectId) {
      return app.findRecordsByFilter(COLLECTION, 'project_id = {:p}', 'position,created', 0, 0, { p: projectId }).map(toEntity)
    },
    /** Maior posição do quadro (0 se não houver). */
    maxPosition(projectId) {
      const row = new DynamicModel({ n: 0 })
      app.db().select('COALESCE(MAX(position), 0) AS n').from(COLLECTION).where($dbx.hashExp({ project_id: projectId })).one(row)
      return row.n
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
    delete(id) {
      app.delete(app.findRecordById(COLLECTION, id))
    },
  }
}

function createPlanManagementRepositories(app) {
  return {
    planJournalRepository: createPlanJournalRepository(app),
    planIssueRepository: createPlanIssueRepository(app),
    planColumnRepository: createPlanColumnRepository(app),
  }
}

module.exports = { createPlanManagementRepositories }
