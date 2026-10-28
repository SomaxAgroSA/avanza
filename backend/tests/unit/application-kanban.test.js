const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createTaskService } = require('../../src/application/tasks')
const { createBoardService } = require('../../src/application/board')
const { createLookupService } = require('../../src/application/lookups')
const { createTaskTypeService } = require('../../src/application/task-types')
const { createCustomFieldService } = require('../../src/application/custom-fields')
const workflow = require('../../src/domain/workflow')
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
  for (const [u, role] of [
    [gabi, 'manager'],
    [mario, 'member'],
    [lia, 'viewer'],
  ]) {
    await deps.projectMemberRepository.add({ projectId: project.id, userId: u.id, role })
  }
  const severidade = await createCustomFieldService(deps).createField(admin, {
    label: 'Severidade',
    type: 'select',
    options: [{ label: 'Alta', color: 'red', is_default: true }],
  })
  const types = createTaskTypeService(deps)
  const bug = await types.createType(admin, { key: 'BUG', name: 'Bug' })
  await types.setTypeFields(admin, bug.id, [{ field_id: severidade.id, show_on_card: true }])
  const statuses = createLookupService(deps, 'status')
  const backlog = await statuses.create(admin, { key: 'BACKLOG', name: 'Backlog', category: 'backlog' })
  const todo = await statuses.create(admin, { key: 'TODO', name: 'A fazer', category: 'todo' })
  const dev = await statuses.create(admin, { key: 'DEV', name: 'Desenvolvimento', category: 'in_progress', wip_limit: 2 })
  const done = await statuses.create(admin, { key: 'DONE', name: 'Concluído', category: 'done' })
  await createLookupService(deps, 'priority').create(admin, { key: 'MEDIA', name: 'Média' })
  const ctx = { admin, gabi: await ctxOf(deps, gabi), mario: await ctxOf(deps, mario), lia: await ctxOf(deps, lia) }
  const tasks = createTaskService(deps)
  return {
    deps,
    ctx,
    project,
    bug,
    statusService: statuses,
    statuses: { backlog, todo, dev, done },
    tasks,
    board: createBoardService(deps),
    newTask: (title, extra) => tasks.createTask(ctx.mario, Object.assign({ project_id: project.id, task_type_id: bug.id, title }, extra)),
  }
}

const column = (board, key) => board.columns.find((c) => c.status.key === key)
const titles = (board, key) => column(board, key).tasks.map((t) => t.title)

describe('domain/workflow — transições', () => {
  it('sem regra, qualquer destino; com regra, só os destinos listados; ficar no mesmo status sempre pode', () => {
    assert.equal(workflow.transitionAllowed({ id: 'a', allowedNext: [] }, { id: 'b' }), true)
    assert.equal(workflow.transitionAllowed({ id: 'a', allowedNext: ['b'] }, { id: 'b' }), true)
    assert.equal(workflow.transitionAllowed({ id: 'a', allowedNext: ['b'] }, { id: 'c' }), false)
    assert.equal(workflow.transitionAllowed({ id: 'a', allowedNext: ['b'] }, { id: 'a' }), true)
  })
})

describe('application/lookups — WIP e transições do status', () => {
  it('valida limite WIP e destinos permitidos (só status existentes, sem ele mesmo)', async () => {
    const s = await setup()
    const updated = await s.statusService.update(s.ctx.admin, s.statuses.backlog.id, { allowed_next: [s.statuses.todo.id], wip_limit: 0 })
    assert.deepEqual(updated.allowed_next, [s.statuses.todo.id])
    assert.equal(updated.wip_limit, 0)
    assert.equal((await s.statusService.get(s.ctx.admin, s.statuses.dev.id)).wip_limit, 2)
    assert.equal(await codeOf(() => s.statusService.update(s.ctx.admin, s.statuses.backlog.id, { allowed_next: ['nao_existe'] })), 'VALIDATION_ERROR:{"allowed_next":"invalid_option"}')
    assert.equal(await codeOf(() => s.statusService.update(s.ctx.admin, s.statuses.backlog.id, { allowed_next: [s.statuses.backlog.id] })), 'VALIDATION_ERROR:{"allowed_next":"invalid_option"}')
    assert.equal(await codeOf(() => s.statusService.update(s.ctx.admin, s.statuses.backlog.id, { wip_limit: -1 })), 'VALIDATION_ERROR:{"wip_limit":"too_small"}')
  })
})

