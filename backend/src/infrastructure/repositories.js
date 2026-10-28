/**
 * Repositórios PocketBase — implementam as portas descritas em application/ports.js.
 *
 * Único ponto do backend que conhece collections, nomes de colunas e a API do PocketBase.
 * Trocar o banco (ex.: PostgreSQL) significa reescrever este arquivo, não o domínio.
 */

const { toDate, toPbDate, findOrNull } = require('./pb-helpers')
const { appError } = require('../core/errors')

const USER_FIELDS = { name: 'name', roleId: 'role_id', status: 'status', locale: 'locale', theme: 'theme' }

function createUserRepository(app) {
  const COLLECTION = 'users'

  function toEntity(record) {
    return {
      id: record.id,
      name: record.getString('name'),
      email: record.email(),
      avatarUrl: null, // servido por rota protegida em fase futura
      status: record.getString('status'),
      roleId: record.getString('role_id'),
      locale: record.getString('locale') || 'pt-BR',
      theme: record.getString('theme') || 'system',
      emailNotifications: !record.getBool('email_notifications_off'),
      createdAt: toDate(record.getDateTime('created')),
      updatedAt: toDate(record.getDateTime('updated')),
      lastLoginAt: toDate(record.getDateTime('last_login_at')),
    }
  }

  function findRecord(id) {
    return findOrNull(() => app.findRecordById(COLLECTION, id))
  }

  function buildFilters(query) {
    const exprs = []
    if (query.search) exprs.push($dbx.or($dbx.like('name', query.search), $dbx.like('email', query.search)))
    if (query.status) exprs.push($dbx.hashExp({ status: query.status }))
    if (query.roleId) exprs.push($dbx.hashExp({ role_id: query.roleId }))
    return exprs
  }

  return {
    findById(id) {
      const record = findRecord(id)
      return record ? toEntity(record) : null
    },

    findByEmail(email) {
      const record = findOrNull(() => app.findAuthRecordByEmail(COLLECTION, email))
      return record ? toEntity(record) : null
    },

    findManyByIds(ids) {
      if (ids.length === 0) return []
      return app.findRecordsByIds(COLLECTION, ids).map(toEntity)
    },

    emailExists(email, exceptId) {
      const record = findOrNull(() =>
        app.findFirstRecordByFilter(COLLECTION, 'email = {:email} && id != {:id}', { email, id: exceptId || '' }),
      )
      return !!record
    },

    list(query) {
      const exprs = buildFilters(query)
      const select = app.recordQuery(COLLECTION)
      exprs.forEach((expr) => select.andWhere(expr))
      // colunas de ordenação vêm de whitelist na camada de aplicação
      select.orderBy.apply(select, query.sort.map((s) => `${s.column} ${s.direction}`).concat(['id ASC']))
      select.limit(query.pagination.perPage).offset(query.pagination.offset)
      const records = arrayOf(new Record())
      select.all(records)
      const total = app.countRecords.apply(app, [COLLECTION].concat(exprs))
      return { items: records.map(toEntity), total }
    },

    create(data) {
      const record = new Record(app.findCollectionByNameOrId(COLLECTION))
      record.set('name', data.name)
      record.setEmail(data.email)
      record.setPassword(data.password)
      record.setVerified(true)
      record.set('role_id', data.roleId)
      record.set('status', data.status)
      record.set('locale', data.locale)
      record.set('theme', data.theme)
      app.save(record)
      return toEntity(record)
    },

    update(id, patch) {
      const record = app.findRecordById(COLLECTION, id)
      Object.keys(patch).forEach((key) => {
        if (key === 'email') record.setEmail(patch.email)
        else if (key === 'password') record.setPassword(patch.password)
        else if (key === 'lastLoginAt') record.set('last_login_at', toPbDate(patch.lastLoginAt))
        else if (key === 'emailNotifications') record.set('email_notifications_off', !patch.emailNotifications)
        else if (USER_FIELDS[key]) record.set(USER_FIELDS[key], patch[key])
      })
      app.save(record)
      return toEntity(record)
    },

    verifyPassword(id, password) {
      const record = findRecord(id)
      return !!record && record.validatePassword(password)
    },

    countByRole(roleId) {
      return app.countRecords(COLLECTION, $dbx.hashExp({ role_id: roleId }))
    },

    /** Usuários ativos (busca por nome/e-mail), excluindo `excludeIds`. */
    searchActive(query) {
      const select = app.recordQuery(COLLECTION).andWhere($dbx.hashExp({ status: 'active' }))
      if (query.search) select.andWhere($dbx.or($dbx.like('name', query.search), $dbx.like('email', query.search)))
      if (query.excludeIds && query.excludeIds.length > 0) select.andWhere($dbx.notIn.apply(null, ['id'].concat(query.excludeIds)))
      select.orderBy('name ASC').limit(query.limit)
      const records = arrayOf(new Record())
      select.all(records)
      return records.map(toEntity)
    },
  }
}

function createRoleRepository(app) {
  const COLLECTION = 'roles'

  function toEntity(record) {
    return {
      id: record.id,
      code: record.getString('code'),
      name: record.getString('name'),
      description: record.getString('description'),
      isSystem: record.getBool('is_system'),
    }
  }

  function permissionIdsByCode(codes) {
    if (codes.length === 0) return {}
    const records = app.findAllRecords('permissions', $dbx.in.apply(null, ['code'].concat(codes)))
    const map = {}
    records.forEach((r) => {
      map[r.getString('code')] = r.id
    })
    return map
  }

  return {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },

    findByCode(code) {
      const record = findOrNull(() => app.findFirstRecordByData(COLLECTION, 'code', code))
      return record ? toEntity(record) : null
    },

    list() {
      return app.findRecordsByFilter(COLLECTION, "id != ''", 'name', 0, 0).map(toEntity)
    },

    getPermissionCodes(roleId) {
      const rows = arrayOf(new DynamicModel({ code: '' }))
      app
        .db()
        .newQuery(
          'SELECT p.code AS code FROM role_permissions rp ' +
            'INNER JOIN permissions p ON p.id = rp.permission_id ' +
            'WHERE rp.role_id = {:roleId} ORDER BY p.code',
        )
        .bind({ roleId })
        .all(rows)
      return rows.map((row) => row.code)
    },

    setPermissionCodes(roleId, codes) {
      const existing = app.findAllRecords('role_permissions', $dbx.hashExp({ role_id: roleId }))
      const ids = permissionIdsByCode(codes)
      const keepIds = codes.map((code) => ids[code]).filter(Boolean)

      existing.forEach((link) => {
        if (keepIds.indexOf(link.getString('permission_id')) < 0) app.delete(link)
      })
      const existingIds = existing.map((link) => link.getString('permission_id'))
      const collection = app.findCollectionByNameOrId('role_permissions')
      keepIds
        .filter((id) => existingIds.indexOf(id) < 0)
        .forEach((permissionId) => {
          const link = new Record(collection)
          link.set('role_id', roleId)
          link.set('permission_id', permissionId)
          app.save(link)
        })
    },

    create(data) {
      const record = new Record(app.findCollectionByNameOrId(COLLECTION))
      record.set('code', data.code)
      record.set('name', data.name)
      record.set('description', data.description || '')
      record.set('is_system', false)
      app.save(record)
      return toEntity(record)
    },

    update(id, patch) {
      const record = app.findRecordById(COLLECTION, id)
      if (patch.name !== undefined) record.set('name', patch.name)
      if (patch.description !== undefined) record.set('description', patch.description)
      app.save(record)
      return toEntity(record)
    },

    delete(id) {
      app.delete(app.findRecordById(COLLECTION, id))
    },
  }
}

function createPermissionRepository(app) {
  return {
    list() {
      return app.findRecordsByFilter('permissions', "id != ''", 'module,code', 0, 0).map((record) => ({
        id: record.id,
        code: record.getString('code'),
        module: record.getString('module'),
      }))
    },
  }
}

function createSessionRepository(app) {
  const COLLECTION = 'sessions'

  function toEntity(record) {
    return {
      id: record.id,
      userId: record.getString('user_id'),
      tokenHash: record.getString('token_hash'),
      ip: record.getString('ip'),
      userAgent: record.getString('user_agent'),
      remember: record.getBool('remember'),
      expiresAt: toDate(record.getDateTime('expires_at')),
      lastSeenAt: toDate(record.getDateTime('last_seen_at')),
      revokedAt: toDate(record.getDateTime('revoked_at')),
      createdAt: toDate(record.getDateTime('created')),
    }
  }

  const repo = {
    create(data) {
      const record = new Record(app.findCollectionByNameOrId(COLLECTION))
      record.set('user_id', data.userId)
      record.set('token_hash', data.tokenHash)
      record.set('ip', data.ip)
      record.set('user_agent', data.userAgent)
      record.set('remember', data.remember)
      record.set('expires_at', toPbDate(data.expiresAt))
      record.set('last_seen_at', toPbDate(data.lastSeenAt))
      app.save(record)
      return toEntity(record)
    },

    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },

    findByTokenHash(hash) {
      const record = findOrNull(() => app.findFirstRecordByData(COLLECTION, 'token_hash', hash))
      return record ? toEntity(record) : null
    },

    touch(id, lastSeenAt, expiresAt) {
      const record = app.findRecordById(COLLECTION, id)
      record.set('last_seen_at', toPbDate(lastSeenAt))
      record.set('expires_at', toPbDate(expiresAt))
      app.save(record)
      return toEntity(record)
    },

    revoke(id, at) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      if (!record || !record.getDateTime('revoked_at').isZero()) return
      record.set('revoked_at', toPbDate(at))
      app.save(record)
    },

    /** Revoga as sessões ativas do usuário (exceto `exceptId`); retorna quantas foram revogadas. */
    revokeAllForUser(userId, at, exceptId) {
      const records = app.findRecordsByFilter(
        COLLECTION,
        "user_id = {:userId} && revoked_at = '' && id != {:exceptId}",
        '',
        0,
        0,
        { userId, exceptId: exceptId || '' },
      )
      records.forEach((record) => {
        record.set('revoked_at', toPbDate(at))
        app.save(record)
      })
      return records.length
    },

    listActiveForUser(userId, now) {
      return app
        .findRecordsByFilter(
          COLLECTION,
          "user_id = {:userId} && revoked_at = '' && expires_at > {:now}",
          '-last_seen_at',
          50,
          0,
          { userId, now: toPbDate(now) },
        )
        .map(toEntity)
    },
  }
  return repo
}

