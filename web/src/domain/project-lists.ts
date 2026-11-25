/**
 * Projetos por perfil (ajuste 25/11/2026), hoje parte do "O que aparece" do perfil (§48, `projects.lists` em
 * domain/screens.ts) — só a tela: as listas que aparecem no menu Projetos e onde ele abre ("Abre em"). Com uma só,
 * "Projetos" abre direto nela, sem submenu; entrar pelo endereço de uma lista escondida leva à de entrada. O que a
 * pessoa pode fazer continua nas permissões (a página de um projeto, por link direto, segue abrindo).
 */
import { startItem, visibleItems, type ScreenSettings } from './screens'

/** As listas do menu Projetos, na ordem do menu. */
export const PROJECT_LISTS = ['all', 'ongoing', 'finished', 'archived'] as const
export type ProjectList = (typeof PROJECT_LISTS)[number]

/** Endereço de cada lista. */
export const PROJECT_LIST_PATHS: Record<ProjectList, string> = {
  all: '/projects',
  ongoing: '/projects/ongoing',
  finished: '/projects/finished',
  archived: '/projects/archived',
}

/** Chave de i18n do nome de cada lista: o mesmo do menu. */
export const PROJECT_LIST_LABELS: Record<ProjectList, string> = {
  all: 'nav.projectsAll',
  ongoing: 'nav.projectsOngoing',
  finished: 'nav.projectsFinished',
  archived: 'nav.projectsArchived',
}

/**
 * As listas do perfil, com a de entrada ("Abre em") primeiro e as demais na ordem do menu. O menu segue a ordem dele
 * (só filtra por estas); a primeira é para onde Projetos leva.
 */
export function projectListsOf(screens: ScreenSettings): ProjectList[] {
  const start = startItem(screens, 'projects.lists') ?? 'all'
  return [start, ...visibleItems(screens, 'projects.lists').filter((list) => list !== start)]
}

/** A lista de um endereço (caminho exato, sem a barra final), ou null quando não é uma das quatro. */
export function projectListOf(pathname: string): ProjectList | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return PROJECT_LISTS.find((list) => PROJECT_LIST_PATHS[list] === path) ?? null
}

/** Para onde leva o menu Projetos: a lista de entrada (a primeira de `projectListsOf`). */
export const projectsEntryPath = (lists: readonly ProjectList[]): string => PROJECT_LIST_PATHS[lists[0] ?? 'all']

/**
 * Endereço de uma lista escondida → a primeira visível (null = pode abrir: é visível ou não é uma das listas,
 * como a página de um projeto ou "Meus projetos").
 */
export function hiddenListRedirect(pathname: string, lists: readonly ProjectList[]): string | null {
  const list = projectListOf(pathname)
  return list && !lists.includes(list) ? projectsEntryPath(lists) : null
}
