import type { PlatformFeatures } from '@/domain/entities'
import { can, type PermissionCode } from '@/domain/permissions'
import { platformNavItems, visibleNavItems, type NavItem } from './nav-items'

/**
 * Telas que podem ser a página inicial de uma pessoa (regras §38) — a mesma lista fechada do servidor
 * (backend/src/domain/user.js#HOME_PAGES), sem o '' (automática).
 */
export const HOME_PAGE_PATHS = ['/tracking', '/projects', '/projects/ongoing', '/projects/finished', '/projects/archived', '/tasks', '/kanban', '/docs'] as const

export interface HomePageOption {
  path: string
  /** Chaves de i18n do rótulo: a seção e, quando é uma tela dentro dela, a tela (ex.: Proyectos › En marcha). */
  labelKeys: string[]
}

/** Item do menu (com o pai) para um caminho; o filho ganha do pai com o mesmo endereço ("Todos" em /projects). */
function findItem(items: NavItem[], path: string): HomePageOption | null {
  for (const item of items) {
    const child = item.children?.find((c) => c.to === path && !c.hidden)
    if (child) return { path, labelKeys: [item.labelKey, child.labelKey] }
    if (item.to === path && !item.children && !item.hidden) return { path, labelKeys: [item.labelKey] }
  }
  return null
}

const PANORAMA_PATH = '/tracking'

/** Páginas iniciais que quem tem estas permissões consegue abrir (as do menu dela), na ordem do menu. */
export function homePageOptions(permissions: readonly PermissionCode[], features?: PlatformFeatures): HomePageOption[] {
  const visible = visibleNavItems(permissions, platformNavItems(features))
  return HOME_PAGE_PATHS.map((path) => findItem(visible, path)).filter((option): option is HomePageOption => option !== null)
}

/** Panorama desligado (§26.2): quem entraria nele vai para Tarefas; sem a Lista de tarefas (§44), para os projetos. */
export function panoramaOffPath(permissions: readonly PermissionCode[]): string {
  return can(permissions, 'tasks.list') && can(permissions, 'tasks.view') ? '/tasks' : '/projects'
}

/** Automática (como antes do §38): Panorama para quem vê o painel executivo (se ligado); senão, a lista de projetos. */
export function automaticHomePath(permissions: readonly PermissionCode[], features?: PlatformFeatures): string {
  if (!can(permissions, 'executive.view')) return '/projects'
  return features && !features.panoramaEnabled ? panoramaOffPath(permissions) : PANORAMA_PATH
}

/**
 * Para onde "/" leva: a página escolhida, se a pessoa ainda pode abri-la; senão, a automática. O Panorama
 * escolhido e desligado leva a Tarefas; a escolha fica guardada e volta a valer quando ele religa.
 */
export function resolveHomePath(homePage: string, permissions: readonly PermissionCode[], features?: PlatformFeatures): string {
  if (homePage === PANORAMA_PATH && features && !features.panoramaEnabled) return panoramaOffPath(permissions)
  const chosen = homePage ? homePageOptions(permissions, features).find((option) => option.path === homePage) : undefined
  return chosen ? chosen.path : automaticHomePath(permissions, features)
}
