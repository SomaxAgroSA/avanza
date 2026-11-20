/**
 * Casos de uso das demandas internas (regras de negócio §45, ADR-057): tarefas sem projeto, pedidas a uma
 * pessoa (o responsável), que as distribui à equipe dela.
 *
 * - Abrir: quem tem `tasks.create` — tipo, título, responsável (qualquer pessoa ativa que vê tarefas),
 *   departamento que pede, descrição e prioridade. Nasce "Sem atribuir", sem executor e sem prazo (quem
 *   define é o responsável); a abertura (`created_at`) é automática. O responsável é avisado.
 * - Fluxo (domain/demand.js): o responsável atribui/reatribui com prazo (data e hora, obrigatório) e
 *   estimativa — quem tem `projects.view_all` também, em qualquer demanda (o histórico guarda quem fez); quem executa começa, passa a alguém da equipe (comentário obrigatório; o responsável é
 *   avisado) e conclui (comentário obrigatório; vai para "Para validar" de quem pediu); quem pediu valida
 *   (Concluída) ou devolve (comentário obrigatório; volta para Em andamento).
 * - Tudo vai para o histórico da tarefa (`task.demand_*`, com quem, quando e a nota) e avisa pelas
 *   notificações internas de sempre (o e-mail só sai se a integração estiver configurada).
 * - As demandas moram no projeto de sistema `kind = 'demands'` (oculto); `inbox()` o recria se sumir.
 * - Caixas da tela Demandas: Recebidas por mim, Atribuídas a mim e Pedidas por mim; `overview` traz os
 *   números de cada passo (o selo do menu Tarefas = Recebidas "Sem atribuir") e a carga da equipe.
 * - Caixa Todas (`all`, só com `projects.view_all`; sem ela, FORBIDDEN): todas as demandas — internas e
 *   tarefas de projeto com responsável —, com filtros por responsável e por quem executa; o `overview`
 *   dessas pessoas traz também os números de todas e a carga de todas as pessoas (`all_team`).
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const { parsePagination, buildPageMeta } = require('../core/pagination')
const rbac = require('../domain/rbac')
const taskDomain = require('../domain/task')
const demandDomain = require('../domain/demand')
const workflow = require('../domain/workflow')
const { buildAuditEntry, truncate } = require('./audit')
const { toUserSummary } = require('./presenters')
const { createTaskService } = require('./tasks')
const { createTaskAccess } = require('./task-access')
const { createNotifier } = require('./notifications')

/** A caixa das demandas: a primeira chave livre da lista (a migration 0031 usa a mesma). */
const INBOX = Object.freeze({ name: 'Demandas internas', keys: ['DEM', 'DEMINT', 'DEMANDAS', 'DEMANDA', 'DEMSYS'], icon: 'inbox', cover: 'slate' })
const MAX_HOURS = 100000
const OWNER_SEARCH_LIMIT = 500
const TEAM_LIMIT = 500

const idRule = rules.custom((value) => (typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value) ? null : 'invalid_type'))
const hoursRule = rules.custom((value) => {
  if (typeof value !== 'number' || !isFinite(value)) return 'invalid_type'
  if (value <= 0) return 'too_small'
  return value > MAX_HOURS ? 'too_large' : null
})

const CREATE_SCHEMA = {
  title: [rules.required(), rules.maxLength(200)],
  description: [rules.maxLength(50000)],
  task_type_id: [rules.required(), idRule],
  demand_owner_id: [rules.required(), idRule],
  area_id: [rules.required(), idRule],
  priority_id: [idRule],
}

const LIST_SCHEMA = {
  box: [rules.required(), rules.oneOf(demandDomain.DEMAND_BOXES)],
  status: [
    rules.custom((value) =>
      typeof value === 'string' && value.split(',').every((s) => demandDomain.DEMAND_STATUSES.indexOf(s.trim()) >= 0) ? null : 'invalid_option',
    ),
  ],
  owner_id: [idRule],
  assignee_id: [idRule],
}

