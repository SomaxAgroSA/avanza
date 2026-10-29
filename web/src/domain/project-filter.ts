import { PROJECT_STATUSES, type Project, type ProjectStatus } from './projects'

/**
 * Configurador do filtro de projetos — por pessoa e por tela (preferência `project_filter.<tela>`
 * na API). Define quais projetos aparecem no filtro de projeto de cada tela: só alguns status e/ou só
 * os projetos de que a pessoa participa (dona ou membro). Regras puras; a tela só as aplica.
 */

/** Telas que têm filtro de projeto (a chave da preferência é `project_filter.<tela>`). */
export const PROJECT_FILTER_SCREENS = ['kanban', 'planning', 'plan', 'timeline', 'tasks', 'reports', 'executive'] as const
export type ProjectFilterScreen = (typeof PROJECT_FILTER_SCREENS)[number]

/** Telas cuja API recebe um projeto só: o configurador restringe apenas as opções do filtro. */
export const OPTIONS_ONLY_SCREENS: readonly ProjectFilterScreen[] = ['tasks', 'reports']

export interface ProjectFilterSettings {
  /** Status permitidos; vazio = todos. */
  statuses: ProjectStatus[]
  /** Só projetos de que participo (dono ou membro). */
  membersOnly: boolean
}

export const DEFAULT_PROJECT_FILTER: ProjectFilterSettings = { statuses: [], membersOnly: false }

/** O que a regra precisa saber de um projeto. `status` nulo = desconhecido. */
export interface ProjectFilterSubject {
  id: string
  status: ProjectStatus | null
  member: boolean
}

export function projectFilterKey(screen: ProjectFilterScreen): string {
  return `project_filter.${screen}`
}

/** Projeto da lista geral: participa quando tem papel (dono, gestor, membro ou leitor). */
export function toProjectFilterSubject(project: Pick<Project, 'id' | 'status' | 'myRole'>): ProjectFilterSubject {
  return { id: project.id, status: project.status, member: project.myRole !== null }
}

/** Valor salvo (ou ausente) → configuração válida: status desconhecidos e repetidos saem, na ordem do catálogo. */
export function normalizeProjectFilter(value: Partial<ProjectFilterSettings> | null | undefined): ProjectFilterSettings {
  if (!value) return DEFAULT_PROJECT_FILTER
  const chosen = Array.isArray(value.statuses) ? value.statuses : []
  return {
    statuses: PROJECT_STATUSES.filter((status) => chosen.includes(status)),
    membersOnly: value.membersOnly === true,
  }
}

export function isDefaultProjectFilter(settings: ProjectFilterSettings): boolean {
  return settings.statuses.length === 0 && !settings.membersOnly
}

/** Marca/desmarca um status (resultado na ordem do catálogo). */
export function toggleProjectFilterStatus(settings: ProjectFilterSettings, status: ProjectStatus, checked: boolean): ProjectFilterSettings {
  const next = checked ? [...settings.statuses, status] : settings.statuses.filter((s) => s !== status)
  return normalizeProjectFilter({ ...settings, statuses: next })
}

export function allowedByProjectFilter(project: Pick<ProjectFilterSubject, 'status' | 'member'>, settings: ProjectFilterSettings): boolean {
  if (settings.membersOnly && !project.member) return false
  if (settings.statuses.length > 0 && (!project.status || !settings.statuses.includes(project.status))) return false
  return true
}

/**
 * Projetos que a tela mostra. `keep` = ids em uso (o projeto aberto, os já escolhidos): continuam na
 * lista mesmo fora da configuração, para o valor atual nunca sumir do filtro.
 */
export function filterProjectsBySettings<T>(
  list: readonly T[],
  settings: ProjectFilterSettings,
  subject: (item: T) => ProjectFilterSubject,
  keep: readonly string[] = [],
): T[] {
  if (isDefaultProjectFilter(settings)) return [...list]
  return list.filter((item) => {
    const s = subject(item)
    return keep.includes(s.id) || allowedByProjectFilter(s, settings)
  })
}

/**
 * Projetos a pedir à API numa visão que junta vários ("Todos os projetos"): `null` = sem restrição
 * (configuração padrão); senão, os permitidos mais os de `keep`. Lista vazia = nenhum projeto atende.
 */
export function scopedProjectIds(
  list: readonly ProjectFilterSubject[],
  settings: ProjectFilterSettings,
  keep: readonly string[] = [],
): string[] | null {
  if (isDefaultProjectFilter(settings)) return null
  return filterProjectsBySettings(list, settings, (p) => p, keep).map((p) => p.id)
}
