/**
 * Projetos por perfil (ajuste 25/11/2026), escolhido em Controle de acesso → Perfis — só a tela, como as Tarefas do
 * perfil: as listas que aparecem no menu Projetos. Com uma só, "Projetos" abre direto nela, sem submenu; entrar
 * pelo endereço de uma lista escondida leva à primeira visível. O que a pessoa pode fazer continua nas permissões
 * (a página de um projeto, por link direto, segue abrindo). A lista fechada é a do servidor
 * (backend/src/domain/permissions.js#PROJECT_LISTS).
 */

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

/** As listas de um perfil (da API ou da sessão): só as conhecidas, na ordem do menu; sem nenhuma, as quatro. */
export function toProjectLists(source: unknown): ProjectList[] {
  const values = Array.isArray(source) ? source : []
  const lists = PROJECT_LISTS.filter((list) => values.includes(list))
  return lists.length ? lists : [...PROJECT_LISTS]
}

/** A lista de um endereço (caminho exato, sem a barra final), ou null quando não é uma das quatro. */
export function projectListOf(pathname: string): ProjectList | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return PROJECT_LISTS.find((list) => PROJECT_LIST_PATHS[list] === path) ?? null
}

/** Para onde leva o menu Projetos: a primeira lista visível. */
export const projectsEntryPath = (lists: readonly ProjectList[]): string => PROJECT_LIST_PATHS[lists[0] ?? 'all']

/**
 * Endereço de uma lista escondida → a primeira visível (null = pode abrir: é visível ou não é uma das listas,
 * como a página de um projeto ou "Meus projetos").
 */
export function hiddenListRedirect(pathname: string, lists: readonly ProjectList[]): string | null {
  const list = projectListOf(pathname)
  return list && !lists.includes(list) ? projectsEntryPath(lists) : null
}

/** Marca ou desmarca uma lista no perfil, na ordem do menu. Sempre fica ao menos uma (desmarcar a última não muda nada). */
export function toggleProjectList(lists: readonly ProjectList[], list: ProjectList, on: boolean): ProjectList[] {
  if (lists.includes(list) === on || (!on && lists.length === 1)) return [...lists]
  return PROJECT_LISTS.filter((item) => (item === list ? on : lists.includes(item)))
}
