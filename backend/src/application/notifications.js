/**
 * Notificações internas: geração (usada pelos casos de uso de tarefas, comentários e atualizações do
 * quadro, dentro da mesma transação), caixa de entrada do usuário e lembretes diários de prazo.
 *
 * Só recebe quem continua com acesso ao projeto e está ativo; o autor da ação nunca é notificado.
 * Os dados exibidos (código e título da tarefa, trecho do comentário, status) são guardados na
 * notificação — a lista não depende de consultar cada tarefa.
 */

const { appError } = require('../core/errors')
const { parsePagination, buildPageMeta } = require('../core/pagination')
const rbac = require('../domain/rbac')
const workflow = require('../domain/workflow')
const notificationDomain = require('../domain/notification')
const { iso, toUserSummary } = require('./presenters')
const emailDomain = require('../domain/email')
const { emailContext } = require('./email')

/** Gera notificações; `repos` é o conjunto de repositórios da transação atual. */
function createNotifier(deps) {
  async function hasAccess(project, userId) {
    return project.ownerId === userId || !!(await deps.projectMemberRepository.find(project.id, userId))
  }

  /**
   * `event`: { task, project, actorId, entries: [{ userId, type }], data?, dedupeKey?(userId, type) }.
   * Retorna quantas notificações foram criadas.
   */
  /** Cria uma notificação por destinatário válido (`target` = campos do alvo: tarefa ou elemento do quadro). */
  async function deliver(repos, event, target, baseData) {
    const list = notificationDomain.recipients(event.entries, event.actorId)
    if (list.length === 0) return 0
    const users = {}
    ;(await deps.userRepository.findManyByIds(list.map((r) => r.userId))).forEach((u) => {
      users[u.id] = u
    })
    const mail = await emailContext(deps)
    const actor = mail && event.actorId ? await deps.userRepository.findById(event.actorId) : null
    let created = 0
    for (const recipient of list) {
      const user = users[recipient.userId]
      if (!user || user.status !== 'active' || !(await hasAccess(event.project, user.id))) continue
      const dedupeKey = event.dedupeKey ? event.dedupeKey(recipient.type) : ''
      if (dedupeKey && (await repos.notificationRepository.existsKey(user.id, dedupeKey))) continue
      const notification = Object.assign({ userId: user.id, type: recipient.type, actorId: event.actorId || null, data: Object.assign({}, baseData, event.data || {}), dedupeKey }, target)
      await repos.notificationRepository.create(notification)
      if (mail && user.emailNotifications !== false && user.email) {
        const message = emailDomain.renderNotificationEmail(notification, { locale: user.locale, actorName: actor ? actor.name : null, platform: mail.platform, appUrl: mail.appUrl })
        await repos.emailOutboxRepository.enqueue({ to: user.email, kind: 'notification', subject: message.subject, html: message.html, text: message.text })
      }
      created++
    }
    return created
  }

  async function notify(repos, event) {
    return deliver(repos, event, { taskId: event.task.id }, { code: event.task.code, title: event.task.title })
  }

  /** Elemento do quadro (GP-3): `event.item` no lugar de `event.task`. */
  async function notifyItem(repos, event) {
    return deliver(repos, event, { planItemId: event.item.id, projectId: event.project.id }, { name: event.item.name, project: event.project.name })
  }

  return { notify, notifyItem }
}

function createNotificationService(deps) {
  const notifications = deps.notificationRepository
  const notifier = createNotifier(deps)

  function present(item, actors) {
    const data = item.data || {}
    const actor = item.actorId ? actors[item.actorId] : null
    const extra = {}
    Object.keys(data).forEach((key) => {
      if (['code', 'title', 'name', 'project'].indexOf(key) < 0) extra[key] = data[key]
    })
    return {
      id: item.id,
      type: item.type,
      task: item.taskId ? { id: item.taskId, code: data.code || '', title: data.title || '' } : null,
      plan_item: item.planItemId ? { id: item.planItemId, project_id: item.projectId || null, name: data.name || '', project_name: data.project || '' } : null,
      actor: actor ? toUserSummary(actor) : null,
      data: extra,
      read: !!item.readAt,
      created_at: iso(item.createdAt),
    }
  }

  async function listNotifications(ctx, query) {
    rbac.assertAuthenticated(ctx.principal)
    const q = query || {}
    const pagination = parsePagination(q, { defaultPerPage: 20, maxPerPage: 50 })
    const result = await notifications.listByUser(ctx.principal.userId, { unreadOnly: q.unread === '1', pagination })
    const actorIds = result.items.map((n) => n.actorId).filter((id, i, all) => id && all.indexOf(id) === i)
    const actors = {}
    if (actorIds.length > 0) {
      ;(await deps.userRepository.findManyByIds(actorIds)).forEach((u) => {
        actors[u.id] = u
      })
    }
    return { items: result.items.map((n) => present(n, actors)), meta: buildPageMeta(pagination, result.total) }
  }

  async function unreadCount(ctx) {
    rbac.assertAuthenticated(ctx.principal)
    return { count: await notifications.countUnread(ctx.principal.userId) }
  }

  async function markRead(ctx, id) {
    rbac.assertAuthenticated(ctx.principal)
    const item = id ? await notifications.findById(id) : null
    // de outra pessoa = inexistente (não revela)
    if (!item || item.userId !== ctx.principal.userId) throw appError('NOTIFICATION_NOT_FOUND')
    if (!item.readAt) await notifications.markRead(item.id, deps.clock.now())
    return { read: true }
  }

  async function markAllRead(ctx) {
    rbac.assertAuthenticated(ctx.principal)
    return { updated: await notifications.markAllRead(ctx.principal.userId, deps.clock.now()) }
  }

  /** Rotina diária: prazo amanhã e prazo vencido, uma vez por tarefa e prazo (chave de deduplicação). */
  async function sendDueReminders(now) {
    const openStatusIds = (await deps.statusRepository.list({ includeInactive: true }))
      .filter((s) => !workflow.isClosedCategory(s.category))
      .map((s) => s.id)
    if (openStatusIds.length === 0) return { created: 0 }
    const today = notificationDomain.dayKey(now)
    const until = new Date(new Date(`${today}T00:00:00Z`).getTime() + 2 * 86400000)
    const candidates = await deps.taskRepository.listForReminders({ before: until, statusIds: openStatusIds })
    const projects = {}
    let created = 0
    await deps.unitOfWork.run(async (repos) => {
      for (const task of candidates) {
        const type = notificationDomain.dueReminderType(task.dueDate, now)
        if (!type || !task.assigneeId) continue
        const project = projects[task.projectId] || (projects[task.projectId] = await deps.projectRepository.findById(task.projectId))
        if (!project || project.archivedAt) continue
        const due = notificationDomain.dayKey(task.dueDate)
        created += await notifier.notify(repos, {
          task,
          project,
          actorId: null,
          entries: [{ userId: task.assigneeId, type }],
          data: { due_date: due },
          dedupeKey: (kind) => `${kind}:${task.id}:${due}`,
        })
      }
    })
    return { created }
  }

  /** Dispara a rotina de lembretes agora (operação; settings.manage). */
  async function runDueRemindersNow(ctx) {
    rbac.assertCan(ctx.principal, 'settings.manage')
    return sendDueReminders(deps.clock.now())
  }

  return { listNotifications, unreadCount, markRead, markAllRead, sendDueReminders, runDueRemindersNow }
}

module.exports = { createNotifier, createNotificationService }
