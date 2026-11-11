/**
 * Controle de acesso por usuário: junta o perfil (o que cada módulo deixa ver e fazer) e a participação
 * nos projetos (quem entra em cada projeto). A autorização real continua no backend (domain/rbac);
 * aqui ficam as regras da tela: dependências entre permissões, nível de acesso a um projeto e o resumo.
 */
import type { PermissionCode } from './permissions'
import type { MemberRole, ProjectMember } from './projects'

export interface AccessModule {
  module: string
  /** Permissão que deixa ver o módulo (sem ela, nenhuma ação do módulo vale). */
  view: PermissionCode | null
  actions: PermissionCode[]
  /** Partes do módulo que a pessoa vê (só Projetos: as seções de cada projeto, regras §35). */
  sections?: PermissionCode[]
}

export const ACCESS_MODULES: AccessModule[] = [
  {
    module: 'projects',
    view: 'projects.view',
    actions: ['projects.view_all', 'projects.create', 'projects.edit', 'projects.delete'],
    sections: ['projects.charter', 'projects.history', 'projects.members', 'projects.report'],
  },
  { module: 'tasks', view: 'tasks.view', actions: ['tasks.create', 'tasks.edit', 'tasks.assign', 'tasks.link', 'tasks.fork', 'tasks.delete'] },
  { module: 'kanban', view: 'kanban.view', actions: [] },
  { module: 'plan', view: 'plan.view', actions: ['plan.edit', 'plan.manage'] },
  { module: 'reports', view: 'reports.view', actions: [] },
  { module: 'executive', view: 'executive.view', actions: [] },
  { module: 'docs', view: 'docs.view', actions: ['docs.edit', 'docs.manage'] },
  { module: 'users', view: 'users.view', actions: ['users.create', 'users.edit', 'users.disable'] },
  { module: 'audit', view: 'audit.view', actions: [] },
  { module: 'settings', view: null, actions: ['settings.manage', 'permissions.manage', 'platform.manage', 'integrations.manage', 'api_tokens.create'] },
]

const moduleOf = (code: PermissionCode) => ACCESS_MODULES.find((m) => m.view === code || m.actions.includes(code) || (m.sections ?? []).includes(code))

/**
 * O que a pessoa vê dentro de cada projeto, na ordem das abas do projeto: as seções próprias do projeto
 * (Ficha, Histórico, Membros, Informe) e os módulos que também aparecem nele (Gestão, Tarefas, Kanban).
 * A Visão geral sempre aparece; o dono do projeto vê tudo.
 */
export const PROJECT_SECTION_CHIPS: { key: string; code: PermissionCode }[] = [
  { key: 'charter', code: 'projects.charter' },
  { key: 'report', code: 'projects.report' },
  { key: 'members', code: 'projects.members' },
  { key: 'history', code: 'projects.history' },
]

/**
 * Liga ou desliga uma permissão mantendo a coerência: ligar uma ação (ou seção) liga também o "ver" do
 * módulo; desligar o "ver" desliga todas as ações e seções do módulo.
 */
export function togglePermission(current: readonly PermissionCode[], code: PermissionCode, on: boolean): PermissionCode[] {
  const set = new Set(current)
  const mod = moduleOf(code)
  if (on) {
    set.add(code)
    if (mod?.view) set.add(mod.view)
  } else {
    set.delete(code)
    if (mod && mod.view === code) mod.actions.concat(mod.sections ?? []).forEach((a) => set.delete(a))
  }
  return [...set].sort()
}

export function moduleVisible(perms: readonly PermissionCode[], mod: AccessModule): boolean {
  return mod.view ? perms.includes(mod.view) : mod.actions.some((a) => perms.includes(a))
}

export type ProjectAccess = 'owner' | MemberRole | 'none'

export function projectAccessOf(members: readonly ProjectMember[], userId: string): ProjectAccess {
  const found = members.find((m) => m.user.id === userId)
  if (!found) return 'none'
  return found.isOwner ? 'owner' : found.role
}

export interface AccessSummary {
  modulesVisible: number
  modulesTotal: number
  projectsWithAccess: number
  projectsTotal: number
  /** Vê todos os projetos pelo perfil (sem precisar ser membro). */
  seesAllProjects: boolean
}

export function accessSummary(perms: readonly PermissionCode[], projectAccess: readonly ProjectAccess[]): AccessSummary {
  const seesAllProjects = perms.includes('projects.view_all') && perms.includes('projects.view')
  return {
    modulesVisible: ACCESS_MODULES.filter((m) => moduleVisible(perms, m)).length,
    modulesTotal: ACCESS_MODULES.length,
    projectsWithAccess: seesAllProjects ? projectAccess.length : projectAccess.filter((a) => a !== 'none').length,
    projectsTotal: projectAccess.length,
    seesAllProjects,
  }
}

/** Código de um perfil próprio para a pessoa (ex.: "USR_DOUGLAS_MARTINS"), dentro do formato aceito pelo servidor. */
export function personalRoleCode(name: string, taken: readonly string[]): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 22)
  const base = `USR_${slug || 'PERFIL'}`
  let code = base
  for (let n = 2; taken.includes(code); n++) code = `${base}_${n}`.slice(0, 32)
  return code
}
