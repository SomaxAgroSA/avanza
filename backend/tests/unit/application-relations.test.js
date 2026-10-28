const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createTaskService } = require('../../src/application/tasks')
const { createRelationService } = require('../../src/application/relations')
const { createLookupService } = require('../../src/application/lookups')
const { createTaskTypeService } = require('../../src/application/task-types')
const { createCustomFieldService } = require('../../src/application/custom-fields')
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
  const other = await deps.projectRepository.create({ name: 'ERP', key: 'ERP', ownerId: gabi.id, createdBy: gabi.id, status: 'active', priority: 'medium' })
  for (const [u, role] of [
    [gabi, 'manager'],
    [mario, 'member'],
    [lia, 'viewer'],
  ]) {
    await deps.projectMemberRepository.add({ projectId: project.id, userId: u.id, role })
  }
  await deps.projectMemberRepository.add({ projectId: other.id, userId: gabi.id, role: 'manager' })
  const versao = await createCustomFieldService(deps).createField(admin, { label: 'Versão', type: 'text' })
  const types = createTaskTypeService(deps)
  const bug = await types.createType(admin, { key: 'BUG', name: 'Bug' })
  await types.setTypeFields(admin, bug.id, [{ field_id: versao.id }])
  const statuses = createLookupService(deps, 'status')
  await statuses.create(admin, { key: 'TODO', name: 'A fazer', category: 'todo', is_default: true })
  const done = await statuses.create(admin, { key: 'DONE', name: 'Concluído', category: 'done' })
  await createLookupService(deps, 'priority').create(admin, { key: 'MEDIA', name: 'Média' })
  const tag = await deps.tagRepository.create({ name: 'Urgente', nameKey: 'urgente', color: 'red' })
  const ctx = { admin, gabi: await ctxOf(deps, gabi), mario: await ctxOf(deps, mario), lia: await ctxOf(deps, lia) }
  const tasks = createTaskService(deps)
  return {
    deps,
    ctx,
    project,
    other,
    done,
    tag,
    tasks,
    relations: createRelationService(deps),
    newTask: (title, extra, who) =>
      tasks.createTask(who || ctx.mario, Object.assign({ project_id: project.id, task_type_id: bug.id, title }, extra)),
  }
}

const history = (s, taskId) => s.deps.store.audit.filter((a) => a.entityType === 'task' && a.entityId === taskId)

