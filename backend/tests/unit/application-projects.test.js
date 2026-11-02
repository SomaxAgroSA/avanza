const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createProjectService } = require('../../src/application/projects')
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

async function setup() {
  const deps = createFakeDeps()
  const projects = createProjectService(deps)
  const manager = await seedUser(deps, { name: 'Gestora', roleCode: 'MANAGER' })
  const member = await seedUser(deps, { name: 'Membro', roleCode: 'MEMBER' })
  const admin = await seedUser(deps, { name: 'Admin', roleCode: 'ADMIN' })
  const ctx = { manager: await ctxOf(deps, manager), member: await ctxOf(deps, member), admin: await ctxOf(deps, admin) }
  return { deps, projects, users: { manager, member, admin }, ctx }
}

const input = (overrides) => Object.assign({ name: 'CRM Corporativo', key: 'crm' }, overrides)

describe('application/projects — criação', () => {
  it('cria com chave normalizada, criador como dono/gestor e auditoria', async () => {
    const { deps, projects, users, ctx } = await setup()
    const project = await projects.createProject(ctx.manager, input({ description: 'Projeto do CRM' }))
    assert.equal(project.key, 'CRM')
    assert.equal(project.status, 'planning')
    assert.equal(project.priority, 'medium')
    assert.equal(project.owner.id, users.manager.id)
    assert.equal(project.member_count, 1)
    assert.equal(project.my_role, 'owner')
    assert.equal(project.capabilities.edit, true)
    assert.equal(deps.store.audit.at(-1).action, 'project.created')
  })

  it('exige projects.create', async () => {
    const { projects, ctx } = await setup()
    await assert.rejects(() => projects.createProject(ctx.member, input()), { code: 'FORBIDDEN' })
  })

  it('valida chave, datas e opções e rejeita chave duplicada', async () => {
    const { projects, ctx } = await setup()
    await assert.rejects(
      () => projects.createProject(ctx.manager, input({ key: 'x', status: 'nope', start_date: '2026-02-01', due_date: '2026-01-01' })),
      (err) => err.code === 'VALIDATION_ERROR' && err.details.fields.key === 'invalid_format' && err.details.fields.status === 'invalid_option',
    )
    await assert.rejects(
      () => projects.createProject(ctx.manager, input({ start_date: '2026-02-01', due_date: '2026-01-01' })),
      (err) => err.details.fields.due_date === 'due_before_start',
    )
    await projects.createProject(ctx.manager, input())
    await assert.rejects(() => projects.createProject(ctx.manager, input({ name: 'Outro' })), { code: 'PROJECT_KEY_IN_USE' })
  })
})

describe('application/projects — visibilidade', () => {
  it('lista apenas projetos acessíveis; view_all enxerga todos', async () => {
    const { projects, ctx } = await setup()
    await projects.createProject(ctx.manager, input())
    await projects.createProject(ctx.admin, input({ name: 'Interno', key: 'INT' }))

    assert.deepEqual((await projects.listProjects(ctx.manager, {})).items.map((p) => p.key), ['CRM'])
    assert.equal((await projects.listProjects(ctx.member, {})).items.length, 0)
    assert.deepEqual((await projects.listProjects(ctx.admin, { sort: 'key' })).items.map((p) => p.key), ['CRM', 'INT'])
    assert.deepEqual((await projects.listProjects(ctx.admin, { view: 'mine' })).items.map((p) => p.key), ['INT'])
  })

  it('projeto de outro time responde PROJECT_NOT_FOUND (IDOR)', async () => {
    const { projects, ctx } = await setup()
    const project = await projects.createProject(ctx.manager, input())
    await assert.rejects(() => projects.getProject(ctx.member, project.id), { code: 'PROJECT_NOT_FOUND' })
  })

  it('arquivados ficam só na visão "archived"', async () => {
    const { projects, ctx } = await setup()
    const project = await projects.createProject(ctx.manager, input())
    await projects.archiveProject(ctx.manager, project.id)
    assert.equal((await projects.listProjects(ctx.manager, {})).items.length, 0)
    assert.equal((await projects.listProjects(ctx.manager, { view: 'archived' })).items.length, 1)
  })
})

