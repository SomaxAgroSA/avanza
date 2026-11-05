const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const project = require('../../pb_hooks/src/domain/project')
const { createPrincipal } = require('../../pb_hooks/src/domain/rbac')

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

    const manager = project.resolveAccess(principal(ALL), base, { role: 'manager' })
    assert.doesNotThrow(() => project.assertAccess(manager, base, 'edit'))
    assert.doesNotThrow(() => project.assertAccess(manager, base, 'manage_members'))
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
    const manager = project.resolveAccess(principal(ALL), archived, { role: 'manager' })
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
    const access = project.resolveAccess(principal(ALL), base, { role: 'manager' })
    assert.deepEqual(project.capabilities(access, base), {
      edit: true,
      manage_members: true,
      archive: true,
      delete: false,
      transfer: false,
      sections: [],
    })
  })

  it('seções do projeto (§26): o perfil decide; o dono sempre vê', () => {
    const perms = ALL.concat(['projects.charter', 'projects.members'])
    const member = project.resolveAccess(principal(perms), base, { role: 'member' })
    assert.deepEqual(project.capabilities(member, base).sections, ['charter', 'members'])
    assert.doesNotThrow(() => project.assertAccess(member, base, 'charter'))
    assert.throws(() => project.assertAccess(member, base, 'history'), { code: 'FORBIDDEN' })
    const owner = project.resolveAccess(principal(ALL, 'owner'), base, null)
    assert.deepEqual(project.capabilities(owner, base).sections, ['charter', 'history', 'members', 'report'])
    const outsider = project.resolveAccess(principal(perms), base, null)
    assert.throws(() => project.assertAccess(outsider, base, 'charter'), { code: 'PROJECT_NOT_FOUND' })
  })
})
