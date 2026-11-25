const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createDocSpaceService } = require('../../src/application/doc-spaces')
const { createDocPageService } = require('../../src/application/doc-pages')
const { createDocNoticeService } = require('../../src/application/doc-notices')
const { createNotificationService } = require('../../src/application/notifications')
const { renderNotificationEmail } = require('../../src/domain/email')
const { createPrincipal } = require('../../src/domain/rbac')

async function ctxOf(deps, user) {
  const role = await deps.roleRepository.findById(user.roleId)
  return {
    principal: createPrincipal({ userId: user.id, roleId: role.id, roleCode: role.code, permissions: await deps.roleRepository.getPermissionCodes(role.id) }),
    ip: '1.1.1.1',
    userAgent: 'ua',
    correlationId: 'c',
  }
}

async function codeOf(fn) {
  try {
    await fn()
  } catch (err) {
    return err.code === 'VALIDATION_ERROR' ? `${err.code}:${JSON.stringify(err.details.fields)}` : err.code
  }
  return 'OK'
}

const doc = (value) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] })

async function setup() {
  const deps = createFakeDeps()
  const gabi = await seedUser(deps, { roleCode: 'MANAGER', name: 'Gabi' })
  const mario = await seedUser(deps, { roleCode: 'MEMBER', name: 'Mário' })
  const lia = await seedUser(deps, { roleCode: 'VIEWER', name: 'Lia' })
  const otto = await seedUser(deps, { roleCode: 'MEMBER', name: 'Otto' })
  const project = await deps.projectRepository.create({ name: 'CRM', key: 'CRM', ownerId: gabi.id, devLeadId: mario.id, createdBy: gabi.id, status: 'active', priority: 'medium' })
  for (const [u, role] of [
    [gabi, 'manager'],
    [mario, 'member'],
    [lia, 'viewer'],
  ]) {
    await deps.projectMemberRepository.add({ projectId: project.id, userId: u.id, role })
  }
  const ctx = { gabi: await ctxOf(deps, gabi), mario: await ctxOf(deps, mario), lia: await ctxOf(deps, lia), otto: await ctxOf(deps, otto) }
  const spaces = createDocSpaceService(deps)
  const pages = createDocPageService(deps)
  const space = await spaces.createSpace(ctx.gabi, { key: 'CRMDOC', name: 'Docs do CRM', project_id: project.id, visibility: 'project' })
  const draft = await pages.createPage(ctx.gabi, space.id, { title: 'Tabela de custos' })
  const page = await pages.publishPage(ctx.gabi, draft.id, { title: 'Tabela de custos', content: doc('Matriz produto × safra') })
  return { deps, ctx, users: { gabi, mario, lia, otto }, project, space, page, pages, notices: createDocNoticeService(deps), notifications: createNotificationService(deps) }
}

