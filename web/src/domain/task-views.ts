/**
 * Tarefas por perfil (ajustes 23 e 24/11/2026), hoje parte do "O que aparece" do perfil (§48, domain/screens.ts):
 * a Lista, o alcance dela, as caixas da Caixa de entrada e onde o menu Tarefas abre. Só a tela: o que a pessoa pode
 * fazer continua nas permissões. `taskViewsOf` traduz o "O que aparece" para as regras desta tela.
 */
import { screenKey, shows, startItem, type ScreenSettings } from './screens'

/** Caixas da Caixa de entrada, na ordem da tela. */
export const INBOX_BOXES = ['received', 'assigned', 'requested', 'all'] as const
export type InboxBox = (typeof INBOX_BOXES)[number]
/** As caixas pessoais (as que o perfil esconde em `tasksHiddenBoxes`; a Todas fica em `tasksAllBox`). */
export const PERSONAL_BOXES = ['received', 'assigned', 'requested'] as const
export type PersonalBox = (typeof PERSONAL_BOXES)[number]

/** Onde o menu Tarefas abre: '' = Lista (como antes); 'inbox' = Recebidas; os demais, a caixa do nome. */
export type TasksStart = '' | 'inbox' | 'inbox_assigned' | 'inbox_requested' | 'inbox_all'
/**
 * A Lista: '' = "Minhas tarefas" e "Ver todas" (como antes); 'mine' = só "Minhas tarefas"; 'all' = só "Ver todas";
 * 'hidden' = sem a Lista.
 */
export type TasksList = '' | 'mine' | 'all' | 'hidden'
/** A caixa Todas da Caixa de entrada (que exige `projects.view_all`): '' = visível; 'hidden' = escondida. */
export type TasksAllBox = '' | 'hidden'

export interface TaskViews {
  tasksStart: TasksStart
  tasksList: TasksList
  tasksAllBox: TasksAllBox
  /** Caixas pessoais escondidas ([] = todas visíveis, como antes). */
  tasksHiddenBoxes: PersonalBox[]
}

/** Como antes dos ajustes (perfil sem escolha). */
export const DEFAULT_TASK_VIEWS: TaskViews = { tasksStart: '', tasksList: '', tasksAllBox: '', tasksHiddenBoxes: [] }

/** A caixa em que cada entrada abre (a Lista não tem caixa). */
export const START_BOX: Record<Exclude<TasksStart, ''>, InboxBox> = { inbox: 'received', inbox_assigned: 'assigned', inbox_requested: 'requested', inbox_all: 'all' }
/** A entrada de cada caixa. */
export const BOX_START: Record<InboxBox, Exclude<TasksStart, ''>> = { received: 'inbox', assigned: 'inbox_assigned', requested: 'inbox_requested', all: 'inbox_all' }

/**
 * As Tarefas do "O que aparece" do perfil (§48): `tasks.screens` (Lista, Caixa de entrada), `tasks.scopes`
 * (Minhas, Ver todas), `tasks.boxes` e o "Abre em" de `tasks.screens` e `tasks.boxes`. Sem a Caixa de entrada,
 * nenhuma caixa.
 */
export function taskViewsOf(screens: ScreenSettings): TaskViews {
  const list = shows(screens, 'tasks.screens.list')
  const inbox = shows(screens, 'tasks.screens.inbox')
  const tasksList: TasksList = !list ? 'hidden' : !shows(screens, 'tasks.scopes.all') ? 'mine' : !shows(screens, 'tasks.scopes.mine') ? 'all' : ''
  const box = startItem(screens, 'tasks.boxes') ?? 'received'
  return {
    tasksStart: startItem(screens, 'tasks.screens') === 'inbox' ? BOX_START[box] : '',
    tasksList,
    tasksAllBox: inbox && shows(screens, 'tasks.boxes.all') ? '' : 'hidden',
    tasksHiddenBoxes: PERSONAL_BOXES.filter((b) => !inbox || !shows(screens, screenKey('tasks.boxes', b))),
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

/**
 * Cabeçalho da Caixa de entrada (ajuste 25/11, aprovado em demonstração): `boxSwitch` — os botões das caixas, só
 * com mais de uma (com uma só não há o que escolher); `title` — sem a Lista e com uma caixa só, a tela se chama
 * "Caixa de entrada": no começo da linha vai o nome com o número, sem as abas Lista | Caixa de entrada.
 */
export function inboxHeader(views: TaskViews, boxes: readonly InboxBox[]): { boxSwitch: boolean; title: boolean } {
  const boxSwitch = boxes.length > 1
  return { boxSwitch, title: !boxSwitch && views.tasksList === 'hidden' }
}