function invalid(fields) {
  return appError('VALIDATION_ERROR', undefined, { fields })
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR')

function createDemandService(deps) {
  const tasks = deps.taskRepository
  const taskService = createTaskService(deps)
  const taskAccess = createTaskAccess(deps)
  const notifier = createNotifier(deps)

  // ---------------------------------------------------------------- apoio

  /** A caixa das demandas (projeto de sistema); recria se uma importação a apagou. */
  async function inbox() {
    const project = await deps.projectRepository.ensureSystem(demandDomain.DEMANDS_KIND, INBOX)
    if (!project) throw appError('INTERNAL_ERROR')
    return project
  }

  /** Demanda que a pessoa vê (TASK_NOT_FOUND se não existe, não é demanda ou não é visível — anti-IDOR). */
  async function load(ctx, id) {
    rbac.assertAuthenticated(ctx.principal)
    const task = typeof id === 'string' && id ? await tasks.findById(id) : null
    const project = task ? await deps.projectRepository.findById(task.projectId) : null
    if (!task || !project || !demandDomain.isDemand(task)) throw appError('TASK_NOT_FOUND')
    const access = await taskAccess.forTask(ctx.principal, task, project)
    taskDomain.assertTaskAccess(access, project, 'view', task)
    return { task, project, access }
  }

  function assertAction(ctx, task, action) {
    const issue = demandDomain.actionIssue(ctx.principal.userId, task, action, { viewAll: demandDomain.assignsAny(ctx.principal) })
    if (issue) throw appError(issue)
  }

  /** A pessoa pode ver tarefas (o perfil tem `tasks.view`)? */
  async function seesTasks(user) {
    const role = await deps.roleRepository.findById(user.roleId)
    if (!role) return false
    const principal = rbac.createPrincipal({ userId: user.id, roleId: role.id, roleCode: role.code, permissions: await deps.roleRepository.getPermissionCodes(role.id) })
    return rbac.can(principal, 'tasks.view')
  }

  /** Pessoa ativa que vê tarefas (responsável ou quem recebe a demanda); senão `invalid_option` no campo. */
  async function activeWorker(userId, field) {
    const user = await deps.userRepository.findById(userId)
    if (!user || user.status !== 'active' || !(await seesTasks(user))) throw invalid({ [field]: 'invalid_option' })
    return user
  }

  /** Quem recebe (atribuir/passar): pessoa ativa da equipe do responsável (ou qualquer uma, fora de área). */
  async function receiver(task, userId) {
    const user = await activeWorker(userId, 'assignee_id')
    if (!demandDomain.canReceive(await taskAccess.teamOf(task.demandOwnerId), userId)) throw invalid({ assignee_id: 'not_in_team' })
    return user
  }

  function noteOf(input) {
    const raw = (input || {}).comment
    const issue = demandDomain.noteIssue(raw)
    if (issue) throw invalid({ comment: issue })
    return raw.trim()
  }

  async function nameOf(userId) {
    if (!userId) return null
    const user = await deps.userRepository.findById(userId)
    return user ? user.name : null
  }

  /**
   * Grava o novo passo (com o status do fluxo de trabalho que o acompanha, as datas de início/conclusão e a
   * posição) e os `changes`, o histórico e os avisos — tudo na mesma transação. Devolve o detalhe.
   */
  async function transition(ctx, loaded, nextStatus, changes, history, notices) {
    const { task, project } = loaded
    const statuses = await deps.statusRepository.list({ includeInactive: true })
    const patch = Object.assign({ demandStatus: nextStatus }, changes)
    const statusId = demandDomain.workflowStatusFor(nextStatus, statuses, task.statusId)
    if (statusId && statusId !== task.statusId) {
      const from = statuses.find((s) => s.id === task.statusId)
      const to = statuses.find((s) => s.id === statusId)
      const dates = taskDomain.statusDates(task, from ? from.category : null, to.category, deps.clock.now())
      patch.statusId = statusId
      patch.startedAt = dates.startedAt
      patch.completedAt = dates.completedAt
      patch.position = ((await tasks.maxPosition(task.projectId, statusId)) || 0) + workflow.POSITION_STEP
    }
    await deps.unitOfWork.run(async (repos) => {
      const updated = await repos.taskRepository.update(task.id, patch)
      await repos.auditRepository.record(
        buildAuditEntry(ctx, { entityType: 'task', entityId: task.id, action: history.action, oldValue: history.oldValue || null, newValue: history.newValue }),
      )
      for (const notice of notices || []) {
        await notifier.notify(repos, { task: updated, project, actorId: ctx.principal.userId, entries: notice.entries, data: notice.data })
      }
    })
    return taskService.getTask(ctx, task.id)
  }

  // ---------------------------------------------------------------- abrir

  async function createDemand(ctx, input) {
    rbac.assertAuthenticated(ctx.principal)
    rbac.assertCan(ctx.principal, 'tasks.view')
    rbac.assertCan(ctx.principal, 'tasks.create')
    const raw = input || {}
    const source = {}
    Object.keys(CREATE_SCHEMA).forEach((key) => {
      source[key] = raw[key]
    })
    const data = assertValid(source, CREATE_SCHEMA)

    const active = (item, field) => {
      if (!item || item.isActive === false) throw invalid({ [field]: 'invalid_option' })
      return item
    }
    const type = active(await deps.taskTypeRepository.findById(data.task_type_id), 'task_type_id')
    const area = active(await deps.areaRepository.findById(data.area_id), 'area_id')
    const priorities = await deps.priorityRepository.list({ includeInactive: true })
    const priority = data.priority_id ? active(priorities.find((p) => p.id === data.priority_id), 'priority_id') : priorities.find((p) => p.isDefault && p.isActive !== false)
    if (!priority) throw invalid({ priority_id: 'required' })
    const owner = await activeWorker(data.demand_owner_id, 'demand_owner_id')
    const statuses = await deps.statusRepository.list({ includeInactive: true })
    const statusId = demandDomain.workflowStatusFor('unassigned', statuses, null)
    if (!statusId) throw invalid({ status_id: 'required' })
    const status = statuses.find((s) => s.id === statusId)

    const project = await inbox()
    const now = deps.clock.now()
    const dates = taskDomain.statusDates({}, null, status.category, now)
    const requester = await deps.userRepository.findById(ctx.principal.userId)
    const created = await deps.unitOfWork.run(async (repos) => {
      const number = await repos.taskRepository.nextNumber(project.id)
      const task = await repos.taskRepository.create({
        projectId: project.id,
        number,
        code: taskDomain.taskCode(project.key, number),
        title: data.title,
        description: data.description || '',
        typeId: type.id,
        statusId: status.id,
        priorityId: priority.id,
        creatorId: ctx.principal.userId,
        assigneeId: null,
        reporterId: ctx.principal.userId,
        parentTaskId: null,
        forkedFromTaskId: null,
        sprintId: null,
        planItemId: null,
        urgency: null,
        areaId: area.id,
        startDate: null,
        dueDate: null,
        estimatedHours: null,
        actualHours: null,
        startedAt: dates.startedAt,
        completedAt: dates.completedAt,
        checklist: [],
        demandStatus: 'unassigned',
        demandOwnerId: owner.id,
        demandPastAssignees: [],
        position: ((await repos.taskRepository.maxPosition(project.id, status.id)) || 0) + workflow.POSITION_STEP,
      })
      const values = {
        code: task.code,
        title: task.title,
        description: truncate(task.description || '', 1000),
        task_type: type.name,
        task_priority: priority.name,
        area: area.name,
        reporter: requester ? requester.name : null,
        demand_owner: owner.name,
        demand_status: 'unassigned',
      }
      Object.keys(values).forEach((key) => {
        if (values[key] === null || values[key] === '') delete values[key]
      })
      await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'task', entityId: task.id, action: 'task.created', oldValue: null, newValue: values }))
      await notifier.notify(repos, { task, project, actorId: ctx.principal.userId, entries: [{ userId: owner.id, type: 'demand_received' }] })
      return task
    })
    return taskService.getTask(ctx, created.id)
  }

  // ---------------------------------------------------------------- fluxo

  /** Responsável (ou quem tem `projects.view_all`) atribui ou reatribui: { assignee_id, due_at (data e hora), estimated_hours? (null limpa) }. */
  async function assign(ctx, id, input) {
    const loaded = await load(ctx, id)
    const task = loaded.task
    assertAction(ctx, task, 'assign')
    const raw = input || {}
    const data = assertValid(
      { assignee_id: raw.assignee_id, due_at: raw.due_at, estimated_hours: raw.estimated_hours },
      { assignee_id: [rules.required(), idRule], due_at: [rules.required(), rules.isoDate()], estimated_hours: [hoursRule] },
    )
    const user = await receiver(task, data.assignee_id)
    const estimate = raw.estimated_hours === null ? null : data.estimated_hours === undefined ? task.estimatedHours || null : round2(data.estimated_hours)
    const first = !task.assigneeId
    const changedPerson = task.assigneeId !== user.id
    const next = demandDomain.nextStatus(task, 'assign', user.id)
    const dueAt = data.due_at.toISOString()
    return transition(
      ctx,
      loaded,
      next,
      { assigneeId: user.id, dueDate: data.due_at, estimatedHours: estimate, demandPastAssignees: demandDomain.pastAssigneesAfter(task, user.id) },
      {
        action: first ? 'task.demand_assigned' : 'task.demand_reassigned',
        oldValue: first ? null : { assignee: await nameOf(task.assigneeId), due_at: task.dueDate ? new Date(task.dueDate).toISOString() : null, estimated_hours: task.estimatedHours || null },
        newValue: { assignee: user.name, due_at: dueAt, estimated_hours: estimate, demand_status: next },
      },
      changedPerson ? [{ entries: [{ userId: user.id, type: 'assigned' }], data: { due_at: dueAt } }] : [],
    )
  }

  /** Quem executa começa a trabalhar (Atribuída → Em andamento). */
  async function start(ctx, id) {
    const loaded = await load(ctx, id)
    assertAction(ctx, loaded.task, 'start')
    return transition(ctx, loaded, 'in_progress', {}, { action: 'task.demand_started', newValue: { demand_status: 'in_progress' } }, [])
  }

  /** Quem executa passa a alguém da equipe do responsável: { assignee_id, comment } — o responsável é avisado. */
  async function pass(ctx, id, input) {
    const loaded = await load(ctx, id)
    const task = loaded.task
    assertAction(ctx, task, 'pass')
    const raw = input || {}
    const data = assertValid({ assignee_id: raw.assignee_id }, { assignee_id: [rules.required(), idRule] })
    const note = noteOf(raw)
    if (data.assignee_id === task.assigneeId) throw invalid({ assignee_id: 'same_assignee' })
    const user = await receiver(task, data.assignee_id)
    const comment = truncate(note, 200)
    return transition(
      ctx,
      loaded,
      demandDomain.nextStatus(task, 'pass', user.id),
      { assigneeId: user.id, demandPastAssignees: demandDomain.pastAssigneesAfter(task, user.id) },
      { action: 'task.demand_passed', oldValue: { assignee: await nameOf(task.assigneeId) }, newValue: { assignee: user.name, note, demand_status: 'assigned' } },
      [
        { entries: [{ userId: user.id, type: 'assigned' }], data: { comment } },
        { entries: [{ userId: task.demandOwnerId, type: 'demand_passed' }], data: { comment, assignee: user.name } },
      ],
    )
  }

  /** Quem executa conclui (comentário do que foi entregue) → "Para validar" de quem pediu. */
  async function conclude(ctx, id, input) {
    const loaded = await load(ctx, id)
    const task = loaded.task
    assertAction(ctx, task, 'conclude')
    const note = noteOf(input)
    return transition(ctx, loaded, 'to_validate', {}, { action: 'task.demand_concluded', newValue: { note, demand_status: 'to_validate' } }, [
      {
        entries: [
          { userId: task.reporterId, type: 'demand_concluded' },
          { userId: task.demandOwnerId, type: 'demand_concluded' },
        ],
        data: { comment: truncate(note, 200) },
      },
    ])
  }

  /** Quem pediu valida a entrega → Concluída. */
  async function validate(ctx, id) {
    const loaded = await load(ctx, id)
    const task = loaded.task
    assertAction(ctx, task, 'validate')
    return transition(ctx, loaded, 'done', {}, { action: 'task.demand_validated', newValue: { demand_status: 'done' } }, [
      {
        entries: [
          { userId: task.assigneeId, type: 'demand_validated' },
          { userId: task.demandOwnerId, type: 'demand_validated' },
        ],
      },
    ])
  }

  /** Quem pediu devolve (comentário obrigatório) → volta para Em andamento com quem executa. */
  async function returnDemand(ctx, id, input) {
    const loaded = await load(ctx, id)
    const task = loaded.task
    assertAction(ctx, task, 'return')
    const note = noteOf(input)
    return transition(ctx, loaded, 'in_progress', {}, { action: 'task.demand_returned', newValue: { note, demand_status: 'in_progress' } }, [
      {
        entries: [
          { userId: task.assigneeId, type: 'demand_returned' },
          { userId: task.demandOwnerId, type: 'demand_returned' },
        ],
        data: { comment: truncate(note, 200) },
      },
    ])
  }

  // ---------------------------------------------------------------- consultas

  /**
   * Caixas da tela Demandas (`box` = received | assigned | requested | all; `status` = passos separados por
   * vírgula; `owner_id` e `assignee_id` filtram pelo responsável e por quem executa). `all` = todas as
   * demandas, só para quem tem `projects.view_all` (FORBIDDEN para os demais).
   */
  async function listDemands(ctx, query) {
    rbac.assertAuthenticated(ctx.principal)
    rbac.assertCan(ctx.principal, 'tasks.view')
    const q = query || {}
    const pick = (key) => (q[key] === undefined || q[key] === '' ? undefined : q[key])
    const filters = assertValid({ box: pick('box'), status: pick('status'), owner_id: pick('owner_id'), assignee_id: pick('assignee_id') }, LIST_SCHEMA)
    const issue = demandDomain.boxIssue(ctx.principal, filters.box)
    if (issue) throw appError(issue)
    const pagination = parsePagination(q, { defaultPerPage: 100, maxPerPage: 100 })
    const result = await tasks.list({
      // a caixa já é de quem participa (ou, em Todas, de quem vê todas): tudo nela é visível à pessoa
      scope: { userId: ctx.principal.userId, viewAll: true },
      demandBox: { box: filters.box, userId: ctx.principal.userId },
      demandOwnerId: filters.owner_id,
      assigneeId: filters.assignee_id,
      demandStatuses: filters.status ? filters.status.split(',').map((s) => s.trim()) : undefined,
      sort: [{ column: 'created', direction: 'DESC' }],
      pagination,
    })
    return { items: await taskService.summarize(result.items, ctx), meta: buildPageMeta(pagination, result.total) }
  }

  /** Carga por pessoa, das mais carregadas para as menos: { user, open_count, estimated_hours }. */
  async function loadOf(ids, load) {
    const users = ids.length ? await deps.userRepository.findManyByIds(ids) : []
    return users
      .filter((u) => u.status === 'active' || load[u.id])
      .map((u) => ({ user: toUserSummary(u), open_count: load[u.id] ? load[u.id].open : 0, estimated_hours: load[u.id] ? round2(load[u.id].hours) : 0 }))
      .sort((a, b) => b.estimated_hours - a.estimated_hours || b.open_count - a.open_count || byName(a.user, b.user))
  }

  /**
   * Números da tela Demandas e o selo do menu: quantas há em cada passo nas três caixas, e a carga da
   * equipe (as outras pessoas da área de quem consulta + quem executa as demandas que ela recebeu):
   * demandas atribuídas e em andamento e as horas estimadas delas. Com `projects.view_all`, também a
   * caixa Todas (`counts.all`) e a carga de todas as pessoas com demandas abertas (`all_team`).
   */
  async function overview(ctx) {
    rbac.assertAuthenticated(ctx.principal)
    rbac.assertCan(ctx.principal, 'tasks.view')
    const me = ctx.principal.userId
    const seesAll = demandDomain.seesAllDemands(ctx.principal)
    const raw = await tasks.demandCounts(me, { all: seesAll })
    const counts = {}
    ;(seesAll ? demandDomain.DEMAND_BOXES : demandDomain.PERSONAL_BOXES).forEach((box) => {
      counts[box] = {}
      demandDomain.DEMAND_STATUSES.forEach((status) => {
        counts[box][status] = (raw[box] && raw[box][status]) || 0
      })
    })
    const mates = demandDomain.teamOf(await taskAccess.areas(), me).memberIds
    const ids = mates.concat(await tasks.demandAssignees(me, demandDomain.LOAD_STATUSES)).filter((id, i, all) => id && all.indexOf(id) === i)
    const team = await loadOf(ids, await tasks.demandLoad(ids, demandDomain.LOAD_STATUSES))
    if (!seesAll) return { counts, team }
    // Carga das equipes (caixa Todas): todas as pessoas com demandas atribuídas ou em andamento
    const everyone = await tasks.demandLoadAll(demandDomain.LOAD_STATUSES)
    return { counts, team, all_team: await loadOf(Object.keys(everyone), everyone) }
  }

  /**
   * Quem pode receber a demanda (diálogos Atribuir e Passar a…): o responsável e quem tem
   * `projects.view_all` (que também atribui) veem a equipe inteira (o responsável incluído); quem executa vê
   * a mesma lista sem ele mesmo. Fora de área: as pessoas ativas.
   */
  async function team(ctx, id) {
    const { task } = await load(ctx, id)
    const me = ctx.principal.userId
    const isOwner = task.demandOwnerId === me || demandDomain.assignsAny(ctx.principal)
    if (!isOwner && task.assigneeId !== me) throw appError('FORBIDDEN')
    const squad = await taskAccess.teamOf(task.demandOwnerId)
    const people = squad.inArea
      ? await deps.userRepository.findManyByIds([squad.ownerId].concat(squad.memberIds).filter(Boolean))
      : await deps.userRepository.searchActive({ search: '', excludeIds: [], limit: TEAM_LIMIT })
    return people
      .filter((u) => u.status === 'active' && (isOwner || u.id !== me))
      .sort(byName)
      .map(toUserSummary)
  }

  /** Responsáveis possíveis no formulário "Demanda interna": pessoas ativas (busca por nome ou e-mail). */
  async function owners(ctx, query) {
    rbac.assertAuthenticated(ctx.principal)
    rbac.assertCan(ctx.principal, 'tasks.create')
    const q = query || {}
    const data = assertValid({ search: q.search === '' ? undefined : q.search }, { search: [rules.maxLength(100)] })
    return (await deps.userRepository.searchActive({ search: data.search || '', excludeIds: [], limit: OWNER_SEARCH_LIMIT })).sort(byName).map(toUserSummary)
  }

  return { createDemand, assign, start, pass, conclude, validate, returnDemand, listDemands, overview, team, owners }
}

module.exports = { createDemandService, INBOX }