describe('application/doc-notices — avisar sobre uma página (§47)', () => {
  it('candidatos: só quem lê a página, sem quem avisa; o responsável de Desenvolvimento vem primeiro e sugerido', async () => {
    const s = await setup()
    const items = await s.notices.listCandidates(s.ctx.gabi, s.page.id)
    assert.deepEqual(
      items.map((u) => [u.name, u.suggested]),
      [
        ['Mário', true],
        ['Lia', false],
      ],
    )
    // quem só lê não avisa
    assert.equal(await codeOf(() => s.notices.listCandidates(s.ctx.lia, s.page.id)), 'FORBIDDEN')
    // fora do projeto: a página nem existe
    assert.equal(await codeOf(() => s.notices.listCandidates(s.ctx.otto, s.page.id)), 'DOC_PAGE_NOT_FOUND')
  })

  it('avisa: notificação doc_shared com a página e o "O que olhar", histórico e o aviso sem abrir', async () => {
    const s = await setup()
    const result = await s.notices.notify(s.ctx.gabi, s.page.id, { user_ids: [s.users.mario.id, s.users.mario.id], note: '  Veja a matriz  ' })
    assert.equal(result.notified, 1)
    assert.deepEqual(
      result.notices.map((n) => [n.user.name, n.actor.name, n.note, n.opened_at]),
      [['Mário', 'Gabi', 'Veja a matriz', null]],
    )
    const sent = s.deps.store.notifications.filter((n) => n.type === 'doc_shared')
    assert.equal(sent.length, 1)
    assert.equal(sent[0].userId, s.users.mario.id)
    assert.equal(sent[0].docPageId, s.page.id)
    assert.deepEqual(sent[0].data, { title: 'Tabela de custos', space_key: 'CRMDOC', space: 'Docs do CRM', project: 'CRM', note: 'Veja a matriz' })
    const audit = s.deps.store.audit.find((e) => e.action === 'doc_page.notified')
    assert.deepEqual(audit.newValue, { user_ids: [s.users.mario.id], with_note: true })

    // no sino do Mário: a página, com o projeto e o "O que olhar"
    const inbox = await s.notifications.listNotifications(s.ctx.mario, {})
    assert.deepEqual(inbox.items[0].doc_page, { id: s.page.id, space_key: 'CRMDOC', space_name: 'Docs do CRM', title: 'Tabela de custos', project_name: 'CRM' })
    assert.deepEqual(inbox.items[0].data, { note: 'Veja a matriz' })
    assert.equal(inbox.items[0].task, null)
  })

  it('recusa quem não lê a página, quem só lê, página em rascunho e "O que olhar" longo demais', async () => {
    const s = await setup()
    assert.equal(await codeOf(() => s.notices.notify(s.ctx.gabi, s.page.id, { user_ids: [s.users.otto.id] })), 'VALIDATION_ERROR:{"user_ids":"no_access"}')
    assert.equal(await codeOf(() => s.notices.notify(s.ctx.gabi, s.page.id, { user_ids: [] })), 'VALIDATION_ERROR:{"user_ids":"invalid_type"}')
    assert.equal(await codeOf(() => s.notices.notify(s.ctx.gabi, s.page.id, { user_ids: [s.users.mario.id], note: 'x'.repeat(501) })), 'VALIDATION_ERROR:{"note":"too_long"}')
    assert.equal(await codeOf(() => s.notices.notify(s.ctx.lia, s.page.id, { user_ids: [s.users.mario.id] })), 'FORBIDDEN')
    const draft = await s.pages.createPage(s.ctx.gabi, s.space.id, { title: 'Rascunho' })
    assert.equal(await codeOf(() => s.notices.notify(s.ctx.gabi, draft.id, { user_ids: [s.users.mario.id] })), 'DOC_PAGE_NOT_PUBLISHED')
    assert.equal(s.deps.store.notifications.length, 0)
  })

  it('quem foi avisado abre a página: o aviso fica aberto e a notificação, lida; quem avisa vê quando', async () => {
    const s = await setup()
    await s.notices.notify(s.ctx.gabi, s.page.id, { user_ids: [s.users.mario.id, s.users.lia.id] })
    // quem avisa abrindo a página não marca nada
    await s.pages.getPage(s.ctx.gabi, s.page.id)
    assert.ok((await s.notices.listNotices(s.ctx.gabi, s.page.id)).every((n) => n.opened_at === null))

    await s.pages.getPage(s.ctx.mario, s.page.id)
    const list = await s.notices.listNotices(s.ctx.gabi, s.page.id)
    const byName = Object.fromEntries(list.map((n) => [n.user.name, n.opened_at]))
    assert.ok(byName['Mário'])
    assert.equal(byName['Lia'], null)
    assert.equal((await s.notifications.unreadCount(s.ctx.mario)).count, 0)
    assert.equal((await s.notifications.unreadCount(s.ctx.lia)).count, 1)
    // só quem edita vê a lista de avisos
    assert.equal(await codeOf(() => s.notices.listNotices(s.ctx.lia, s.page.id)), 'FORBIDDEN')

    // novo aviso depois de aberto: volta a "não abriu" para essa pessoa (o mais recente vale)
    await s.notices.notify(s.ctx.gabi, s.page.id, { user_ids: [s.users.mario.id], note: 'Mudou a seção 2' })
    const again = (await s.notices.listNotices(s.ctx.gabi, s.page.id)).find((n) => n.user.name === 'Mário')
    assert.deepEqual([again.note, again.opened_at], ['Mudou a seção 2', null])
  })

  it('e-mail do aviso: assunto com o projeto, "O que olhar" e botão para a página', () => {
    const message = renderNotificationEmail(
      { type: 'doc_shared', docPageId: 'pg1', projectId: 'p1', data: { title: 'Tabla de costos', space_key: 'TDC', project: 'DRE SOMAX PARAGUAY', note: 'Mira la página 2' } },
      { locale: 'es', actorName: 'Angelica Davalos', platform: 'Avanza', appUrl: 'https://avanza.example' },
    )
    assert.equal(message.subject, 'Documentación en Avanza | DRE SOMAX PARAGUAY')
    assert.match(message.text, /Angelica Davalos te pidió que mires una página de la documentación\./)
    assert.match(message.text, /Qué mirar: Mira la página 2/)
    assert.match(message.text, /Ver página: https:\/\/avanza\.example\/docs\/TDC\/pg1/)
  })
})
