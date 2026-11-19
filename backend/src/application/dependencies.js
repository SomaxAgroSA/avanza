/**
 * Dependências por área (regras de negócio §42; ADR-054): para o painel "Direção e gerência" de Em andamento.
 *
 * - Acesso: autenticado com `projects.view`; sem `tasks.view`, resultado vazio. Só entram os projetos não
 *   arquivados que a pessoa vê **por inteiro** (o acesso limitado do Responsável TI fica de fora, como no
 *   Equipo ahora) — tanto a entrega quanto a tarefa que espera por ela precisam estar visíveis.
 * - Áreas: a lista da plataforma (Configurações → Dependências por área, `dependency_areas`; sem ela, a área
 *   TI das antigas Pessoas de TI, `it_people`) + o Responsável TI de cada projeto (papel `it` do membro, só
 *   no projeto dele), que conta na área TI.
 * - `getDependencies` traz todas as áreas; `getTiDependencies` (rota antiga `/ti-dependencies`) só a TI.
 * - Leitura em lote (projetos, tarefas abertas, membros `it`, relações das entregas) e o cálculo em
 *   domain/dependencies.js.
 * - Filtros: `project_ids` (separados por vírgula; só esses blocos voltam) e `tz_offset` (minutos, como em
 *   Date#getTimezoneOffset) para o "hoje" de quem consulta.
 */

const { assertValid, rules } = require('../core/validation')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const taskDomain = require('../domain/task')
const workflow = require('../domain/workflow')
const report = require('../domain/report')
const depDomain = require('../domain/dependencies')
const settingsDomain = require('../domain/platform-settings')
const { currentSettings } = require('./platform-settings')
const { iso, toUserSummary } = require('./presenters')

const MAX_PROJECT_IDS = 200
const ID_PATTERN = /^[A-Za-z0-9_]{1,64}$/
const CHUNK = 400

const SCHEMA = {
  project_ids: [
    rules.custom((value) => {
      if (typeof value !== 'string') return 'invalid_type'
      const ids = value.split(',').map((id) => id.trim()).filter(Boolean)
      if (ids.length > MAX_PROJECT_IDS) return 'too_many'
      return ids.every((id) => ID_PATTERN.test(id)) ? null : 'invalid_type'
    }),
  ],
  tz_offset: [rules.custom((value) => (/^-?\d{1,3}$/.test(String(value)) && Math.abs(Number(value)) <= 840 ? null : 'invalid_type'))],
}

function chunks(list) {
  const out = []
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK))
  return out
}

function createDependenciesService(deps) {
  function parse(query) {
    const q = query || {}
    const source = {}
    Object.keys(SCHEMA).forEach((key) => {
      source[key] = q[key] === undefined || q[key] === '' ? undefined : q[key]
    })
    const data = assertValid(source, SCHEMA)
    return {
      projectIds: (data.project_ids || '')
        .split(',')
        .map((id) => id.trim())
        .filter((id, i, all) => id && all.indexOf(id) === i),
      tzOffset: data.tz_offset === undefined ? 0 : Number(data.tz_offset),
    }
  }

  async function compute(ctx, query, onlyArea) {
    rbac.assertAuthenticated(ctx.principal)
    rbac.assertCan(ctx.principal, 'projects.view')
    const params = parse(query)
    const now = deps.clock.now()
    const today = report.localDay(now, params.tzOffset)
    const areas = settingsDomain.resolveDependencyAreas(await currentSettings(deps))
    const shownAreas = areas.filter((a) => !onlyArea || a.key === onlyArea)
    const empty = { generated_at: iso(now), today, people: [], areas: depDomain.countAreas(shownAreas, []), projects: [], totals: depDomain.sumTotals([]) }
    if (!rbac.can(ctx.principal, 'tasks.view')) return empty

    const all = (await deps.projectRepository.listAll()).filter((p) => !p.archivedAt)
    const roles = all.length ? await deps.projectMemberRepository.rolesForUser(ctx.principal.userId, all.map((p) => p.id)) : {}
    const linkable = []
    const visible = all.filter((p) => {
      const access = projectDomain.resolveAccess(ctx.principal, p, roles[p.id] ? { role: roles[p.id] } : null)
      if (!access.canView || access.limited) return false
      try {
        taskDomain.assertTaskAccess(access, p, 'link')
        linkable.push(p.id)
      } catch (_) {
        // sem permissão de relacionar: a tela não oferece "Confirmar bloqueio"
      }
      return true
    })
    if (visible.length === 0) return empty
    const ids = visible.map((p) => p.id)

    const itMembers = {}
    ;(await deps.projectMemberRepository.listByRole('it', ids)).forEach((m) => {
      ;(itMembers[m.projectId] = itMembers[m.projectId] || []).push(m.userId)
    })
    if (areas.every((a) => a.user_ids.length === 0) && Object.keys(itMembers).length === 0) return empty

    const statuses = await deps.statusRepository.list({ includeInactive: true })
    const closed = statuses.filter((s) => workflow.isClosedCategory(s.category)).map((s) => s.id)
    const tasks = (await deps.taskRepository.listForReport({ projectIds: ids, withTitles: true })).filter((t) => closed.indexOf(t.statusId) < 0)
    const deliveryIds = tasks.filter((t) => depDomain.areaOf(t, areas, itMembers)).map((t) => t.id)
    const relations = []
    for (const part of chunks(deliveryIds)) relations.push(...(await deps.relationRepository.listByTasks(part)))

    const result = depDomain.buildDependencies({
      projects: visible,
      tasks,
      relations: relations.filter((r, i, list) => list.findIndex((other) => other.id === r.id) === i),
      areas,
      itMembers,
      today,
      linkableProjectIds: linkable,
      onlyArea,
    })

    const projects = params.projectIds.length ? result.projects.filter((p) => params.projectIds.indexOf(p.project.id) >= 0) : result.projects

    // quem responde pelas entregas (a tela mostra uma vez, no topo)
    const assigneeIds = []
    projects.forEach((p) =>
      p.deliveries.forEach((d) => {
        if (assigneeIds.indexOf(d.assignee_id) < 0) assigneeIds.push(d.assignee_id)
      }),
    )
    const people = (assigneeIds.length ? await deps.userRepository.findManyByIds(assigneeIds) : []).map(toUserSummary).sort((a, b) => a.name.localeCompare(b.name))

    return { generated_at: iso(now), today, people, areas: depDomain.countAreas(shownAreas, projects), projects, totals: depDomain.sumTotals(projects) }
  }

  /** Todas as áreas (`GET /dependencies`). */
  async function getDependencies(ctx, query) {
    return compute(ctx, query, null)
  }

  /** Só a área TI (`GET /ti-dependencies`, mantida por compatibilidade). */
  async function getTiDependencies(ctx, query) {
    return compute(ctx, query, depDomain.TI_AREA_KEY)
  }

  return { getDependencies, getTiDependencies }
}

module.exports = { createDependenciesService }