function parseJsonField(record, field) {
  const raw = record.getString(field)
  if (!raw || raw === 'null') return null
  try {
    return JSON.parse(raw)
  } catch (_) {
    return null
  }
}

function createAuditRepository(app) {
  const COLLECTION = 'audit_logs'

  function toEntity(record) {
    return {
      id: record.id,
      entityType: record.getString('entity_type'),
      entityId: record.getString('entity_id'),
      action: record.getString('action'),
      oldValue: parseJsonField(record, 'old_value'),
      newValue: parseJsonField(record, 'new_value'),
      userId: record.getString('user_id') || null,
      ip: record.getString('ip'),
      userAgent: record.getString('user_agent'),
      correlationId: record.getString('correlation_id'),
      createdAt: toDate(record.getDateTime('created')),
    }
  }

  return {
    list(query) {
      const f = query.filters
      const exprs = []
      if (f.entityType) exprs.push($dbx.hashExp({ entity_type: f.entityType }))
      if (f.entityId) exprs.push($dbx.hashExp({ entity_id: f.entityId }))
      if (f.userId) exprs.push($dbx.hashExp({ user_id: f.userId }))
      if (f.action) exprs.push($dbx.hashExp({ action: f.action }))
      if (f.from) exprs.push($dbx.exp('created >= {:from}', { from: toPbDate(f.from) }))
      if (f.to) exprs.push($dbx.exp('created <= {:to}', { to: toPbDate(f.to) }))
      const select = app.recordQuery(COLLECTION)
      exprs.forEach((expr) => select.andWhere(expr))
      select.orderBy('created DESC', 'id DESC').limit(query.pagination.perPage).offset(query.pagination.offset)
      const records = arrayOf(new Record())
      select.all(records)
      const total = app.countRecords.apply(app, [COLLECTION].concat(exprs))
      return { items: records.map(toEntity), total }
    },

    record(entry) {
      const record = new Record(app.findCollectionByNameOrId('audit_logs'))
      record.set('entity_type', entry.entityType)
      record.set('entity_id', entry.entityId)
      record.set('action', entry.action)
      record.set('old_value', entry.oldValue)
      record.set('new_value', entry.newValue)
      record.set('user_id', entry.userId || '')
      record.set('ip', entry.ip)
      record.set('user_agent', entry.userAgent)
      record.set('correlation_id', entry.correlationId)
      app.save(record)
    },

    countBefore(date) {
      return app.countRecords(COLLECTION, $dbx.exp('created < {:c}', { c: toPbDate(date) }))
    },

    /** Retenção (Configurador geral): apaga em lotes o que é anterior à data; o histórico não tem arquivos. */
    purgeBefore(date) {
      const c = toPbDate(date)
      const total = app.countRecords(COLLECTION, $dbx.exp('created < {:c}', { c }))
      for (let left = total; left > 0; left -= 1000) {
        app.db().newQuery('DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs WHERE created < {:c} ORDER BY created LIMIT 1000)').bind({ c }).execute()
      }
      return total
    },
  }
}

