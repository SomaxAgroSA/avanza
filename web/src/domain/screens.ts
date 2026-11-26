/**
 * "O que aparece" por perfil (Controle de acesso → Perfis, regras §48, ADR-062): um mecanismo só para esconder
 * partes da tela — submenus, listas, caixas, visões, abas, blocos, filtros e botões — e dizer onde cada módulo
 * abre ("Abre em"). É só a tela: não tira permissão nenhuma (o servidor continua validando tudo).
 *
 * O perfil guarda o que está ESCONDIDO (chaves `<grupo>.<item>`); o resto aparece. Em cada grupo sempre fica ao
 * menos um item visível, menos nos grupos opcionais (`OPTIONAL_GROUPS`: botões que podem sumir todos). Catálogo espelhado de backend/src/domain/screens.js (o teste de paridade compara).
 */

/** Grupos do catálogo, na ordem da tela. */
export const SCREEN_CATALOG = {
  'tracking.blocks': ['synthesis', 'kpis', 'health', 'execution', 'attention', 'milestones'],
  'projects.lists': ['all', 'ongoing', 'finished', 'archived'],
  'projects.ongoing_views': ['management', 'executive'],
  'projects.blocks': ['kpis', 'dependencies', 'timeline', 'areas', 'status', 'team', 'table'],
  'projects.tabs': ['overview', 'charter', 'management', 'tasks', 'report', 'files', 'docs', 'members', 'history', 'settings'],
  'projects.task_views': ['list', 'kanban', 'planning', 'timeline'],
  'tasks.screens': ['list', 'inbox'],
  'tasks.scopes': ['mine', 'all'],
  'tasks.boxes': ['received', 'assigned', 'requested', 'all'],
  'tasks.views': ['list', 'timeline'],
  'tasks.filters': ['search', 'project', 'priority', 'urgency', 'responsible', 'assignee', 'company'],
  'tasks.create': ['project_task', 'internal_demand'],
  'tasks.row_actions': ['pin'],
  'docs.actions': ['notify', 'versions', 'pdf'],
  'settings.menu': ['general', 'integrations', 'task_types', 'custom_fields', 'statuses', 'priorities', 'areas', 'dependency_areas', 'companies', 'tags', 'icons', 'access', 'audit'],
} as const

export type ScreenGroup = keyof typeof SCREEN_CATALOG
export type ScreenItem<G extends ScreenGroup> = (typeof SCREEN_CATALOG)[G][number]
export type ScreenKey = { [G in ScreenGroup]: `${G}.${ScreenItem<G>}` }[ScreenGroup]

export const SCREEN_GROUPS = Object.keys(SCREEN_CATALOG) as ScreenGroup[]

/** Grupos com "Abre em" (onde a tela abre quando há mais de um visível). */
export const START_GROUPS = ['projects.lists', 'projects.ongoing_views', 'tasks.screens', 'tasks.boxes', 'tasks.views'] as const satisfies readonly ScreenGroup[]
export type StartGroup = (typeof START_GROUPS)[number]

/** Grupos que podem ficar sem nenhum item visível (§50: o "Fixar" das linhas da Lista; as fixadas continuam no topo). */
export const OPTIONAL_GROUPS = ['tasks.row_actions'] as const satisfies readonly ScreenGroup[]
export const isOptionalGroup = (group: ScreenGroup): boolean => (OPTIONAL_GROUPS as readonly string[]).includes(group)

/** Todas as chaves, na ordem do catálogo. */
export const SCREEN_KEYS: ScreenKey[] = SCREEN_GROUPS.flatMap((group) => SCREEN_CATALOG[group].map((item) => `${group}.${item}` as ScreenKey))

export const screenKey = <G extends ScreenGroup>(group: G, item: ScreenItem<G>): ScreenKey => `${group}.${item}` as ScreenKey

export const isStartGroup = (group: ScreenGroup): group is StartGroup => (START_GROUPS as readonly string[]).includes(group)

