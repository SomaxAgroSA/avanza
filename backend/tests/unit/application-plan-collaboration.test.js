/**
 * Quadro do projeto — GP-3: painel do elemento (atualizações com respostas e @menções, arquivos,
 * histórico e contadores da linha).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createPlanService } = require('../../src/application/plan')
const { createPlanCollaborationService } = require('../../src/application/plan-collaboration')
const { createNotificationService } = require('../../src/application/notifications')
const { createAuditService } = require('../../src/application/audit-logs')
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

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

async function setup() {
  const deps = createFakeDeps()
  deps.locale = 'pt-BR'
  const gabi = await seedUser(deps, { roleCode: 'MANAGER', name: 'Gabi' })
  const mario = await seedUser(deps, { roleCode: 'MEMBER', name: 'Mário' })
  const lia = await seedUser(deps, { roleCode: 'MEMBER', name: 'Lia' })
  const otto = await seedUser(deps, { roleCode: 'MEMBER', name: 'Otto' })
  const project = await deps.projectRepository.create({ name: 'Clover 6', key: 'CLV', ownerId: gabi.id, createdBy: gabi.id, status: 'active', priority: 'medium' })
  for (const [u, role] of [
    [gabi, 'manager'],
    [mario, 'member'],
    [lia, 'viewer'],
  ]) {
    await deps.projectMemberRepository.add({ projectId: project.id, userId: u.id, role })
  }
  const ctx = { gabi: await ctxOf(deps, gabi), mario: await ctxOf(deps, mario), lia: await ctxOf(deps, lia), otto: await ctxOf(deps, otto) }
  const plan = createPlanService(deps)
  const collab = createPlanCollaborationService(deps)
  const group = await plan.createGroup(ctx.gabi, project.id, { name: 'Iniciação', color: 'blue' })
  const item = await plan.createItem(ctx.mario, project.id, { group_id: group.id, name: 'Reunião de kickoff' })
  const inbox = async (who) => (await createNotificationService(deps).listNotifications(ctx[who], {})).items
  const actions = (action) => deps.store.audit.filter((a) => a.action === action)
  return { deps, ctx, users: { gabi, mario, lia, otto }, project, plan, collab, item, inbox, actions }
}

describe('application/plan-collaboration — atualizações', () => {
  it('publica com @menção (notifica), responde (notifica o autor), conversa em ordem; leitor também publica', async () => {
    const s = await setup()
    const content = `Pauta pronta, @[Lia](${s.users.lia.id}) confira`
    const first = await s.collab.createUpdate(s.ctx.mario, s.item.id, { content })
    assert.equal(first.author.name, 'Mário')
    assert.deepEqual(first.mentions.map((m) => m.name), ['Lia'])
    assert.deepEqual(first.capabilities, { edit: true, delete: true, reply: true })
    const reply = await s.collab.createUpdate(s.ctx.lia, s.item.id, { content: 'Vi, obrigada!', parent_id: first.id })
    assert.equal(reply.parent_id, first.id)
    await s.collab.createUpdate(s.ctx.gabi, s.item.id, { content: 'Segunda atualização' })

    const view = await s.collab.listUpdates(s.ctx.lia, s.item.id)
    assert.deepEqual(view.capabilities, { post: true })
    assert.deepEqual(view.updates.map((u) => u.content), ['Segunda atualização', content])
    assert.deepEqual(view.updates[1].replies.map((r) => r.content), ['Vi, obrigada!'])

    const lia = await s.inbox('lia')
    assert.equal(lia[0].type, 'plan_mention')
    assert.deepEqual(lia[0].plan_item, { id: s.item.id, project_id: s.project.id, name: 'Reunião de kickoff', project_name: 'Clover 6' })
    assert.equal(lia[0].task, null)
    assert.equal((await s.inbox('mario'))[0].type, 'plan_reply')
    assert.equal(s.actions('plan_item.update_added').length, 3)

    // não responde resposta; não menciona quem não é do projeto; quem não é do projeto não vê
    assert.equal(await codeOf(() => s.collab.createUpdate(s.ctx.mario, s.item.id, { content: 'x', parent_id: reply.id })), 'VALIDATION_ERROR:{"parent_id":"invalid_option"}')
    assert.equal(await codeOf(() => s.collab.createUpdate(s.ctx.mario, s.item.id, { content: `@[Otto](${s.users.otto.id})` })), 'VALIDATION_ERROR:{"content":"invalid_mention"}')
    assert.equal(await codeOf(() => s.collab.createUpdate(s.ctx.mario, s.item.id, { content: '  ' })), 'VALIDATION_ERROR:{"content":"required"}')
    assert.equal(await codeOf(() => s.collab.listUpdates(s.ctx.otto, s.item.id)), 'PLAN_ITEM_NOT_FOUND')
  })

  it('autor edita (menção nova notifica); autor ou gestor exclui (fica "removida"); contador no quadro', async () => {
    const s = await setup()
    const up = await s.collab.createUpdate(s.ctx.mario, s.item.id, { content: 'Primeira' })
    await s.collab.createUpdate(s.ctx.mario, s.item.id, { content: 'Resposta', parent_id: up.id })
    assert.equal(await codeOf(() => s.collab.editUpdate(s.ctx.lia, up.id, { content: 'Não' })), 'FORBIDDEN')
    const edited = await s.collab.editUpdate(s.ctx.mario, up.id, { content: `Primeira @[Gabi](${s.users.gabi.id})` })
    assert.ok(edited.edited_at)
    assert.equal((await s.inbox('gabi'))[0].type, 'plan_mention')
    assert.equal((await s.plan.getPlan(s.ctx.gabi, s.project.id)).items.find((i) => i.id === s.item.id).updates, 2)

    assert.equal(await codeOf(() => s.collab.deleteUpdate(s.ctx.lia, up.id)), 'FORBIDDEN')
    await s.collab.deleteUpdate(s.ctx.gabi, up.id)
    const [thread] = (await s.collab.listUpdates(s.ctx.mario, s.item.id)).updates
    assert.equal(thread.deleted, true)
    assert.equal(thread.content, '')
    assert.equal(thread.replies.length, 1)
    assert.equal((await s.plan.getPlan(s.ctx.gabi, s.project.id)).items.find((i) => i.id === s.item.id).updates, 1)
    assert.equal(s.actions('plan_item.update_deleted').length, 1)
  })

  it('projeto arquivado: só leitura', async () => {
    const s = await setup()
    await s.deps.projectRepository.update(s.project.id, { archivedAt: new Date() })
    assert.deepEqual((await s.collab.listUpdates(s.ctx.mario, s.item.id)).capabilities, { post: false })
    assert.equal(await codeOf(() => s.collab.createUpdate(s.ctx.mario, s.item.id, { content: 'x' })), 'PROJECT_ARCHIVED')
  })
})

const png = (name) => ({ name, size: 1200, head: PNG, handle: {} })

describe('application/plan-collaboration — imagens e arquivos nas atualizações', () => {
  it('cola a imagem junto do texto (ou só a imagem); tudo ou nada; leitor anexa na sua; contador, download e histórico', async () => {
    const s = await setup()
    const up = await s.collab.createUpdate(s.ctx.lia, s.item.id, { content: '  ' }, [png('print.png')])
    assert.equal(up.content, '')
    assert.equal(up.files.length, 1)
    assert.equal(up.files[0].kind, 'image')
    assert.equal(up.files[0].update_id, up.id)
    assert.equal(up.files[0].url, `/api/v1/plan/files/${up.files[0].id}/file`)
    assert.deepEqual(up.files[0].capabilities, { delete: true })
    assert.deepEqual(s.actions('plan_item.update_added')[0].newValue, { files: 'print.png' })

    // tipo decidido pelo conteúdo; com erro nada é gravado
    const before = s.deps.store.planUpdates.length
    assert.equal(await codeOf(() => s.collab.createUpdate(s.ctx.mario, s.item.id, { content: 'Ata' }, [png('ok.png'), { name: 'x.png', size: 10, head: [1, 2, 3], handle: {} }])), 'VALIDATION_ERROR:{"files":"type_mismatch"}')
    assert.equal(s.deps.store.planUpdates.length, before)
    assert.equal(s.deps.store.planFiles.length, 1)
    assert.equal(await codeOf(() => s.collab.createUpdate(s.ctx.mario, s.item.id, { content: '' }, [])), 'VALIDATION_ERROR:{"content":"required"}')
    assert.equal(await codeOf(() => s.collab.createUpdate(s.ctx.mario, s.item.id, { content: 'x' }, Array.from({ length: 11 }, (_, i) => png(`${i}.png`)))), 'VALIDATION_ERROR:{"files":"too_many"}')

    const [thread] = (await s.collab.listUpdates(s.ctx.mario, s.item.id)).updates
    assert.deepEqual(thread.files.map((f) => f.name), ['print.png'])
    assert.deepEqual(thread.files[0].capabilities, { delete: false })
    assert.deepEqual((await s.collab.listUpdates(s.ctx.gabi, s.item.id)).updates[0].files[0].capabilities, { delete: true })
    assert.equal((await s.plan.getPlan(s.ctx.gabi, s.project.id)).items[0].files, 1)
    assert.equal((await s.collab.fileFor(s.ctx.mario, up.files[0].id)).name, 'print.png')
    assert.equal(await codeOf(() => s.collab.fileFor(s.ctx.otto, up.files[0].id)), 'PLAN_FILE_NOT_FOUND')
  })

  it('autor anexa depois; autor ou gestor exclui o arquivo; excluir a atualização apaga os arquivos dela; editar pode deixar só a imagem', async () => {
    const s = await setup()
    const up = await s.collab.createUpdate(s.ctx.mario, s.item.id, { content: 'Ata' })
    assert.equal(await codeOf(() => s.collab.addFiles(s.ctx.lia, up.id, [png('a.png')])), 'FORBIDDEN')
    const [file] = await s.collab.addFiles(s.ctx.mario, up.id, [png('quadro.png')])
    assert.equal(file.update_id, up.id)
    assert.deepEqual(s.actions('plan_item.file_added')[0].newValue, { files: 'quadro.png' })
    assert.equal(await codeOf(() => s.collab.deleteFile(s.ctx.lia, file.id)), 'FORBIDDEN')
    await s.collab.deleteFile(s.ctx.gabi, file.id)
    assert.equal(s.actions('plan_item.file_deleted').length, 1)

    await s.collab.addFiles(s.ctx.mario, up.id, [png('b.png')])
    await s.collab.deleteUpdate(s.ctx.mario, up.id)
    assert.equal(s.deps.store.planFiles.length, 0)
    assert.deepEqual(s.actions('plan_item.update_deleted')[0].oldValue, { update: 'Ata', files: 'b.png' })
    assert.equal(await codeOf(() => s.collab.addFiles(s.ctx.mario, up.id, [png('c.png')])), 'FORBIDDEN')

    const withImage = await s.collab.createUpdate(s.ctx.mario, s.item.id, { content: 'Texto' }, [png('d.png')])
    assert.equal((await s.collab.editUpdate(s.ctx.mario, withImage.id, { content: '' })).content, '')
    const plain = await s.collab.createUpdate(s.ctx.mario, s.item.id, { content: 'Só texto' })
    assert.equal(await codeOf(() => s.collab.editUpdate(s.ctx.mario, plain.id, { content: '' })), 'VALIDATION_ERROR:{"content":"required"}')

    await s.deps.projectRepository.update(s.project.id, { archivedAt: new Date() })
    assert.equal(await codeOf(() => s.collab.addFiles(s.ctx.mario, plain.id, [png('e.png')])), 'PROJECT_ARCHIVED')
  })

  it('histórico do elemento: quem vê o quadro; quem não é do projeto não', async () => {
    const s = await setup()
    await s.plan.updateItem(s.ctx.mario, s.item.id, { estimated_hours: 2 })
    const audit = createAuditService(s.deps)
    const page = await audit.listEntityHistory(s.ctx.lia, 'plan_item', s.item.id, {})
    assert.deepEqual(page.items.map((e) => e.action).sort(), ['plan_item.created', 'plan_item.updated'])
    assert.equal(await codeOf(() => audit.listEntityHistory(s.ctx.otto, 'plan_item', s.item.id, {})), 'PLAN_ITEM_NOT_FOUND')
  })
})
