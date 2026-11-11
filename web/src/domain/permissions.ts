/**
 * Catálogo de permissões conhecido pelo frontend (espelha backend/src/domain/permissions.js).
 * A UI usa permissões apenas para esconder/desabilitar ações — a autorização real é sempre do backend.
 */
export const PERMISSION_CODES = [
  'projects.view',
  'projects.create',
  'projects.edit',
  'projects.delete',
  'projects.view_all',
  // seções do projeto (regras §35): o que a pessoa vê dentro de cada projeto em que entra
  'projects.charter',
  'projects.history',
  'projects.members',
  'projects.report',
  'tasks.view',
  'tasks.create',
  'tasks.edit',
  'tasks.delete',
  'tasks.assign',
  'tasks.fork',
  'tasks.link',
  'kanban.view',
  'users.view',
  'users.create',
  'users.edit',
  'users.disable',
  'reports.view',
  'executive.view',
  'docs.view',
  'docs.edit',
  'docs.manage',
  'plan.view',
  'plan.edit',
  'plan.manage',
  'audit.view',
  'settings.manage',
  'permissions.manage',
  'platform.manage',
  'integrations.manage',
  'api_tokens.create',
] as const

export type PermissionCode = (typeof PERMISSION_CODES)[number]

export const SUPER_ADMIN_ROLE = 'SUPER_ADMIN'

export function isPermissionCode(value: string): value is PermissionCode {
  return (PERMISSION_CODES as readonly string[]).includes(value)
}

export function can(granted: readonly string[], permission: PermissionCode): boolean {
  return granted.includes(permission)
}

export function canAny(granted: readonly string[], permissions: readonly PermissionCode[]): boolean {
  return permissions.some((permission) => granted.includes(permission))
}

/** Módulo de uma permissão ("tasks.edit" -> "tasks"). */
export function permissionModule(code: string): string {
  return code.split('.')[0] ?? code
}
