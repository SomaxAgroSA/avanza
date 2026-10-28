const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createTaskService } = require('../../src/application/tasks')
const { createTagService } = require('../../src/application/tags')
const { createCommentService } = require('../../src/application/comments')
const { createTaskTypeService } = require('../../src/application/task-types')
const { createLookupService } = require('../../src/application/lookups')
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

async function setup() {
  const deps = createFakeDeps()
  const adminUser = await seedUser(deps, { roleCode: 'ADMIN', name: 'Admin' })
  const gabi = await seedUser(deps, { roleCode: 'MANAGER', name: 'Gabi' })
  const mario = await seedUser(deps, { roleCode: 'MEMBER', name: 'Mário' })
  const lia = await seedUser(deps, { roleCode: 'MEMBER', name: 'Lia' })
  const admin = await ctxOf(deps, adminUser)
  const project = await deps.projectRepository.create({ name: 'CRM', key: 'CRM', ownerId: gabi.id, createdBy: gabi.id, status: 'active', priority: 'medium' })
  await deps.projectMemberRepository.add({ projectId: project.id, userId: gabi.id, role: 'manager' })
  await deps.projectMemberRepository.add({ projectId: project.id, userId: mario.id, role: 'member' })
  await deps.projectMemberRepository.add({ projectId: project.id, userId: lia.id, role: 'viewer' })
  const type = await createTaskTypeService(deps).createType(admin, { key: 'DOC', name: 'Documentação' })
  await createLookupService(deps, 'status').create(admin, { key: 'TODO', name: 'A fazer', category: 'todo' })
  await createLookupService(deps, 'priority').create(admin, { key: 'MEDIA', name: 'Média' })
  const tasks = createTaskService(deps)
  const ctx = { admin, gabi: await ctxOf(deps, gabi), mario: await ctxOf(deps, mario), lia: await ctxOf(deps, lia) }
  const task = await tasks.createTask(ctx.mario, { project_id: project.id, task_type_id: type.id, title: 'Manual' })
  return { deps, tasks, tags: createTagService(deps), comments: createCommentService(deps), ctx, task, project, type }
}

describe('application/tags', () => {
  it('cadastro global com nome único (sem diferenciar maiúsculas/acentos) e só com settings.manage', async () => {
    const { tags, ctx, deps } = await setup()
    const urgent = await tags.createTag(ctx.admin, { name: 'Urgência', color: 'red' })
    assert.deepEqual([urgent.name, urgent.color], ['Urgência', 'red'])
    assert.equal(await codeOf(() => tags.createTag(ctx.admin, { name: 'URGENCIA' })), 'TAG_NAME_IN_USE')
    assert.equal(await codeOf(() => tags.createTag(ctx.mario, { name: 'Outra' })), 'FORBIDDEN')
    assert.deepEqual((await tags.listTags(ctx.mario)).map((t) => t.name), ['Urgência'])
    assert.equal(deps.store.audit.at(-1).action, 'tag.created')
  })

  it('renomear mantém unicidade; excluir remove das tarefas', async () => {
    const { tags, tasks, ctx, task } = await setup()
    const a = await tags.createTag(ctx.admin, { name: 'Front-end', color: 'blue' })
    const b = await tags.createTag(ctx.admin, { name: 'Back-end', color: 'green' })
    assert.equal(await codeOf(() => tags.updateTag(ctx.admin, b.id, { name: 'front-end' })), 'TAG_NAME_IN_USE')
    await tasks.updateTask(ctx.mario, task.id, { tag_ids: [a.id, b.id] })
    assert.equal((await tags.listTags(ctx.admin)).find((t) => t.id === a.id).task_count, 1)
    await tags.deleteTag(ctx.admin, a.id)
    assert.deepEqual((await tasks.getTask(ctx.mario, task.id)).tags.map((t) => t.name), ['Back-end'])
  })
})

describe('application/tasks — tags e checklist', () => {
  it('aplica tags, filtra por tag e registra no histórico pelos nomes', async () => {
    const { tags, tasks, ctx, task, deps } = await setup()
    const a = await tags.createTag(ctx.admin, { name: 'Cliente', color: 'violet' })
    const updated = await tasks.updateTask(ctx.mario, task.id, { tag_ids: [a.id] })
    assert.deepEqual(updated.tags, [{ id: a.id, name: 'Cliente', color: 'violet' }])
    assert.deepEqual((await tasks.listTasks(ctx.mario, { tag_id: a.id })).items.map((t) => t.code), ['CRM-1'])
    assert.deepEqual(deps.store.audit.at(-1).newValue, { tags: 'Cliente' })
    assert.equal(await codeOf(() => tasks.updateTask(ctx.mario, task.id, { tag_ids: ['nao_existe'] })), 'VALIDATION_ERROR:{"tag_ids":"invalid_option"}')
  })

  it('checklist: salva itens, mostra progresso e histórico legível', async () => {
    const { tasks, ctx, task, deps } = await setup()
    const updated = await tasks.updateTask(ctx.mario, task.id, { checklist: [{ text: 'Escrever' }, { text: 'Revisar', done: true }] })
    assert.deepEqual(updated.checklist.map((i) => [i.text, i.done]), [['Escrever', false], ['Revisar', true]])
    assert.ok(updated.checklist.every((i) => i.id))
    assert.deepEqual(updated.checklist_progress, { done: 1, total: 2 })
    assert.deepEqual(deps.store.audit.at(-1).newValue, { checklist: ['○ Escrever', '✓ Revisar'] })
    assert.equal(await codeOf(() => tasks.updateTask(ctx.mario, task.id, { checklist: [{ text: '' }] })), 'VALIDATION_ERROR:{"checklist":"item_text_required"}')
    // leitora comenta, mas não edita a tarefa (checklist faz parte da tarefa)
    assert.equal(await codeOf(() => tasks.updateTask(ctx.lia, task.id, { checklist: [] })), 'FORBIDDEN')
  })
})

