const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const project = require('../../src/domain/project')
const { createPrincipal } = require('../../src/domain/rbac')

const principal = (permissions, userId = 'u1', roleCode = 'MEMBER') =>
  createPrincipal({ userId, roleId: 'r', roleCode, permissions })

const base = { id: 'p1', ownerId: 'owner', archivedAt: null }
const ALL = ['projects.view', 'projects.create', 'projects.edit', 'projects.delete']

describe('domain/project — chave', () => {
  it('normaliza e valida a chave', () => {
    assert.equal(project.normalizeKey('  crm2 '), 'CRM2')
    assert.equal(project.keyIssue('CRM'), null)
    assert.equal(project.keyIssue('C'), 'invalid_format')
    assert.equal(project.keyIssue('1ABC'), 'invalid_format')
    assert.equal(project.keyIssue('ABCDEFGHIJK'), 'invalid_format')
    assert.equal(project.keyIssue('CR-M'), 'invalid_format')
  })

  it('valida intervalo de datas', () => {
    assert.equal(project.datesIssue(new Date('2026-01-10'), new Date('2026-01-01')), 'due_before_start')
    assert.equal(project.datesIssue(new Date('2026-01-01'), new Date('2026-01-10')), null)
    assert.equal(project.datesIssue(null, new Date('2026-01-10')), null)
  })
})

describe('domain/project — acesso', () => {
  it('não membro sem projects.view_all não enxerga o projeto (404)', () => {
    const access = project.resolveAccess(principal(ALL), base, null)
    assert.equal(access.canView, false)
    assert.throws(() => project.assertAccess(access, base, 'view'), { code: 'PROJECT_NOT_FOUND' })
  })

  it('membro enxerga, mas só gestor edita e gerencia membros', () => {
    const member = project.resolveAccess(principal(ALL), base, { role: 'member' })
    assert.equal(member.canView, true)
    assert.throws(() => project.assertAccess(member, base, 'edit'), { code: 'FORBIDDEN' })

    const manager = project.resolveAccess(principal(ALL.concat('projects.members')), base, { role: 'manager' })
    assert.doesNotThrow(() => project.assertAccess(manager, base, 'edit'))
    assert.doesNotThrow(() => project.assertAccess(manager, base, 'manage_members'))
    // gerenciar membros também exige a seção Membros (§35)
    const noSection = project.resolveAccess(principal(ALL), base, { role: 'manager' })
    assert.throws(() => project.assertAccess(noSection, base, 'manage_members'), { code: 'FORBIDDEN' })
  })

  it('permissão global continua obrigatória mesmo para gestor', () => {
    const manager = project.resolveAccess(principal(['projects.view']), base, { role: 'manager' })
    assert.throws(() => project.assertAccess(manager, base, 'edit'), { code: 'FORBIDDEN' })
  })

  it('dono é gestor; projects.view_all dá acesso administrativo', () => {
    const owner = project.resolveAccess(principal(ALL, 'owner'), base, { role: 'member' })
    assert.equal(owner.role, 'owner')
    assert.doesNotThrow(() => project.assertAccess(owner, base, 'transfer'))

    const admin = project.resolveAccess(principal(ALL.concat('projects.view_all'), 'adm', 'ADMIN'), base, null)
    assert.equal(admin.canView, true)
    assert.doesNotThrow(() => project.assertAccess(admin, base, 'edit'))
  })

  it('projeto arquivado é somente leitura (exceto desarquivar e excluir)', () => {
    const archived = Object.assign({}, base, { archivedAt: new Date() })
    const manager = project.resolveAccess(principal(ALL.concat('projects.members')), archived, { role: 'manager' })
    assert.throws(() => project.assertAccess(manager, archived, 'edit'), { code: 'PROJECT_ARCHIVED' })
    assert.throws(() => project.assertAccess(manager, archived, 'manage_members'), { code: 'PROJECT_ARCHIVED' })
    assert.doesNotThrow(() => project.assertAccess(manager, archived, 'archive'))
  })

  it('excluir exige projects.delete, ser dono (ou view_all) e o projeto arquivado', () => {
    const owner = project.resolveAccess(principal(ALL, 'owner'), base, { role: 'manager' })
    assert.throws(() => project.assertAccess(owner, base, 'delete'), { code: 'PROJECT_NOT_ARCHIVED' })

    const archived = Object.assign({}, base, { archivedAt: new Date() })
    const archivedOwner = project.resolveAccess(principal(ALL, 'owner'), archived, { role: 'manager' })
    assert.doesNotThrow(() => project.assertAccess(archivedOwner, archived, 'delete'))

    const manager = project.resolveAccess(principal(ALL), archived, { role: 'manager' })
    assert.throws(() => project.assertAccess(manager, archived, 'delete'), { code: 'FORBIDDEN' })

    const noPermission = project.resolveAccess(principal(['projects.view', 'projects.edit'], 'owner'), archived, { role: 'manager' })
    assert.throws(() => project.assertAccess(noPermission, archived, 'delete'), { code: 'FORBIDDEN' })
  })

  it('SUPER_ADMIN acessa qualquer projeto', () => {
    const root = project.resolveAccess(principal([], 'root', 'SUPER_ADMIN'), base, null)
    assert.equal(root.canView, true)
    assert.equal(root.canEdit, true)
  })

  it('expõe capacidades para a interface', () => {
    const access = project.resolveAccess(principal(ALL.concat('projects.members')), base, { role: 'manager' })
    assert.deepEqual(project.capabilities(access, base), {
      edit: true,
      manage_members: true,
      archive: true,
      delete: false,
      transfer: false,
      upload_files: false,
      sections: ['members'],
    })
    // arquivos do projeto: enviar exige tasks.edit + colaborar (o leitor do projeto só vê)
    const withTasks = ALL.concat('tasks.edit')
    assert.equal(project.capabilities(project.resolveAccess(principal(withTasks), base, { role: 'manager' }), base).upload_files, true)
    assert.equal(project.capabilities(project.resolveAccess(principal(withTasks), base, { role: 'member' }), base).upload_files, true)
    assert.equal(project.capabilities(project.resolveAccess(principal(withTasks), base, { role: 'viewer' }), base).upload_files, false)
    const archived = Object.assign({}, base, { archivedAt: new Date() })
    assert.equal(project.capabilities(project.resolveAccess(principal(withTasks), archived, { role: 'manager' }), archived).upload_files, false)
  })
})

