import type { TeamActivity, TeamActivityProject, UserSummary } from '@/domain/projects'

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