describe('application/board — quadro do projeto', () => {
  it('colunas na ordem dos status, com WIP, contagem e cards com campos "no card"', async () => {
    const s = await setup()
    await s.newTask('Erro A')
    await s.newTask('Erro B', { status_id: s.statuses.dev.id, assignee_id: s.deps.store.users.find((u) => u.name === 'Mário').id })
    const board = await s.board.getBoard(s.ctx.lia, s.project.id)
    assert.deepEqual(board.columns.map((c) => [c.status.key, c.total]), [['BACKLOG', 1], ['TODO', 0], ['DEV', 1], ['DONE', 0]])
    assert.equal(column(board, 'DEV').wip_limit, 2)
    const card = column(board, 'DEV').tasks[0]
    assert.equal(card.code, 'CRM-2')
    assert.equal(card.assignee.name, 'Mário')
    assert.deepEqual(card.card_fields.map((f) => [f.field.label, f.value !== null]), [['Severidade', true]])
    assert.deepEqual(board.capabilities, { move: false, create: false })
    assert.deepEqual((await s.board.getBoard(s.ctx.mario, s.project.id)).capabilities, { move: true, create: true })
  })

  it('quem não vê o projeto recebe 404', async () => {
    const s = await setup()
    const outsider = await ctxOf(s.deps, await seedUser(s.deps, { roleCode: 'MEMBER', name: 'Otto' }))
    assert.equal(await codeOf(() => s.board.getBoard(outsider, s.project.id)), 'PROJECT_NOT_FOUND')
  })
})

describe('application/tasks — mover no quadro', () => {
  it('muda de coluna e posiciona entre os vizinhos; ordem se mantém na releitura', async () => {
    const s = await setup()
    const a = await s.newTask('A', { status_id: s.statuses.todo.id })
    const b = await s.newTask('B', { status_id: s.statuses.todo.id })
    const c = await s.newTask('C')
    assert.deepEqual(titles(await s.board.getBoard(s.ctx.mario, s.project.id), 'TODO'), ['A', 'B'])
    // C vai para "A fazer" entre A e B
    const moved = await s.tasks.moveTask(s.ctx.mario, c.id, { status_id: s.statuses.todo.id, prev_id: a.id, next_id: b.id })
    assert.equal(moved.status.key, 'TODO')
    assert.deepEqual(titles(await s.board.getBoard(s.ctx.mario, s.project.id), 'TODO'), ['A', 'C', 'B'])
    // B vai para o topo da mesma coluna
    await s.tasks.moveTask(s.ctx.mario, b.id, { status_id: s.statuses.todo.id, next_id: a.id })
    assert.deepEqual(titles(await s.board.getBoard(s.ctx.mario, s.project.id), 'TODO'), ['B', 'A', 'C'])
    // reordenar na mesma coluna não gera histórico; mudar de coluna gera
    const last = s.deps.store.audit.at(-1)
    assert.equal(last.action, 'task.updated')
    assert.deepEqual(last.newValue, { task_status: 'A fazer' })
  })

  it('transição não permitida é recusada pelo servidor', async () => {
    const s = await setup()
    await s.statusService.update(s.ctx.admin, s.statuses.backlog.id, { allowed_next: [s.statuses.todo.id] })
    const t = await s.newTask('X')
    assert.equal(await codeOf(() => s.tasks.moveTask(s.ctx.mario, t.id, { status_id: s.statuses.done.id })), 'TRANSITION_NOT_ALLOWED')
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.mario, t.id, { status_id: s.statuses.done.id })), 'TRANSITION_NOT_ALLOWED')
    assert.equal((await s.tasks.moveTask(s.ctx.mario, t.id, { status_id: s.statuses.todo.id })).status.key, 'TODO')
  })

  it('leitor não move; muitas inserções no mesmo ponto continuam ordenadas', async () => {
    const s = await setup()
    const a = await s.newTask('A')
    const z = await s.newTask('Z')
    assert.equal(await codeOf(() => s.tasks.moveTask(s.ctx.lia, a.id, { status_id: s.statuses.todo.id })), 'FORBIDDEN')
    // insere 60 vezes entre A e o último inserido: força renumeração quando o espaço acaba
    let next = z
    for (let i = 0; i < 60; i++) {
      const t = await s.newTask(`N${i}`)
      await s.tasks.moveTask(s.ctx.mario, t.id, { status_id: s.statuses.backlog.id, prev_id: a.id, next_id: next.id })
      next = t
    }
    const order = titles(await s.board.getBoard(s.ctx.mario, s.project.id), 'BACKLOG')
    assert.equal(order[0], 'A')
    assert.equal(order[1], 'N59')
    assert.equal(order.at(-1), 'Z')
  })
})
