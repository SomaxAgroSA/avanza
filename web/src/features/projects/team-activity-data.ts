import type { TFunction } from 'i18next'
import { formatRelative } from '@/core/utils/format'
import type { TeamActivity, TeamActivityAction, TeamActivityProject, UserSummary } from '@/domain/projects'

/** Quantas tarefas em que a pessoa agiu aparecem embaixo de cada projeto (o resto fica no "+N más"). */
export const ACTED_PREVIEW = 3

/** O primeiro nome ("Victor" de "Victor Martinetti"). */
export const firstName = (name: string) => name.split(' ')[0] ?? name

/** Por projeto: quem aparece na coluna "Trabajando" (trabalhando, ativo na semana ou em curso parado). */
export function activityByProject(data: TeamActivity | undefined): Map<string, Array<{ user: UserSummary; row: TeamActivityProject }>> {
  const out = new Map<string, Array<{ user: UserSummary; row: TeamActivityProject }>>()
  data?.people.forEach((person) =>
    person.projects.forEach((row) => {
      if (row.state === 'idle' && !row.stale) return
      const list = out.get(row.project.id) ?? []
      list.push({ user: person.user, row })
      out.set(row.project.id, list)
    }),
  )
  // quem está trabalhando primeiro
  const rank = (r: TeamActivityProject) => (r.state === 'working' ? 0 : r.stale ? 1 : 2)
  out.forEach((list) => list.sort((a, b) => rank(a.row) - rank(b.row) || b.row.inProgress - a.row.inProgress))
  return out
}

/** Texto da direita de um projeto do Equipo ahora ("3 mov. · hace 4 horas" — as ações da própria pessoa). */
export function teamMetric(t: TFunction, row: TeamActivityProject, locale: string): string {
  const when = formatRelative(row.lastActivity, locale)
  if (row.state === 'working') return t('team.metric.working', { count: row.inProgress })
  if (row.state === 'active') return t('team.metric.active', { count: row.actions, when })
  if (row.stale) return row.lastActivity ? t('team.metric.stale', { count: row.inProgress, when }) : t('team.metric.staleNever', { count: row.inProgress })
  return row.lastActivity ? t('team.metric.idle', { count: row.open, when }) : t('team.metric.openOnly', { count: row.open })
}

/** Em quantas tarefas a pessoa agiu na semana (somando os projetos mostrados). */
export function actedCount(projects: readonly TeamActivityProject[]): number {
  return projects.reduce((sum, row) => sum + row.recent, 0)
}

/** A ação em poucas palavras, para o cartão: "pasó a Prueba", "comentó", "adjuntó 1 archivo", "editó". */
export function actionText(t: TFunction, action: TeamActivityAction): string {
  switch (action.type) {
    case 'status_changed':
      return action.to ? t('team.action.status_changed', { to: action.to }) : t('team.action.edited')
    case 'step':
      return t(`team.action.step.${action.step ?? 'started'}`)
    case 'attached':
      return t('team.action.attached', { count: action.count ?? 1 })
    default:
      return t(`team.action.${action.type}`)
  }
}

/** A ação por extenso, para o painel: "Pasó de Desarrollo a Prueba", "Comentó: «…»". */
export function actionDetail(t: TFunction, action: TeamActivityAction): string {
  switch (action.type) {
    case 'status_changed':
      if (!action.to) return t('team.actionLong.edited')
      return action.from ? t('team.actionLong.status_changed', { from: action.from, to: action.to }) : t('team.actionLong.statusTo', { to: action.to })
    case 'step':
      return t(`team.actionLong.step.${action.step ?? 'started'}`)
    case 'commented':
      return action.excerpt ? t('team.actionLong.commented', { excerpt: action.excerpt }) : t('team.actionLong.commentedPlain')
    case 'attached':
      return t('team.actionLong.attached', { count: action.count ?? 1 })
    default:
      return t(`team.actionLong.${action.type}`)
  }
}
