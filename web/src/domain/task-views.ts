/**
 * Tarefas por perfil (ajustes 23 e 24/11/2026), escolhido em Controle de acesso → Perfis — só a tela: cada
 * perfil vê o que precisa, sem se perder (o que a pessoa pode fazer continua nas permissões). No perfil marca-se
 * o que aparece (a Lista e cada caixa da Caixa de entrada) e onde o menu Tarefas abre. As listas fechadas são as
 * do servidor (backend/src/domain/permissions.js#TASK_VIEWS e #TASK_HIDDEN_BOXES).
 */

/** Caixas da Caixa de entrada, na ordem da tela. */
export const INBOX_BOXES = ['received', 'assigned', 'requested', 'all'] as const
export type InboxBox = (typeof INBOX_BOXES)[number]
/** As caixas pessoais (as que o perfil esconde em `tasksHiddenBoxes`; a Todas fica em `tasksAllBox`). */
export const PERSONAL_BOXES = ['received', 'assigned', 'requested'] as const
export type PersonalBox = (typeof PERSONAL_BOXES)[number]

/** Onde o menu Tarefas abre: '' = Lista (como antes); 'inbox' = Recebidas; os demais, a caixa do nome. */
export type TasksStart = '' | 'inbox' | 'inbox_assigned' | 'inbox_requested' | 'inbox_all'
/** A Lista: '' = todas as que a pessoa pode ver (como antes); 'mine' = só "Minhas tarefas"; 'hidden' = sem a Lista. */
export type TasksList = '' | 'mine' | 'hidden'
/** A caixa Todas da Caixa de entrada (que exige `projects.view_all`): '' = visível; 'hidden' = escondida. */
export type TasksAllBox = '' | 'hidden'

export interface TaskViews {
  tasksStart: TasksStart
  tasksList: TasksList
  tasksAllBox: TasksAllBox
  /** Caixas pessoais escondidas ([] = todas visíveis, como antes). */
  tasksHiddenBoxes: PersonalBox[]
}

export const TASKS_START_VALUES: readonly TasksStart[] = ['', 'inbox', 'inbox_assigned', 'inbox_requested', 'inbox_all']
export const TASKS_LIST_VALUES: readonly TasksList[] = ['', 'mine', 'hidden']
export const TASKS_ALL_BOX_VALUES: readonly TasksAllBox[] = ['', 'hidden']

/** Como antes dos ajustes (perfil sem escolha). */
export const DEFAULT_TASK_VIEWS: TaskViews = { tasksStart: '', tasksList: '', tasksAllBox: '', tasksHiddenBoxes: [] }

/** A caixa em que cada entrada abre (a Lista não tem caixa). */
export const START_BOX: Record<Exclude<TasksStart, ''>, InboxBox> = { inbox: 'received', inbox_assigned: 'assigned', inbox_requested: 'requested', inbox_all: 'all' }
/** A entrada de cada caixa. */
export const BOX_START: Record<InboxBox, Exclude<TasksStart, ''>> = { received: 'inbox', assigned: 'inbox_assigned', requested: 'inbox_requested', all: 'inbox_all' }

const pick = <T extends string>(values: readonly T[], value: unknown): T => (values.includes(value as T) ? (value as T) : values[0]!)

/** Os ajustes de um perfil (da API ou da sessão), com o padrão para o que faltar ou vier desconhecido. */
export function toTaskViews(source: { tasksStart?: unknown; tasksList?: unknown; tasksAllBox?: unknown; tasksHiddenBoxes?: unknown } | null | undefined): TaskViews {
  const hidden = Array.isArray(source?.tasksHiddenBoxes) ? source.tasksHiddenBoxes : []
  return {
    tasksStart: pick(TASKS_START_VALUES, source?.tasksStart),
    tasksList: pick(TASKS_LIST_VALUES, source?.tasksList),
    tasksAllBox: pick(TASKS_ALL_BOX_VALUES, source?.tasksAllBox),
    tasksHiddenBoxes: PERSONAL_BOXES.filter((box) => hidden.includes(box)),
  }
}

/** A caixa Todas aparece: quem vê todos os projetos e cujo perfil não a escondeu. */
export function showsAllBox(views: TaskViews, seesAll: boolean): boolean {
  return seesAll && views.tasksAllBox !== 'hidden'
}

/**
 * As caixas que a pessoa vê, na ordem da tela. Ninguém fica sem nada: se o perfil esconde a Lista e não sobra
 * caixa (ex.: só a Todas marcada, sem `projects.view_all`), volta a Recebidas por mim.
 */
