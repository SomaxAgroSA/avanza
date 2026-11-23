/**
 * Tarefas por perfil (ajuste 23/11/2026), escolhido em Controle de acesso → Perfis — só a tela: cada perfil vê
 * o que precisa, sem se perder (o que a pessoa pode fazer continua nas permissões). As listas fechadas são as
 * do servidor (backend/src/domain/permissions.js#TASK_VIEWS).
 */

/** Onde o menu Tarefas abre: '' = Lista (como antes); 'inbox' = Caixa de entrada; 'inbox_all' = a caixa Todas. */
export type TasksStart = '' | 'inbox' | 'inbox_all'
/** A Lista: '' = todas as que a pessoa pode ver (como antes); 'mine' = só "Minhas tarefas"; 'hidden' = sem a Lista. */
export type TasksList = '' | 'mine' | 'hidden'
/** A caixa Todas da Caixa de entrada (que exige `projects.view_all`): '' = visível; 'hidden' = escondida. */
export type TasksAllBox = '' | 'hidden'

export interface TaskViews {
  tasksStart: TasksStart
  tasksList: TasksList
  tasksAllBox: TasksAllBox
}

export const TASKS_START_VALUES: readonly TasksStart[] = ['', 'inbox', 'inbox_all']
export const TASKS_LIST_VALUES: readonly TasksList[] = ['', 'mine', 'hidden']
export const TASKS_ALL_BOX_VALUES: readonly TasksAllBox[] = ['', 'hidden']

/** Como antes do ajuste (perfil sem escolha). */
export const DEFAULT_TASK_VIEWS: TaskViews = { tasksStart: '', tasksList: '', tasksAllBox: '' }

const pick = <T extends string>(values: readonly T[], value: unknown): T => (values.includes(value as T) ? (value as T) : values[0]!)

/** Os ajustes de um perfil (da API ou da sessão), com o padrão para o que faltar ou vier desconhecido. */
export function toTaskViews(source: { tasksStart?: unknown; tasksList?: unknown; tasksAllBox?: unknown } | null | undefined): TaskViews {
  return {
    tasksStart: pick(TASKS_START_VALUES, source?.tasksStart),
    tasksList: pick(TASKS_LIST_VALUES, source?.tasksList),
    tasksAllBox: pick(TASKS_ALL_BOX_VALUES, source?.tasksAllBox),
  }
}

/** A caixa Todas aparece: quem vê todos os projetos e cujo perfil não a escondeu. */
export function showsAllBox(views: TaskViews, seesAll: boolean): boolean {
  return seesAll && views.tasksAllBox !== 'hidden'
}

/** A Caixa de entrada pela porta do perfil: a caixa Todas quando é a escolhida e aparece; senão, Recebidas. */
export function inboxPath(views: TaskViews, seesAll: boolean): string {
  return views.tasksStart === 'inbox_all' && showsAllBox(views, seesAll) ? '/tasks/demands?box=all' : '/tasks/demands'
}

/**
 * Para onde leva o menu Tarefas: a Lista (padrão) ou a Caixa de entrada. Sem a Lista, sempre a Caixa de entrada;
 * "a caixa Todas" sem poder vê-la vira Recebidas.
 */
export function tasksEntryPath(views: TaskViews, seesAll: boolean): string {
  if (views.tasksStart === '' && views.tasksList !== 'hidden') return '/tasks'
  return inboxPath(views, seesAll)
}
