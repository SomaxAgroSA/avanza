const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createProjectService } = require('../../pb_hooks/src/application/projects')
const { createPrincipal } = require('../../pb_hooks/src/domain/rbac')

function ctxOf(deps, user) {
  const role = deps.roleRepository.findById(user.roleId)
  return {
    principal: createPrincipal({ userId: user.id, roleId: role.id, roleCode: role.code, permissions: deps.roleRepository.getPermissionCodes(role.id) }),
    ip: '1.1.1.1',
    userAgent: 'ua',
    correlationId: 'c',
  }
}

function setup() {
  const deps = createFakeDeps()
  const projects = createProjectService(deps)
  const manager = seedUser(deps, { name: 'Gestora', roleCode: 'MANAGER' })
  const member = seedUser(deps, { name: 'Membro', roleCode: 'MEMBER' })
  const admin = seedUser(deps, { name: 'Admin', roleCode: 'ADMIN' })
  const ctx = { manager: ctxOf(deps, manager), member: ctxOf(deps, member), admin: ctxOf(deps, admin) }
  return { deps, projects, users: { manager, member, admin }, ctx }
}

const input = (overrides) => Object.assign({ name: 'CRM Corporativo', key: 'crm' }, overrides)

describe('application/projects — criação', () => {
  it('cria com chave normalizada, criador como dono/gestor e auditoria', () => {
    const { deps, projects, users, ctx } = setup()
    const project = projects.createProject(ctx.manager, input({ description: 'Projeto do CRM' }))
    assert.equal(project.key, 'CRM')
    assert.equal(project.status, 'planning')
    assert.equal(project.priority, 'medium')
    assert.equal(project.owner.id, users.manager.id)
    assert.equal(project.member_count, 1)
    assert.equal(project.my_role, 'owner')
    assert.equal(project.capabilities.edit, true)
    assert.equal(deps.store.audit.at(-1).action, 'project.created')
  })

  it('exige projects.create', () => {
    const { projects, ctx } = setup()
    assert.throws(() => projects.createProject(ctx.member, input()), { code: 'FORBIDDEN' })
  })

  it('valida chave, datas e opções e rejeita chave duplicada', () => {
    const { projects, ctx } = setup()
    assert.throws(
      () => projects.createProject(ctx.manager, input({ key: 'x', status: 'nope', start_date: '2026-02-01', due_date: '2026-01-01' })),
      (err) => err.code === 'VALIDATION_ERROR' && err.details.fields.key === 'invalid_format' && err.details.fields.status === 'invalid_option',
    )
    assert.throws(
      () => projects.createProject(ctx.manager, input({ start_date: '2026-02-01', due_date: '2026-01-01' })),
      (err) => err.details.fields.due_date === 'due_before_start',
    )
    projects.createProject(ctx.manager, input())
    assert.throws(() => projects.createProject(ctx.manager, input({ name: 'Outro' })), { code: 'PROJECT_KEY_IN_USE' })
  })
})

describe('application/projects — visibilidade', () => {
  it('lista apenas projetos acessíveis; view_all enxerga todos', () => {
    const { projects, ctx } = setup()
    projects.createProject(ctx.manager, input())
    projects.createProject(ctx.admin, input({ name: 'Interno', key: 'INT' }))

    assert.deepEqual(projects.listProjects(ctx.manager, {}).items.map((p) => p.key), ['CRM'])
    assert.equal(projects.listProjects(ctx.member, {}).items.length, 0)
    assert.deepEqual(projects.listProjects(ctx.admin, { sort: 'key' }).items.map((p) => p.key), ['CRM', 'INT'])
    assert.deepEqual(projects.listProjects(ctx.admin, { view: 'mine' }).items.map((p) => p.key), ['INT'])
  })

  it('projeto de outro time responde PROJECT_NOT_FOUND (IDOR)', () => {
    const { projects, ctx } = setup()
    const project = projects.createProject(ctx.manager, input())
    assert.throws(() => projects.getProject(ctx.member, project.id), { code: 'PROJECT_NOT_FOUND' })
  })

  it('arquivados ficam só na visão "archived"', () => {
    const { projects, ctx } = setup()
    const project = projects.createProject(ctx.manager, input())
    projects.archiveProject(ctx.manager, project.id)
    assert.equal(projects.listProjects(ctx.manager, {}).items.length, 0)
    assert.equal(projects.listProjects(ctx.manager, { view: 'archived' }).items.length, 1)
  })
})