function createProjectRepository(app) {
  const COLLECTION = 'projects'

  function toEntity(record) {
    return {
      id: record.id,
      name: record.getString('name'),
      key: record.getString('key'),
      description: record.getString('description'),
      icon: record.getString('icon'),
      cover: record.getString('cover'),
      status: record.getString('status'),
      priority: record.getString('priority'),
      ownerId: record.getString('owner_id'),
      createdBy: record.getString('created_by'),
      startDate: toDate(record.getDateTime('start_date')),
      dueDate: toDate(record.getDateTime('due_date')),
      archivedAt: toDate(record.getDateTime('archived_at')),
      createdAt: toDate(record.getDateTime('created')),
      updatedAt: toDate(record.getDateTime('updated')),
    }
  }

  const FIELDS = { name: 'name', description: 'description', icon: 'icon', cover: 'cover', status: 'status', priority: 'priority', ownerId: 'owner_id', createdBy: 'created_by' }
  const DATES = { startDate: 'start_date', dueDate: 'due_date', archivedAt: 'archived_at' }

  function apply(record, data) {
    Object.keys(data).forEach((key) => {
      if (FIELDS[key]) record.set(FIELDS[key], data[key])
      else if (DATES[key]) record.set(DATES[key], toPbDate(data[key]))
      else if (key === 'key') record.set('key', data.key)
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

    list(query) {
      const exprs = []
      if (query.view === 'mine' || !query.scope.viewAll) {
        exprs.push($dbx.exp('projects.id IN (SELECT project_id FROM project_members WHERE user_id = {:uid})', { uid: query.scope.userId }))
      }
      exprs.push($dbx.exp(query.view === 'archived' ? "archived_at != ''" : "archived_at = ''"))
      if (query.search) exprs.push($dbx.or($dbx.like('name', query.search), $dbx.like('key', query.search)))
      if (query.status) exprs.push($dbx.hashExp({ status: query.status }))
      if (query.priority) exprs.push($dbx.hashExp({ priority: query.priority }))
      if (query.ownerId) exprs.push($dbx.hashExp({ owner_id: query.ownerId }))

      const select = app.recordQuery(COLLECTION)
      exprs.forEach((expr) => select.andWhere(expr))
      select.orderBy.apply(select, query.sort.map((s) => `${s.column} ${s.direction}`).concat(['id ASC']))
      select.limit(query.pagination.perPage).offset(query.pagination.offset)
      const records = arrayOf(new Record())
      select.all(records)
      const total = app.countRecords.apply(app, [COLLECTION].concat(exprs))
      return { items: records.map(toEntity), total }
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

    findManyByIds(ids) {
      if (ids.length === 0) return []
      return app.findRecordsByIds(COLLECTION, ids).map(toEntity)
    },
  }
}

function createProjectMemberRepository(app) {
  const COLLECTION = 'project_members'

  function toEntity(record) {
    return {
      id: record.id,
      projectId: record.getString('project_id'),
      userId: record.getString('user_id'),
      role: record.getString('role'),
      createdAt: toDate(record.getDateTime('created')),
    }
  }

  function findRecord(projectId, userId) {
    return findOrNull(() =>
      app.findFirstRecordByFilter(COLLECTION, 'project_id = {:p} && user_id = {:u}', { p: projectId, u: userId }),
    )
  }

  return {
    find(projectId, userId) {
      const record = findRecord(projectId, userId)
      return record ? toEntity(record) : null
    },

    listByProject(projectId) {
      return app.findRecordsByFilter(COLLECTION, 'project_id = {:p}', 'created', 0, 0, { p: projectId }).map(toEntity)
    },

    add(data) {
      const record = new Record(app.findCollectionByNameOrId(COLLECTION))
      record.set('project_id', data.projectId)
      record.set('user_id', data.userId)
      record.set('role', data.role)
      app.save(record)
      return toEntity(record)
    },

    updateRole(projectId, userId, role) {
      const record = findRecord(projectId, userId)
      record.set('role', role)
      app.save(record)
      return toEntity(record)
    },

    remove(projectId, userId) {
      const record = findRecord(projectId, userId)
      if (record) app.delete(record)
    },

    removeAllForProject(projectId) {
      app.findRecordsByFilter(COLLECTION, 'project_id = {:p}', '', 0, 0, { p: projectId }).forEach((record) => app.delete(record))
    },

    countByProjects(ids) {
      const counts = {}
      if (ids.length === 0) return counts
      const rows = arrayOf(new DynamicModel({ project_id: '', total: 0 }))
      app
        .db()
        .select('project_id', 'COUNT(*) AS total')
        .from(COLLECTION)
        .where($dbx.in.apply(null, ['project_id'].concat(ids)))
        .groupBy('project_id')
        .all(rows)
      rows.forEach((row) => {
        counts[row.project_id] = row.total
      })
      return counts
    },

    rolesForUser(userId, ids) {
      const roles = {}
      if (ids.length === 0) return roles
      app
        .findAllRecords(COLLECTION, $dbx.hashExp({ user_id: userId }), $dbx.in.apply(null, ['project_id'].concat(ids)))
        .forEach((record) => {
          roles[record.getString('project_id')] = record.getString('role')
        })
      return roles
    },
  }
}

function createCustomFieldRepository(app) {
  const COLLECTION = 'custom_fields'
  const OPTIONS = 'custom_field_options'
  const FIELDS = {
    name: 'name',
    label: 'label',
    type: 'type',
    description: 'description',
    config: 'config',
    defaultValue: 'default_value',
    searchable: 'searchable',
    filterable: 'filterable',
    sortable: 'sortable',
  }

  function toEntity(record) {
    return {
      id: record.id,
      name: record.getString('name'),
      label: record.getString('label'),
      type: record.getString('type'),
      description: record.getString('description'),
      config: parseJsonField(record, 'config') || {},
      defaultValue: parseJsonField(record, 'default_value'),
      searchable: record.getBool('searchable'),
      filterable: record.getBool('filterable'),
      sortable: record.getBool('sortable'),
      createdAt: toDate(record.getDateTime('created')),
      updatedAt: toDate(record.getDateTime('updated')),
    }
  }

  function toOption(record) {
    return {
      id: record.id,
      fieldId: record.getString('field_id'),
      label: record.getString('label'),
      color: record.getString('color') || 'gray',
      order: record.getInt('order'),
      isActive: record.getBool('is_active'),
    }
  }

  function apply(record, data) {
    Object.keys(data).forEach((key) => {
      if (FIELDS[key]) record.set(FIELDS[key], data[key] === undefined ? null : data[key])
    })
  }

  const repo = {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    findByName(name) {
      const record = findOrNull(() => app.findFirstRecordByData(COLLECTION, 'name', name))
      return record ? toEntity(record) : null
    },
    findManyByIds(ids) {
      if (ids.length === 0) return []
      return app.findRecordsByIds(COLLECTION, ids).map(toEntity)
    },
    list(query) {
      const select = app.recordQuery(COLLECTION)
      if (query.type) select.andWhere($dbx.hashExp({ type: query.type }))
      if (query.search) select.andWhere($dbx.or($dbx.like('label', query.search), $dbx.like('name', query.search)))
      select.orderBy('label ASC', 'id ASC')
      const records = arrayOf(new Record())
      select.all(records)
      return records.map(toEntity)
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
    listOptions(fieldIds) {
      if (fieldIds.length === 0) return []
      return app
        .findAllRecords(OPTIONS, $dbx.in.apply(null, ['field_id'].concat(fieldIds)))
        .map(toOption)
        .sort((a, b) => a.order - b.order)
    },
    /** Substitui as opções: mantém IDs informados, cria novas e remove as ausentes. */
    syncOptions(fieldId, options) {
      const existing = app.findAllRecords(OPTIONS, $dbx.hashExp({ field_id: fieldId }))
      const keep = options.filter((o) => o.id).map((o) => o.id)
      existing.forEach((record) => {
        if (keep.indexOf(record.id) < 0) app.delete(record)
      })
      const collection = app.findCollectionByNameOrId(OPTIONS)
      return options.map((option, index) => {
        let record = option.id ? existing.find((r) => r.id === option.id) : null
        if (!record) {
          record = new Record(collection)
          record.set('field_id', fieldId)
        }
        record.set('label', option.label)
        record.set('color', option.color)
        record.set('order', index)
        record.set('is_active', option.isActive)
        app.save(record)
        return toOption(record)
      })
    },
  }
  return repo
}

function createTaskTypeRepository(app) {
  const COLLECTION = 'task_types'

  function toEntity(record) {
    return {
      id: record.id,
      key: record.getString('key'),
      name: record.getString('name'),
      description: record.getString('description'),
      translations: parseJsonField(record, 'translations') || {},
      icon: record.getString('icon'),
      color: record.getString('color'),
      order: record.getInt('order'),
      isActive: record.getBool('is_active'),
      createdAt: toDate(record.getDateTime('created')),
      updatedAt: toDate(record.getDateTime('updated')),
    }
  }

  const FIELDS = { key: 'key', name: 'name', description: 'description', translations: 'translations', icon: 'icon', color: 'color', order: 'order', isActive: 'is_active' }

  function apply(record, data) {
    Object.keys(data).forEach((key) => {
      if (FIELDS[key]) record.set(FIELDS[key], data[key])
    })
  }

  const repo = {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    findByKey(key) {
      const record = findOrNull(() => app.findFirstRecordByData(COLLECTION, 'key', key))
      return record ? toEntity(record) : null
    },
    list(query) {
      const filter = query.includeInactive ? "id != ''" : 'is_active = true'
      return app.findRecordsByFilter(COLLECTION, filter, 'order,name', 0, 0).map(toEntity)
    },
    maxOrder() {
      return repo.list({ includeInactive: true }).reduce((max, t) => Math.max(max, t.order), -1)
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
    setOrder(ids) {
      ids.forEach((id, index) => {
        const record = app.findRecordById(COLLECTION, id)
        record.set('order', index)
        app.save(record)
      })
    },
    /** Tarefas que usam o tipo (a collection de tarefas chega na Fase 4). */
    countTasks(id) {
      try {
        return app.countRecords('tasks', $dbx.hashExp({ task_type_id: id }))
      } catch (_) {
        return 0
      }
    },
  }
  return repo
}

function createTaskTypeFieldRepository(app) {
  const COLLECTION = 'task_type_fields'

  function toEntity(record) {
    return {
      typeId: record.getString('task_type_id'),
      fieldId: record.getString('field_id'),
      order: record.getInt('order'),
      required: record.getBool('required'),
      visible: record.getBool('visible'),
      showOnCard: record.getBool('show_on_card'),
      requiredStatusIds: parseJsonField(record, 'required_status_ids') || [],
    }
  }

  return {
    listByType(typeId) {
      return app.findRecordsByFilter(COLLECTION, 'task_type_id = {:t}', 'order', 0, 0, { t: typeId }).map(toEntity)
    },
    replace(typeId, items) {
      app.findAllRecords(COLLECTION, $dbx.hashExp({ task_type_id: typeId })).forEach((record) => app.delete(record))
      const collection = app.findCollectionByNameOrId(COLLECTION)
      items.forEach((item) => {
        const record = new Record(collection)
        record.set('task_type_id', typeId)
        record.set('field_id', item.fieldId)
        record.set('order', item.order)
        record.set('required', item.required)
        record.set('visible', item.visible)
        record.set('show_on_card', item.showOnCard)
        record.set('required_status_ids', item.requiredStatusIds || [])
        app.save(record)
      })
    },
    typesUsingFields(fieldIds) {
      const map = {}
      if (fieldIds.length === 0) return map
      app.findAllRecords(COLLECTION, $dbx.in.apply(null, ['field_id'].concat(fieldIds))).forEach((record) => {
        const fieldId = record.getString('field_id')
        map[fieldId] = (map[fieldId] || []).concat(record.getString('task_type_id'))
      })
      return map
    },
    countByTypes(typeIds) {
      const counts = {}
      if (typeIds.length === 0) return counts
      const rows = arrayOf(new DynamicModel({ task_type_id: '', total: 0 }))
      app
        .db()
        .select('task_type_id', 'COUNT(*) AS total')
        .from(COLLECTION)
        .where($dbx.in.apply(null, ['task_type_id'].concat(typeIds)))
        .groupBy('task_type_id')
        .all(rows)
      rows.forEach((row) => {
        counts[row.task_type_id] = row.total
      })
      return counts
    },
  }
}

/** Escapa curingas do LIKE (usado com ESCAPE '\'). */
function likePattern(text) {
  return `%${String(text).replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

function createTaskRepository(app) {
  const COLLECTION = 'tasks'

  function toEntity(record) {
    // horas: 0 = não informado (campo numérico do PocketBase não aceita nulo)
    const number = (name) => {
      const value = record.getFloat(name)
      return value > 0 ? value : null
    }
    return {
      id: record.id,
      projectId: record.getString('project_id'),
      number: record.getInt('number'),
      code: record.getString('code'),
      title: record.getString('title'),
      description: record.getString('description'),
      typeId: record.getString('task_type_id'),
      statusId: record.getString('status_id'),
      priorityId: record.getString('priority_id'),
      creatorId: record.getString('creator_id') || null,
      assigneeId: record.getString('assignee_id') || null,
      reporterId: record.getString('reporter_id') || null,
      parentTaskId: record.getString('parent_task_id') || null,
      forkedFromTaskId: record.getString('forked_from_task_id') || null,
      sprintId: record.getString('sprint_id') || null,
      startDate: toDate(record.getDateTime('start_date')),
      dueDate: toDate(record.getDateTime('due_date')),
      startedAt: toDate(record.getDateTime('started_at')),
      completedAt: toDate(record.getDateTime('completed_at')),
      estimatedHours: number('estimated_hours'),
      actualHours: number('actual_hours'),
      checklist: parseJsonField(record, 'checklist') || [],
      position: record.getFloat('position'),
      createdAt: toDate(record.getDateTime('created')),
      updatedAt: toDate(record.getDateTime('updated')),
    }
  }

  /** Linha do quadro e do backlog: as colunas do cartão (sem a descrição); -0 = número com casas decimais. */
  const CARD_ROW = {
    id: '',
    project_id: '',
    number: 0,
    code: '',
    title: '',
    task_type_id: '',
    status_id: '',
    priority_id: '',
    creator_id: '',
    assignee_id: '',
    reporter_id: '',
    parent_task_id: '',
    forked_from_task_id: '',
    sprint_id: '',
    start_date: '',
    due_date: '',
    started_at: '',
    completed_at: '',
    estimated_hours: -0,
    actual_hours: -0,
    checklist: '',
    position: -0,
    created: '',
    updated: '',
  }
  const CARD_COLUMNS = Object.keys(CARD_ROW).map((name) => (name === 'checklist' ? "COALESCE(checklist, '') AS checklist" : name))

  /** Mesma entidade de `toEntity`, a partir da linha enxuta (a descrição não vai ao quadro). */
  function cardRowToEntity(row) {
    const hours = (value) => (value > 0 ? value : null)
    let checklist = []
    if (row.checklist && row.checklist !== 'null') {
      try {
        checklist = JSON.parse(row.checklist) || []
      } catch (_) {
        checklist = []
      }
    }
    return {
      id: row.id,
      projectId: row.project_id,
      number: row.number,
      code: row.code,
      title: row.title,
      description: '',
      typeId: row.task_type_id,
      statusId: row.status_id,
      priorityId: row.priority_id,
      creatorId: row.creator_id || null,
      assigneeId: row.assignee_id || null,
      reporterId: row.reporter_id || null,
      parentTaskId: row.parent_task_id || null,
      forkedFromTaskId: row.forked_from_task_id || null,
      sprintId: row.sprint_id || null,
      startDate: toDate(row.start_date),
      dueDate: toDate(row.due_date),
      startedAt: toDate(row.started_at),
      completedAt: toDate(row.completed_at),
      estimatedHours: hours(row.estimated_hours),
      actualHours: hours(row.actual_hours),
      checklist,
      position: row.position,
      createdAt: toDate(row.created),
      updatedAt: toDate(row.updated),
    }
  }

  const FIELDS = {
    projectId: 'project_id',
    number: 'number',
    code: 'code',
    title: 'title',
    description: 'description',
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

  function apply(record, data) {
    Object.keys(data).forEach((key) => {
      const value = data[key]
      if (FIELDS[key]) record.set(FIELDS[key], value === null ? '' : value)
      else if (DATES[key]) record.set(DATES[key], toPbDate(value))
      else if (NUMBERS[key]) record.set(NUMBERS[key], value === null ? 0 : value)
      else if (key === 'checklist') record.set('checklist', value || [])
      else if (key === 'position') record.set('position', value)
    })
  }

  /** Ordenação pública -> expressões SQL (whitelist; nada vem do cliente sem passar por aqui). */
  const ORDER = {
    code: (dir) => [`tasks.number ${dir}`],
    title: (dir) => [`tasks.title ${dir}`],
    created: (dir) => [`tasks.created ${dir}`],
    updated: (dir) => [`tasks.updated ${dir}`],
    due_date: (dir) => ["(tasks.due_date = '') ASC", `tasks.due_date ${dir}`],
    priority: (dir) => [`(SELECT p."order" FROM task_priorities p WHERE p.id = tasks.priority_id) ${dir}`],
    status: (dir) => [`(SELECT s."order" FROM task_statuses s WHERE s.id = tasks.status_id) ${dir}`],
  }

  const repo = {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },

    /** Tarefas com responsável e prazo antes de `before`, em status abertos (lembretes diários). */
    /** Maior posição na coluna (null se vazia). */
    maxPosition(projectId, statusId) {
      const row = new DynamicModel({ n: 0, c: 0 })
      app
        .db()
        .select('COALESCE(MAX(position), 0) AS n', 'COUNT(*) AS c')
        .from(COLLECTION)
        .where($dbx.hashExp({ project_id: projectId, status_id: statusId }))
        .one(row)
      return row.c > 0 ? row.n : null
    },

    /** Reescreve as posições da coluna em passos iguais (quando não cabe mais nada entre dois cards). */
    renumber(projectId, statusId) {
      app
        .findRecordsByFilter(COLLECTION, 'project_id = {:p} && status_id = {:s}', 'position,number', 0, 0, { p: projectId, s: statusId })
        .forEach((record, index) => {
          record.set('position', (index + 1) * 1024)
          app.save(record)
        })
    },

    countByStatus(projectId) {
      const counts = {}
      const rows = arrayOf(new DynamicModel({ status_id: '', total: 0 }))
      app.db().select('status_id', 'COUNT(*) AS total').from(COLLECTION).where($dbx.hashExp({ project_id: projectId })).groupBy('status_id').all(rows)
      rows.forEach((row) => {
        counts[row.status_id] = row.total
      })
      return counts
    },

    /** Cards de uma coluna: ordem manual; nas colunas de encerramento, os mais recentes. */
    /** Todas as tarefas do projeto (timeline), pela numeração, até `limit`. */
    listByProject(projectId, limit) {
      return app.findRecordsByFilter(COLLECTION, 'project_id = {:p}', 'number', limit || 0, 0, { p: projectId }).map(toEntity)
    },
    // consulta enxuta (só as colunas do cartão, sem montar o registro completo): o quadro é a chamada
    // mais frequente e a mais pesada em projetos grandes — ver docs/plano-migracao-supabase.md §3 e §4
    listForBoard(projectId, statusId, options) {
      const rows = arrayOf(new DynamicModel(CARD_ROW))
      app
        .db()
        .select(...CARD_COLUMNS)
        .from(COLLECTION)
        .where($dbx.hashExp({ project_id: projectId, status_id: statusId }))
        .orderBy(...(options.closed ? ['completed_at DESC', 'updated DESC'] : ['position ASC', 'number ASC']))
        .limit(options.limit)
        .all(rows)
      return rows.map(cardRowToEntity)
    },

    /** Backlog: tarefas nos status indicados, em ordem manual (limit 0 = todas). */
    // mesma consulta enxuta do quadro (só as colunas do cartão, sem montar o registro completo)
    listBacklog(projectId, statusIds, limit) {
      if (statusIds.length === 0) return []
      const rows = arrayOf(new DynamicModel(CARD_ROW))
      const select = app
        .db()
        .select(...CARD_COLUMNS)
        .from(COLLECTION)
        .where($dbx.hashExp({ project_id: projectId }))
        .andWhere($dbx.in.apply(null, ['status_id'].concat(statusIds)))
        .orderBy('position ASC', 'number ASC')
      if (limit) select.limit(limit)
      select.all(rows)
      return rows.map(cardRowToEntity)
    },

    /** Maior posição entre os status indicados (null se não houver tarefas). */
    maxPositionIn(projectId, statusIds) {
      if (statusIds.length === 0) return null
      const row = new DynamicModel({ n: 0, c: 0 })
      app
        .db()
        .select('COALESCE(MAX(position), 0) AS n', 'COUNT(*) AS c')
        .from(COLLECTION)
        .where($dbx.hashExp({ project_id: projectId }))
        .andWhere($dbx.in.apply(null, ['status_id'].concat(statusIds)))
        .one(row)
      return row.c > 0 ? row.n : null
    },

    /** Renumera juntas as tarefas dos status indicados (backlog com mais de um status). */
    renumberMany(projectId, statusIds) {
      repo.listBacklog(projectId, statusIds, 0).forEach((task, index) => {
        const record = app.findRecordById(COLLECTION, task.id)
        record.set('position', (index + 1) * 1024)
        app.save(record)
      })
    },

    findManyByIds(ids) {
      if (ids.length === 0) return []
      return app.findRecordsByIds(COLLECTION, ids).map(toEntity)
    },

    /** Linhas enxutas para relatórios (só as colunas usadas nos cálculos). */
    listForReport(query) {
      const exprs = []
      if (!query.scope.viewAll) exprs.push($dbx.exp('project_id IN (SELECT project_id FROM project_members WHERE user_id = {:uid})', { uid: query.scope.userId }))
      if (!query.includeArchived) exprs.push($dbx.exp("project_id IN (SELECT id FROM projects WHERE archived_at = '' OR archived_at IS NULL)"))
      if (query.projectId) exprs.push($dbx.hashExp({ project_id: query.projectId }))
      if (query.assigneeId) exprs.push($dbx.hashExp({ assignee_id: query.assigneeId === 'none' ? '' : query.assigneeId }))
      if (query.typeId) exprs.push($dbx.hashExp({ task_type_id: query.typeId }))
      if (query.priorityId) exprs.push($dbx.hashExp({ priority_id: query.priorityId }))
      if (query.statusId) exprs.push($dbx.hashExp({ status_id: query.statusId }))
      const rows = arrayOf(
        new DynamicModel({ id: '', project_id: '', task_type_id: '', status_id: '', priority_id: '', assignee_id: '', created: '', started_at: '', completed_at: '', due_date: '' }),
      )
      const select = app.db().select('id', 'project_id', 'task_type_id', 'status_id', 'priority_id', 'assignee_id', 'created', 'started_at', 'completed_at', 'due_date').from(COLLECTION)
      if (exprs.length) select.where($dbx.and.apply(null, exprs))
      select.all(rows)
      const date = (text) => (text ? new Date(String(text).replace(' ', 'T')) : null)
      return rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        typeId: r.task_type_id,
        statusId: r.status_id,
        priorityId: r.priority_id,
        assigneeId: r.assignee_id || null,
        createdAt: date(r.created),
        startedAt: date(r.started_at),
        completedAt: date(r.completed_at),
        dueDate: date(r.due_date),
      }))
    },

    listChildren(parentId) {
      return app.findRecordsByFilter(COLLECTION, 'parent_task_id = {:p}', 'number', 0, 0, { p: parentId }).map(toEntity)
    },

    listForks(taskId) {
      return app.findRecordsByFilter(COLLECTION, 'forked_from_task_id = {:t}', 'number', 0, 0, { t: taskId }).map(toEntity)
    },

    /** Progresso das subtarefas por pai: { total, done } (done = status encerrado). */
    subtaskStats(parentIds, closedStatusIds) {
      const map = {}
      if (parentIds.length === 0) return map
      app.findAllRecords(COLLECTION, $dbx.in.apply(null, ['parent_task_id'].concat(parentIds))).forEach((record) => {
        const parentId = record.getString('parent_task_id')
        const entry = map[parentId] || { done: 0, total: 0 }
        entry.total += 1
        if (closedStatusIds.indexOf(record.getString('status_id')) >= 0) entry.done += 1
        map[parentId] = entry
      })
      return map
    },

    listBySprint(sprintId) {
      return app.findRecordsByFilter(COLLECTION, 'sprint_id = {:c}', 'number', 0, 0, { c: sprintId }).map(toEntity)
    },

    listForReminders(query) {
      if (query.statusIds.length === 0) return []
      const select = app.recordQuery(COLLECTION)
      select.andWhere($dbx.exp("due_date != '' AND due_date < {:before} AND assignee_id != ''", { before: toPbDate(query.before) }))
      select.andWhere($dbx.in.apply(null, ['status_id'].concat(query.statusIds)))
      const records = arrayOf(new Record())
      select.all(records)
      return records.map(toEntity)
    },

    nextNumber(projectId) {
      const row = new DynamicModel({ n: 0 })
      app.db().select('COALESCE(MAX(number), 0) AS n').from(COLLECTION).where($dbx.hashExp({ project_id: projectId })).one(row)
      return row.n + 1
    },

    list(query) {
      const exprs = []
      if (!query.scope.viewAll) {
        exprs.push($dbx.exp('tasks.project_id IN (SELECT project_id FROM project_members WHERE user_id = {:uid})', { uid: query.scope.userId }))
      }
      if (query.projectId) exprs.push($dbx.hashExp({ 'tasks.project_id': query.projectId }))
      if (query.typeId) exprs.push($dbx.hashExp({ 'tasks.task_type_id': query.typeId }))
      if (query.priorityId) exprs.push($dbx.hashExp({ 'tasks.priority_id': query.priorityId }))
      if (query.assigneeId) exprs.push($dbx.hashExp({ 'tasks.assignee_id': query.assigneeId }))
      if (query.tagId) exprs.push($dbx.exp('tasks.id IN (SELECT task_id FROM task_tag_relations WHERE tag_id = {:tag})', { tag: query.tagId }))
      if (query.sprintId) exprs.push($dbx.hashExp({ 'tasks.sprint_id': query.sprintId === 'none' ? '' : query.sprintId }))
      if (query.statusIds) {
        exprs.push(query.statusIds.length ? $dbx.in.apply(null, ['tasks.status_id'].concat(query.statusIds)) : $dbx.exp('1 = 0'))
      }
      if (query.search) {
        const params = { q: likePattern(query.search.text) }
        const parts = ["tasks.title LIKE {:q} ESCAPE '\\'", "tasks.code LIKE {:q} ESCAPE '\\'"]
        if (query.search.fieldIds.length > 0) {
          const placeholders = query.search.fieldIds.map((id, i) => {
            params[`f${i}`] = id
            return `{:f${i}}`
          })
          parts.push(
            `tasks.id IN (SELECT task_id FROM task_custom_values WHERE field_id IN (${placeholders.join(', ')}) AND value_text LIKE {:q} ESCAPE '\\')`,
          )
        }
        exprs.push($dbx.exp(`(${parts.join(' OR ')})`, params))
      }

      const select = app.recordQuery(COLLECTION)
      exprs.forEach((expr) => select.andWhere(expr))
      const order = []
      query.sort.forEach((s) => ORDER[s.column](s.direction).forEach((o) => order.push(o)))
      select.orderBy.apply(select, order.concat(['tasks.created ASC', 'tasks.id ASC']))
      select.limit(query.pagination.perPage).offset(query.pagination.offset)
      const records = arrayOf(new Record())
      select.all(records)
      const total = app.countRecords.apply(app, [COLLECTION].concat(exprs))
      return { items: records.map(toEntity), total }
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
      // valores personalizados saem em cascata (relação com cascadeDelete)
      app.delete(app.findRecordById(COLLECTION, id))
    },
  }
  return repo
}

function createTagRepository(app) {
  const COLLECTION = 'tags'

  function toEntity(record) {
    return {
      id: record.id,
      name: record.getString('name'),
      nameKey: record.getString('name_key'),
      color: record.getString('color'),
      createdAt: toDate(record.getDateTime('created')),
      updatedAt: toDate(record.getDateTime('updated')),
    }
  }

  function apply(record, data) {
    if (data.name !== undefined) record.set('name', data.name)
    if (data.nameKey !== undefined) record.set('name_key', data.nameKey)
    if (data.color !== undefined) record.set('color', data.color)
  }

  return {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    findByKey(key) {
      const record = findOrNull(() => app.findFirstRecordByData(COLLECTION, 'name_key', key))
      return record ? toEntity(record) : null
    },
    findManyByIds(ids) {
      if (ids.length === 0) return []
      return app.findRecordsByIds(COLLECTION, ids).map(toEntity)
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
    delete(id) {
      // relações com tarefas saem em cascata
      app.delete(app.findRecordById(COLLECTION, id))
    },
    countTasks(ids) {
      const counts = {}
      if (ids.length === 0) return counts
      const rows = arrayOf(new DynamicModel({ tag_id: '', total: 0 }))
      app
        .db()
        .select('tag_id', 'COUNT(*) AS total')
        .from('task_tag_relations')
        .where($dbx.in.apply(null, ['tag_id'].concat(ids)))
        .groupBy('tag_id')
        .all(rows)
      rows.forEach((row) => {
        counts[row.tag_id] = row.total
      })
      return counts
    },
  }
}

function createTaskTagRepository(app) {
  const COLLECTION = 'task_tag_relations'
  return {
    listByTasks(taskIds) {
      const map = {}
      if (taskIds.length === 0) return map
      app.findAllRecords(COLLECTION, $dbx.in.apply(null, ['task_id'].concat(taskIds))).forEach((record) => {
        const taskId = record.getString('task_id')
        map[taskId] = (map[taskId] || []).concat(record.getString('tag_id'))
      })
      return map
    },
    replace(taskId, tagIds) {
      app.findAllRecords(COLLECTION, $dbx.hashExp({ task_id: taskId })).forEach((record) => app.delete(record))
      const collection = app.findCollectionByNameOrId(COLLECTION)
      tagIds.forEach((tagId) => {
        const record = new Record(collection)
        record.set('task_id', taskId)
        record.set('tag_id', tagId)
        app.save(record)
      })
    },
  }
}

function createCommentRepository(app) {
  const COLLECTION = 'comments'

  function toEntity(record) {
    return {
      id: record.id,
      taskId: record.getString('task_id'),
      userId: record.getString('user_id'),
      content: record.getString('content'),
      mentions: parseJsonField(record, 'mentions') || [],
      editedAt: toDate(record.getDateTime('edited_at')),
      deletedAt: toDate(record.getDateTime('deleted_at')),
      createdAt: toDate(record.getDateTime('created')),
      updatedAt: toDate(record.getDateTime('updated')),
    }
  }

  function apply(record, data) {
    if (data.taskId !== undefined) record.set('task_id', data.taskId)
    if (data.userId !== undefined) record.set('user_id', data.userId)
    if (data.content !== undefined) record.set('content', data.content)
    if (data.mentions !== undefined) record.set('mentions', data.mentions)
    if (data.editedAt !== undefined) record.set('edited_at', toPbDate(data.editedAt))
    if (data.deletedAt !== undefined) record.set('deleted_at', toPbDate(data.deletedAt))
  }

  const repo = {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    listByTask(taskId) {
      return app.findRecordsByFilter(COLLECTION, 'task_id = {:t}', 'created,id', 0, 0, { t: taskId }).map(toEntity)
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
    countByTasks(taskIds) {
      const counts = {}
      if (taskIds.length === 0) return counts
      const rows = arrayOf(new DynamicModel({ task_id: '', total: 0 }))
      app
        .db()
        .select('task_id', 'COUNT(*) AS total')
        .from(COLLECTION)
        .where($dbx.in.apply(null, ['task_id'].concat(taskIds)))
        .andWhere($dbx.exp("deleted_at = ''"))
        .groupBy('task_id')
        .all(rows)
      rows.forEach((row) => {
        counts[row.task_id] = row.total
      })
      return counts
    },
  }
  return repo
}

function createAttachmentRepository(app) {
  const COLLECTION = 'attachments'

  function toEntity(record) {
    return {
      id: record.id,
      taskId: record.getString('task_id'),
      name: record.getString('name'),
      mime: record.getString('mime'),
      kind: record.getString('kind'),
      size: record.getInt('size'),
      uploadedBy: record.getString('uploaded_by') || null,
      commentId: record.getString('comment_id') || null,
      createdAt: toDate(record.getDateTime('created')),
    }
  }

  return {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    findManyByIds(ids) {
      if (ids.length === 0) return []
      return app.findRecordsByIds(COLLECTION, ids).map(toEntity)
    },
    listByTask(taskId) {
      // só os anexos da tarefa (os de comentário aparecem no comentário)
      return app.findRecordsByFilter(COLLECTION, "task_id = {:t} && comment_id = ''", 'created,id', 0, 0, { t: taskId }).map(toEntity)
    },
    listByComments(commentIds) {
      const map = {}
      if (commentIds.length === 0) return map
      app.findAllRecords(COLLECTION, $dbx.in.apply(null, ['comment_id'].concat(commentIds))).forEach((record) => {
        const item = toEntity(record)
        map[item.commentId] = (map[item.commentId] || []).concat(item)
      })
      Object.keys(map).forEach((id) => map[id].sort((a, b) => a.createdAt - b.createdAt))
      return map
    },
    deleteByComment(commentId) {
      app.findAllRecords(COLLECTION, $dbx.hashExp({ comment_id: commentId })).forEach((record) => app.delete(record))
    },
    /** `data.handle` é o arquivo enviado (filesystem.File); o PocketBase revalida tipo e tamanho ao salvar. */
    create(data) {
      const record = new Record(app.findCollectionByNameOrId(COLLECTION))
      record.set('task_id', data.taskId)
      record.set('file', data.handle)
      record.set('name', data.name)
      record.set('mime', data.mime)
      record.set('kind', data.kind)
      record.set('size', data.size)
      record.set('uploaded_by', data.uploadedBy || '')
      record.set('comment_id', data.commentId || '')
      try {
        app.save(record)
      } catch (_err) {
        // recusado pela validação do próprio PocketBase (tipo detectado pelo conteúdo, tamanho…)
        throw appError('VALIDATION_ERROR', undefined, { fields: { files: 'invalid_file' }, name: data.name })
      }
      return toEntity(record)
    },
    delete(id) {
      // o PocketBase remove o arquivo do armazenamento junto com o registro
      app.delete(app.findRecordById(COLLECTION, id))
    },
    countByTasks(taskIds) {
      const counts = {}
      if (taskIds.length === 0) return counts
      const rows = arrayOf(new DynamicModel({ task_id: '', total: 0 }))
      app
        .db()
        .select('task_id', 'COUNT(*) AS total')
        .from(COLLECTION)
        .where($dbx.in.apply(null, ['task_id'].concat(taskIds)))
        .andWhere($dbx.exp("comment_id = ''"))
        .groupBy('task_id')
        .all(rows)
      rows.forEach((row) => {
        counts[row.task_id] = row.total
      })
      return counts
    },
    /** Copia o arquivo (bytes) para outra tarefa; usado pelo fork. */
    copyTo(id, target) {
      const source = app.findRecordById(COLLECTION, id)
      const key = `${source.baseFilesPath()}/${source.getString('file')}`
      const fsys = app.newFilesystem()
      let bytes
      try {
        const reader = fsys.getReader(key)
        try {
          bytes = toBytes(reader)
        } finally {
          reader.close()
        }
      } finally {
        fsys.close()
      }
      return this.create({
        taskId: target.taskId,
        handle: $filesystem.fileFromBytes(bytes, source.getString('name')),
        name: source.getString('name'),
        mime: source.getString('mime'),
        kind: source.getString('kind'),
        size: source.getInt('size'),
        uploadedBy: target.uploadedBy,
        commentId: null,
      })
    },
    /** Caminho do arquivo no armazenamento (para servir o download). */
    fileKeyOf(id) {
      const record = app.findRecordById(COLLECTION, id)
      return `${record.baseFilesPath()}/${record.getString('file')}`
    },
  }
}

function createNotificationRepository(app) {
  const COLLECTION = 'notifications'

  function toEntity(record) {
    return {
      id: record.id,
      userId: record.getString('user_id'),
      type: record.getString('type'),
      taskId: record.getString('task_id') || null,
      planItemId: record.getString('plan_item_id') || null,
      projectId: record.getString('project_id') || null,
      actorId: record.getString('actor_id') || null,
      data: parseJsonField(record, 'data') || {},
      dedupeKey: record.getString('dedupe_key'),
      readAt: toDate(record.getDateTime('read_at')),
      createdAt: toDate(record.getDateTime('created')),
    }
  }

  return {
    create(data) {
      const record = new Record(app.findCollectionByNameOrId(COLLECTION))
      record.set('user_id', data.userId)
      record.set('type', data.type)
      record.set('task_id', data.taskId || '')
      record.set('plan_item_id', data.planItemId || '')
      record.set('project_id', data.projectId || '')
      record.set('actor_id', data.actorId || '')
      record.set('data', data.data || {})
      record.set('dedupe_key', data.dedupeKey || '')
      app.save(record)
      return toEntity(record)
    },
    existsKey(userId, key) {
      return !!findOrNull(() => app.findFirstRecordByFilter(COLLECTION, 'user_id = {:u} && dedupe_key = {:k}', { u: userId, k: key }))
    },
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    listByUser(userId, query) {
      const filter = query.unreadOnly ? "user_id = {:u} && read_at = ''" : 'user_id = {:u}'
      const items = app
        .findRecordsByFilter(COLLECTION, filter, '-created,-id', query.pagination.perPage, query.pagination.offset, { u: userId })
        .map(toEntity)
      const total = app.countRecords(COLLECTION, $dbx.exp(query.unreadOnly ? "user_id = {:u} AND read_at = ''" : 'user_id = {:u}', { u: userId }))
      return { items, total }
    },
    countUnread(userId) {
      return app.countRecords(COLLECTION, $dbx.exp("user_id = {:u} AND read_at = ''", { u: userId }))
    },
    markRead(id, at) {
      const record = app.findRecordById(COLLECTION, id)
      record.set('read_at', toPbDate(at))
      app.save(record)
    },
    markAllRead(userId, at) {
      const unread = app.findRecordsByFilter(COLLECTION, "user_id = {:u} && read_at = ''", '', 0, 0, { u: userId })
      unread.forEach((record) => {
        record.set('read_at', toPbDate(at))
        app.save(record)
      })
      return unread.length
    },
  }
}

function createTaskValueRepository(app) {
  const COLLECTION = 'task_custom_values'

  /** Cópias indexadas do valor conforme o tipo do campo (busca, filtro e ordenação). */
  function indexColumns(type, value) {
    const columns = { value_text: '', value_number: null, value_date: '', value_bool: false }
    if (value === null || value === undefined) return columns
    if (type === 'number' || type === 'decimal') columns.value_number = value
    else if (type === 'boolean') columns.value_bool = value === true
    else if (type === 'date' || type === 'datetime') columns.value_date = toPbDate(value)
    else if (Array.isArray(value)) columns.value_text = value.join(',').slice(0, 500)
    else columns.value_text = String(value).slice(0, 500)
    return columns
  }

  return {
    listByTasks(taskIds) {
      const map = {}
      if (taskIds.length === 0) return map
      app.findAllRecords(COLLECTION, $dbx.in.apply(null, ['task_id'].concat(taskIds))).forEach((record) => {
        const taskId = record.getString('task_id')
        map[taskId] = map[taskId] || {}
        map[taskId][record.getString('field_id')] = parseJsonField(record, 'value')
      })
      return map
    },

    /** Substitui todos os valores da tarefa. `values` = { fieldId: valor }; `types` = { fieldId: tipo }. */
    replace(taskId, values, types) {
      app.findAllRecords(COLLECTION, $dbx.hashExp({ task_id: taskId })).forEach((record) => app.delete(record))
      const collection = app.findCollectionByNameOrId(COLLECTION)
      Object.keys(values).forEach((fieldId) => {
        const record = new Record(collection)
        record.set('task_id', taskId)
        record.set('field_id', fieldId)
        record.set('value', values[fieldId])
        const columns = indexColumns((types || {})[fieldId], values[fieldId])
        Object.keys(columns).forEach((column) => record.set(column, columns[column]))
        app.save(record)
      })
    },
  }
}

/**
 * Repositório de listas configuráveis (status e prioridades).
 * `taskColumn` é a coluna de `tasks` que referencia o item (a collection chega na Fase 4b).
 */
function createLookupRepository(app, COLLECTION, options) {
  function toEntity(record) {
    const entity = {
      id: record.id,
      key: record.getString('key'),
      name: record.getString('name'),
      description: record.getString('description'),
      color: record.getString('color'),
      order: record.getInt('order'),
      isActive: record.getBool('is_active'),
      isDefault: record.getBool('is_default'),
      createdAt: toDate(record.getDateTime('created')),
      updatedAt: toDate(record.getDateTime('updated')),
    }
    if (options.hasCategory) {
      entity.category = record.getString('category')
      entity.wipLimit = record.getInt('wip_limit')
      entity.allowedNext = parseJsonField(record, 'allowed_next') || []
    }
    return entity
  }

  const FIELDS = {
    key: 'key',
    name: 'name',
    description: 'description',
    color: 'color',
    order: 'order',
    isActive: 'is_active',
    isDefault: 'is_default',
    category: options.hasCategory ? 'category' : null,
    wipLimit: options.hasCategory ? 'wip_limit' : null,
    allowedNext: options.hasCategory ? 'allowed_next' : null,
  }

  function apply(record, data) {
    Object.keys(data).forEach((key) => {
      if (FIELDS[key] && data[key] !== undefined) record.set(FIELDS[key], data[key])
    })
  }

  const repo = {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    findByKey(key) {
      const record = findOrNull(() => app.findFirstRecordByData(COLLECTION, 'key', key))
      return record ? toEntity(record) : null
    },
    list(query) {
      const filter = query.includeInactive ? "id != ''" : 'is_active = true'
      return app.findRecordsByFilter(COLLECTION, filter, 'order,name', 0, 0).map(toEntity)
    },
    maxOrder() {
      return repo.list({ includeInactive: true }).reduce((max, item) => Math.max(max, item.order), -1)
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
    setOrder(ids) {
      ids.forEach((id, index) => {
        const record = app.findRecordById(COLLECTION, id)
        record.set('order', index)
        app.save(record)
      })
    },
    clearDefault() {
      app.findAllRecords(COLLECTION, $dbx.hashExp({ is_default: true })).forEach((record) => {
        record.set('is_default', false)
        app.save(record)
      })
    },
    countTasks(id) {
      try {
        return app.countRecords('tasks', $dbx.hashExp({ [options.taskColumn]: id }))
      } catch (_) {
        return 0
      }
    },
  }
  return repo
}

function createSprintRepository(app) {
  const COLLECTION = 'sprints'
  const day = (dateTime) => {
    const date = toDate(dateTime)
    return date ? date.toISOString().slice(0, 10) : null
  }

  function toEntity(record) {
    return {
      id: record.id,
      projectId: record.getString('project_id'),
      name: record.getString('name'),
      goal: record.getString('goal'),
      startDate: day(record.getDateTime('start_date')),
      endDate: day(record.getDateTime('end_date')),
      state: record.getString('state'),
      order: record.getInt('order'),
      createdBy: record.getString('created_by') || null,
      createdAt: toDate(record.getDateTime('created')),
      updatedAt: toDate(record.getDateTime('updated')),
    }
  }

  const FIELDS = { projectId: 'project_id', name: 'name', goal: 'goal', state: 'state', order: 'order', createdBy: 'created_by' }
  function apply(record, data) {
    Object.keys(data).forEach((key) => {
      const value = data[key]
      if (FIELDS[key]) record.set(FIELDS[key], value === null ? '' : value)
      // dia puro (meia-noite UTC)
      else if (key === 'startDate' || key === 'endDate') record.set(key === 'startDate' ? 'start_date' : 'end_date', value ? `${value} 00:00:00.000Z` : '')
    })
  }

  return {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    findManyByIds(ids) {
      if (ids.length === 0) return []
      return app.findRecordsByIds(COLLECTION, ids).map(toEntity)
    },
    /** Encerradas por último; depois a ordem manual e a criação. */
    listByProject(projectId, options) {
      const filter = options.includeClosed ? 'project_id = {:p}' : "project_id = {:p} && state != 'closed'"
      return app
        .findRecordsByFilter(COLLECTION, filter, 'created', 0, 0, { p: projectId })
        .map(toEntity)
        .sort(
          (a, b) =>
            (a.state === 'closed') - (b.state === 'closed') ||
            a.order - b.order ||
            (a.createdAt ? a.createdAt.getTime() : 0) - (b.createdAt ? b.createdAt.getTime() : 0),
        )
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

/** Marcos do projeto (timeline). `dueDate` em AAAA-MM-DD (dia puro, como nas sprints). */
function createProjectGroupRepository(app) {
  const COLLECTION = 'project_groups'

  function toEntity(record) {
    return {
      id: record.id,
      projectId: record.getString('project_id'),
      parentId: record.getString('parent_id') || null,
      name: record.getString('name'),
      color: record.getString('color'),
      position: record.getFloat('position'),
      createdBy: record.getString('created_by') || null,
      createdAt: toDate(record.getDateTime('created')),
      updatedAt: toDate(record.getDateTime('updated')),
    }
  }

  const FIELDS = { projectId: 'project_id', parentId: 'parent_id', name: 'name', color: 'color', createdBy: 'created_by' }
  function apply(record, data) {
    Object.keys(data).forEach((key) => {
      const value = data[key]
      if (FIELDS[key]) record.set(FIELDS[key], value === null ? '' : value)
      else if (key === 'position') record.set('position', value)
    })
  }

  const repo = {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    findManyByIds(ids) {
      if (ids.length === 0) return []
      return app.findRecordsByIds(COLLECTION, ids).map(toEntity)
    },
    listByProject(projectId) {
      return app.findRecordsByFilter(COLLECTION, 'project_id = {:p}', 'position,created', 0, 0, { p: projectId }).map(toEntity)
    },
    /** Maior posição entre os grupos irmãos (null se não houver). */
    maxPosition(projectId, parentId) {
      const row = new DynamicModel({ n: 0, c: 0 })
      app
        .db()
        .select('COALESCE(MAX(position), 0) AS n', 'COUNT(*) AS c')
        .from(COLLECTION)
        .where($dbx.hashExp({ project_id: projectId, parent_id: parentId || '' }))
        .one(row)
      return row.c > 0 ? row.n : null
    },
    renumber(projectId, parentId) {
      app
        .findRecordsByFilter(COLLECTION, 'project_id = {:p} && parent_id = {:t}', 'position,created', 0, 0, { p: projectId, t: parentId || '' })
        .forEach((record, index) => {
          record.set('position', (index + 1) * 1024)
          app.save(record)
        })
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
  return repo
}

function createPlanStatusRepository(app) {
  const COLLECTION = 'plan_statuses'
  const toEntity = (record) => ({
    id: record.id,
    projectId: record.getString('project_id'),
    name: record.getString('name'),
    color: record.getString('color'),
    category: record.getString('category'),
    position: record.getFloat('position'),
  })
  const FIELDS = { projectId: 'project_id', name: 'name', color: 'color', category: 'category', position: 'position' }
  const apply = (record, data) =>
    Object.keys(data).forEach((key) => {
      if (FIELDS[key]) record.set(FIELDS[key], data[key])
    })
  return {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    listByProject(projectId) {
      return app.findRecordsByFilter(COLLECTION, 'project_id = {:p}', 'position,created', 0, 0, { p: projectId }).map(toEntity)
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

function createPlanResourceRepository(app) {
  const COLLECTION = 'plan_resources'
  const toEntity = (record) => ({
    id: record.id,
    projectId: record.getString('project_id'),
    name: record.getString('name'),
    nameKey: record.getString('name_key'),
    color: record.getString('color'),
  })
  const FIELDS = { projectId: 'project_id', name: 'name', nameKey: 'name_key', color: 'color' }
  const apply = (record, data) =>
    Object.keys(data).forEach((key) => {
      if (FIELDS[key]) record.set(FIELDS[key], data[key])
    })
  return {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    findByKey(projectId, nameKey) {
      const record = findOrNull(() => app.findFirstRecordByFilter(COLLECTION, 'project_id = {:p} && name_key = {:k}', { p: projectId, k: nameKey }))
      return record ? toEntity(record) : null
    },
    listByProject(projectId) {
      return app.findRecordsByFilter(COLLECTION, 'project_id = {:p}', 'name', 0, 0, { p: projectId }).map(toEntity)
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

function createPlanItemRepository(app) {
  const COLLECTION = 'plan_items'
  const day = (dateTime) => {
    const date = toDate(dateTime)
    return date ? date.toISOString().slice(0, 10) : null
  }
  const toEntity = (record) => ({
    id: record.id,
    projectId: record.getString('project_id'),
    groupId: record.getString('group_id'),
    parentId: record.getString('parent_id') || null,
    name: record.getString('name'),
    statusId: record.getString('status_id') || null,
    startDate: day(record.getDateTime('start_date')),
    endDate: day(record.getDateTime('end_date')),
    dueDate: day(record.getDateTime('due_date')),
    ownerId: record.getString('owner_id') || null,
    resourceIds: record.getStringSlice('resource_ids'),
    metrics: parseJsonField(record, 'metrics') || {},
    custom: parseJsonField(record, 'custom') || {},
    progress: record.getInt('progress'),
    progressSet: record.getBool('progress_set'),
    position: record.getFloat('position'),
    createdBy: record.getString('created_by') || null,
    createdAt: toDate(record.getDateTime('created')),
    updatedAt: toDate(record.getDateTime('updated')),
  })
  const FIELDS = { projectId: 'project_id', groupId: 'group_id', parentId: 'parent_id', name: 'name', statusId: 'status_id', ownerId: 'owner_id', createdBy: 'created_by' }
  const DAYS = { startDate: 'start_date', endDate: 'end_date', dueDate: 'due_date' }
  const apply = (record, data) =>
    Object.keys(data).forEach((key) => {
      const value = data[key]
      if (FIELDS[key]) record.set(FIELDS[key], value === null ? '' : value)
      else if (DAYS[key]) record.set(DAYS[key], value ? value + ' 00:00:00.000Z' : '')
      else if (key === 'resourceIds') record.set('resource_ids', value || [])
      else if (key === 'metrics') record.set('metrics', value || {})
      else if (key === 'custom') record.set('custom', value || {})
      else if (key === 'progress') record.set('progress', value || 0)
      else if (key === 'progressSet') record.set('progress_set', !!value)
      else if (key === 'position') record.set('position', value)
    })
  return {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    listByProject(projectId, limit) {
      return app.findRecordsByFilter(COLLECTION, 'project_id = {:p}', 'position,created', limit || 0, 0, { p: projectId }).map(toEntity)
    },
    listByGroups(groupIds) {
      if (groupIds.length === 0) return []
      const select = app.recordQuery(COLLECTION)
      select.andWhere($dbx.in.apply(null, ['group_id'].concat(groupIds)))
      select.orderBy('position ASC', 'created ASC')
      const records = arrayOf(new Record())
      select.all(records)
      return records.map(toEntity)
    },
    listChildren(parentId) {
      return app.findRecordsByFilter(COLLECTION, 'parent_id = {:p}', 'position,created', 0, 0, { p: parentId }).map(toEntity)
    },
    /** Maior posição entre irmãos (mesmo grupo e mesmo pai; null se não houver). */
    maxPosition(groupId, parentId) {
      const row = new DynamicModel({ n: 0, c: 0 })
      app
        .db()
        .select('COALESCE(MAX(position), 0) AS n', 'COUNT(*) AS c')
        .from(COLLECTION)
        .where($dbx.hashExp({ group_id: groupId, parent_id: parentId || '' }))
        .one(row)
      return row.c > 0 ? row.n : null
    },
    /** Elementos que usam a etiqueta de status/recurso (para limpar ao excluir a etiqueta). */
    listByStatus(statusId) {
      return app.findRecordsByFilter(COLLECTION, 'status_id = {:s}', '', 0, 0, { s: statusId }).map(toEntity)
    },
    listByResource(resourceId) {
      return app.findRecordsByFilter(COLLECTION, 'resource_ids ?= {:r}', '', 0, 0, { r: resourceId }).map(toEntity)
    },
    /** Irmãos na ordem: elementos do grupo (parentId vazio) ou subelementos do pai. */
    listSiblings(groupId, parentId) {
      const filter = parentId ? 'parent_id = {:p}' : "group_id = {:g} && parent_id = ''"
      return app.findRecordsByFilter(COLLECTION, filter, 'position,created', 0, 0, { g: groupId, p: parentId || '' }).map(toEntity)
    },
    /** Reescreve as posições dos irmãos em passos iguais (quando não cabe mais nada entre dois). */
    renumber(groupId, parentId) {
      const filter = parentId ? 'parent_id = {:p}' : "group_id = {:g} && parent_id = ''"
      app.findRecordsByFilter(COLLECTION, filter, 'position,created', 0, 0, { g: groupId, p: parentId || '' }).forEach((record, index) => {
        record.set('position', (index + 1) * 1024)
        app.save(record)
      })
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

/** Dependências entre elementos do quadro (`blocks` | `relates`). */
function createPlanLinkRepository(app) {
  const COLLECTION = 'plan_item_links'
  const toEntity = (record) => ({
    id: record.id,
    projectId: record.getString('project_id'),
    fromId: record.getString('from_id'),
    toId: record.getString('to_id'),
    type: record.getString('type'),
    createdBy: record.getString('created_by') || null,
    createdAt: toDate(record.getDateTime('created')),
  })
  return {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    listByProject(projectId) {
      return app.findRecordsByFilter(COLLECTION, 'project_id = {:p}', 'created', 0, 0, { p: projectId }).map(toEntity)
    },
    create(data) {
      const record = new Record(app.findCollectionByNameOrId(COLLECTION))
      record.set('project_id', data.projectId)
      record.set('from_id', data.fromId)
      record.set('to_id', data.toId)
      record.set('type', data.type)
      record.set('created_by', data.createdBy || '')
      app.save(record)
      return toEntity(record)
    },
    delete(id) {
      app.delete(app.findRecordById(COLLECTION, id))
    },
    /** Remove as ligações dos elementos (antes de excluí-los). */
    deleteByItems(itemIds) {
      if (itemIds.length === 0) return
      const select = app.recordQuery(COLLECTION)
      select.andWhere($dbx.or($dbx.in.apply(null, ['from_id'].concat(itemIds)), $dbx.in.apply(null, ['to_id'].concat(itemIds))))
      const records = arrayOf(new Record())
      select.all(records)
      records.forEach((record) => app.delete(record))
    },
  }
}

/** Configuração do quadro por projeto (sem registro = padrão). */
function createPlanSettingsRepository(app) {
  const COLLECTION = 'plan_settings'
  const find = (projectId) => {
    const found = app.findRecordsByFilter(COLLECTION, 'project_id = {:p}', '', 1, 0, { p: projectId })
    return found.length ? found[0] : null
  }
  const toEntity = (record) => {
    const baseline = parseJsonField(record, 'baseline')
    return {
      projectId: record.getString('project_id'),
      dependencyRule: record.getString('dependency_rule'),
      // linha de base do Cronograma (GP-4)
      baseline: baseline && baseline.saved_at ? { savedAt: new Date(baseline.saved_at), items: baseline.items || {} } : null,
      issueSeq: record.getInt('issue_seq'),
    }
  }
  return {
    findByProject(projectId) {
      const record = find(projectId)
      return record ? toEntity(record) : null
    },
    save(projectId, data) {
      const existing = find(projectId)
      const record = existing || new Record(app.findCollectionByNameOrId(COLLECTION))
      record.set('project_id', projectId)
      if (!existing && data.dependencyRule === undefined) record.set('dependency_rule', 'warn')
      if (data.dependencyRule !== undefined) record.set('dependency_rule', data.dependencyRule)
      if (data.baseline !== undefined) record.set('baseline', data.baseline ? { saved_at: data.baseline.savedAt.toISOString(), items: data.baseline.items } : null)
      if (data.issueSeq !== undefined) record.set('issue_seq', data.issueSeq)
      app.save(record)
      return toEntity(record)
    },
  }
}

function createMilestoneRepository(app) {
  const COLLECTION = 'project_milestones'
  const day = (dateTime) => {
    const date = toDate(dateTime)
    return date ? date.toISOString().slice(0, 10) : null
  }

  function toEntity(record) {
    return {
      id: record.id,
      projectId: record.getString('project_id'),
      name: record.getString('name'),
      description: record.getString('description'),
      dueDate: day(record.getDateTime('due_date')),
      state: record.getString('state'),
      createdBy: record.getString('created_by') || null,
      createdAt: toDate(record.getDateTime('created')),
      updatedAt: toDate(record.getDateTime('updated')),
    }
  }

  const FIELDS = { projectId: 'project_id', name: 'name', description: 'description', state: 'state', createdBy: 'created_by' }
  function apply(record, data) {
    Object.keys(data).forEach((key) => {
      const value = data[key]
      if (FIELDS[key]) record.set(FIELDS[key], value === null ? '' : value)
      else if (key === 'dueDate') record.set('due_date', value ? value + ' 00:00:00.000Z' : '')
    })
  }

  return {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    /** Pela data; empate pela criação. */
    listByProject(projectId) {
      return app.findRecordsByFilter(COLLECTION, 'project_id = {:p}', 'due_date,created', 0, 0, { p: projectId }).map(toEntity)
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

function createRelationRepository(app) {
  const COLLECTION = 'task_relations'

  function toEntity(record) {
    return {
      id: record.id,
      type: record.getString('relation_type'),
      sourceId: record.getString('source_task_id'),
      targetId: record.getString('target_task_id'),
      createdBy: record.getString('created_by') || null,
      createdAt: toDate(record.getDateTime('created')),
    }
  }

  const inList = (column, ids) => $dbx.in.apply(null, [column].concat(ids))
  const ofType = (type) => $dbx.hashExp({ relation_type: type })

  return {
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    listByTask(taskId) {
      return app.findRecordsByFilter(COLLECTION, 'source_task_id = {:t} || target_task_id = {:t}', 'created', 0, 0, { t: taskId }).map(toEntity)
    },
    listBetween(a, b) {
      return app
        .findRecordsByFilter(COLLECTION, '(source_task_id = {:a} && target_task_id = {:b}) || (source_task_id = {:b} && target_task_id = {:a})', 'created', 0, 0, { a, b })
        .map(toEntity)
    },
    /** Arestas "vem antes" que saem dos ids (bloqueia: origem->destino; depende de: destino->origem). */
    precedenceFrom(ids) {
      if (ids.length === 0) return []
      return app
        .findAllRecords(COLLECTION, $dbx.or($dbx.and(ofType('blocks'), inList('source_task_id', ids)), $dbx.and(ofType('depends_on'), inList('target_task_id', ids))))
        .map(toEntity)
    },
    /** Quem bloqueia cada tarefa: [{ taskId, blockerId }]. */
    blockersOf(taskIds) {
      if (taskIds.length === 0) return []
      return app
        .findAllRecords(COLLECTION, $dbx.or($dbx.and(ofType('blocks'), inList('target_task_id', taskIds)), $dbx.and(ofType('depends_on'), inList('source_task_id', taskIds))))
        .map(toEntity)
        .map((rel) => (rel.type === 'blocks' ? { taskId: rel.targetId, blockerId: rel.sourceId } : { taskId: rel.sourceId, blockerId: rel.targetId }))
    },
    create(data) {
      const record = new Record(app.findCollectionByNameOrId(COLLECTION))
      record.set('source_task_id', data.sourceId)
      record.set('target_task_id', data.targetId)
      record.set('relation_type', data.type)
      record.set('created_by', data.createdBy || '')
      app.save(record)
      return toEntity(record)
    },
    delete(id) {
      app.delete(app.findRecordById(COLLECTION, id))
    },
    deleteByTask(taskId) {
      app
        .findRecordsByFilter(COLLECTION, 'source_task_id = {:t} || target_task_id = {:t}', '', 0, 0, { t: taskId })
        .forEach((record) => app.delete(record))
    },
  }
}

function createLoginAttemptRepository(app) {
  const COLLECTION = 'login_attempts'
  return {
    record(key, at) {
      const record = new Record(app.findCollectionByNameOrId(COLLECTION))
      record.set('key', key)
      record.set('attempted_at', toPbDate(at))
      app.save(record)
    },
    /** Datas das falhas desde `since`. */
    listSince(key, since) {
      return app
        .findRecordsByFilter(COLLECTION, 'key = {:k} && attempted_at >= {:s}', '-attempted_at', 200, 0, { k: key, s: toPbDate(since) })
        .map((r) => toDate(r.getDateTime('attempted_at')))
        .filter(Boolean)
    },
    clear(key) {
      app.findAllRecords(COLLECTION, $dbx.hashExp({ key })).forEach((r) => app.delete(r))
    },
    /** Limpeza diária das tentativas antigas. */
    purgeBefore(date) {
      const old = app.findAllRecords(COLLECTION, $dbx.exp('attempted_at < {:d}', { d: toPbDate(date) }))
      old.forEach((r) => app.delete(r))
      return old.length
    },
  }
}

function createRepositories(app) {
  // documentação (expansão, Onda 2) em arquivo próprio
  const { createDocRepositories } = require('./doc-repositories')
  // painel do elemento do quadro (GP-3) em arquivo próprio
  const { createPlanCollabRepositories } = require('./plan-collab-repositories')
  // Gestão do quadro (GP-4: diário e problemas) em arquivo próprio
  const { createPlanManagementRepositories } = require('./plan-management-repositories')
  // Configurador geral em arquivo próprio
  const { createPlatformSettingsRepository } = require('./platform-repositories')
  // e-mail (integrações) em arquivo próprio
  const { createEmailRepositories } = require('./email-repositories')
  const { createApiTokenRepository } = require('./api-token-repositories')
  const { createWebhookRepositories, withWebhooks } = require('./webhook-repositories')
  const repos = Object.assign(createWebhookRepositories(app), createDocRepositories(app), createPlanCollabRepositories(app), createPlanManagementRepositories(app), createEmailRepositories(app), {
    platformSettingsRepository: createPlatformSettingsRepository(app),
    apiTokenRepository: createApiTokenRepository(app),
    taskRepository: createTaskRepository(app),
    relationRepository: createRelationRepository(app),
    loginAttemptRepository: createLoginAttemptRepository(app),
    sprintRepository: createSprintRepository(app),
    milestoneRepository: createMilestoneRepository(app),
    projectGroupRepository: createProjectGroupRepository(app),
    planStatusRepository: createPlanStatusRepository(app),
    planResourceRepository: createPlanResourceRepository(app),
    planItemRepository: createPlanItemRepository(app),
    planLinkRepository: createPlanLinkRepository(app),
    planSettingsRepository: createPlanSettingsRepository(app),
    taskValueRepository: createTaskValueRepository(app),
    tagRepository: createTagRepository(app),
    taskTagRepository: createTaskTagRepository(app),
    commentRepository: createCommentRepository(app),
    attachmentRepository: createAttachmentRepository(app),
    notificationRepository: createNotificationRepository(app),
    statusRepository: createLookupRepository(app, 'task_statuses', { hasCategory: true, taskColumn: 'status_id' }),
    priorityRepository: createLookupRepository(app, 'task_priorities', { hasCategory: false, taskColumn: 'priority_id' }),
    customFieldRepository: createCustomFieldRepository(app),
    taskTypeRepository: createTaskTypeRepository(app),
    taskTypeFieldRepository: createTaskTypeFieldRepository(app),
    projectRepository: createProjectRepository(app),
    projectMemberRepository: createProjectMemberRepository(app),
    userRepository: createUserRepository(app),
    roleRepository: createRoleRepository(app),
    permissionRepository: createPermissionRepository(app),
    sessionRepository: createSessionRepository(app),
    auditRepository: createAuditRepository(app),
  })
  // o histórico também enfileira as entregas dos webhooks que assinam o evento
  repos.auditRepository = withWebhooks(repos.auditRepository, repos)
  return repos
}

module.exports = { createRepositories }