/** O que o perfil escolheu: as chaves escondidas (na ordem do catálogo) e o "Abre em" de cada grupo. */
export interface ScreenSettings {
  hidden: ScreenKey[]
  starts: Partial<Record<StartGroup, string>>
}

/** Sem escolha: tudo visível, cada grupo abre no primeiro. */
export const DEFAULT_SCREENS: ScreenSettings = { hidden: [], starts: {} }

const itemsOf = <G extends ScreenGroup>(group: G): readonly ScreenItem<G>[] => SCREEN_CATALOG[group]

/** O que veio da API ou da sessão, só com o conhecido: escondidas do catálogo e "Abre em" num item visível. */
export function toScreenSettings(hidden: unknown, starts: unknown): ScreenSettings {
  const list = Array.isArray(hidden) ? hidden : []
  const known = SCREEN_KEYS.filter((key) => list.includes(key))
  const source = starts && typeof starts === 'object' && !Array.isArray(starts) ? (starts as Record<string, unknown>) : {}
  const out: ScreenSettings['starts'] = {}
  START_GROUPS.forEach((group) => {
    const item = source[group]
    if (typeof item === 'string' && (itemsOf(group) as readonly string[]).includes(item) && !known.includes(`${group}.${item}` as ScreenKey)) out[group] = item
  })
  return { hidden: known, starts: out }
}

/** A parte aparece? */
export const shows = (settings: ScreenSettings, key: ScreenKey): boolean => !settings.hidden.includes(key)

/** Itens visíveis de um grupo, na ordem da tela (nunca vazio: um grupo todo escondido mostra tudo — menos o opcional). */
export function visibleItems<G extends ScreenGroup>(settings: ScreenSettings, group: G): ScreenItem<G>[] {
  const items = itemsOf(group)
  const visible = items.filter((item) => shows(settings, screenKey(group, item)))
  return visible.length || isOptionalGroup(group) ? visible : [...items]
}

/**
 * Onde o grupo abre: o "Abre em" do perfil, se aparece (e está entre os `available`, quando a tela restringe mais —
 * ex.: a caixa Todas só com `projects.view_all`); senão, o primeiro visível disponível. null = nenhum disponível.
 */
export function startItem<G extends StartGroup>(settings: ScreenSettings, group: G, available?: readonly ScreenItem<G>[]): ScreenItem<G> | null {
  const visible = visibleItems(settings, group).filter((item) => !available || available.includes(item))
  const wanted = settings.starts[group] as ScreenItem<G> | undefined
  return wanted && visible.includes(wanted) ? wanted : (visible[0] ?? null)
}

/**
 * Marca ou desmarca um item. Sempre fica ao menos um visível no grupo (desmarcar o último não muda nada) e o
 * "Abre em" acompanha: se o item escolhido saiu, a entrada cai (abre no primeiro visível).
 */
export function toggleScreen<G extends ScreenGroup>(settings: ScreenSettings, group: G, item: ScreenItem<G>, on: boolean): ScreenSettings {
  const key = screenKey(group, item)
  if (shows(settings, key) === on) return settings
  if (!on && !isOptionalGroup(group) && visibleItems(settings, group).length === 1) return settings
  const hidden = on ? settings.hidden.filter((k) => k !== key) : SCREEN_KEYS.filter((k) => k === key || settings.hidden.includes(k))
  const starts = { ...settings.starts }
  if (!on && isStartGroup(group) && starts[group] === item) delete starts[group]
  return { hidden, starts }
}

/** Escolhe o "Abre em" de um grupo (só entre os visíveis). */
export function chooseStart<G extends StartGroup>(settings: ScreenSettings, group: G, item: ScreenItem<G>): ScreenSettings {
  if (!shows(settings, screenKey(group, item))) return settings
  return { ...settings, starts: { ...settings.starts, [group]: item } }
}

/** É o último visível do grupo (não pode ser desmarcado)? */
export const isLastVisible = <G extends ScreenGroup>(settings: ScreenSettings, group: G, item: ScreenItem<G>): boolean => {
  if (isOptionalGroup(group)) return false
  const visible = visibleItems(settings, group)
  return visible.length === 1 && visible[0] === item
}
