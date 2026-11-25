/**
 * Avisar sobre uma página da Documentação (regras de negócio §47, ADR-060).
 *
 * - Quem edita a página (e só página publicada) escolhe quem deve olhá-la, com um "O que olhar" opcional.
 *   Cada pessoa recebe uma notificação `doc_shared` (sino + e-mail, se ela recebe e-mails).
 * - Só entram pessoas ativas que leem a página (`docs.view` + visibilidade do espaço, domain/docs.js):
 *   ninguém recebe um link que não abre. Quem avisa não entra na lista.
 * - Sugestão: o responsável de Desenvolvimento do projeto do espaço (`dev_lead_id`) vem marcado.
 * - Quando a pessoa abre a página, o aviso fica "aberto em" e a notificação dela vira lida
 *   (`markOpened`, chamado por doc-pages ao ler a página). Quem edita vê, na página, quem foi avisado e
 *   quando abriu.
 * - Auditoria: doc_page.notified (ids das pessoas e se houve "O que olhar").
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const rbac = require('../domain/rbac')
const docsDomain = require('../domain/docs')
const projectDomain = require('../domain/project')
const { buildAuditEntry } = require('./audit')
const { iso, toUserSummary } = require('./presenters')
const { createDocAccess } = require('./doc-access')
const { createNotifier } = require('./notifications')

const idPattern = /^[A-Za-z0-9_]{1,64}$/
const NOTIFY_RULES = {
  user_ids: [
    rules.required(),
    rules.custom((value) =>
      Array.isArray(value) && value.length > 0 && value.length <= docsDomain.MAX_NOTICE_RECIPIENTS && value.every((id) => typeof id === 'string' && idPattern.test(id))
        ? null
        : 'invalid_type',
    ),
  ],
  note: [rules.string(), rules.maxLength(docsDomain.NOTICE_NOTE_MAX)],
}

function createDocNoticeService(deps) {
  const access = createDocAccess(deps)
  const notifier = createNotifier(deps)

  async function notifiablePage(ctx, pageId) {
    const loaded = await access.loadPage(ctx, pageId)
    if (!loaded.access.canEdit) throw appError('FORBIDDEN')
    if (!docsDomain.canNotifyPage(loaded.access, loaded.page)) throw appError('DOC_PAGE_NOT_PUBLISHED')
    return loaded
  }

  async function projectOf(space) {
    return space.projectId ? deps.projectRepository.findById(space.projectId) : null
  }

  /** Pessoas ativas (fora quem avisa) que leem a página, com o projeto do espaço. */
  async function readers(ctx, loaded) {
    const project = await projectOf(loaded.space)
    const users = await deps.userRepository.searchActive({ search: '', excludeIds: [ctx.principal.userId] })
    const members = new Map()
    if (project) (await deps.projectMemberRepository.listByProject(project.id)).forEach((m) => members.set(m.userId, m))
    const principals = new Map()
    async function principalOf(user) {
      if (!principals.has(user.roleId)) {
        const role = await deps.roleRepository.findById(user.roleId)
        principals.set(user.roleId, role ? { role, permissions: await deps.roleRepository.getPermissionCodes(role.id) } : null)
      }
      const found = principals.get(user.roleId)
      return found ? rbac.createPrincipal({ userId: user.id, roleId: found.role.id, roleCode: found.role.code, permissions: found.permissions }) : null
    }
    const result = []
    for (const user of users) {
      const principal = await principalOf(user)
      if (!principal) continue
      const projectAccess = project ? projectDomain.resolveAccess(principal, project, members.get(user.id) || null) : null
      const spaceAccess = docsDomain.spaceAccess(principal, loaded.space, projectAccess)
      if (docsDomain.canSeePage(spaceAccess, loaded.page)) result.push(user)
    }
    return { project, users: result }
  }

  /** Quem pode ser avisado; o responsável de Desenvolvimento do projeto vem primeiro e sugerido. */
  async function listCandidates(ctx, pageId) {
    const loaded = await notifiablePage(ctx, pageId)
    const { project, users } = await readers(ctx, loaded)
    const devLeadId = project ? project.devLeadId : null
    const items = users.map((user) => Object.assign(toUserSummary(user), { suggested: !!devLeadId && user.id === devLeadId }))
    items.sort((a, b) => Number(b.suggested) - Number(a.suggested))
    return items
  }

  async function presentNotices(pageId) {
    const notices = docsDomain.latestNoticePerUser(await deps.docPageNoticeRepository.listByPage(pageId))
    const ids = [...new Set(notices.flatMap((n) => [n.userId, n.actorId]).filter(Boolean))]
    const users = new Map((ids.length ? await deps.userRepository.findManyByIds(ids) : []).map((u) => [u.id, u]))
    return notices
      .filter((n) => users.has(n.userId))
      .map((n) => ({
        id: n.id,
        user: toUserSummary(users.get(n.userId)),
        actor: n.actorId && users.has(n.actorId) ? toUserSummary(users.get(n.actorId)) : null,
        note: n.note,
        created_at: iso(n.createdAt),
        opened_at: iso(n.openedAt),
      }))
  }

  /** Quem foi avisado sobre a página (o aviso mais recente de cada pessoa) e quando abriu — só quem edita. */
  async function listNotices(ctx, pageId) {
    const loaded = await access.loadPage(ctx, pageId)
    if (!loaded.access.canEdit) throw appError('FORBIDDEN')
    return presentNotices(loaded.page.id)
  }

  async function notify(ctx, pageId, input) {
    const loaded = await notifiablePage(ctx, pageId)
    const source = input || {}
    const data = assertValid({ user_ids: source.user_ids, note: source.note === undefined || source.note === null ? '' : source.note }, NOTIFY_RULES)
    const userIds = [...new Set(data.user_ids)]
    const note = String(data.note || '').trim()
    const { project, users } = await readers(ctx, loaded)
    const allowed = new Set(users.map((u) => u.id))
    if (!userIds.every((id) => allowed.has(id))) throw appError('VALIDATION_ERROR', undefined, { fields: { user_ids: 'no_access' } })
    await deps.unitOfWork.run(async (repos) => {
      for (const userId of userIds) {
        await repos.docPageNoticeRepository.create({ pageId: loaded.page.id, userId, actorId: ctx.principal.userId, note })
      }
      await notifier.notifyDocPage(repos, { page: loaded.page, space: loaded.space, project, actorId: ctx.principal.userId, userIds, note })
      await repos.auditRepository.record(
        buildAuditEntry(ctx, { entityType: 'doc_page', entityId: loaded.page.id, action: 'doc_page.notified', oldValue: null, newValue: { user_ids: userIds, with_note: !!note } }),
      )
    })
    return { notified: userIds.length, notices: await presentNotices(loaded.page.id) }
  }

  /** A pessoa abriu a página: os avisos dela ficam abertos e as notificações sobre a página, lidas. */
  async function markOpened(ctx, page) {
    if (!ctx || !ctx.principal || !ctx.principal.userId || !page || page.status !== 'published') return
    const now = deps.clock.now()
    const opened = await deps.docPageNoticeRepository.markOpened(page.id, ctx.principal.userId, now)
    if (opened > 0) await deps.notificationRepository.markReadByDocPage(ctx.principal.userId, page.id, now)
  }

  return { listCandidates, listNotices, notify, markOpened }
}

module.exports = { createDocNoticeService }
