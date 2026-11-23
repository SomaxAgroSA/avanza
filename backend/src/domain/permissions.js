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
  // seções do projeto (regras §35): o que a pessoa vê dentro de cada projeto em que entra
  { code: 'projects.charter', module: 'projects' },
  { code: 'projects.history', module: 'projects' },
  { code: 'projects.members', module: 'projects' },
  { code: 'projects.report', module: 'projects' },

  { code: 'tasks.view', module: 'tasks' },
  { code: 'tasks.create', module: 'tasks' },
  { code: 'tasks.edit', module: 'tasks' },
  { code: 'tasks.delete', module: 'tasks' },
  { code: 'tasks.assign', module: 'tasks' },
  { code: 'tasks.fork', module: 'tasks' },
  { code: 'tasks.link', module: 'tasks' },
  // Lista de tarefas (§44): o item "Tarefas" do menu e a página /tasks; só de tela — a API das tarefas segue
  // tasks.view, que também governa as tarefas dentro de cada projeto. Sem tasks.view não serve para nada.
  { code: 'tasks.list', module: 'task_list' },

  { code: 'kanban.view', module: 'kanban' },

  { code: 'users.view', module: 'users' },
  { code: 'users.create', module: 'users' },
  { code: 'users.edit', module: 'users' },
  { code: 'users.disable', module: 'users' },

  { code: 'reports.view', module: 'reports' },
  // Painel executivo: Gestão de projetos + Kanban de todos os projetos, só leitura (Admin por padrão)
  { code: 'executive.view', module: 'executive' },

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
    'projects.view', 'projects.create', 'projects.edit', 'projects.charter', 'projects.history', 'projects.members', 'projects.report',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.assign', 'tasks.fork', 'tasks.link', 'tasks.list',
    'kanban.view',
    'users.view',
    'reports.view',
    'docs.view', 'docs.edit', 'docs.manage',
    'plan.view', 'plan.edit', 'plan.manage',
    'api_tokens.create',
  ],
  MEMBER: [
    'projects.view', 'projects.charter', 'projects.history', 'projects.members', 'projects.report',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign', 'tasks.fork', 'tasks.link', 'tasks.list',
    'kanban.view',
    'reports.view',
    'docs.view', 'docs.edit',
    'plan.view', 'plan.edit',
  ],
  VIEWER: ['projects.view', 'projects.charter', 'projects.history', 'projects.members', 'projects.report', 'tasks.view', 'tasks.list', 'kanban.view', 'reports.view', 'docs.view', 'plan.view'],
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

/**
 * Vista da lista "Em andamento" por perfil (§41), escolhida em Controle de acesso → Perfis. '' = Gestão
 * (a tela de sempre); 'executive' = Direção e gerência (painel de consulta). Só muda a tela, não o que a
 * pessoa pode fazer: isso continua nas permissões do perfil.
 */
const ONGOING_VIEWS = Object.freeze(['', 'executive', 'both'])

/**
 * Tarefas por perfil (ajuste 23/11/2026), escolhido em Controle de acesso → Perfis — só a tela, como a vista de
 * Em andamento: a pessoa enxerga o que precisa, sem se perder (o acesso continua nas permissões).
 * - tasks_start: onde o menu Tarefas abre — '' Lista; 'inbox' Caixa de entrada (Recebidas); 'inbox_assigned',
 *   'inbox_requested' e 'inbox_all' as caixas Atribuídas a mim, Pedidas por mim e Todas;
 * - tasks_list: a Lista — '' todas as que a pessoa pode ver; 'mine' só "Minhas tarefas"; 'hidden' sem a Lista;
 * - tasks_all_box: a caixa Todas da Caixa de entrada (que exige projects.view_all) — '' visível; 'hidden' não.
 */
const TASK_VIEWS = Object.freeze({
  tasks_start: Object.freeze(['', 'inbox', 'inbox_assigned', 'inbox_requested', 'inbox_all']),
  tasks_list: Object.freeze(['', 'mine', 'hidden']),
  tasks_all_box: Object.freeze(['', 'hidden']),
})

/**
 * Caixas pessoais da Caixa de entrada que o perfil pode esconder (ajuste 24/11/2026), na ordem da tela; a caixa
 * Todas fica em tasks_all_box. Gravadas em roles.tasks_hidden_boxes, separadas por vírgula.
 */
const TASK_HIDDEN_BOXES = Object.freeze(['received', 'assigned', 'requested'])

module.exports = { PERMISSIONS, ONGOING_VIEWS, TASK_VIEWS, TASK_HIDDEN_BOXES, ROLE_CODES, DEFAULT_ROLE_PERMISSIONS, DEFAULT_ROLES, isKnownPermission }
