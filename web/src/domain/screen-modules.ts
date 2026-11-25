/**
 * Os módulos do menu no "O que aparece" do perfil (Controle de acesso → Perfis, §48): em cada um, o "Lo ve" (a
 * permissão que mostra o módulo no menu), o que o perfil pode fazer (as permissões dos módulos de acesso, como hoje)
 * e os grupos de "O que aparece". Também diz, item a item, a permissão sem a qual a parte não aparece mesmo marcada
 * (o "O que aparece" só esconde; nunca dá acesso).
 */
import { can, type PermissionCode } from './permissions'
import type { ScreenGroup, ScreenKey } from './screens'

export type ScreenModuleId = 'tracking' | 'projects' | 'tasks' | 'kanban' | 'docs' | 'users' | 'settings'

export interface ScreenModule {
  module: ScreenModuleId
  /** O perfil vê o módulo no menu? */
  sees: (permissions: readonly string[]) => boolean
  /** Módulos de acesso (domain/access.ts#ACCESS_MODULES) cujas permissões aparecem em "O que pode fazer". */
  accessModules: string[]
  groups: ScreenGroup[]
}

const SETTINGS_PERMISSIONS: PermissionCode[] = ['platform.manage', 'integrations.manage', 'settings.manage', 'permissions.manage', 'audit.view']

export const SCREEN_MODULES: ScreenModule[] = [
  { module: 'tracking', sees: (p) => can(p, 'executive.view'), accessModules: ['executive', 'reports'], groups: ['tracking.blocks'] },
  {
    module: 'projects',
    sees: (p) => can(p, 'projects.view'),
    accessModules: ['projects', 'plan'],
    groups: ['projects.lists', 'projects.ongoing_views', 'projects.blocks', 'projects.tabs', 'projects.task_views'],
  },
  {
    module: 'tasks',
    sees: (p) => can(p, 'tasks.list') && can(p, 'tasks.view'),
    accessModules: ['tasks', 'task_list'],
    groups: ['tasks.screens', 'tasks.scopes', 'tasks.boxes', 'tasks.views', 'tasks.filters', 'tasks.create'],
  },
  { module: 'kanban', sees: (p) => can(p, 'kanban.view'), accessModules: ['kanban'], groups: [] },
  { module: 'docs', sees: (p) => can(p, 'docs.view'), accessModules: ['docs'], groups: ['docs.actions'] },
  { module: 'users', sees: (p) => can(p, 'users.view'), accessModules: ['users'], groups: [] },
  { module: 'settings', sees: (p) => SETTINGS_PERMISSIONS.some((code) => can(p, code)), accessModules: ['settings', 'audit'], groups: ['settings.menu'] },
]

/**
 * Partes que, além de marcadas, exigem uma permissão do perfil (sem ela, não aparecem): as seções do projeto
 * (Ficha, Informe, Membros, Histórico — §35, validadas também pela API), a Gestão, a Documentação, o Kanban, a caixa
 * Todas, os botões de criar, o Avisar e cada submenu de Configurações.
 */
export const SCREEN_REQUIRES: Partial<Record<ScreenKey, PermissionCode>> = {
  'projects.tabs.charter': 'projects.charter',
  'projects.tabs.report': 'projects.report',
  'projects.tabs.members': 'projects.members',
  'projects.tabs.history': 'projects.history',
  'projects.tabs.management': 'plan.view',
  'projects.tabs.docs': 'docs.view',
  'projects.task_views.kanban': 'kanban.view',
  'projects.blocks.team': 'tasks.view',
  'tasks.scopes.all': 'tasks.view',
  'tasks.boxes.all': 'projects.view_all',
  'tasks.create.project_task': 'tasks.create',
  'tasks.create.internal_demand': 'tasks.create',
  'docs.actions.notify': 'docs.edit',
  'settings.menu.general': 'platform.manage',
  'settings.menu.integrations': 'integrations.manage',
  'settings.menu.task_types': 'settings.manage',
  'settings.menu.custom_fields': 'settings.manage',
  'settings.menu.statuses': 'settings.manage',
  'settings.menu.priorities': 'settings.manage',
  'settings.menu.areas': 'settings.manage',
  'settings.menu.dependency_areas': 'settings.manage',
  'settings.menu.companies': 'platform.manage',
  'settings.menu.tags': 'settings.manage',
  'settings.menu.icons': 'settings.manage',
  'settings.menu.access': 'permissions.manage',
  'settings.menu.audit': 'audit.view',
}

/** A permissão que falta ao perfil para a parte aparecer (null = nada falta). */
export function missingPermission(permissions: readonly string[], key: ScreenKey): PermissionCode | null {
  const required = SCREEN_REQUIRES[key]
  return required && !can(permissions, required) ? required : null
}