describe('application/projects — edição e ciclo de vida', () => {
  it('gestor edita e a auditoria guarda só o que mudou; chave é imutável', async () => {
    const { deps, projects, ctx } = await setup()
    const project = await projects.createProject(ctx.manager, input())
    const updated = await projects.updateProject(ctx.manager, project.id, { name: 'CRM 2.0', status: 'active', key: 'CRM' })
    assert.equal(updated.name, 'CRM 2.0')
    assert.deepEqual(deps.store.audit.at(-1).newValue, { name: 'CRM 2.0', status: 'active' })
    await assert.rejects(() => projects.updateProject(ctx.manager, project.id, { key: 'NEW' }), (err) => err.details.fields.key === 'immutable')
  })

  it('valida datas considerando os valores já salvos', async () => {
    const { projects, ctx } = await setup()
    const project = await projects.createProject(ctx.manager, input({ start_date: '2026-03-01' }))
    await assert.rejects(() => projects.updateProject(ctx.manager, project.id, { due_date: '2026-02-01' }), (err) => err.details.fields.due_date === 'due_before_start')
    const cleared = await projects.updateProject(ctx.manager, project.id, { start_date: null })
    assert.equal(cleared.start_date, null)
  })

  it('membro comum não edita; arquivado não é editável', async () => {
    const { projects, users, ctx } = await setup()
    const project = await projects.createProject(ctx.manager, input())
    await projects.addMember(ctx.manager, project.id, { user_id: users.member.id, role: 'member' })
    await assert.rejects(() => projects.updateProject(ctx.member, project.id, { name: 'X' }), { code: 'FORBIDDEN' })
    await projects.archiveProject(ctx.manager, project.id)
    await assert.rejects(() => projects.updateProject(ctx.manager, project.id, { name: 'X' }), { code: 'PROJECT_ARCHIVED' })
    await projects.unarchiveProject(ctx.manager, project.id)
    assert.equal((await projects.updateProject(ctx.manager, project.id, { name: 'Y' })).name, 'Y')
  })

  it('exclusão exige projeto arquivado e remove membros', async () => {
    const { deps, projects, ctx } = await setup()
    const project = await projects.createProject(ctx.admin, input())
    await assert.rejects(() => projects.deleteProject(ctx.admin, project.id), { code: 'PROJECT_NOT_ARCHIVED' })
    await projects.archiveProject(ctx.admin, project.id)
    await projects.deleteProject(ctx.admin, project.id)
    await assert.rejects(() => projects.getProject(ctx.admin, project.id), { code: 'PROJECT_NOT_FOUND' })
    assert.equal(deps.store.projectMembers.length, 0)
    assert.equal(deps.store.audit.at(-1).action, 'project.deleted')
  })
})

