/**
 * Catálogo de permissões e perfis padrão (RBAC).
 *
 * O catálogo é definido pelo sistema (cada código corresponde a uma verificação no backend).
 * Quais perfis possuem cada permissão é configurável pelo administrador; a matriz abaixo
 * é apenas o estado inicial aplicado pela migração de seed.
 */

const PERMISSIONS = Object.freeze([
  { code: 'projects.view', module: 'projects' },
  { code: 'projects.create', module: 'projects' },
  { code: 'projects.edit', module: 'projects' },
  { code: 'projects.delete', module: 'projects' },
  { code: 'projects.view_all', module: 'projects' },

  { code: 'tasks.view', module: 'tasks' },
  { code: 'tasks.create', module: 'tasks' },
  { code: 'tasks.edit', module: 'tasks' },
  { code: 'tasks.delete', module: 'tasks' },
  { code: 'tasks.assign', module: 'tasks' },
  { code: 'tasks.fork', module: 'tasks' },
  { code: 'tasks.link', module: 'tasks' },

  { code: 'kanban.view', module: 'kanban' },
  { code: 'kanban.manage', module: 'kanban' },

  { code: 'users.view', module: 'users' },
  { code: 'users.create', module: 'users' },
  { code: 'users.edit', module: 'users' },
  { code: 'users.disable', module: 'users' },

  { code: 'reports.view', module: 'reports' },

  { code: 'docs.view', module: 'docs' },
  { code: 'docs.edit', module: 'docs' },
  { code: 'docs.manage', module: 'docs' },

  // Gerenciamento de Projetos: quadro do projeto (módulo à parte das tarefas)
  { code: 'plan.view', module: 'plan' },
  { code: 'plan.edit', module: 'plan' },
  { code: 'plan.manage', module: 'plan' },

  { code: 'audit.view', module: 'audit' },

  { code: 'settings.manage', module: 'settings' },
  { code: 'permissions.manage', module: 'settings' },
  // Configurador geral: segurança e identidade da plataforma (só Admin por padrão)
  { code: 'platform.manage', module: 'settings' },
  // Integrações: e-mail, webhooks e tokens de API de todos (só Admin por padrão)
  { code: 'integrations.manage', module: 'settings' },
  // tokens de API pessoais (acesso à API sem o navegador)
  { code: 'api_tokens.create', module: 'settings' },
])

const ROLE_CODES = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  MEMBER: 'MEMBER',
  VIEWER: 'VIEWER',
})

const ALL_CODES = PERMISSIONS.map((p) => p.code)

const DEFAULT_ROLE_PERMISSIONS = Object.freeze({
  // SUPER_ADMIN possui tudo implicitamente (ver rbac.can); a lista é só informativa.
  SUPER_ADMIN: ALL_CODES,
  ADMIN: ALL_CODES,
  MANAGER: [
    'projects.view', 'projects.create', 'projects.edit',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.assign', 'tasks.fork', 'tasks.link',
    'kanban.view', 'kanban.manage',
    'users.view',
    'reports.view',
    'docs.view', 'docs.edit', 'docs.manage',
    'plan.view', 'plan.edit', 'plan.manage',
    'api_tokens.create',
  ],
  MEMBER: [
    'projects.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign', 'tasks.fork', 'tasks.link',
    'kanban.view',
    'reports.view',
    'docs.view', 'docs.edit',
    'plan.view', 'plan.edit',
  ],
  VIEWER: ['projects.view', 'tasks.view', 'kanban.view', 'reports.view', 'docs.view', 'plan.view'],
})

const DEFAULT_ROLES = Object.freeze([
  { code: ROLE_CODES.SUPER_ADMIN, name: 'Super Admin', description: 'Full, unrestricted access' },
  { code: ROLE_CODES.ADMIN, name: 'Admin', description: 'Manages the platform and its settings' },
  { code: ROLE_CODES.MANAGER, name: 'Manager', description: 'Manages projects, boards and tasks' },
  { code: ROLE_CODES.MEMBER, name: 'Member', description: 'Works on tasks' },
  { code: ROLE_CODES.VIEWER, name: 'Viewer', description: 'Read-only access' },
])

function isKnownPermission(code) {
  return ALL_CODES.indexOf(code) >= 0
}

module.exports = { PERMISSIONS, ROLE_CODES, DEFAULT_ROLE_PERMISSIONS, DEFAULT_ROLES, isKnownPermission }