export function visibleBoxes(views: TaskViews, seesAll: boolean): InboxBox[] {
  const boxes: InboxBox[] = PERSONAL_BOXES.filter((box) => !views.tasksHiddenBoxes.includes(box))
  if (showsAllBox(views, seesAll)) boxes.push('all')
  return boxes.length === 0 && views.tasksList === 'hidden' ? ['received'] : boxes
}

/** Endereço de uma caixa (Recebidas é a do endereço sem parâmetro). */
export const boxPath = (box: InboxBox): string => (box === 'received' ? '/tasks/demands' : `/tasks/demands?box=${box}`)

/** A caixa em que a Caixa de entrada abre: a da entrada do perfil, se a pessoa a vê; senão, a primeira visível. */
export function startBox(views: TaskViews, seesAll: boolean): InboxBox | null {
  const boxes = visibleBoxes(views, seesAll)
  const wanted = views.tasksStart === '' ? null : START_BOX[views.tasksStart]
  return wanted && boxes.includes(wanted) ? wanted : (boxes[0] ?? null)
}

/** A Caixa de entrada pela porta do perfil (sem caixa visível, a Lista). */
export function inboxPath(views: TaskViews, seesAll: boolean): string {
  const box = startBox(views, seesAll)
  return box ? boxPath(box) : '/tasks'
}

/**
 * Para onde leva o menu Tarefas: a Lista (padrão) ou a Caixa de entrada, na caixa escolhida. Sem a Lista, sempre
 * a Caixa de entrada; uma caixa que a pessoa não vê vira a primeira que ela vê.
 */
export function tasksEntryPath(views: TaskViews, seesAll: boolean): string {
  if (views.tasksStart === '' && views.tasksList !== 'hidden') return '/tasks'
  return inboxPath(views, seesAll)
}

/** As telas de Tarefas que o perfil marca em "O que aparece": a Lista e cada caixa, na ordem da tela. */
export const TASK_SCREENS = ['list', ...INBOX_BOXES] as const
export type TaskScreen = (typeof TASK_SCREENS)[number]

export const screenStart = (screen: TaskScreen): TasksStart => (screen === 'list' ? '' : BOX_START[screen])
export const startScreen = (start: TasksStart): TaskScreen => (start === '' ? 'list' : START_BOX[start])

/** As telas marcadas no perfil (o que ele escolheu; ver de fato a Todas ainda exige `projects.view_all`). */
export function shownScreens(views: TaskViews): TaskScreen[] {
  return TASK_SCREENS.filter((screen) =>
    screen === 'list' ? views.tasksList !== 'hidden' : screen === 'all' ? views.tasksAllBox !== 'hidden' : !views.tasksHiddenBoxes.includes(screen),
  )
}

/**
 * Marca ou desmarca uma tela no perfil. Sempre fica ao menos uma (desmarcar a última não muda nada) e a
 * entrada acompanha: se a tela em que o menu abria saiu, passa a abrir na primeira marcada.
 */
export function toggleScreen(views: TaskViews, screen: TaskScreen, on: boolean): TaskViews {
  const shown = shownScreens(views)
  if (shown.includes(screen) === on || (!on && shown.length === 1)) return views
  const next: TaskViews =
    screen === 'list'
      ? { ...views, tasksList: on ? '' : 'hidden' }
      : screen === 'all'
        ? { ...views, tasksAllBox: on ? '' : 'hidden' }
        : { ...views, tasksHiddenBoxes: PERSONAL_BOXES.filter((box) => (box === screen ? !on : views.tasksHiddenBoxes.includes(box))) }
  const left = shownScreens(next)
  return left.includes(startScreen(next.tasksStart)) ? next : { ...next, tasksStart: screenStart(left[0]!) }
}

/**
 * Cabeçalho da Caixa de entrada (ajuste 25/11, aprovado em demonstração): `boxSwitch` — os botões das caixas, só
 * com mais de uma (com uma só não há o que escolher); `title` — sem a Lista e com uma caixa só, a tela se chama
 * "Caixa de entrada": no começo da linha vai o nome com o número, sem as abas Lista | Caixa de entrada.
 */
export function inboxHeader(views: TaskViews, boxes: readonly InboxBox[]): { boxSwitch: boolean; title: boolean } {
  const boxSwitch = boxes.length > 1
  return { boxSwitch, title: !boxSwitch && views.tasksList === 'hidden' }
}