describe('application/projects — edição e ciclo de vida', () => {
  it('gestor edita e a auditoria guarda só o que mudou; chave é imutável', () => {
    const { deps, projects, ctx } = setup()
    const project = projects.createProject(ctx.manager, input())
    const updated = projects.updateProject(ctx.manager, project.id, { name: 'CRM 2.0', status: 'active', key: 'CRM' })
    assert.equal(updated.name, 'CRM 2.0')
    assert.deepEqual(deps.store.audit.at(-1).newValue, { name: 'CRM 2.0', status: 'active' })
    assert.throws(() => projects.updateProject(ctx.manager, project.id, { key: 'NEW' }), (err) => err.details.fields.key === 'immutable')
  })

  it('valida datas considerando os valores já salvos', () => {
    const { projects, ctx } = setup()
    const project = projects.createProject(ctx.manager, input({ start_date: '2026-03-01' }))
    assert.throws(() => projects.updateProject(ctx.manager, project.id, { due_date: '2026-02-01' }), (err) => err.details.fields.due_date === 'due_before_start')
    const cleared = projects.updateProject(ctx.manager, project.id, { start_date: null })
    assert.equal(cleared.start_date, null)
  })

  it('membro comum não edita; arquivado não é editável', () => {
    const { projects, users, ctx } = setup()
    const project = projects.createProject(ctx.manager, input())
    projects.addMember(ctx.manager, project.id, { user_id: users.member.id, role: 'member' })
    assert.throws(() => projects.updateProject(ctx.member, project.id, { name: 'X' }), { code: 'FORBIDDEN' })
    projects.archiveProject(ctx.manager, project.id)
    assert.throws(() => projects.updateProject(ctx.manager, project.id, { name: 'X' }), { code: 'PROJECT_ARCHIVED' })
    projects.unarchiveProject(ctx.manager, project.id)
    assert.equal(projects.updateProject(ctx.manager, project.id, { name: 'Y' }).name, 'Y')
  })

  it('exclusão exige projeto arquivado e remove membros', () => {
    const { deps, projects, ctx } = setup()
    const project = projects.createProject(ctx.admin, input())
    assert.throws(() => projects.deleteProject(ctx.admin, project.id), { code: 'PROJECT_NOT_ARCHIVED' })
    projects.archiveProject(ctx.admin, project.id)
    projects.deleteProject(ctx.admin, project.id)
    assert.throws(() => projects.getProject(ctx.admin, project.id), { code: 'PROJECT_NOT_FOUND' })
    assert.equal(deps.store.projectMembers.length, 0)
    assert.equal(deps.store.audit.at(-1).action, 'project.deleted')
  })
})