describe('domain/project — seções (§35)', () => {
  it('o perfil decide; o dono sempre vê; quem não vê o projeto recebe 404', () => {
    const perms = ALL.concat(['projects.charter', 'projects.members'])
    const member = project.resolveAccess(principal(perms), base, { role: 'member' })
    assert.deepEqual(project.capabilities(member, base).sections, ['charter', 'members'])
    assert.doesNotThrow(() => project.assertAccess(member, base, 'charter'))
    assert.throws(() => project.assertAccess(member, base, 'history'), { code: 'FORBIDDEN' })
    assert.throws(() => project.assertAccess(member, base, 'report'), { code: 'FORBIDDEN' })
    const owner = project.resolveAccess(principal(ALL, 'owner'), base, null)
    assert.deepEqual(project.capabilities(owner, base).sections, ['charter', 'history', 'members', 'report'])
    const outsider = project.resolveAccess(principal(perms), base, null)
    assert.throws(() => project.assertAccess(outsider, base, 'charter'), { code: 'PROJECT_NOT_FOUND' })
    assert.equal(project.canSeeSection(member, 'settings'), false)
  })
})

describe('domain/project — Responsável TI (§33)', () => {
  const PERMS = ['projects.view', 'projects.edit', 'tasks.view', 'tasks.edit']

  it('fica limitado: abre só o resumo; nada mais do projeto existe para ele', () => {
    const it = project.resolveAccess(principal(PERMS), base, { role: 'it' })
    assert.equal(it.limited, true)
    assert.equal(it.canView, false)
    assert.equal(it.canEdit, false)
    assert.equal(it.role, 'it')
    assert.doesNotThrow(() => project.assertAccess(it, base, 'brief'))
    for (const action of ['view', 'edit', 'manage_members', 'archive', 'transfer', 'delete']) {
      assert.throws(() => project.assertAccess(it, base, action), { code: 'PROJECT_NOT_FOUND' }, action)
    }
    for (const section of ['charter', 'history', 'members', 'report']) {
      assert.throws(() => project.assertAccess(it, base, section), { code: 'FORBIDDEN' }, section)
    }
    assert.deepEqual(project.capabilities(it, base), { edit: false, manage_members: false, archive: false, delete: false, transfer: false, upload_files: false, sections: [] })
  })

  it('a ficha abre só se o perfil tiver projects.charter (só leitura); as demais seções nunca', () => {
    const it = project.resolveAccess(principal(PERMS.concat(['projects.charter', 'projects.history', 'projects.members', 'projects.report'])), base, { role: 'it' })
    assert.deepEqual(project.capabilities(it, base).sections, ['charter'])
    assert.doesNotThrow(() => project.assertAccess(it, base, 'charter'))
    assert.throws(() => project.assertAccess(it, base, 'history'), { code: 'FORBIDDEN' })
    assert.throws(() => project.assertAccess(it, base, 'edit'), { code: 'PROJECT_NOT_FOUND' })
  })

  it('dono, projects.view_all e quem não tem projects.view nunca ficam limitados', () => {
    assert.equal(project.resolveAccess(principal(PERMS, 'owner'), base, { role: 'it' }).limited, false)
    const admin = project.resolveAccess(principal(PERMS.concat('projects.view_all'), 'adm'), base, { role: 'it' })
    assert.equal(admin.limited, false)
    assert.equal(admin.canView, true)
    const noView = project.resolveAccess(principal(['tasks.view']), base, { role: 'it' })
    assert.equal(noView.limited, false)
    assert.throws(() => project.assertAccess(noView, base, 'brief'), { code: 'PROJECT_NOT_FOUND' })
  })
})

describe('domain/project — projeto pai (§34)', () => {
  const crm = { id: 'crm', parentId: null, archivedAt: null }
  it('um só nível, nem ele mesmo, nem pai arquivado; pai que não se pode editar = invalid_option', () => {
    assert.equal(project.parentIssue(null, crm, false), null)
    assert.equal(project.parentIssue({ id: 'erp' }, crm, false), null)
    assert.equal(project.parentIssue(crm, crm, false), 'self')
    assert.equal(project.parentIssue(null, { id: 'fvb', parentId: 'crm' }, false), 'parent_is_child')
    assert.equal(project.parentIssue({ id: 'erp' }, crm, true), 'has_children')
    assert.equal(project.parentIssue(null, Object.assign({}, crm, { archivedAt: new Date() }), false), 'parent_archived')
    assert.equal(project.parentIssue(null, null, false), 'invalid_option')
  })
})
