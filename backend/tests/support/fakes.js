/**
 * Implementações em memória das portas da aplicação, usadas nos testes unitários.
 * Espelham o contrato dos repositórios PocketBase (pb_hooks/src/infrastructure).
 */

const { DEFAULT_ROLES, DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } = require('../../pb_hooks/src/domain/permissions')

let seq = 0
const nextId = (prefix) => `${prefix}${++seq}`

function createFakeClock(start) {
  let current = new Date(start || '2026-01-10T12:00:00.000Z')
  return {
    now: () => new Date(current.getTime()),
    advanceMinutes: (m) => {
      current = new Date(current.getTime() + m * 60000)
    },
  }
}

function createFakeTokens() {
  return {
    generate: () => `tok_${++seq}_${'x'.repeat(40)}`,
    hash: (token) => `hash(${token})`,
  }
}

function createFakeStore() {
  const roles = DEFAULT_ROLES.map((r) => ({
    id: `role_${r.code}`,
    code: r.code,
    name: r.name,
    description: r.description,
    isSystem: true,
  }))
  const rolePermissions = {}
  roles.forEach((r) => {
    rolePermissions[r.id] = DEFAULT_ROLE_PERMISSIONS[r.code].slice()
  })
  return {
    users: [],
    passwords: {},
    roles,
    rolePermissions,
    sessions: [],
    audit: [],
    projects: [],
    projectMembers: [],
    customFields: [],
    fieldOptions: [],
    taskTypes: [],
    typeFields: [],
    /** Tarefas por tipo (Fase 4); os testes ajustam para simular uso. */
    taskCounts: {},
    statuses: [],
    priorities: [],
    areas: [],
    tasks: [],
    taskValues: [],
    tags: [],
    taskTags: [],
    comments: [],
    attachments: [],
    notifications: [],
    sprints: [],
    charters: [],
    charterItems: [],
    charterMeasurements: [],
    milestones: [],
    projectGroups: [],
    planStatuses: [],
    planResources: [],
    planItems: [],
    planLinks: [],
    planUpdates: [],
    planFiles: [],
    planSettings: [],
    planJournal: [],
    planColumns: [],
    planIssues: [],
    docSpaces: [],
    docPages: [],
    docVersions: [],
    docFiles: [],
    relations: [],
    loginAttempts: [],
    /** Configurador geral (registro único). */
    platformSettings: { values: {}, files: {}, updatedAt: null },
    /** E-mail (integrações): configurações, fila e links de uso único. */
    emailSettings: { values: {}, password: '' },
    emailOutbox: [],
    authTokens: [],
    apiTokens: [],
    webhooks: [],
    webhookDeliveries: [],
    /** Tarefas por status/prioridade; os testes ajustam para simular uso. */
    lookupTaskCounts: {},
  }
}

/** Repositório em memória de status/prioridades (mesma porta de infrastructure/repositories.js). */
function createFakeLookupRepository(store, bucket, prefix) {
  let seq = 0
  const repo = {
    findById: (id) => store[bucket].find((x) => x.id === id) || null,
    findByKey: (key) => store[bucket].find((x) => x.key === key) || null,
    list: (query) =>
      store[bucket]
        .filter((x) => query.includeInactive || x.isActive)
        .slice()
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    maxOrder: () => store[bucket].reduce((max, x) => Math.max(max, x.order), -1),
    create: (data) => {
      seq += 1
      const item = Object.assign({ id: `${prefix}_${seq}`, createdAt: new Date(), updatedAt: new Date() }, data)
      store[bucket].push(item)
      return item
    },
    update: (id, patch) => Object.assign(repo.findById(id), patch, { updatedAt: new Date() }),
    delete: (id) => {
      store[bucket] = store[bucket].filter((x) => x.id !== id)
    },
    setOrder: (ids) =>
      ids.forEach((id, index) => {
        repo.findById(id).order = index
      }),
    clearDefault: () =>
      store[bucket].forEach((x) => {
        x.isDefault = false
      }),
    countTasks: (id) => store.lookupTaskCounts[id] || 0,
    countProjects: (id) => store.projects.filter((p) => p.areaId === id).length,
  }
  return repo
}