describe('application/projects — membros', () => {
  it('adiciona, altera papel e remove membros com auditoria', async () => {
    const { deps, projects, users, ctx } = await setup()
    const project = await projects.createProject(ctx.manager, input())
    await projects.addMember(ctx.manager, project.id, { user_id: users.member.id, role: 'viewer' })
    assert.equal((await projects.getProject(ctx.member, project.id)).my_role, 'viewer')

    await projects.updateMemberRole(ctx.manager, project.id, users.member.id, { role: 'manager' })
    assert.equal((await projects.getProject(ctx.member, project.id)).capabilities.manage_members, false, 'MEMBER não tem projects.edit')

    const members = await projects.listMembers(ctx.member, project.id)
    assert.deepEqual(members.map((m) => [m.user.name, m.role, m.is_owner]), [
      ['Gestora', 'manager', true],
      ['Membro', 'manager', false],
    ])

    await projects.removeMember(ctx.manager, project.id, users.member.id)
    await assert.rejects(() => projects.getProject(ctx.member, project.id), { code: 'PROJECT_NOT_FOUND' })
    assert.deepEqual(
      deps.store.audit.filter((e) => e.action.startsWith('project.member')).map((e) => e.action),
      ['project.member_added', 'project.member_role_changed', 'project.member_removed'],
    )
  })

  it('bloqueia duplicado, usuário desativado, remover dono e mudar papel do dono', async () => {
    const { deps, projects, users, ctx } = await setup()
    const project = await projects.createProject(ctx.manager, input())
    await projects.addMember(ctx.manager, project.id, { user_id: users.member.id, role: 'member' })
    await assert.rejects(() => projects.addMember(ctx.manager, project.id, { user_id: users.member.id, role: 'member' }), { code: 'MEMBER_ALREADY_EXISTS' })

    const disabled = await seedUser(deps, { status: 'disabled' })
    await assert.rejects(
      () => projects.addMember(ctx.manager, project.id, { user_id: disabled.id, role: 'member' }),
      (err) => err.details.fields.user_id === 'user_disabled',
    )
    await assert.rejects(() => projects.addMember(ctx.manager, project.id, { user_id: 'nope', role: 'member' }), { code: 'USER_NOT_FOUND' })
    await assert.rejects(() => projects.removeMember(ctx.manager, project.id, users.manager.id), { code: 'CANNOT_REMOVE_OWNER' })
    await assert.rejects(() => projects.updateMemberRole(ctx.manager, project.id, users.manager.id, { role: 'viewer' }), { code: 'OWNER_ROLE_LOCKED' })
  })

  it('membro pode sair do projeto; não pode remover outros', async () => {
    const { projects, users, ctx } = await setup()
    const project = await projects.createProject(ctx.manager, input())
    await projects.addMember(ctx.manager, project.id, { user_id: users.member.id, role: 'member' })
    await projects.addMember(ctx.manager, project.id, { user_id: users.admin.id, role: 'member' })
    await assert.rejects(() => projects.removeMember(ctx.member, project.id, users.admin.id), { code: 'FORBIDDEN' })
    await projects.removeMember(ctx.member, project.id, users.member.id)
    await assert.rejects(() => projects.getProject(ctx.member, project.id), { code: 'PROJECT_NOT_FOUND' })
  })

  it('candidatos a membro: ativos e ainda não membros', async () => {
    const { deps, projects, users, ctx } = await setup()
    const project = await projects.createProject(ctx.manager, input())
    await seedUser(deps, { name: 'Inativo', status: 'disabled' })
    const names = (await projects.memberCandidates(ctx.manager, project.id, {})).map((u) => u.name).sort()
    assert.deepEqual(names, ['Admin', 'Membro'])
    assert.deepEqual((await projects.memberCandidates(ctx.manager, project.id, { search: 'adm' })).map((u) => u.id), [users.admin.id])
  })

  it('transfere a posse: novo dono vira gestor e o anterior continua gestor', async () => {
    const { projects, users, ctx } = await setup()
    const project = await projects.createProject(ctx.manager, input())
    const result = await projects.transferOwnership(ctx.manager, project.id, { user_id: users.admin.id })
    assert.equal(result.owner.id, users.admin.id)
    const roles = Object.fromEntries((await projects.listMembers(ctx.manager, project.id)).map((m) => [m.user.id, m.role]))
    assert.equal(roles[users.admin.id], 'manager')
    assert.equal(roles[users.manager.id], 'manager')
    assert.equal((await projects.getProject(ctx.manager, project.id)).capabilities.transfer, false)
  })
})

describe('application/projects — urgência (semáforo)', () => {
  it('nasce sem urgência; edita, limpa com null, registra no histórico e filtra a listagem', async () => {
    const { deps, projects, ctx } = await setup()
    const a = await projects.createProject(ctx.manager, input())
    const b = await projects.createProject(ctx.manager, input({ name: 'Outro', key: 'OUT', urgency: 'low' }))
    assert.equal(a.urgency, null)
    assert.equal(b.urgency, 'low')
    assert.equal((await projects.updateProject(ctx.manager, a.id, { urgency: 'high' })).urgency, 'high')
    const entry = deps.store.audit.at(-1)
    assert.deepEqual([entry.action, entry.oldValue.urgency, entry.newValue.urgency], ['project.updated', null, 'high'])
    const keys = async (urgency) => (await projects.listProjects(ctx.manager, { urgency })).items.map((p) => p.key)
    assert.deepEqual(await keys('high'), ['CRM'])
    assert.deepEqual(await keys('low'), ['OUT'])
    assert.equal((await projects.updateProject(ctx.manager, b.id, { urgency: null })).urgency, null)
    assert.deepEqual(await keys('none'), ['OUT'])
    await assert.rejects(() => projects.updateProject(ctx.manager, a.id, { urgency: 'roja' }), { code: 'VALIDATION_ERROR' })
    await assert.rejects(() => projects.listProjects(ctx.manager, { urgency: 'roja' }), { code: 'VALIDATION_ERROR' })
    // POST com urgency: null = sem urgência
    assert.equal((await projects.createProject(ctx.manager, input({ name: 'Terceiro', key: 'TER', urgency: null }))).urgency, null)
  })
})
