/**
 * Equipo ahora: em que projeto cada pessoa está trabalhando, a partir das tarefas atribuídas a ela.
 *
 * - Só projetos em andamento (planejamento, em curso ou pausado, não arquivados) que a pessoa vê por
 *   inteiro (o Responsável TI, que vê só o resumo, fica de fora) e com `tasks.view`.
 * - Por pessoa e projeto: tarefas em andamento (categoria in_progress), tarefas que mudaram na janela
 *   (7 dias), abertas e a última atividade. "Parada" = tem tarefa em andamento, mas nada mudou na janela.
 * - Cada projeto traz as tarefas por trás dos números (o "+" da tela): em andamento, as que mudaram e,
 *   sem nenhuma delas, as abertas — até 20, da mais recente para a mais antiga.
 * A última mudança da tarefa vale como atividade de quem é o responsável por ela.
 */

const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const { iso, toUserSummary } = require('./presenters')

const WINDOW_DAYS = 7
const OPEN_STATUSES = ['planning', 'active', 'paused']
const CLOSED = ['done', 'cancelled']
const MAX_TASKS = 20

function createTeamActivityService(deps) {
  async function getTeamActivity(ctx) {
    rbac.assertAuthenticated(ctx.principal)
    rbac.assertCan(ctx.principal, 'projects.view')
    const now = deps.clock.now()
    const since = new Date(now.getTime() - WINDOW_DAYS * 864e5)
    const empty = { window_days: WINDOW_DAYS, generated_at: iso(now), people: [] }
    if (!rbac.can(ctx.principal, 'tasks.view')) return empty

    const open = (await deps.projectRepository.listAll()).filter((p) => !p.archivedAt && OPEN_STATUSES.indexOf(p.status) >= 0)
    const roles = open.length ? await deps.projectMemberRepository.rolesForUser(ctx.principal.userId, open.map((p) => p.id)) : {}
    const visible = open.filter((p) => {
      const access = projectDomain.resolveAccess(ctx.principal, p, roles[p.id] ? { role: roles[p.id] } : null)
      return access.canView && !access.limited
    })
    if (visible.length === 0) return empty
    const projects = new Map(visible.map((p) => [p.id, p]))

    // pessoa → projeto → números e tarefas
    const byPerson = new Map()
    for (const task of await deps.taskRepository.listActivity([...projects.keys()], since)) {
      const closed = CLOSED.indexOf(task.status.category) >= 0
      const moved = task.updatedAt && new Date(task.updatedAt) >= since
      if (closed && !moved) continue
      if (!byPerson.has(task.assigneeId)) byPerson.set(task.assigneeId, new Map())
      const perProject = byPerson.get(task.assigneeId)
      if (!perProject.has(task.projectId)) perProject.set(task.projectId, { in_progress: 0, recent: 0, open: 0, last: null, tasks: [] })
      const entry = perProject.get(task.projectId)
      const running = task.status.category === 'in_progress'
      if (running) entry.in_progress++
      if (moved) entry.recent++
      if (!closed) entry.open++
      if (task.updatedAt && (!entry.last || new Date(task.updatedAt) > entry.last)) entry.last = new Date(task.updatedAt)
      entry.tasks.push({ task, running, moved })
    }

    const users = new Map()
    const ids = [...byPerson.keys()]
    ;(ids.length ? await deps.userRepository.findManyByIds(ids) : []).forEach((u) => users.set(u.id, u))

    const people = []
    for (const [userId, perProject] of byPerson) {
      const user = users.get(userId)
      if (!user) continue
      const list = []
      for (const [projectId, e] of perProject) {
        const project = projects.get(projectId)
        const stale = e.in_progress > 0 && e.recent === 0
        const behind = e.tasks.filter((x) => x.running || x.moved)
        const shown = (behind.length ? behind : e.tasks)
          .sort((a, b) => Number(b.running) - Number(a.running) || new Date(b.task.updatedAt) - new Date(a.task.updatedAt))
          .slice(0, MAX_TASKS)
        list.push({
          project: { id: project.id, key: project.key, name: project.name, icon: project.icon || 'folder', cover: project.cover || 'violet' },
          state: e.in_progress > 0 && !stale ? 'working' : e.recent > 0 ? 'active' : 'idle',
          in_progress: e.in_progress,
          recent: e.recent,
          open: e.open,
          stale,
          last_activity: iso(e.last),
          tasks: shown.map(({ task, running, moved }) => ({
            id: task.id,
            code: task.code,
            title: task.title,
            status: task.status,
            updated_at: iso(task.updatedAt),
            in_progress: running,
            moved,
          })),
        })
      }
      const RANK = { working: 0, active: 1, idle: 2 }
      list.sort((a, b) => RANK[a.state] - RANK[b.state] || b.in_progress - a.in_progress || b.recent - a.recent || b.open - a.open)
      people.push({ user: toUserSummary(user), projects: list })
    }
    people.sort((a, b) => a.user.name.localeCompare(b.user.name))
    return { window_days: WINDOW_DAYS, generated_at: iso(now), people }
  }

  return { getTeamActivity }
}

module.exports = { createTeamActivityService }
