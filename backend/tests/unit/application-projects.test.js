const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createLookupService } = require('../../src/application/lookups')
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

  it('visões "ongoing" e "finished" separam os abertos pelo status', async () => {
    const { projects, ctx } = await setup()
    const running = await projects.createProject(ctx.manager, input({ key: 'RUN', name: 'Rodando' }))
    const done = await projects.createProject(ctx.manager, input({ key: 'FIN', name: 'Pronto' }))
    await projects.updateProject(ctx.manager, done.id, { status: 'completed' })
    const keys = async (view) => (await projects.listProjects(ctx.manager, { view })).items.map((p) => p.key)
    assert.deepEqual(await keys('ongoing'), [running.key])
    assert.deepEqual(await keys('finished'), [done.key])
    await assert.rejects(() => projects.listProjects(ctx.manager, { view: 'outra' }), { code: 'VALIDATION_ERROR' })
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

describe('application/projects — área responsável (§32)', () => {
  it('nasce com a área escolhida; edita, limpa com null, registra o nome no histórico e filtra', async () => {
    const { deps, projects, ctx } = await setup()
    const areas = createLookupService(deps, 'area')
    const ti = await areas.create(ctx.admin, { key: 'TI', name: 'Dpto. TI', color: 'blue' })
    const cred = await areas.create(ctx.admin, { key: 'CRED', name: 'Créditos', color: 'red' })
    const a = await projects.createProject(ctx.manager, input({ area_id: ti.id }))
    const b = await projects.createProject(ctx.manager, input({ name: 'Outro', key: 'OUT' }))
    assert.deepEqual([a.area, b.area], [{ id: ti.id, key: 'TI', name: 'Dpto. TI', color: 'blue' }, null])
    assert.equal((await projects.getProject(ctx.manager, a.id)).area.name, 'Dpto. TI')
    assert.equal((await projects.updateProject(ctx.manager, b.id, { area_id: cred.id })).area.name, 'Créditos')
    const entry = deps.store.audit.at(-1)
    assert.deepEqual([entry.action, entry.oldValue.area, entry.newValue.area], ['project.updated', null, 'Créditos'])
    const keys = async (area) => (await projects.listProjects(ctx.manager, { area_id: area })).items.map((p) => [p.key, p.area && p.area.name])
    assert.deepEqual(await keys(cred.id), [['OUT', 'Créditos']])
    assert.equal((await projects.updateProject(ctx.manager, a.id, { area_id: null })).area, null)
    assert.deepEqual(await keys('none'), [['CRM', null]])
    await assert.rejects(() => projects.updateProject(ctx.manager, a.id, { area_id: 'nada' }), (err) => err.code === 'VALIDATION_ERROR' && err.details.fields.area_id === 'invalid_option')
    await assert.rejects(() => projects.listProjects(ctx.manager, { area_id: 'a b' }), { code: 'VALIDATION_ERROR' })
  })

  it('área inativa: não se escolhe, mas continua no projeto que já a tinha', async () => {
    const { deps, projects, ctx } = await setup()
    const areas = createLookupService(deps, 'area')
    const ti = await areas.create(ctx.admin, { key: 'TI', name: 'Dpto. TI' })
    const a = await projects.createProject(ctx.manager, input({ area_id: ti.id }))
    await areas.update(ctx.admin, ti.id, { is_active: false })
    assert.equal((await projects.updateProject(ctx.manager, a.id, { name: 'CRM 2', area_id: ti.id })).area.name, 'Dpto. TI')
    await assert.rejects(() => projects.createProject(ctx.manager, input({ name: 'X', key: 'XYZ', area_id: ti.id })), { code: 'VALIDATION_ERROR' })
  })
})

describe('application/projects — projeto pai (§34)', () => {
  it('cria o subprojeto ligado ao pai; o pai mostra a quantidade de filhos e o histórico guarda o nome', async () => {
    const { deps, projects, ctx } = await setup()
    const crm = await projects.createProject(ctx.manager, input({ name: 'Portal CRM', key: 'CRM' }))
    const fvb = await projects.createProject(ctx.manager, input({ name: 'Força de Vendas Brasil', key: 'FVB', parent_id: crm.id }))
    assert.deepEqual(fvb.parent, { id: crm.id, key: 'CRM', name: 'Portal CRM', icon: crm.icon, cover: crm.cover })
    assert.equal(fvb.child_count, 0)
    assert.equal(crm.parent, null)
    assert.equal((await projects.getProject(ctx.manager, crm.id)).child_count, 1)
    assert.equal(deps.store.audit.at(-1).newValue.parent_project, 'Portal CRM')
    const keys = async (parent) => (await projects.listProjects(ctx.manager, { parent_id: parent })).items.map((p) => p.key)
    assert.deepEqual(await keys(crm.id), ['FVB'])
    assert.deepEqual(await keys('none'), ['CRM'])
    assert.equal((await projects.listProjects(ctx.manager, {})).items.find((p) => p.key === 'CRM').child_count, 1)
    await assert.rejects(() => projects.listProjects(ctx.manager, { parent_id: 'x;y' }), { code: 'VALIDATION_ERROR' })
  })

  it('liga, troca e solta o pai na edição, com histórico', async () => {
    const { deps, projects, ctx } = await setup()
    const crm = await projects.createProject(ctx.manager, input({ name: 'Portal CRM', key: 'CRM' }))
    const erp = await projects.createProject(ctx.manager, input({ name: 'ERP', key: 'ERP' }))
    const gcs = await projects.createProject(ctx.manager, input({ name: 'GCS', key: 'GCS' }))
    assert.equal((await projects.updateProject(ctx.manager, gcs.id, { parent_id: crm.id })).parent.key, 'CRM')
    assert.equal((await projects.updateProject(ctx.manager, gcs.id, { parent_id: erp.id })).parent.key, 'ERP')
    const entry = deps.store.audit.at(-1)
    assert.deepEqual([entry.oldValue.parent_project, entry.newValue.parent_project], ['Portal CRM', 'ERP'])
    assert.equal((await projects.updateProject(ctx.manager, gcs.id, { parent_id: null })).parent, null)
    assert.deepEqual([deps.store.audit.at(-1).oldValue.parent_project, deps.store.audit.at(-1).newValue.parent_project], ['ERP', null])
  })

  it('um só nível: nem ele mesmo, nem filho como pai, nem pai virando filho, nem pai arquivado', async () => {
    const { projects, ctx } = await setup()
    const crm = await projects.createProject(ctx.manager, input({ name: 'Portal CRM', key: 'CRM' }))
    const fvb = await projects.createProject(ctx.manager, input({ name: 'FVB', key: 'FVB', parent_id: crm.id }))
    const erp = await projects.createProject(ctx.manager, input({ name: 'ERP', key: 'ERP' }))
    const issue = async (fn) => {
      try {
        await fn()
      } catch (err) {
        return err.details.fields.parent_id
      }
      return null
    }
    assert.equal(await issue(() => projects.updateProject(ctx.manager, crm.id, { parent_id: crm.id })), 'self')
    assert.equal(await issue(() => projects.createProject(ctx.manager, input({ key: 'NETO', parent_id: fvb.id }))), 'parent_is_child')
    assert.equal(await issue(() => projects.updateProject(ctx.manager, crm.id, { parent_id: erp.id })), 'has_children')
    assert.equal(await issue(() => projects.createProject(ctx.manager, input({ key: 'X1', parent_id: 'nada' }))), 'invalid_option')
    await projects.archiveProject(ctx.manager, erp.id)
    assert.equal(await issue(() => projects.createProject(ctx.manager, input({ key: 'X2', parent_id: erp.id }))), 'parent_archived')
  })

  it('só liga a um pai que a pessoa pode editar (o pai invisível é opção inválida)', async () => {
    const { deps, projects, users, ctx } = await setup()
    const crm = await projects.createProject(ctx.manager, input({ name: 'Portal CRM', key: 'CRM' }))
    await deps.projectMemberRepository.add({ projectId: crm.id, userId: users.member.id, role: 'viewer' })
    const outra = await seedUser(deps, { name: 'Outra gestora', roleCode: 'MANAGER' })
    const ctxOutra = await ctxOf(deps, outra)
    await assert.rejects(
      () => projects.createProject(ctxOutra, input({ key: 'SUB', parent_id: crm.id })),
      (err) => err.code === 'VALIDATION_ERROR' && err.details.fields.parent_id === 'invalid_option',
    )
    // leitora do pai também não liga
    await deps.projectMemberRepository.add({ projectId: crm.id, userId: outra.id, role: 'viewer' })
    await assert.rejects(() => projects.createProject(ctxOutra, input({ key: 'SUB', parent_id: crm.id })), (err) => err.details.fields.parent_id === 'invalid_option')
  })

  it('excluir o pai solta os subprojetos; ser membro do pai não dá acesso ao filho', async () => {
    const { deps, projects, users, ctx } = await setup()
    const crm = await projects.createProject(ctx.manager, input({ name: 'Portal CRM', key: 'CRM' }))
    const fvb = await projects.createProject(ctx.manager, input({ name: 'FVB', key: 'FVB', parent_id: crm.id }))
    await deps.projectMemberRepository.add({ projectId: crm.id, userId: users.member.id, role: 'member' })
    await assert.rejects(() => projects.getProject(ctx.member, fvb.id), { code: 'PROJECT_NOT_FOUND' })
    await projects.archiveProject(ctx.manager, crm.id)
    await projects.deleteProject(ctx.admin, crm.id)
    assert.equal((await projects.getProject(ctx.manager, fvb.id)).parent, null)
  })
})

describe('application/projects — seções do projeto (§35)', () => {
  it('o perfil decide as seções; sem a seção Membros, não gerencia membros', async () => {
    const { deps, projects, users, ctx } = await setup()
    const crm = await projects.createProject(ctx.admin, input({ name: 'Portal CRM', key: 'CRM' }))
    const role = await deps.roleRepository.create({ code: 'SEM_MEMBROS', name: 'Gestor sem membros', isSystem: false })
    await deps.roleRepository.setPermissionCodes(role.id, ['projects.view', 'projects.edit', 'projects.charter'])
    const limited = await seedUser(deps, { name: 'Gestor restrito', roleCode: 'SEM_MEMBROS' })
    await deps.projectMemberRepository.add({ projectId: crm.id, userId: limited.id, role: 'manager' })
    const ctxLimited = await ctxOf(deps, limited)
    const seen = await projects.getProject(ctxLimited, crm.id)
    assert.deepEqual(seen.capabilities.sections, ['charter'])
    assert.equal(seen.capabilities.manage_members, false)
    assert.equal(seen.capabilities.edit, true)
    await assert.rejects(() => projects.addMember(ctxLimited, crm.id, { user_id: users.member.id, role: 'member' }), { code: 'FORBIDDEN' })
    await assert.rejects(() => projects.memberCandidates(ctxLimited, crm.id, {}), { code: 'FORBIDDEN' })
    // a lista continua servindo para escolher pessoas (responsável, filtros)
    assert.ok((await projects.listMembers(ctxLimited, crm.id)).length >= 2)
    assert.deepEqual((await projects.getProject(ctx.admin, crm.id)).capabilities.sections, ['charter', 'history', 'members', 'report'])
  })
})

describe('application/projects — cor única e subprojetos (§24)', () => {
  it('sem cor escolhida, cada projeto novo ganha a próxima cor livre', async () => {
    const { projects, ctx } = await setup()
    const a = await projects.createProject(ctx.manager, input({ key: 'AAA' }))
    const b = await projects.createProject(ctx.manager, input({ key: 'BBB' }))
    assert.equal(a.cover, 'violet')
    assert.equal(b.cover, 'indigo')
    const covers = await projects.projectCovers(ctx.manager, {})
    assert.deepEqual(covers.used.sort(), ['indigo', 'violet'])
    assert.equal(covers.suggested, 'blue')
  })

  it('rejeita a cor de outro projeto, na criação e na edição', async () => {
    const { projects, ctx } = await setup()
    const a = await projects.createProject(ctx.manager, input({ key: 'AAA', cover: '#123456' }))
    await assert.rejects(() => projects.createProject(ctx.manager, input({ key: 'BBB', cover: '#123456' })), (err) => err.details.fields.cover === 'color_in_use')
    const b = await projects.createProject(ctx.manager, input({ key: 'BBB' }))
    await assert.rejects(() => projects.updateProject(ctx.manager, b.id, { cover: a.cover }), (err) => err.details.fields.cover === 'color_in_use')
    // a própria cor continua aceita (o formulário reenvia tudo)
    const same = await projects.updateProject(ctx.manager, a.id, { name: 'Outro nome', cover: '#123456' })
    assert.equal(same.cover, '#123456')
  })

  it('subprojeto usa a cor e o ícone do pai e acompanha quando o pai muda', async () => {
    const { projects, ctx } = await setup()
    const parent = await projects.createProject(ctx.manager, input({ key: 'PAI', icon: 'rocket', cover: '#0369a1' }))
    const child = await projects.createProject(ctx.manager, input({ key: 'FILHO', icon: 'star', cover: 'red', parent_id: parent.id }))
    assert.equal(child.cover, '#0369a1')
    assert.equal(child.icon, 'rocket')
    await projects.updateProject(ctx.manager, parent.id, { cover: '#7e22ce', icon: 'globe' })
    const after = await projects.getProject(ctx.manager, child.id)
    assert.equal(after.cover, '#7e22ce')
    assert.equal(after.icon, 'globe')
    // o subprojeto não troca de cor sozinho
    const kept = await projects.updateProject(ctx.manager, child.id, { cover: 'red' })
    assert.equal(kept.cover, '#7e22ce')
  })

  it('ao deixar de ser subprojeto, ganha uma cor própria', async () => {
    const { projects, ctx } = await setup()
    const parent = await projects.createProject(ctx.manager, input({ key: 'PAI' }))
    const child = await projects.createProject(ctx.manager, input({ key: 'FILHO', parent_id: parent.id }))
    const detached = await projects.updateProject(ctx.manager, child.id, { parent_id: null })
    assert.notEqual(detached.cover, parent.cover)
  })
})