function createFakeRepositories(store) {
  const userRepository = {
    findById: (id) => store.users.find((u) => u.id === id) || null,
    findByEmail: (email) => store.users.find((u) => u.email === email) || null,
    findManyByIds: (ids) => store.users.filter((u) => ids.includes(u.id)),
    emailExists: (email, exceptId) => store.users.some((u) => u.email === email && u.id !== exceptId),
    list: (query) => {
      let items = store.users.slice()
      if (query.search) {
        const q = query.search.toLowerCase()
        items = items.filter((u) => u.name.toLowerCase().includes(q) || u.email.includes(q))
      }
      if (query.status) items = items.filter((u) => u.status === query.status)
      if (query.roleId) items = items.filter((u) => u.roleId === query.roleId)
      const total = items.length
      items = items.slice(query.pagination.offset, query.pagination.offset + query.pagination.perPage)
      return { items, total }
    },
    create: (data) => {
      const user = {
        id: nextId('user_'),
        name: data.name,
        email: data.email,
        avatarUrl: null,
        status: data.status,
        roleId: data.roleId,
        locale: data.locale || 'pt-BR',
        theme: data.theme || 'system',
        emailNotifications: data.emailNotifications !== false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLoginAt: null,
      }
      store.users.push(user)
      store.passwords[user.id] = data.password
      return user
    },
    update: (id, patch) => {
      const user = userRepository.findById(id)
      Object.assign(user, patch)
      if (patch.password) {
        store.passwords[id] = patch.password
        delete user.password
      }
      return user
    },
    verifyPassword: (id, password) => store.passwords[id] === password,
    countByRole: (roleId) => store.users.filter((u) => u.roleId === roleId).length,
    searchActive: ({ search, excludeIds, limit }) => {
      const q = (search || '').toLowerCase()
      return store.users
        .filter((u) => u.status === 'active' && !(excludeIds || []).includes(u.id))
        .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.includes(q))
        .slice(0, limit)
    },
  }

  const roleRepository = {
    findById: (id) => store.roles.find((r) => r.id === id) || null,
    findByCode: (code) => store.roles.find((r) => r.code === code) || null,
    list: () => store.roles.map((r) => Object.assign({}, r)),
    getPermissionCodes: (roleId) => (store.rolePermissions[roleId] || []).slice(),
    setPermissionCodes: (roleId, codes) => {
      store.rolePermissions[roleId] = codes.slice()
    },
    create: (data) => {
      const role = Object.assign({ id: nextId('role_'), isSystem: false }, data)
      store.roles.push(role)
      store.rolePermissions[role.id] = []
      return role
    },
    update: (id, patch) => Object.assign(roleRepository.findById(id), patch),
    delete: (id) => {
      store.roles = store.roles.filter((r) => r.id !== id)
      delete store.rolePermissions[id]
    },
  }

  const permissionRepository = {
    list: () => PERMISSIONS.map((p) => ({ id: `perm_${p.code}`, code: p.code, module: p.module })),
  }

  const sessionRepository = {
    create: (data) => {
      const session = Object.assign({ id: nextId('sess_'), revokedAt: null, createdAt: data.lastSeenAt }, data)
      store.sessions.push(session)
      return session
    },
    findById: (id) => store.sessions.find((s) => s.id === id) || null,
    findByTokenHash: (hash) => store.sessions.find((s) => s.tokenHash === hash) || null,
    touch: (id, lastSeenAt, expiresAt) => Object.assign(sessionRepository.findById(id), { lastSeenAt, expiresAt }),
    revoke: (id, at) => Object.assign(sessionRepository.findById(id), { revokedAt: at }),
    revokeAllForUser: (userId, at, exceptId) => {
      const targets = store.sessions.filter((s) => s.userId === userId && !s.revokedAt && s.id !== exceptId)
      targets.forEach((s) => {
        s.revokedAt = at
      })
      return targets.length
    },
    listActiveForUser: (userId, now) =>
      store.sessions.filter((s) => s.userId === userId && !s.revokedAt && s.expiresAt > now),
  }

  let auditSeq = 0
  const auditRepository = {
    record: (entry) => {
      auditSeq++
      store.audit.push(Object.assign({ id: `audit_${auditSeq}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, auditSeq)) }, entry))
    },
    list: (query) => {
      const f = query.filters
      let items = store.audit.filter(
        (e) =>
          (!f.entityType || e.entityType === f.entityType) &&
          (!f.entityId || e.entityId === f.entityId) &&
          (!f.userId || e.userId === f.userId) &&
          (!f.action || e.action === f.action) &&
          (!f.from || e.createdAt >= f.from) &&
          (!f.to || e.createdAt <= f.to),
      )
      items = items.slice().sort((a, b) => b.createdAt - a.createdAt)
      return { items: items.slice(query.pagination.offset, query.pagination.offset + query.pagination.perPage), total: items.length }
    },
    countBefore: (date) => store.audit.filter((e) => e.createdAt < date).length,
    purgeBefore: (date) => {
      const before = store.audit.length
      const kept = store.audit.filter((e) => e.createdAt >= date)
      store.audit.length = 0
      kept.forEach((e) => store.audit.push(e))
      return before - kept.length
    },
  }

  let platformStamp = 0
  const touchPlatform = () => {
    store.platformSettings.updatedAt = new Date(Date.UTC(2026, 9, 1, 0, 0, ++platformStamp))
  }
  const platformSettingsRepository = {
    get: () => ({
      values: Object.assign({}, store.platformSettings.values),
      files: Object.assign({}, store.platformSettings.files),
      updatedAt: store.platformSettings.updatedAt,
    }),
    saveValues: (values) => {
      store.platformSettings.values = Object.assign({}, values)
      touchPlatform()
    },
    setFile: (slot, data) => {
      store.platformSettings.files[slot] = { name: data.name, mime: data.mime, size: data.size }
      touchPlatform()
    },
    clearFile: (slot) => {
      delete store.platformSettings.files[slot]
      touchPlatform()
    },
    fileKeyOf: (slot) => `platform/${slot}`,
  }

  const { DEFAULT_SETTINGS: EMAIL_DEFAULTS } = require('../../pb_hooks/src/domain/email')
  const emailSettingsRepository = {
    get: () => ({ values: Object.assign({}, EMAIL_DEFAULTS, store.emailSettings.values), hasPassword: !!store.emailSettings.password }),
    save: (values, password) => {
      store.emailSettings.values = Object.assign({}, values)
      if (password !== undefined) store.emailSettings.password = password
    },
  }

  const emailOutboxRepository = {
    enqueue: (entry) => {
      const item = Object.assign({ id: nextId('mail_'), status: 'pending', attempts: 0, lastError: '', nextAttemptAt: null, sentAt: null, createdAt: new Date() }, entry)
      store.emailOutbox.push(item)
      return item
    },
    listDue: (now, limit) => store.emailOutbox.filter((m) => m.status === 'pending' && (!m.nextAttemptAt || m.nextAttemptAt <= now)).slice(0, limit),
    update: (id, patch) => Object.assign(store.emailOutbox.find((m) => m.id === id), patch),
    counts: () => ({
      pending: store.emailOutbox.filter((m) => m.status === 'pending').length,
      sent: store.emailOutbox.filter((m) => m.status === 'sent').length,
      failed: store.emailOutbox.filter((m) => m.status === 'failed').length,
    }),
    listRecent: (limit) => store.emailOutbox.slice().reverse().slice(0, limit),
  }

  const webhookRepository = {
    list: () => store.webhooks.slice(),
    listActive: () => store.webhooks.filter((w) => w.active),
    findById: (id) => store.webhooks.find((w) => w.id === id) || null,
    create: (data) => {
      const webhook = Object.assign({ id: nextId('wh_'), lastStatus: null, lastDeliveryAt: null, consecutiveFailures: 0, createdAt: new Date() }, data)
      store.webhooks.push(webhook)
      return webhook
    },
    update: (id, patch) => Object.assign(store.webhooks.find((w) => w.id === id), patch),
    delete: (id) => {
      store.webhooks = store.webhooks.filter((w) => w.id !== id)
      store.webhookDeliveries = store.webhookDeliveries.filter((d) => d.webhookId !== id)
    },
  }

  let deliveryClock = 0
  const webhookDeliveryRepository = {
    create: (data) => {
      const delivery = Object.assign({ id: nextId('whd_'), status: 'pending', attempts: 0, responseStatus: null, responseBody: '', error: '', deliveredAt: null, createdAt: new Date(Date.UTC(2026, 9, 1, 12, 0, ++deliveryClock)) }, data)
      store.webhookDeliveries.push(delivery)
      return delivery
    },
    findById: (id) => store.webhookDeliveries.find((d) => d.id === id) || null,
    listByWebhook: (webhookId, limit) => store.webhookDeliveries.filter((d) => d.webhookId === webhookId).slice().reverse().slice(0, limit),
    listDue: (now, limit) => store.webhookDeliveries.filter((d) => d.status === 'pending' && (!d.nextAttemptAt || d.nextAttemptAt <= now)).slice(0, limit),
    update: (id, patch) => Object.assign(store.webhookDeliveries.find((d) => d.id === id), patch),
    purgeBefore: (date) => {
      const before = store.webhookDeliveries.length
      store.webhookDeliveries = store.webhookDeliveries.filter((d) => d.status === 'pending' || (d.deliveredAt || d.createdAt) >= date)
      return before - store.webhookDeliveries.length
    },
  }

  const apiTokenRepository = {
    create: (data) => {
      const token = Object.assign({ id: nextId('pat_'), lastUsedAt: null, lastUsedIp: '', revokedAt: null }, data)
      store.apiTokens.push(token)
      return token
    },
    findById: (id) => store.apiTokens.find((t) => t.id === id) || null,
    findByHash: (hash) => store.apiTokens.find((t) => t.tokenHash === hash) || null,
    listByUser: (userId) => store.apiTokens.filter((t) => t.userId === userId).slice().reverse(),
    listAll: () => store.apiTokens.slice().reverse(),
    countActiveByUser: (userId, now) => store.apiTokens.filter((t) => t.userId === userId && !t.revokedAt && (!t.expiresAt || t.expiresAt > now)).length,
    touch: (id, at, ip) => Object.assign(store.apiTokens.find((t) => t.id === id), { lastUsedAt: at, lastUsedIp: ip }),
    revoke: (id, at) => Object.assign(store.apiTokens.find((t) => t.id === id), { revokedAt: at }),
  }

  const authTokenRepository = {
    create: (data) => {
      const token = Object.assign({ id: nextId('tok_'), usedAt: null }, data)
      store.authTokens.push(token)
      return token
    },
    findByHash: (hash) => store.authTokens.find((t) => t.tokenHash === hash) || null,
    markUsed: (id, at) => {
      store.authTokens.find((t) => t.id === id).usedAt = at
    },
    invalidateForUser: (userId, purpose, at) => {
      store.authTokens.filter((t) => t.userId === userId && t.purpose === purpose && !t.usedAt).forEach((t) => (t.usedAt = at))
    },
    countSince: (userId, purpose, since) => store.authTokens.filter((t) => t.userId === userId && t.purpose === purpose && t.createdAt >= since).length,
  }

  const SORT_FIELDS = { name: 'name', key: 'key', created: 'createdAt', due_date: 'dueDate', status: 'status', priority: 'priority' }
  const projectRepository = {
    findById: (id) => store.projects.find((p) => p.id === id) || null,
    findByKey: (key) => store.projects.find((p) => p.key === key) || null,
    list: (query) => {
      const memberOf = (p) => store.projectMembers.some((m) => m.projectId === p.id && m.userId === query.scope.userId)
      let items = store.projects.filter((p) => (query.view === 'mine' || !query.scope.viewAll ? memberOf(p) : true))
      items = items.filter((p) => (query.view === 'archived' ? !!p.archivedAt : !p.archivedAt))
      if (query.search) {
        const q = query.search.toLowerCase()
        items = items.filter((p) => p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q))
      }
      if (query.status) items = items.filter((p) => p.status === query.status)
      if (query.priority) items = items.filter((p) => p.priority === query.priority)
      if (query.urgency) items = items.filter((p) => (p.urgency || 'none') === query.urgency)
      if (query.areaId) items = items.filter((p) => (p.areaId || 'none') === query.areaId)
      if (query.ownerId) items = items.filter((p) => p.ownerId === query.ownerId)
      const sort = query.sort[0]
      if (sort) {
        const field = SORT_FIELDS[sort.column]
        const factor = sort.direction === 'DESC' ? -1 : 1
        items = items.slice().sort((a, b) => (a[field] > b[field] ? factor : a[field] < b[field] ? -factor : 0))
      }
      return { items: items.slice(query.pagination.offset, query.pagination.offset + query.pagination.perPage), total: items.length }
    },
    create: (data) => {
      const project = Object.assign({ id: nextId('proj_'), archivedAt: null, createdAt: new Date(), updatedAt: new Date() }, data)
      store.projects.push(project)
      return project
    },
    update: (id, patch) => Object.assign(projectRepository.findById(id), patch, { updatedAt: new Date() }),
    delete: (id) => {
      store.projects = store.projects.filter((p) => p.id !== id)
    },
    findManyByIds: (ids) => store.projects.filter((p) => ids.includes(p.id)),
  }

  let taskClock = 0
  const TASK_SORT = {
    code: (t) => t.number,
    title: (t) => t.title.toLowerCase(),
    created: (t) => t.createdAt.getTime(),
    updated: (t) => t.updatedAt.getTime(),
    due_date: (t) => (t.dueDate ? t.dueDate.getTime() : Infinity),
    priority: (t) => (store.priorities.find((p) => p.id === t.priorityId) || { order: 999 }).order,
    status: (t) => (store.statuses.find((p) => p.id === t.statusId) || { order: 999 }).order,
  }
  const taskRepository = {
    findById: (id) => store.tasks.find((t) => t.id === id) || null,
    nextNumber: (projectId) => store.tasks.filter((t) => t.projectId === projectId).reduce((max, t) => Math.max(max, t.number), 0) + 1,
    create: (data) => {
      taskClock += 1
      const at = new Date(Date.UTC(2026, 0, 1, 0, 0, taskClock))
      const task = Object.assign({ id: nextId('task_'), createdAt: at, updatedAt: at }, data)
      store.tasks.push(task)
      return task
    },
    update: (id, patch) => {
      taskClock += 1
      return Object.assign(taskRepository.findById(id), patch, { updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, taskClock)) })
    },
    delete: (id) => {
      store.tasks = store.tasks.filter((t) => t.id !== id)
      store.taskValues = store.taskValues.filter((v) => v.taskId !== id)
      store.taskTags = store.taskTags.filter((r) => r.taskId !== id)
      store.comments = store.comments.filter((c) => c.taskId !== id)
      store.attachments = store.attachments.filter((a) => a.taskId !== id)
    },
    maxPosition: (projectId, statusId) => {
      const list = store.tasks.filter((t) => t.projectId === projectId && t.statusId === statusId && typeof t.position === 'number')
      return list.length ? Math.max(...list.map((t) => t.position)) : null
    },
    renumber: (projectId, statusId) => {
      store.tasks
        .filter((t) => t.projectId === projectId && t.statusId === statusId)
        .sort((a, b) => a.position - b.position)
        .forEach((t, index) => {
          t.position = (index + 1) * 1024
        })
    },
    countByStatus: (projectId) => {
      const counts = {}
      store.tasks
        .filter((t) => t.projectId === projectId)
        .forEach((t) => {
          counts[t.statusId] = (counts[t.statusId] || 0) + 1
        })
      return counts
    },
    listByProject: (projectId, limit) =>
      store.tasks
        .filter((t) => t.projectId === projectId)
        .slice()
        .sort((a, b) => a.number - b.number)
        .slice(0, limit || undefined),
    listForBoard: (projectId, statusId, options) => {
      const list = store.tasks.filter((t) => t.projectId === projectId && t.statusId === statusId)
      const sorted = options.closed
        ? list.slice().sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
        : list.slice().sort((a, b) => a.position - b.position || a.number - b.number)
      return sorted.slice(0, options.limit)
    },
    /** Backlog: tarefas nos status indicados, em ordem manual. */
    listBacklog: (projectId, statusIds, limit) =>
      store.tasks
        .filter((t) => t.projectId === projectId && statusIds.includes(t.statusId))
        .slice()
        .sort((a, b) => a.position - b.position || a.number - b.number)
        .slice(0, limit || undefined),
    maxPositionIn: (projectId, statusIds) => {
      const list = store.tasks.filter((t) => t.projectId === projectId && statusIds.includes(t.statusId) && typeof t.position === 'number')
      return list.length ? Math.max(...list.map((t) => t.position)) : null
    },
    renumberMany: (projectId, statusIds) => {
      store.tasks
        .filter((t) => t.projectId === projectId && statusIds.includes(t.statusId))
        .sort((a, b) => a.position - b.position || a.number - b.number)
        .forEach((t, index) => {
          t.position = (index + 1) * 1024
        })
    },
    findManyByIds: (ids) => store.tasks.filter((t) => ids.includes(t.id)),
    listForReport: (query) =>
      store.tasks
        .filter((t) => query.scope.viewAll || store.projectMembers.some((m) => m.projectId === t.projectId && m.userId === query.scope.userId && m.role !== 'it'))
        .filter((t) => query.includeArchived || !(store.projects.find((p) => p.id === t.projectId) || {}).archivedAt)
        .filter((t) => !query.projectId || t.projectId === query.projectId)
        .filter((t) => !query.assigneeId || (query.assigneeId === 'none' ? !t.assigneeId : t.assigneeId === query.assigneeId))
        .filter((t) => !query.typeId || t.typeId === query.typeId)
        .filter((t) => !query.priorityId || t.priorityId === query.priorityId)
        .filter((t) => !query.statusId || t.statusId === query.statusId)
        .map((t) => ({
          id: t.id,
          projectId: t.projectId,
          typeId: t.typeId,
          statusId: t.statusId,
          priorityId: t.priorityId,
          assigneeId: t.assigneeId || null,
          createdAt: t.createdAt,
          startedAt: t.startedAt || null,
          completedAt: t.completedAt || null,
          dueDate: t.dueDate ? new Date(t.dueDate) : null,
        })),
    listChildren: (parentId) => store.tasks.filter((t) => t.parentTaskId === parentId).slice().sort((a, b) => a.number - b.number),
    listForks: (taskId) => store.tasks.filter((t) => t.forkedFromTaskId === taskId).slice().sort((a, b) => a.number - b.number),
    /** Progresso das subtarefas por pai: { total, done } (done = status encerrado). */
    subtaskStats: (parentIds, closedStatusIds) => {
      const map = {}
      store.tasks
        .filter((t) => t.parentTaskId && parentIds.includes(t.parentTaskId))
        .forEach((t) => {
          const entry = map[t.parentTaskId] || { done: 0, total: 0 }
          entry.total += 1
          if (closedStatusIds.includes(t.statusId)) entry.done += 1
          map[t.parentTaskId] = entry
        })
      return map
    },
    listBySprint: (sprintId) => store.tasks.filter((t) => t.sprintId === sprintId),
    listForReminders: (query) =>
      store.tasks.filter((t) => t.dueDate && t.dueDate < query.before && t.assigneeId && query.statusIds.includes(t.statusId)),
    list: (query) => {
      const visible = (t) =>
        query.scope.viewAll ||
        store.projectMembers.some((m) => m.projectId === t.projectId && m.userId === query.scope.userId && (m.role !== 'it' || t.assigneeId === query.scope.userId))
      let items = store.tasks.filter(visible)
      if (query.projectId) items = items.filter((t) => t.projectId === query.projectId)
      if (query.typeId) items = items.filter((t) => t.typeId === query.typeId)
      if (query.statusIds) items = items.filter((t) => query.statusIds.includes(t.statusId))
      if (query.priorityId) items = items.filter((t) => t.priorityId === query.priorityId)
      if (query.assigneeId) items = items.filter((t) => t.assigneeId === query.assigneeId)
      if (query.tagId) items = items.filter((t) => store.taskTags.some((r) => r.taskId === t.id && r.tagId === query.tagId))
      if (query.sprintId) items = items.filter((t) => (query.sprintId === 'none' ? !t.sprintId : t.sprintId === query.sprintId))
      if (query.inReport !== undefined) items = items.filter((t) => !t.reportExcluded === query.inReport)
      if (query.urgency) items = items.filter((t) => (t.urgency || 'none') === query.urgency)
      if (query.areaId) items = items.filter((t) => (t.areaId || 'none') === query.areaId)
      if (query.search) {
        const q = query.search.text.toLowerCase()
        items = items.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.code.toLowerCase().includes(q) ||
            store.taskValues.some(
              (v) => v.taskId === t.id && query.search.fieldIds.includes(v.fieldId) && String(v.value).toLowerCase().includes(q),
            ),
        )
      }
      const sorts = query.sort.concat([{ column: 'created', direction: 'ASC' }])
      items = items.slice().sort((a, b) => {
        for (const s of sorts) {
          const va = TASK_SORT[s.column](a)
          const vb = TASK_SORT[s.column](b)
          if (va !== vb) return (va > vb ? 1 : -1) * (s.direction === 'DESC' ? -1 : 1)
        }
        return 0
      })
      return { items: items.slice(query.pagination.offset, query.pagination.offset + query.pagination.perPage), total: items.length }
    },
  }

  let sprintSeq = 0
  const sprintRepository = {
    findById: (id) => store.sprints.find((c) => c.id === id) || null,
    findManyByIds: (ids) => store.sprints.filter((c) => ids.includes(c.id)),
    /** Encerradas por último; depois a ordem manual e a criação. */
    listByProject: (projectId, options) =>
      store.sprints
        .filter((c) => c.projectId === projectId && (options.includeClosed || c.state !== 'closed'))
        .slice()
        .sort(
          (a, b) =>
            (a.state === 'closed') - (b.state === 'closed') ||
            (a.order || 0) - (b.order || 0) ||
            a.createdAt - b.createdAt,
        ),
    create: (data) => {
      sprintSeq += 1
      const sprint = Object.assign({ id: `sprint_${sprintSeq}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sprintSeq)), updatedAt: new Date() }, data)
      store.sprints.push(sprint)
      return sprint
    },
    update: (id, patch) => Object.assign(sprintRepository.findById(id), patch, { updatedAt: new Date() }),
    delete: (id) => {
      store.sprints = store.sprints.filter((c) => c.id !== id)
    },
  }

  let milestoneSeq = 0
  const milestoneRepository = {
    findById: (id) => store.milestones.find((m) => m.id === id) || null,
    /** Pela data; empate pela criação. */
    listByProject: (projectId) =>
      store.milestones.filter((m) => m.projectId === projectId).slice().sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.createdAt - b.createdAt)),
    create: (data) => {
      milestoneSeq += 1
      const milestone = Object.assign({ id: 'milestone_' + milestoneSeq, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, milestoneSeq)), updatedAt: new Date() }, data)
      store.milestones.push(milestone)
      return milestone
    },
    update: (id, patch) => Object.assign(milestoneRepository.findById(id), patch, { updatedAt: new Date() }),
    delete: (id) => {
      store.milestones = store.milestones.filter((m) => m.id !== id)
    },
  }

  const charterRepository = {
    findByProject: (projectId) => store.charters.find((c) => c.projectId === projectId) || null,
    upsert: (projectId, patch) => {
      let found = charterRepository.findByProject(projectId)
      if (!found) {
        found = { id: 'charter_' + (store.charters.length + 1), projectId, objective: '', createdAt: new Date() }
        store.charters.push(found)
      }
      return Object.assign(found, patch, { updatedAt: new Date() })
    },
  }

  let charterItemSeq = 0
  const charterItemRepository = {
    findById: (id) => store.charterItems.find((i) => i.id === id) || null,
    /** Pela posição; empate pela criação. */
    listByProject: (projectId) =>
      store.charterItems
        .filter((i) => i.projectId === projectId)
        .slice()
        .sort((a, b) => (a.position || 0) - (b.position || 0) || a.createdAt - b.createdAt),
    create: (data) => {
      charterItemSeq += 1
      const item = Object.assign({ id: 'charter_item_' + charterItemSeq, taskIds: [], linkIds: [], current: null, measuredAt: null, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, charterItemSeq)), updatedAt: new Date() }, data)
      store.charterItems.push(item)
      return item
    },
    update: (id, patch) => Object.assign(charterItemRepository.findById(id), patch, { updatedAt: new Date() }),
    delete: (id) => {
      store.charterItems = store.charterItems.filter((i) => i.id !== id)
      store.charterMeasurements = store.charterMeasurements.filter((m) => m.itemId !== id)
    },
  }

  let measurementSeq = 0
  const charterMeasurementRepository = {
    /** Mais recente primeiro (pela data da medição; empate pela criação). */
    listByItem: (itemId, limit) =>
      store.charterMeasurements
        .filter((m) => m.itemId === itemId)
        .slice()
        .sort((a, b) => (a.measuredAt < b.measuredAt ? 1 : a.measuredAt > b.measuredAt ? -1 : b.seq - a.seq))
        .slice(0, limit || undefined),
    create: (data) => {
      measurementSeq += 1
      const m = Object.assign({ id: 'measurement_' + measurementSeq, seq: measurementSeq, createdAt: new Date() }, data)
      store.charterMeasurements.push(m)
      return m
    },
  }

  let groupSeq = 0
  const projectGroupRepository = {
    findById: (id) => store.projectGroups.find((g) => g.id === id) || null,
    findManyByIds: (ids) => store.projectGroups.filter((g) => ids.indexOf(g.id) >= 0),
    listByProject: (projectId) => store.projectGroups.filter((g) => g.projectId === projectId).slice().sort((a, b) => a.position - b.position || a.createdAt - b.createdAt),
    maxPosition: (projectId, parentId) => {
      const list = store.projectGroups.filter((g) => g.projectId === projectId && (g.parentId || null) === (parentId || null))
      return list.length ? Math.max(...list.map((g) => g.position)) : null
    },
    renumber: (projectId, parentId) => {
      store.projectGroups
        .filter((g) => g.projectId === projectId && (g.parentId || null) === (parentId || null))
        .sort((a, b) => a.position - b.position)
        .forEach((g, index) => {
          g.position = (index + 1) * 1024
        })
    },
    create: (data) => {
      groupSeq += 1
      const group = Object.assign({ id: 'group_' + groupSeq, parentId: null, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, groupSeq)), updatedAt: new Date() }, data)
      store.projectGroups.push(group)
      return group
    },
    update: (id, patch) => Object.assign(projectGroupRepository.findById(id), patch, { updatedAt: new Date() }),
    delete: (id) => {
      store.projectGroups = store.projectGroups.filter((g) => g.id !== id)
    },
  }

  let planSeq = 0
  const planId = (prefix) => {
    planSeq += 1
    return prefix + String(planSeq).padStart(8, '0')
  }
  const planStatusRepository = {
    findById: (id) => store.planStatuses.find((s) => s.id === id) || null,
    listByProject: (projectId) => store.planStatuses.filter((s) => s.projectId === projectId).slice().sort((a, b) => a.position - b.position),
    create: (data) => {
      const status = Object.assign({ id: planId('st_') }, data)
      store.planStatuses.push(status)
      return status
    },
    update: (id, patch) => Object.assign(planStatusRepository.findById(id), patch),
    delete: (id) => {
      store.planStatuses = store.planStatuses.filter((s) => s.id !== id)
    },
  }
  const planResourceRepository = {
    findById: (id) => store.planResources.find((r) => r.id === id) || null,
    findByKey: (projectId, key) => store.planResources.find((r) => r.projectId === projectId && r.nameKey === key) || null,
    listByProject: (projectId) => store.planResources.filter((r) => r.projectId === projectId).slice().sort((a, b) => a.name.localeCompare(b.name)),
    create: (data) => {
      const resource = Object.assign({ id: planId('rs_') }, data)
      store.planResources.push(resource)
      return resource
    },
    update: (id, patch) => Object.assign(planResourceRepository.findById(id), patch),
    delete: (id) => {
      store.planResources = store.planResources.filter((r) => r.id !== id)
    },
  }
  const byPos = (a, b) => a.position - b.position || a.createdAt - b.createdAt
  const planItemRepository = {
    findById: (id) => store.planItems.find((i) => i.id === id) || null,
    listByProject: (projectId, limit) => store.planItems.filter((i) => i.projectId === projectId).slice().sort(byPos).slice(0, limit || undefined),
    listByGroups: (groupIds) => store.planItems.filter((i) => groupIds.includes(i.groupId)).slice().sort(byPos),
    listChildren: (parentId) => store.planItems.filter((i) => i.parentId === parentId).slice().sort(byPos),
    maxPosition: (groupId, parentId) => {
      const list = store.planItems.filter((i) => i.groupId === groupId && (i.parentId || null) === (parentId || null))
      return list.length ? Math.max(...list.map((i) => i.position)) : null
    },
    listByStatus: (statusId) => store.planItems.filter((i) => i.statusId === statusId),
    listByResource: (resourceId) => store.planItems.filter((i) => (i.resourceIds || []).includes(resourceId)),
    listSiblings: (groupId, parentId) =>
      store.planItems.filter((i) => (parentId ? i.parentId === parentId : i.groupId === groupId && !i.parentId)).slice().sort(byPos),
    renumber: (groupId, parentId) =>
      planItemRepository.listSiblings(groupId, parentId).forEach((item, index) => {
        item.position = (index + 1) * 1024
      }),
    create: (data) => {
      planSeq += 1
      const item = Object.assign({ id: planId('it_'), parentId: null, resourceIds: [], metrics: {}, custom: {}, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, planSeq)), updatedAt: new Date() }, data)
      store.planItems.push(item)
      return item
    },
    update: (id, patch) => Object.assign(planItemRepository.findById(id), patch, { updatedAt: new Date() }),
    delete: (id) => {
      store.planItems = store.planItems.filter((i) => i.id !== id)
    },
  }

  const planLinkRepository = {
    findById: (id) => store.planLinks.find((l) => l.id === id) || null,
    listByProject: (projectId) => store.planLinks.filter((l) => l.projectId === projectId),
    create: (data) => {
      planSeq += 1
      const link = Object.assign({ id: planId('ln_'), createdAt: new Date() }, data)
      store.planLinks.push(link)
      return link
    },
    delete: (id) => {
      store.planLinks = store.planLinks.filter((l) => l.id !== id)
    },
    deleteByItems: (ids) => {
      store.planLinks = store.planLinks.filter((l) => !ids.includes(l.fromId) && !ids.includes(l.toId))
    },
  }
  const countByItem = (list) =>
    list.reduce((acc, x) => {
      acc[x.itemId] = (acc[x.itemId] || 0) + 1
      return acc
    }, {})
  const planUpdateRepository = {
    findById: (id) => store.planUpdates.find((u) => u.id === id) || null,
    listByItem: (itemId) => store.planUpdates.filter((u) => u.itemId === itemId).slice().sort((a, b) => a.createdAt - b.createdAt),
    create: (data) => {
      planSeq += 1
      const update = Object.assign({ id: planId('up_'), parentId: null, mentions: [], editedAt: null, deletedAt: null, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, planSeq)) }, data)
      store.planUpdates.push(update)
      return update
    },
    update: (id, patch) => Object.assign(planUpdateRepository.findById(id), patch),
    countByProject: (projectId) => countByItem(store.planUpdates.filter((u) => u.projectId === projectId && !u.deletedAt)),
  }
  const planFileRepository = {
    findById: (id) => store.planFiles.find((x) => x.id === id) || null,
    listByItem: (itemId) => store.planFiles.filter((x) => x.itemId === itemId).slice().reverse(),
    create: (data) => {
      planSeq += 1
      const file = Object.assign({ id: planId('fl_'), createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, planSeq)) }, data)
      delete file.handle
      store.planFiles.push(file)
      return file
    },
    delete: (id) => {
      store.planFiles = store.planFiles.filter((x) => x.id !== id)
    },
    fileKeyOf: (id) => `plan/${id}`,
    countByProject: (projectId) => countByItem(store.planFiles.filter((x) => x.projectId === projectId)),
  }
  const planSettingsRepository = {
    findByProject: (projectId) => store.planSettings.find((x) => x.projectId === projectId) || null,
    save: (projectId, data) => {
      let found = planSettingsRepository.findByProject(projectId)
      if (!found) {
        found = { projectId, dependencyRule: 'warn', baseline: null, issueSeq: 0 }
        store.planSettings.push(found)
      }
      if (data.dependencyRule !== undefined) found.dependencyRule = data.dependencyRule
      if (data.baseline !== undefined) found.baseline = data.baseline
      if (data.issueSeq !== undefined) found.issueSeq = data.issueSeq
      return found
    },
  }
  const planStamp = () => {
    planSeq += 1
    return new Date(Date.UTC(2026, 0, 1, 0, 0, planSeq))
  }
  const planColumnRepository = {
    findById: (id) => store.planColumns.find((x) => x.id === id) || null,
    listByProject: (projectId) => store.planColumns.filter((x) => x.projectId === projectId).sort((a, b) => a.position - b.position),
    maxPosition: (projectId) => store.planColumns.filter((x) => x.projectId === projectId).reduce((max, x) => Math.max(max, x.position), 0),
    create: (data) => {
      const at = planStamp()
      const column = Object.assign({ id: planId('cl_'), settings: {}, createdAt: at, updatedAt: at }, data)
      store.planColumns.push(column)
      return column
    },
    update: (id, patch) => Object.assign(planColumnRepository.findById(id), patch, { updatedAt: planStamp() }),
    delete: (id) => {
      store.planColumns = store.planColumns.filter((x) => x.id !== id)
    },
  }
  const planJournalRepository = {
    findById: (id) => store.planJournal.find((x) => x.id === id) || null,
    listByProject: (projectId) => store.planJournal.filter((x) => x.projectId === projectId),
    create: (data) => {
      const at = planStamp()
      const entry = Object.assign({ id: planId('jr_'), createdAt: at, updatedAt: at }, data)
      store.planJournal.push(entry)
      return entry
    },
    update: (id, patch) => Object.assign(planJournalRepository.findById(id), patch, { updatedAt: planStamp() }),
    delete: (id) => {
      store.planJournal = store.planJournal.filter((x) => x.id !== id)
    },
  }
  const planIssueRepository = {
    findById: (id) => store.planIssues.find((x) => x.id === id) || null,
    listByProject: (projectId) => store.planIssues.filter((x) => x.projectId === projectId),
    maxNumber: (projectId) => store.planIssues.filter((x) => x.projectId === projectId).reduce((max, x) => Math.max(max, x.number), 0),
    create: (data) => {
      const at = planStamp()
      const issue = Object.assign({ id: planId('is_'), ownerId: null, resolvedOn: null, createdAt: at, updatedAt: at }, data)
      store.planIssues.push(issue)
      return issue
    },
    update: (id, patch) => Object.assign(planIssueRepository.findById(id), patch, { updatedAt: planStamp() }),
    delete: (id) => {
      store.planIssues = store.planIssues.filter((x) => x.id !== id)
    },
  }

  let docSeq = 0
  const nextDocId = (prefix) => {
    docSeq += 1
    return prefix + String(docSeq).padStart(10, '0')
  }
  const stamp = () => new Date(Date.UTC(2026, 0, 1, 0, 0, docSeq))
  const docSpaceRepository = {
    findById: (id) => store.docSpaces.find((s) => s.id === id) || null,
    findByKey: (key) => store.docSpaces.find((s) => s.key === key) || null,
    list: () => store.docSpaces.slice().sort((a, b) => a.name.localeCompare(b.name)),
    create: (data) => {
      const space = Object.assign({ id: nextDocId('space'), createdAt: stamp(), updatedAt: stamp() }, data)
      store.docSpaces.push(space)
      return space
    },
    update: (id, patch) => Object.assign(docSpaceRepository.findById(id), patch, { updatedAt: stamp() }),
    delete: (id) => {
      const pageIds = store.docPages.filter((p) => p.spaceId === id).map((p) => p.id)
      docPageRepository.deleteMany(pageIds)
      store.docSpaces = store.docSpaces.filter((s) => s.id !== id)
    },
  }
  const docPageRepository = {
    findById: (id) => store.docPages.find((p) => p.id === id) || null,
    listTree: (spaceId) => store.docPages.filter((p) => p.spaceId === spaceId).map((p) => Object.assign({}, p)),
    countPublishedBySpaces: (ids) => {
      const out = {}
      store.docPages.filter((p) => ids.includes(p.spaceId) && p.status === 'published').forEach((p) => {
        out[p.spaceId] = (out[p.spaceId] || 0) + 1
      })
      return out
    },
    create: (data) => {
      const page = Object.assign({ id: nextDocId('page'), createdAt: stamp(), updatedAt: stamp() }, data)
      store.docPages.push(page)
      return page
    },
    update: (id, patch) => Object.assign(docPageRepository.findById(id), patch, { updatedAt: stamp() }),
    deleteMany: (ids) => {
      store.docPages = store.docPages.filter((p) => !ids.includes(p.id))
      store.docVersions = store.docVersions.filter((v) => !ids.includes(v.pageId))
      store.docFiles = store.docFiles.filter((f) => !ids.includes(f.pageId))
    },
    renumber: (ids) =>
      ids.forEach((id, index) => {
        docPageRepository.findById(id).position = (index + 1) * 1024
      }),
    search: (spaceIds, folded, limit) =>
      store.docPages
        .filter((p) => spaceIds.includes(p.spaceId) && p.status === 'published' && (p.searchText || '').includes(folded))
        .sort((a, b) => b.publishedAt - a.publishedAt)
        .slice(0, limit),
    recent: (spaceIds, limit) =>
      store.docPages
        .filter((p) => spaceIds.includes(p.spaceId) && p.status === 'published')
        .sort((a, b) => b.publishedAt - a.publishedAt)
        .slice(0, limit),
  }
  const docPageVersionRepository = {
    create: (data) => {
      const version = Object.assign({ id: nextDocId('vers'), createdAt: stamp() }, data)
      store.docVersions.push(version)
      return version
    },
    listByPage: (pageId) => store.docVersions.filter((v) => v.pageId === pageId).sort((a, b) => b.version - a.version),
    find: (pageId, version) => store.docVersions.find((v) => v.pageId === pageId && v.version === version) || null,
  }
  const docFileRepository = {
    create: (data) => {
      const file = Object.assign({ id: nextDocId('file0'), createdAt: stamp() }, data)
      delete file.handle
      store.docFiles.push(file)
      return file
    },
    findById: (id) => store.docFiles.find((f) => f.id === id) || null,
  }

  const loginAttemptRepository = {
    record: (key, at) => store.loginAttempts.push({ key, at: new Date(at) }),
    listSince: (key, since) => store.loginAttempts.filter((a) => a.key === key && a.at >= since).map((a) => a.at),
    clear: (key) => {
      store.loginAttempts = store.loginAttempts.filter((a) => a.key !== key)
    },
    purgeBefore: (date) => {
      const before = store.loginAttempts.length
      store.loginAttempts = store.loginAttempts.filter((a) => a.at >= date)
      return before - store.loginAttempts.length
    },
  }

  let relationSeq = 0
  const relationRepository = {
    findById: (id) => store.relations.find((r) => r.id === id) || null,
    listByTask: (taskId) => store.relations.filter((r) => r.sourceId === taskId || r.targetId === taskId),
    /** Relações entre o mesmo par (qualquer sentido). */
    listBetween: (a, b) => store.relations.filter((r) => (r.sourceId === a && r.targetId === b) || (r.sourceId === b && r.targetId === a)),
    /** Arestas "vem antes" que saem dos ids (bloqueia: origem->destino; depende de: destino->origem). */
    precedenceFrom: (ids) =>
      store.relations.filter((r) => (r.type === 'blocks' && ids.includes(r.sourceId)) || (r.type === 'depends_on' && ids.includes(r.targetId))),
    /** Quem bloqueia cada tarefa: [{ taskId, blockerId }]. */
    blockersOf: (taskIds) =>
      store.relations
        .map((r) => {
          if (r.type === 'blocks' && taskIds.includes(r.targetId)) return { taskId: r.targetId, blockerId: r.sourceId }
          if (r.type === 'depends_on' && taskIds.includes(r.sourceId)) return { taskId: r.sourceId, blockerId: r.targetId }
          return null
        })
        .filter(Boolean),
    create: (data) => {
      relationSeq += 1
      const rel = Object.assign({ id: `rel_${relationSeq}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, relationSeq)) }, data)
      store.relations.push(rel)
      return rel
    },
    delete: (id) => {
      store.relations = store.relations.filter((r) => r.id !== id)
    },
    deleteByTask: (taskId) => {
      store.relations = store.relations.filter((r) => r.sourceId !== taskId && r.targetId !== taskId)
    },
  }

  const tagRepository = {
    findById: (id) => store.tags.find((t) => t.id === id) || null,
    findByKey: (key) => store.tags.find((t) => t.nameKey === key) || null,
    findManyByIds: (ids) => store.tags.filter((t) => ids.includes(t.id)),
    list: () => store.tags.slice().sort((a, b) => a.name.localeCompare(b.name)),
    create: (data) => {
      const tag = Object.assign({ id: nextId('tag_'), createdAt: new Date(), updatedAt: new Date() }, data)
      store.tags.push(tag)
      return tag
    },
    update: (id, patch) => Object.assign(tagRepository.findById(id), patch, { updatedAt: new Date() }),
    delete: (id) => {
      store.tags = store.tags.filter((t) => t.id !== id)
      store.taskTags = store.taskTags.filter((r) => r.tagId !== id)
    },
    countTasks: (ids) => {
      const counts = {}
      ids.forEach((id) => {
        counts[id] = store.taskTags.filter((r) => r.tagId === id).length
      })
      return counts
    },
  }

  const taskTagRepository = {
    listByTasks: (taskIds) => {
      const map = {}
      store.taskTags
        .filter((r) => taskIds.includes(r.taskId))
        .forEach((r) => {
          map[r.taskId] = (map[r.taskId] || []).concat(r.tagId)
        })
      return map
    },
    replace: (taskId, tagIds) => {
      store.taskTags = store.taskTags.filter((r) => r.taskId !== taskId)
      tagIds.forEach((tagId) => store.taskTags.push({ taskId, tagId }))
    },
  }

  let commentClock = 0
  const commentRepository = {
    findById: (id) => store.comments.find((c) => c.id === id) || null,
    listByTask: (taskId) => store.comments.filter((c) => c.taskId === taskId).slice().sort((a, b) => a.createdAt - b.createdAt),
    create: (data) => {
      commentClock += 1
      const at = new Date(Date.UTC(2026, 1, 1, 0, 0, commentClock))
      const comment = Object.assign({ id: nextId('cm_'), editedAt: null, deletedAt: null, createdAt: at, updatedAt: at }, data)
      store.comments.push(comment)
      return comment
    },
    update: (id, patch) => Object.assign(commentRepository.findById(id), patch),
    countByTasks: (taskIds) => {
      const counts = {}
      store.comments
        .filter((c) => taskIds.includes(c.taskId) && !c.deletedAt)
        .forEach((c) => {
          counts[c.taskId] = (counts[c.taskId] || 0) + 1
        })
      return counts
    },
  }

  let notificationClock = 0
  const notificationRepository = {
    create: (data) => {
      notificationClock += 1
      const item = Object.assign({ id: nextId('nt_'), readAt: null, createdAt: new Date(Date.UTC(2026, 3, 1, 0, 0, notificationClock)) }, data)
      store.notifications.push(item)
      return item
    },
    existsKey: (userId, key) => store.notifications.some((n) => n.userId === userId && n.dedupeKey === key),
    findById: (id) => store.notifications.find((n) => n.id === id) || null,
    listByUser: (userId, query) => {
      const items = store.notifications
        .filter((n) => n.userId === userId && (!query.unreadOnly || !n.readAt))
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
      return { items: items.slice(query.pagination.offset, query.pagination.offset + query.pagination.perPage), total: items.length }
    },
    countUnread: (userId) => store.notifications.filter((n) => n.userId === userId && !n.readAt).length,
    markRead: (id, at) => {
      notificationRepository.findById(id).readAt = at
    },
    markAllRead: (userId, at) => {
      const unread = store.notifications.filter((n) => n.userId === userId && !n.readAt)
      unread.forEach((n) => {
        n.readAt = at
      })
      return unread.length
    },
  }

  let attachmentClock = 0
  const attachmentRepository = {
    /** Copia o arquivo para outra tarefa (fork). */
    copyTo: (id, target) => attachmentRepository.create(Object.assign({}, store.attachments.find((a) => a.id === id), { taskId: target.taskId, uploadedBy: target.uploadedBy, commentId: null })),
    findById: (id) => store.attachments.find((a) => a.id === id) || null,
    findManyByIds: (ids) => store.attachments.filter((a) => ids.includes(a.id)),
    listByTask: (taskId) => store.attachments.filter((a) => a.taskId === taskId && !a.commentId).slice().sort((a, b) => a.createdAt - b.createdAt),
    listByComments: (commentIds) => {
      const map = {}
      store.attachments
        .filter((a) => commentIds.includes(a.commentId))
        .forEach((a) => {
          map[a.commentId] = (map[a.commentId] || []).concat(a)
        })
      return map
    },
    deleteByComment: (commentId) => {
      store.attachments = store.attachments.filter((a) => a.commentId !== commentId)
    },
    create: (data) => {
      attachmentClock += 1
      const item = Object.assign({ id: nextId('att_'), createdAt: new Date(Date.UTC(2026, 2, 1, 0, 0, attachmentClock)) }, data)
      delete item.handle
      store.attachments.push(item)
      return item
    },
    delete: (id) => {
      store.attachments = store.attachments.filter((a) => a.id !== id)
    },
    countByTasks: (taskIds) => {
      const counts = {}
      store.attachments
        .filter((a) => taskIds.includes(a.taskId) && !a.commentId)
        .forEach((a) => {
          counts[a.taskId] = (counts[a.taskId] || 0) + 1
        })
      return counts
    },
  }

  const taskValueRepository = {
    listByTasks: (taskIds) => {
      const map = {}
      store.taskValues
        .filter((v) => taskIds.includes(v.taskId))
        .forEach((v) => {
          map[v.taskId] = Object.assign(map[v.taskId] || {}, { [v.fieldId]: v.value })
        })
      return map
    },
    /** `values` = { fieldId: valor }; `types` = { fieldId: tipo do campo }. */
    replace: (taskId, values) => {
      store.taskValues = store.taskValues.filter((v) => v.taskId !== taskId)
      Object.keys(values).forEach((fieldId) => store.taskValues.push({ taskId, fieldId, value: values[fieldId] }))
    },
  }

  const projectMemberRepository = {
    find: (projectId, userId) => store.projectMembers.find((m) => m.projectId === projectId && m.userId === userId) || null,
    listByProject: (projectId) => store.projectMembers.filter((m) => m.projectId === projectId),
    add: (data) => {
      const member = Object.assign({ id: nextId('pm_'), createdAt: new Date() }, data)
      store.projectMembers.push(member)
      return member
    },
    updateRole: (projectId, userId, role) => Object.assign(projectMemberRepository.find(projectId, userId), { role }),
    remove: (projectId, userId) => {
      store.projectMembers = store.projectMembers.filter((m) => !(m.projectId === projectId && m.userId === userId))
    },
    removeAllForProject: (projectId) => {
      store.projectMembers = store.projectMembers.filter((m) => m.projectId !== projectId)
    },
    countByProjects: (ids) => {
      const counts = {}
      ids.forEach((id) => {
        counts[id] = store.projectMembers.filter((m) => m.projectId === id).length
      })
      return counts
    },
    rolesForUser: (userId, ids) => {
      const roles = {}
      store.projectMembers.filter((m) => m.userId === userId && ids.includes(m.projectId)).forEach((m) => {
        roles[m.projectId] = m.role
      })
      return roles
    },
  }

  const customFieldRepository = {
    findById: (id) => store.customFields.find((f) => f.id === id) || null,
    findByName: (name) => store.customFields.find((f) => f.name === name) || null,
    findManyByIds: (ids) => store.customFields.filter((f) => ids.includes(f.id)),
    list: (query) =>
      store.customFields
        .filter((f) => !query.type || f.type === query.type)
        .filter((f) => !query.search || f.label.toLowerCase().includes(query.search.toLowerCase()) || f.name.includes(query.search.toLowerCase()))
        .slice()
        .sort((a, b) => a.label.localeCompare(b.label)),
    create: (data) => {
      const field = Object.assign({ id: nextId('cf_'), createdAt: new Date(), updatedAt: new Date() }, data)
      store.customFields.push(field)
      return field
    },
    update: (id, patch) => Object.assign(customFieldRepository.findById(id), patch, { updatedAt: new Date() }),
    delete: (id) => {
      store.customFields = store.customFields.filter((f) => f.id !== id)
      store.fieldOptions = store.fieldOptions.filter((o) => o.fieldId !== id)
    },
    listOptions: (fieldIds) =>
      store.fieldOptions.filter((o) => fieldIds.includes(o.fieldId)).slice().sort((a, b) => a.order - b.order),
    /** Substitui as opções: mantém IDs informados, cria novas e remove as ausentes. */
    syncOptions: (fieldId, options) => {
      const keep = options.filter((o) => o.id).map((o) => o.id)
      store.fieldOptions = store.fieldOptions.filter((o) => o.fieldId !== fieldId || keep.includes(o.id))
      return options.map((o, index) => {
        const existing = o.id && store.fieldOptions.find((x) => x.id === o.id && x.fieldId === fieldId)
        if (existing) return Object.assign(existing, { label: o.label, color: o.color, isActive: o.isActive, order: index })
        const created = { id: nextId('opt_'), fieldId, label: o.label, color: o.color, isActive: o.isActive, order: index }
        store.fieldOptions.push(created)
        return created
      })
    },
  }

  const taskTypeRepository = {
    findById: (id) => store.taskTypes.find((t) => t.id === id) || null,
    findByKey: (key) => store.taskTypes.find((t) => t.key === key) || null,
    list: (query) =>
      store.taskTypes
        .filter((t) => query.includeInactive || t.isActive)
        .slice()
        .sort((a, b) => a.order - b.order),
    maxOrder: () => store.taskTypes.reduce((max, t) => Math.max(max, t.order), -1),
    create: (data) => {
      const type = Object.assign({ id: nextId('tt_'), createdAt: new Date(), updatedAt: new Date() }, data)
      store.taskTypes.push(type)
      return type
    },
    update: (id, patch) => Object.assign(taskTypeRepository.findById(id), patch, { updatedAt: new Date() }),
    delete: (id) => {
      store.taskTypes = store.taskTypes.filter((t) => t.id !== id)
      store.typeFields = store.typeFields.filter((tf) => tf.typeId !== id)
    },
    setOrder: (ids) => {
      ids.forEach((id, index) => {
        taskTypeRepository.findById(id).order = index
      })
    },
    countTasks: (id) => store.taskCounts[id] || 0,
  }

  const taskTypeFieldRepository = {
    listByType: (typeId) => store.typeFields.filter((tf) => tf.typeId === typeId).slice().sort((a, b) => a.order - b.order),
    replace: (typeId, items) => {
      store.typeFields = store.typeFields.filter((tf) => tf.typeId !== typeId)
      items.forEach((item) => store.typeFields.push(Object.assign({ typeId }, item)))
    },
    typesUsingFields: (fieldIds) => {
      const map = {}
      store.typeFields
        .filter((tf) => fieldIds.includes(tf.fieldId))
        .forEach((tf) => {
          map[tf.fieldId] = (map[tf.fieldId] || []).concat(tf.typeId)
        })
      return map
    },
    countByTypes: (typeIds) => {
      const counts = {}
      typeIds.forEach((id) => {
        counts[id] = store.typeFields.filter((tf) => tf.typeId === id).length
      })
      return counts
    },
  }

  return {
    customFieldRepository,
    taskTypeRepository,
    taskTypeFieldRepository,
    userRepository,
    roleRepository,
    permissionRepository,
    sessionRepository,
    auditRepository,
    projectRepository,
    projectMemberRepository,
    taskRepository,
    relationRepository,
    loginAttemptRepository,
    platformSettingsRepository,
    emailSettingsRepository,
    emailOutboxRepository,
    authTokenRepository,
    apiTokenRepository,
    webhookRepository,
    webhookDeliveryRepository,
    sprintRepository,
    charterRepository,
    charterItemRepository,
    charterMeasurementRepository,
    milestoneRepository,
    projectGroupRepository,
    planStatusRepository,
    planResourceRepository,
    planItemRepository,
    planLinkRepository,
    planUpdateRepository,
    planFileRepository,
    planJournalRepository,
    planColumnRepository,
    planIssueRepository,
    planSettingsRepository,
    docSpaceRepository,
    docPageRepository,
    docPageVersionRepository,
    docFileRepository,
    taskValueRepository,
    tagRepository,
    taskTagRepository,
    commentRepository,
    attachmentRepository,
    notificationRepository,
    statusRepository: createFakeLookupRepository(store, 'statuses', 'status'),
    priorityRepository: createFakeLookupRepository(store, 'priorities', 'priority'),
    areaRepository: createFakeLookupRepository(store, 'areas', 'area'),
  }
}

/** Mailer em memória: guarda o que foi enviado; `failNext(motivo)` faz o próximo envio falhar. */
function createFakeMailer() {
  let failure = null
  return {
    sent: [],
    failNext(reason) {
      failure = reason
    },
    send(message) {
      if (failure) {
        const reason = failure
        failure = null
        throw new Error(reason)
      }
      this.sent.push(message)
    },
  }
}

/** Cliente HTTP em memória: guarda as chamadas; `respond(status, body)` ou `fail(motivo)` mudam a resposta. */
function createFakeHttpClient() {
  let response = { status: 200, body: 'ok' }
  let failure = null
  return {
    requests: [],
    respond(status, body) {
      response = { status, body }
      failure = null
    },
    fail(reason) {
      failure = reason
    },
    post(url, body, headers, timeout) {
      this.requests.push({ url, body, headers, timeout })
      if (failure) throw new Error(failure)
      return response
    },
  }
}

function createFakeDeps(options) {
  const store = createFakeStore()
  const repos = createFakeRepositories(store)
  const clock = createFakeClock(options && options.start)
  return Object.assign({}, repos, {
    store,
    clock,
    tokens: createFakeTokens(),
    sessionPolicy: { ttlHours: 12, rememberTtlDays: 30, idleMinutes: 120, touchIntervalSeconds: 300 },
    unitOfWork: { run: (fn) => fn(repos) },
    mailer: createFakeMailer(),
    httpClient: createFakeHttpClient(),
    crypto: { hmacSha256Hex: (secret, data) => `hmac(${secret}|${data})` },
    logger: { info() {}, warn() {}, error() {} },
  })
}

/** Cria um usuário diretamente no store (atalho para arrange dos testes). */
function seedUser(deps, overrides) {
  const roleCode = (overrides && overrides.roleCode) || 'MEMBER'
  const role = deps.roleRepository.findByCode(roleCode)
  const data = Object.assign(
    { name: 'Ana', email: `ana${++seq}@example.com`, password: 'senhaForte123', status: 'active', roleId: role.id },
    overrides,
  )
  delete data.roleCode
  return deps.userRepository.create(data)
}

module.exports = { createFakeDeps, seedUser }