describe('application/relations — relações', () => {
  it('cria "bloqueia" e cada lado vê do seu ponto de vista, com histórico nos dois', async () => {
    const s = await setup()
    const a = await s.newTask('Login')
    const b = await s.newTask('Checkout')
    const created = await s.relations.createRelation(s.ctx.mario, a.id, { type: 'blocks', target_id: b.id })
    assert.equal(created.type, 'blocks')
    assert.equal(created.task.code, 'CRM-2')

    const fromB = await s.relations.listRelations(s.ctx.lia, b.id)
    assert.deepEqual(
      fromB.relations.map((r) => [r.type, r.task.code]),
      [['blocked_by', 'CRM-1']],
    )
    assert.deepEqual(history(s, a.id).at(-1).newValue, { 'rel:blocks': 'CRM-2 · Checkout' })
    assert.deepEqual(history(s, b.id).at(-1).newValue, { 'rel:blocked_by': 'CRM-1 · Login' })
  })

  it('não repete relação, não relaciona consigo e não cria ciclo de bloqueio/dependência', async () => {
    const s = await setup()
    const a = await s.newTask('A')
    const b = await s.newTask('B')
    const c = await s.newTask('C')
    await s.relations.createRelation(s.ctx.mario, a.id, { type: 'relates', target_id: b.id })
    assert.equal(await codeOf(() => s.relations.createRelation(s.ctx.mario, b.id, { type: 'relates', target_id: a.id })), 'RELATION_EXISTS')
    assert.equal(await codeOf(() => s.relations.createRelation(s.ctx.mario, a.id, { type: 'blocks', target_id: a.id })), 'VALIDATION_ERROR:{"target_id":"invalid_option"}')
    assert.equal(await codeOf(() => s.relations.createRelation(s.ctx.mario, a.id, { type: 'parece', target_id: b.id })), 'VALIDATION_ERROR:{"type":"invalid_option"}')

    await s.relations.createRelation(s.ctx.mario, a.id, { type: 'blocks', target_id: b.id })
    // c depende de b (b antes de c); então c não pode bloquear a
    await s.relations.createRelation(s.ctx.mario, c.id, { type: 'depends_on', target_id: b.id })
    assert.equal(await codeOf(() => s.relations.createRelation(s.ctx.mario, c.id, { type: 'blocks', target_id: a.id })), 'RELATION_CYCLE')
    assert.equal(await codeOf(() => s.relations.createRelation(s.ctx.mario, a.id, { type: 'blocked_by', target_id: c.id })), 'RELATION_CYCLE')
    assert.equal(await codeOf(() => s.relations.createRelation(s.ctx.mario, a.id, { type: 'blocks', target_id: c.id })), 'OK')
  })

  it('permissões: leitor não relaciona; tarefa invisível não é alvo; excluir registra nos dois lados', async () => {
    const s = await setup()
    const a = await s.newTask('A')
    const b = await s.newTask('B')
    const foreign = await s.tasks.createTask(s.ctx.gabi, { project_id: s.other.id, task_type_id: a.type.id, title: 'ERP' })
    assert.equal(await codeOf(() => s.relations.createRelation(s.ctx.lia, a.id, { type: 'relates', target_id: b.id })), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.relations.createRelation(s.ctx.mario, a.id, { type: 'relates', target_id: foreign.id })), 'VALIDATION_ERROR:{"target_id":"invalid_option"}')
    // quem vê os dois projetos pode relacionar entre projetos
    const cross = await s.relations.createRelation(s.ctx.gabi, a.id, { type: 'relates', target_id: foreign.id })
    // mas quem não vê o outro lado não enxerga a relação
    assert.deepEqual((await s.relations.listRelations(s.ctx.mario, a.id)).relations, [])

    await s.relations.deleteRelation(s.ctx.gabi, cross.id)
    assert.deepEqual(history(s, a.id).at(-1).oldValue, { 'rel:relates': 'ERP-1 · ERP' })
    assert.deepEqual(history(s, foreign.id).at(-1).newValue, null)
    assert.equal(await codeOf(() => s.relations.deleteRelation(s.ctx.gabi, cross.id)), 'RELATION_NOT_FOUND')
  })
})

describe('application/relations — subtarefas', () => {
  it('pai no mesmo projeto, sem ciclo; lista filhos com progresso; histórico legível', async () => {
    const s = await setup()
    const parent = await s.newTask('Checkout novo')
    const child = await s.newTask('Tela de pagamento', { parent_task_id: parent.id })
    const second = await s.newTask('Cupom')
    await s.tasks.updateTask(s.ctx.mario, second.id, { parent_task_id: parent.id, status_id: s.done.id })
    assert.equal((await s.tasks.getTask(s.ctx.mario, child.id)).parent.code, 'CRM-1')

    const view = await s.relations.listRelations(s.ctx.mario, parent.id)
    assert.deepEqual(view.children.map((t) => t.code), ['CRM-2', 'CRM-3'])
    assert.deepEqual(view.subtask_progress, { done: 1, total: 2 })
    // resumo nas listagens
    const summary = (await s.tasks.listTasks(s.ctx.mario, { project_id: s.project.id })).items.find((t) => t.id === parent.id)
    assert.deepEqual(summary.subtask_progress, { done: 1, total: 2 })
    assert.equal(history(s, second.id).at(-1).newValue.parent, 'CRM-1 · Checkout novo')

    const foreign = await s.tasks.createTask(s.ctx.gabi, { project_id: s.other.id, task_type_id: parent.type.id, title: 'ERP' })
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.gabi, child.id, { parent_task_id: foreign.id })), 'VALIDATION_ERROR:{"parent_task_id":"other_project"}')
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.mario, parent.id, { parent_task_id: child.id })), 'VALIDATION_ERROR:{"parent_task_id":"cycle"}')
    // null tira do pai
    assert.equal((await s.tasks.updateTask(s.ctx.mario, child.id, { parent_task_id: null })).parent, null)
  })

  it('excluir o pai não apaga as subtarefas: elas ficam soltas, com histórico', async () => {
    const s = await setup()
    const parent = await s.newTask('Pai')
    const child = await s.newTask('Filha', { parent_task_id: parent.id })
    await s.tasks.deleteTask(s.ctx.gabi, parent.id)
    assert.equal((await s.tasks.getTask(s.ctx.mario, child.id)).parent, null)
    assert.deepEqual(history(s, child.id).at(-1).newValue, { parent: null })
  })

  it('"bloqueada" aparece enquanto houver bloqueio em aberto', async () => {
    const s = await setup()
    const a = await s.newTask('Bloqueadora')
    const b = await s.newTask('Bloqueada')
    await s.relations.createRelation(s.ctx.mario, b.id, { type: 'blocked_by', target_id: a.id })
    const blocked = async () => (await s.tasks.getTask(s.ctx.mario, b.id)).blocked
    assert.equal(await blocked(), true)
    assert.equal((await s.tasks.getTask(s.ctx.mario, a.id)).blocked, false)
    await s.tasks.updateTask(s.ctx.mario, a.id, { status_id: s.done.id })
    assert.equal(await blocked(), false)
  })
})

