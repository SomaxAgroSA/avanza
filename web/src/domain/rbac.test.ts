import { describe, expect, it } from 'vitest'
import type { CurrentUser, Role, User } from './entities'
import { assignableRoles, canGrantPermission, roleLockReason, sortRolesByHierarchy, userActions } from './rbac'
import type { PermissionCode } from './permissions'

const user = (id: string, status: User['status'] = 'active'): User => ({
  id,
  name: id,
  email: `${id}@x.com`,
  avatarUrl: null,
  status,
  roleId: 'r',
  locale: 'pt-BR',
  theme: 'system',
  emailNotifications: true,
  homePage: '',
  createdAt: null,
  updatedAt: null,
  lastLoginAt: null,
})

const current = (roleCode: string, permissions: PermissionCode[], roleId = `role-${roleCode}`): CurrentUser => ({
  user: user('me'),
  role: { id: roleId, code: roleCode, name: roleCode, description: '', isSystem: true, ongoingView: '' },
  permissions,
  session: null,
  platform: { panoramaEnabled: true },
})

const role = (code: string, permissions: PermissionCode[] = []): Role => ({
  id: `role-${code}`,
  code,
  name: code,
  description: '',
  ongoingView: '',
  isSystem: true,
  permissions,
  userCount: 0,
})

describe('domain/rbac', () => {
  it('bloqueia edição de SUPER_ADMIN, do próprio perfil e sem permissions.manage', () => {
    const admin = current('ADMIN', ['permissions.manage'])
    expect(roleLockReason(admin, role('SUPER_ADMIN'))).toBe('immutable')
    expect(roleLockReason(admin, role('ADMIN'))).toBe('own_role')
    expect(roleLockReason(admin, role('MEMBER'))).toBeNull()
    expect(roleLockReason(current('MEMBER', []), role('VIEWER'))).toBe('no_permission')
    expect(roleLockReason(null, role('VIEWER'))).toBe('no_permission')
  })

  it('SUPER_ADMIN pode editar o próprio perfil? não — perfil SUPER_ADMIN é imutável', () => {
    const root = current('SUPER_ADMIN', ['permissions.manage'])
    expect(roleLockReason(root, role('SUPER_ADMIN'))).toBe('immutable')
    expect(roleLockReason(root, role('ADMIN'))).toBeNull()
  })

  it('só concede permissões que possui', () => {
    const admin = current('ADMIN', ['permissions.manage', 'tasks.view'])
    expect(canGrantPermission(admin, 'tasks.view')).toBe(true)
    expect(canGrantPermission(admin, 'tasks.delete')).toBe(false)
    expect(canGrantPermission(current('SUPER_ADMIN', []), 'tasks.delete')).toBe(true)
  })

  it('filtra perfis atribuíveis', () => {
    const admin = current('ADMIN', ['users.create', 'tasks.view'])
    const roles = [role('SUPER_ADMIN'), role('VIEWER', ['tasks.view']), role('MANAGER', ['tasks.view', 'tasks.delete'])]
    expect(assignableRoles(admin, roles).map((r) => r.code)).toEqual(['VIEWER'])
    expect(assignableRoles(current('SUPER_ADMIN', []), roles)).toHaveLength(3)
  })

  it('ações sobre usuários respeitam permissões e protegem a si mesmo e o SUPER_ADMIN', () => {
    const admin = current('ADMIN', ['users.edit', 'users.disable'])
    expect(userActions(admin, user('other'), 'MEMBER')).toEqual(['edit', 'change_role', 'reset_password', 'disable'])
    expect(userActions(admin, user('other', 'disabled'), 'MEMBER')).toContain('enable')
    expect(userActions(admin, user('me'), 'ADMIN')).toEqual(['edit'])
    expect(userActions(admin, user('root'), 'SUPER_ADMIN')).toEqual([])
    expect(userActions(current('VIEWER', []), user('other'), 'MEMBER')).toEqual([])
  })
})

describe('sortRolesByHierarchy', () => {
  it('ordena perfis de sistema por privilégio e personalizados por nome', () => {
    const roles = [role('VIEWER'), { ...role('QA'), name: 'Zeta' }, role('SUPER_ADMIN'), { ...role('OPS'), name: 'Alfa' }, role('ADMIN')]
    expect(sortRolesByHierarchy(roles).map((r) => r.code)).toEqual(['SUPER_ADMIN', 'ADMIN', 'VIEWER', 'OPS', 'QA'])
  })
})