describe('application/projects — membros', () => {
  it('adiciona, altera papel e remove membros com auditoria', () => {
    const { deps, projects, users, ctx } = setup()
    const project = projects.createProject(ctx.manager, input())
    projects.addMember(ctx.manager, project.id, { user_id: users.member.id, role: 'viewer' })
    assert.equal(projects.getProject(ctx.member, project.id).my_role, 'viewer')

    projects.updateMemberRole(ctx.manager, project.id, users.member.id, { role: 'manager' })
    assert.equal(projects.getProject(ctx.member, project.id).capabilities.manage_members, false, 'MEMBER não tem projects.edit')

    const members = projects.listMembers(ctx.member, project.id)
    assert.deepEqual(members.map((m) => [m.user.name, m.role, m.is_owner]), [
      ['Gestora', 'manager', true],
      ['Membro', 'manager', false],
    ])

    projects.removeMember(ctx.manager, project.id, users.member.id)
    assert.throws(() => projects.getProject(ctx.member, project.id), { code: 'PROJECT_NOT_FOUND' })
    assert.deepEqual(
      deps.store.audit.filter((e) => e.action.startsWith('project.member')).map((e) => e.action),
      ['project.member_added', 'project.member_role_changed', 'project.member_removed'],
    )
  })

  it('bloqueia duplicado, usuário desativado, remover dono e mudar papel do dono', () => {
    const { deps, projects, users, ctx } = setup()
    const project = projects.createProject(ctx.manager, input())
    projects.addMember(ctx.manager, project.id, { user_id: users.member.id, role: 'member' })
    assert.throws(() => projects.addMember(ctx.manager, project.id, { user_id: users.member.id, role: 'member' }), { code: 'MEMBER_ALREADY_EXISTS' })

    const disabled = seedUser(deps, { status: 'disabled' })
    assert.throws(
      () => projects.addMember(ctx.manager, project.id, { user_id: disabled.id, role: 'member' }),
      (err) => err.details.fields.user_id === 'user_disabled',
    )
    assert.throws(() => projects.addMember(ctx.manager, project.id, { user_id: 'nope', role: 'member' }), { code: 'USER_NOT_FOUND' })
    assert.throws(() => projects.removeMember(ctx.manager, project.id, users.manager.id), { code: 'CANNOT_REMOVE_OWNER' })
    assert.throws(() => projects.updateMemberRole(ctx.manager, project.id, users.manager.id, { role: 'viewer' }), { code: 'OWNER_ROLE_LOCKED' })
  })

  it('membro pode sair do projeto; não pode remover outros', () => {
    const { projects, users, ctx } = setup()
    const project = projects.createProject(ctx.manager, input())
    projects.addMember(ctx.manager, project.id, { user_id: users.member.id, role: 'member' })
    projects.addMember(ctx.manager, project.id, { user_id: users.admin.id, role: 'member' })
    assert.throws(() => projects.removeMember(ctx.member, project.id, users.admin.id), { code: 'FORBIDDEN' })
    projects.removeMember(ctx.member, project.id, users.member.id)
    assert.throws(() => projects.getProject(ctx.member, project.id), { code: 'PROJECT_NOT_FOUND' })
  })

  it('candidatos a membro: ativos e ainda não membros', () => {
    const { deps, projects, users, ctx } = setup()
    const project = projects.createProject(ctx.manager, input())
    seedUser(deps, { name: 'Inativo', status: 'disabled' })
    const names = projects.memberCandidates(ctx.manager, project.id, {}).map((u) => u.name).sort()
    assert.deepEqual(names, ['Admin', 'Membro'])
    assert.deepEqual(projects.memberCandidates(ctx.manager, project.id, { search: 'adm' }).map((u) => u.id), [users.admin.id])
  })

  it('transfere a posse: novo dono vira gestor e o anterior continua gestor', () => {
    const { projects, users, ctx } = setup()
    const project = projects.createProject(ctx.manager, input())
    const result = projects.transferOwnership(ctx.manager, project.id, { user_id: users.admin.id })
    assert.equal(result.owner.id, users.admin.id)
    const roles = Object.fromEntries(projects.listMembers(ctx.manager, project.id).map((m) => [m.user.id, m.role]))
    assert.equal(roles[users.admin.id], 'manager')
    assert.equal(roles[users.manager.id], 'manager')
    assert.equal(projects.getProject(ctx.manager, project.id).capabilities.transfer, false)
  })
})

describe('application/projects — urgência (semáforo)', () => {
  it('nasce sem urgência; edita, limpa com null, registra no histórico e filtra a listagem', () => {
    const { deps, projects, ctx } = setup()
    const a = projects.createProject(ctx.manager, input())
    const b = projects.createProject(ctx.manager, input({ name: 'Outro', key: 'OUT', urgency: 'low' }))
    assert.equal(a.urgency, null)
    assert.equal(b.urgency, 'low')
    assert.equal(projects.updateProject(ctx.manager, a.id, { urgency: 'high' }).urgency, 'high')
    const entry = deps.store.audit.at(-1)
    assert.deepEqual([entry.action, entry.oldValue.urgency, entry.newValue.urgency], ['project.updated', null, 'high'])
    const keys = (urgency) => projects.listProjects(ctx.manager, { urgency }).items.map((p) => p.key)
    assert.deepEqual(keys('high'), ['CRM'])
    assert.deepEqual(keys('low'), ['OUT'])
    assert.equal(projects.updateProject(ctx.manager, b.id, { urgency: null }).urgency, null)
    assert.deepEqual(keys('none'), ['OUT'])
    assert.throws(() => projects.updateProject(ctx.manager, a.id, { urgency: 'roja' }), { code: 'VALIDATION_ERROR' })
    assert.throws(() => projects.listProjects(ctx.manager, { urgency: 'roja' }), { code: 'VALIDATION_ERROR' })
  })
})