describe('application/relations — fork', () => {
  it('copia o escolhido, guarda a origem e registra nos dois históricos', async () => {
    const s = await setup()
    const source = await s.newTask('Relatório de vendas', {
      description: 'Filtrar por período',
      tag_ids: [s.tag.id],
      custom_values: { versao: '2.1' },
      checklist: [{ text: 'Levantar requisitos', done: true }],
    })
    const other = await s.newTask('Outra')
    await s.relations.createRelation(s.ctx.mario, source.id, { type: 'relates', target_id: other.id })

    const fork = await s.relations.forkTask(s.ctx.mario, source.id, {})
    assert.equal(fork.title, 'Relatório de vendas')
    assert.equal(fork.description, 'Filtrar por período')
    assert.deepEqual(fork.tags.map((t) => t.name), ['Urgente'])
    assert.equal(fork.custom_values.versao, '2.1')
    // checklist volta a ficar pendente no fork
    assert.deepEqual(fork.checklist.map((i) => [i.text, i.done]), [['Levantar requisitos', false]])
    assert.equal(fork.forked_from.code, 'CRM-1')
    assert.deepEqual((await s.relations.listRelations(s.ctx.mario, fork.id)).relations, [])
    assert.deepEqual(history(s, source.id).at(-1).newValue, { fork: 'CRM-3 · Relatório de vendas' })
    assert.equal(history(s, fork.id)[0].newValue.forked_from, 'CRM-1 · Relatório de vendas')
    assert.deepEqual((await s.relations.listRelations(s.ctx.mario, source.id)).forks.map((t) => t.code), ['CRM-3'])

    const minimal = await s.relations.forkTask(s.ctx.mario, source.id, {
      title: 'Relatório (mobile)',
      copy: { description: false, tags: false, custom_values: false, checklist: false, relations: true },
    })
    assert.equal(minimal.description, '')
    assert.deepEqual(minimal.tags, [])
    assert.equal(minimal.custom_values.versao, undefined)
    assert.deepEqual(minimal.checklist, [])
    assert.deepEqual(
      (await s.relations.listRelations(s.ctx.mario, minimal.id)).relations.map((r) => [r.type, r.task.code]),
      [['relates', 'CRM-2']],
    )
  })

  it('exige tasks.fork, acesso à origem e poder criar no projeto destino', async () => {
    const s = await setup()
    const source = await s.newTask('A')
    assert.equal(await codeOf(() => s.relations.forkTask(s.ctx.lia, source.id, {})), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.relations.forkTask(s.ctx.mario, source.id, { project_id: s.other.id })), 'PROJECT_NOT_FOUND')
    const moved = await s.relations.forkTask(s.ctx.gabi, source.id, { project_id: s.other.id })
    assert.equal(moved.code, 'ERP-1')
    assert.equal(moved.forked_from.code, 'CRM-1')
  })
})