describe('application/comments', () => {
  it('qualquer pessoa com acesso ao projeto comenta, inclusive leitora; histórico registra o comentário', async () => {
    const { comments, ctx, task, deps } = await setup()
    const c = await comments.createComment(ctx.mario, task.id, { content: '  Precisa de **revisão**  ' })
    assert.equal(c.content, 'Precisa de **revisão**')
    assert.equal(c.author.name, 'Mário')
    assert.deepEqual(c.capabilities, { edit: true, delete: true })
    const byViewer = await comments.createComment(ctx.lia, task.id, { content: 'Posso ajudar a testar' })
    assert.equal(byViewer.author.name, 'Lia')
    assert.equal(await codeOf(() => comments.createComment(ctx.mario, task.id, { content: ' ' })), 'VALIDATION_ERROR:{"content":"required"}')
    const audit = deps.store.audit.at(-1)
    assert.equal(audit.action, 'comment.added')
    assert.equal(audit.entityType, 'task')
    assert.equal(audit.entityId, task.id)
    assert.deepEqual(audit.newValue, { comment: 'Posso ajudar a testar' })
    // cada um só edita o que escreveu
    assert.deepEqual((await comments.listComments(ctx.lia, task.id)).map((x) => x.capabilities.edit), [false, true])
  })

  it('menções com @: só pessoas com acesso ao projeto; nomes no comentário e no histórico', async () => {
    const { comments, ctx, task, deps } = await setup()
    const gabi = deps.store.users.find((u) => u.name === 'Gabi')
    const lia = deps.store.users.find((u) => u.name === 'Lia')
    const c = await comments.createComment(ctx.mario, task.id, { content: `@[Gabi](${gabi.id}) e @[Lia](${lia.id}), podem revisar?` })
    assert.deepEqual(c.mentions.map((m) => m.name), ['Gabi', 'Lia'])
    const audit = deps.store.audit.at(-1)
    assert.deepEqual(audit.newValue, { comment: '@Gabi e @Lia, podem revisar?', mentions: 'Gabi, Lia' })

    const outsider = await seedUser(deps, { roleCode: 'MEMBER', name: 'Otto' })
    assert.equal(
      await codeOf(() => comments.createComment(ctx.mario, task.id, { content: `oi @[Otto](${outsider.id})` })),
      'VALIDATION_ERROR:{"content":"invalid_mention"}',
    )
    // editar e acrescentar uma menção registra quem foi marcado
    await comments.updateComment(ctx.mario, c.id, { content: `@[Gabi](${gabi.id}) pode revisar?` })
    assert.deepEqual(deps.store.audit.at(-1).newValue, { comment: '@Gabi pode revisar?', mentions: 'Gabi' })
  })

  it('lista de quem pode ser mencionado: pessoas ativas com acesso ao projeto', async () => {
    const { comments, ctx, task } = await setup()
    assert.deepEqual((await comments.mentionCandidates(ctx.lia, task.id)).map((u) => u.name).sort(), ['Gabi', 'Lia', 'Mário'])
  })

  it('só o autor edita; autor ou gestor exclui (exclusão lógica)', async () => {
    const { comments, ctx, task } = await setup()
    const c = await comments.createComment(ctx.mario, task.id, { content: 'Primeira versão' })
    assert.equal(await codeOf(() => comments.updateComment(ctx.gabi, c.id, { content: 'x' })), 'FORBIDDEN')
    const edited = await comments.updateComment(ctx.mario, c.id, { content: 'Versão final' })
    assert.equal(edited.content, 'Versão final')
    assert.ok(edited.edited_at)
    assert.deepEqual(await comments.deleteComment(ctx.gabi, c.id), { deleted: true })
    const [shown] = await comments.listComments(ctx.mario, task.id)
    assert.deepEqual([shown.deleted, shown.content, shown.capabilities.edit], [true, '', false])
    assert.equal(await codeOf(() => comments.updateComment(ctx.mario, c.id, { content: 'volta' })), 'COMMENT_NOT_FOUND')
  })

  it('conta comentários na tarefa e esconde de quem não vê o projeto', async () => {
    const { comments, tasks, ctx, task, deps } = await setup()
    await comments.createComment(ctx.mario, task.id, { content: 'a' })
    const deleted = await comments.createComment(ctx.mario, task.id, { content: 'b' })
    await comments.deleteComment(ctx.mario, deleted.id)
    assert.equal((await tasks.listTasks(ctx.mario, {})).items[0].comment_count, 1)
    const outsider = await ctxOf(deps, await seedUser(deps, { roleCode: 'MEMBER', name: 'Otto' }))
    assert.equal(await codeOf(() => comments.listComments(outsider, task.id)), 'TASK_NOT_FOUND')
  })
})
