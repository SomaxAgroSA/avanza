/**
 * Equipo ahora (regras §41): em que projeto e em que tarefa cada pessoa está agindo.
 *
 * - Só projetos em andamento (planejamento, em curso ou pausado, não arquivados) que quem consulta vê por
 *   inteiro (o Responsável TI, que vê só o resumo, fica de fora) e com `tasks.view`.
 * - A atividade é medida pelas **ações da própria pessoa** nos últimos 7 dias, do histórico da tarefa (quem fez
 *   = a pessoa): mudar o status ou o passo, comentar, editar, anexar, criar. Mudar a tarefa de outra pessoa
 *   não conta como atividade dela.
 * - Por pessoa e projeto: tarefas atribuídas em andamento (`in_progress`) e abertas (`open`); `recent` = em
 *   quantas tarefas ela agiu; `actions` = quantas ações; `last_activity` = a última ação dela no projeto (em
 *   qualquer data). Estado: working = tem tarefa atribuída em andamento e agiu; active = agiu; idle = tem
 *   tarefas abertas atribuídas e não agiu (`stale` = em andamento, mas sem ação dela na janela).
 * - `acted_tasks`: as tarefas em que agiu, com a última ação (tipo, de/para, trecho, quantidade) e a data, da
 *   mais recente para a mais antiga (até 20). `tasks`: as tarefas por trás dos números (o painel do projeto):
 *   em andamento e as em que agiu e, sem nenhuma delas, as abertas — até 20.
 * - Demandas internas (§45): as que quem consulta enxerga (todas com `projects.view_all`) contam no bloco
 *   "Demandas internas" (`project.kind = 'demands'`).
 */

const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const demandDomain = require('../domain/demand')
const activityDomain = require('../domain/team-activity')
const { iso, toUserSummary } = require('./presenters')
const { createTaskAccess } = require('./task-access')

const WINDOW_DAYS = 7
const OPEN_STATUSES = ['planning', 'active', 'paused']
const CLOSED = ['done', 'cancelled']
const MAX_TASKS = 20
const RANK = { working: 0, active: 1, idle: 2 }

const time = (date) => (date ? new Date(date).getTime() : 0)

function presentTask(task, extra) {
  return Object.assign({ id: task.id, code: task.code, title: task.title, status: task.status, updated_at: iso(task.updatedAt) }, extra)
}

