const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createRealtimeService } = require('../../src/application/realtime')
const rbac = require('../../src/domain/rbac')

async function setup() {
  const deps = createFakeDeps({ start: '2026-10-01T12:00:00.000Z' })
  const admin = await seedUser(deps, { email: 'admin@example.com', roleCode: 'ADMIN' })
  const mia = await seedUser(deps, { email: 'mia@example.com', roleCode: 'MEMBER' })
  const ctxOf = async (user) => {
    const role = await deps.roleRepository.findById(user.roleId)
    return { principal: rbac.createPrincipal({ userId: user.id, roleId: role.id, roleCode: role.code, permissions: await deps.roleRepository.getPermissionCodes(role.id), sessionId: 's1' }) }
  }
  const crm = await deps.projectRepository.create({ name: 'CRM', key: 'CRM', ownerId: admin.id, status: 'active', priority: 'medium' })
  const erp = await deps.projectRepository.create({ name: 'ERP', key: 'ERP', ownerId: admin.id, status: 'active', priority: 'medium' })
  await deps.projectMemberRepository.add({ projectId: crm.id, userId: mia.id, role: 'member' })
  return { deps, admin, mia, ctxOf, crm, erp, realtime: createRealtimeService(deps) }
}

describe('application/realtime — assinaturas', () => {
  it('aceita os projetos que a pessoa vê e o próprio tópico; descarta o resto sem derrubar a conexão', async () => {
    const { mia, admin, ctxOf, crm, erp, realtime } = await setup()
    const result = await realtime.authorize(await ctxOf(mia), [`project:${crm.id}`, `project:${erp.id}`, `user:${mia.id}`, `user:${admin.id}`, 'tasks', 'tasks/*', `project:${crm.id}`])
    assert.deepEqual(result.allowed, [`project:${crm.id}`, `user:${mia.id}`])
    assert.deepEqual(result.rejected, [`project:${erp.id}`, `user:${admin.id}`, 'tasks', 'tasks/*'])
    // quem vê todos os projetos assina qualquer um
    assert.deepEqual((await realtime.authorize(await ctxOf(admin), [`project:${erp.id}`])).allowed, [`project:${erp.id}`])
    assert.deepEqual((await realtime.authorize(await ctxOf(mia), ['project:nao-existe'])).allowed, [])
  })

  it('sem sessão não assina nada', async () => {
    const { realtime } = await setup()
    await assert.rejects(() => realtime.authorize({ principal: null }, ['user:x']), (err) => err.code === 'UNAUTHENTICATED')
  })
})

describe('application/realtime — avisos', () => {
  it('registro com projeto vai para o projeto; comentário e anexo descobrem o projeto pela tarefa; notificação vai para a pessoa', async () => {
    const { deps, mia, crm, realtime } = await setup()
    const task = await deps.taskRepository.create({ projectId: crm.id, title: 'Tela', code: 'CRM-1' })
    assert.equal((await realtime.eventFor({ collection: 'tasks', action: 'update', id: task.id, projectId: crm.id })).topic, `project:${crm.id}`)
    const comment = await realtime.eventFor({ collection: 'comments', action: 'create', id: 'c1', taskId: task.id })
    assert.equal(comment.topic, `project:${crm.id}`)
    assert.equal(comment.payload.task_id, task.id)
    assert.equal(await realtime.eventFor({ collection: 'comments', action: 'delete', id: 'c2', taskId: 'sumiu' }), null)
    assert.equal((await realtime.eventFor({ collection: 'notifications', action: 'create', id: 'n1', userId: mia.id })).topic, `user:${mia.id}`)
  })
})
