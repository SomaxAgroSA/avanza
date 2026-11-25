import type { PlatformFeatures } from '@/domain/entities'
import { can, type PermissionCode } from '@/domain/permissions'
import { PROJECT_LISTS, projectsEntryPath, type ProjectList } from '@/domain/project-lists'
import { platformNavItems, visibleNavItems, withProjectLists, type NavItem } from './nav-items'

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

/**
 * Item do menu (com o pai) para um caminho; o filho ganha do pai com o mesmo endereço ("Todos" em /projects). O
 * grupo que virou item de uma lista só (Projetos do perfil, ajuste 25/11) vale pelo endereço a que leva.
 */
function findItem(items: NavItem[], path: string): HomePageOption | null {
  for (const item of items) {
    const child = item.children?.find((c) => c.to === path && !c.hidden)
    if (child) return { path, labelKeys: [item.labelKey, child.labelKey] }
    if ((item.entry ?? item.to) === path && !item.children && !item.hidden) return { path, labelKeys: item.detailKey ? [item.labelKey, item.detailKey] : [item.labelKey] }
  }
  return null
}

const PANORAMA_PATH = '/tracking'

/** As quatro listas de Projetos (perfil sem escolha, como antes do ajuste 25/11). */
const ALL_LISTS: readonly ProjectList[] = PROJECT_LISTS

/**
 * Páginas iniciais que quem tem estas permissões consegue abrir (as do menu dela), na ordem do menu; das listas de
 * Projetos, só as que o perfil mostra (ajuste 25/11).
 */
export function homePageOptions(permissions: readonly PermissionCode[], features?: PlatformFeatures, projectLists: readonly ProjectList[] = ALL_LISTS): HomePageOption[] {
  const visible = withProjectLists(visibleNavItems(permissions, platformNavItems(features)), projectLists)
  return HOME_PAGE_PATHS.map((path) => findItem(visible, path)).filter((option): option is HomePageOption => option !== null)
}

/** Panorama desligado (§26.2): quem entraria nele vai para Tarefas; sem a Lista de tarefas (§44), para os projetos. */
export function panoramaOffPath(permissions: readonly PermissionCode[], projectLists: readonly ProjectList[] = ALL_LISTS): string {
  return can(permissions, 'tasks.list') && can(permissions, 'tasks.view') ? '/tasks' : projectsEntryPath(projectLists)
}

/**
 * Automática (como antes do §38): Panorama para quem vê o painel executivo (se ligado); senão, a lista de projetos
 * (a primeira que o perfil mostra, ajuste 25/11).
 */
export function automaticHomePath(permissions: readonly PermissionCode[], features?: PlatformFeatures, projectLists: readonly ProjectList[] = ALL_LISTS): string {
  if (!can(permissions, 'executive.view')) return projectsEntryPath(projectLists)
  return features && !features.panoramaEnabled ? panoramaOffPath(permissions, projectLists) : PANORAMA_PATH
}

/**
 * Para onde "/" leva: a página escolhida, se a pessoa ainda pode abri-la; senão, a automática. O Panorama
 * escolhido e desligado leva a Tarefas; a escolha fica guardada e volta a valer quando ele religa.
 */
export function resolveHomePath(homePage: string, permissions: readonly PermissionCode[], features?: PlatformFeatures, projectLists: readonly ProjectList[] = ALL_LISTS): string {
  if (homePage === PANORAMA_PATH && features && !features.panoramaEnabled) return panoramaOffPath(permissions, projectLists)
  const chosen = homePage ? homePageOptions(permissions, features, projectLists).find((option) => option.path === homePage) : undefined
  return chosen ? chosen.path : automaticHomePath(permissions, features, projectLists)
}