function createTeamActivityService(deps) {
  const taskAccess = createTaskAccess(deps)

  /** Projetos em andamento que a pessoa vê por inteiro + a caixa das demandas internas (§45). */
  async function scope(ctx) {
    const open = (await deps.projectRepository.listAll()).filter((p) => !p.archivedAt && OPEN_STATUSES.indexOf(p.status) >= 0)
    const roles = open.length ? await deps.projectMemberRepository.rolesForUser(ctx.principal.userId, open.map((p) => p.id)) : {}
    const visible = open.filter((p) => {
      const access = projectDomain.resolveAccess(ctx.principal, p, roles[p.id] ? { role: roles[p.id] } : null)
      return access.canView && !access.limited
    })
    const projects = new Map(visible.map((p) => [p.id, p]))
    const inbox = await deps.projectRepository.findSystem(demandDomain.DEMANDS_KIND)
    if (inbox) projects.set(inbox.id, inbox)
    return { projects, inbox }
  }

  async function getTeamActivity(ctx) {
    rbac.assertAuthenticated(ctx.principal)
    rbac.assertCan(ctx.principal, 'projects.view')
    const now = deps.clock.now()
    const since = new Date(now.getTime() - WINDOW_DAYS * 864e5)
    const empty = { window_days: WINDOW_DAYS, generated_at: iso(now), people: [] }
    if (!rbac.can(ctx.principal, 'tasks.view')) return empty

    const { projects, inbox } = await scope(ctx)
    if (projects.size === 0) return empty
    const projectIds = [...projects.keys()]
    const assigned = await deps.taskRepository.listActivity(projectIds, since)
    const actions = await deps.taskRepository.listActions(projectIds, since)

    // demandas internas: só as que quem consulta enxerga (atribuídas ou em que alguém agiu)
    const isDemand = (task) => !!inbox && task.projectId === inbox.id
    const demandTasks = new Map()
    assigned.concat(actions.map((a) => a.task)).forEach((task) => {
      if (isDemand(task) && task.demandStatus) demandTasks.set(task.id, task)
    })
    const seenDemands = new Set((await taskAccess.visibleDemands(ctx.principal, [...demandTasks.values()])).map((t) => t.id))
    const allowed = (task) => !isDemand(task) || seenDemands.has(task.id)

    // pessoa → projeto → números, tarefas atribuídas e tarefas em que agiu
    const byPerson = new Map()
    const entryOf = (userId, projectId) => {
      if (!byPerson.has(userId)) byPerson.set(userId, new Map())
      const perProject = byPerson.get(userId)
      if (!perProject.has(projectId)) perProject.set(projectId, { in_progress: 0, open: 0, actions: 0, last: null, assigned: [], acted: new Map() })
      return perProject.get(projectId)
    }
    for (const task of assigned) {
      if (!allowed(task) || CLOSED.indexOf(task.status.category) >= 0) continue
      const entry = entryOf(task.assigneeId, task.projectId)
      if (task.status.category === 'in_progress') entry.in_progress++
      entry.open++
      entry.assigned.push(task)
    }
    // ações da mais recente para a mais antiga: a primeira de cada tarefa é a última ação nela
    for (const row of actions) {
      if (!allowed(row.task)) continue
      const entry = entryOf(row.userId, row.task.projectId)
      entry.actions++
      if (!entry.last || time(row.at) > time(entry.last)) entry.last = row.at
      const acted = entry.acted.get(row.task.id)
      if (acted) acted.count++
      else entry.acted.set(row.task.id, { task: row.task, action: activityDomain.actionOf(row), at: row.at, count: 1 })
    }

    const ids = [...byPerson.keys()]
    const users = new Map()
    ;(ids.length ? await deps.userRepository.findManyByIds(ids) : []).forEach((u) => users.set(u.id, u))

    // quem só tem tarefas abertas: a última ação dela no projeto, fora da janela ("sem movimento há N dias")
    const quiet = ids.filter((id) => [...byPerson.get(id).values()].some((e) => e.acted.size === 0))
    const lastSeen = new Map()
    if (quiet.length) {
      const regular = projectIds.filter((id) => !inbox || id !== inbox.id)
      ;(await deps.taskRepository.lastActions(quiet, regular, [...seenDemands])).forEach((r) => lastSeen.set(`${r.userId}|${r.projectId}`, r.at))
    }

    const people = []
    for (const [userId, perProject] of byPerson) {
      const user = users.get(userId)
      if (!user) continue
      const list = []
      for (const [projectId, e] of perProject) {
        const project = projects.get(projectId)
        const acted = [...e.acted.values()]
        const state = activityDomain.stateOf({ inProgress: e.in_progress, acted: acted.length })
        list.push({
          project: Object.assign(
            { id: project.id, key: project.key, name: project.name, icon: project.icon || 'folder', cover: project.cover || 'violet' },
            project.kind ? { kind: project.kind } : {},
          ),
          state,
          in_progress: e.in_progress,
          recent: acted.length,
          actions: e.actions,
          open: e.open,
          stale: e.in_progress > 0 && acted.length === 0,
          last_activity: iso(e.last || lastSeen.get(`${userId}|${projectId}`) || null),
          acted_tasks: acted.slice(0, MAX_TASKS).map((a) =>
            presentTask(a.task, { in_progress: a.task.status.category === 'in_progress', action: Object.assign({}, a.action, { at: iso(a.at) }), actions: a.count }),
          ),
          tasks: behindNumbers(e).map(({ task, running, moved }) => presentTask(task, { in_progress: running, moved })),
        })
      }
      list.sort((a, b) => RANK[a.state] - RANK[b.state] || b.in_progress - a.in_progress || b.recent - a.recent || b.open - a.open || time(b.last_activity) - time(a.last_activity))
      people.push({ user: toUserSummary(user), projects: list })
    }
    people.sort((a, b) => a.user.name.localeCompare(b.user.name))
    return { window_days: WINDOW_DAYS, generated_at: iso(now), people }
  }

  /** As tarefas por trás dos números: em andamento (atribuídas) e as em que agiu; sem nenhuma, as abertas. */
  function behindNumbers(entry) {
    const rows = new Map()
    entry.acted.forEach((a) => rows.set(a.task.id, { task: a.task, running: a.task.status.category === 'in_progress', moved: true, at: a.at }))
    entry.assigned.forEach((task) => {
      if (rows.has(task.id)) return
      rows.set(task.id, { task, running: task.status.category === 'in_progress', moved: false, at: null })
    })
    const all = [...rows.values()]
    const behind = all.filter((x) => x.running || x.moved)
    return (behind.length ? behind : all)
      .sort((a, b) => Number(b.running) - Number(a.running) || time(b.at) - time(a.at) || time(b.task.updatedAt) - time(a.task.updatedAt))
      .slice(0, MAX_TASKS)
  }

  /**
   * Tarefas por projeto para o painel "Direção e gerência" (§41): de cada projeto não arquivado que a pessoa vê
   * por inteiro, quantas tarefas estão executadas (categoria done) e quantas faltam (as demais, sem as
   * canceladas). Exige tasks.view (sem ele, lista vazia); projeto sem tarefas não aparece.
   */
  async function getProjectTaskCounts(ctx) {
    rbac.assertAuthenticated(ctx.principal)
    rbac.assertCan(ctx.principal, 'projects.view')
    const empty = { projects: [] }
    if (!rbac.can(ctx.principal, 'tasks.view')) return empty
    const all = (await deps.projectRepository.listAll()).filter((p) => !p.archivedAt)
    const roles = all.length ? await deps.projectMemberRepository.rolesForUser(ctx.principal.userId, all.map((p) => p.id)) : {}
    const ids = all
      .filter((p) => {
        const access = projectDomain.resolveAccess(ctx.principal, p, roles[p.id] ? { role: roles[p.id] } : null)
        return access.canView && !access.limited
      })
      .map((p) => p.id)
    if (ids.length === 0) return empty
    const counts = await deps.taskRepository.countByProject(ids)
    const projects = []
    for (const id of ids) {
      const byCategory = counts[id] || {}
      const done = byCategory.done || 0
      const open = Object.keys(byCategory).reduce((sum, category) => (CLOSED.indexOf(category) >= 0 ? sum : sum + byCategory[category]), 0)
      if (done + open > 0) projects.push({ project_id: id, done, open })
    }
    return { projects }
  }

  return { getTeamActivity, getProjectTaskCounts }
}

module.exports = { createTeamActivityService }
