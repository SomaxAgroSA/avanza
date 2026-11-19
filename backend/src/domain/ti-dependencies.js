/**
 * Dependências de TI (regras de negócio §42): o que a TI ainda deve aos projetos e o que espera por ela.
 *
 * - **Entrega de TI** = tarefa **aberta** atribuída a uma pessoa de TI: alguém da lista "Pessoas de TI"
 *   (configuração da plataforma, `it_people`) ou o Responsável TI do próprio projeto (papel `it`, ADR-051).
 * - **Bloqueada por TI** = tarefa aberta que espera uma entrega de TI aberta pela mesma regra de "bloqueada"
 *   do Avanza (`precedenceOf`: "bloqueia" e "depende de"; o que vem antes é a entrega). Pode ser de outro
 *   projeto: a tarefa conta no projeto dela e a entrega no dela.
 * - **A validar** = tarefa aberta ligada a uma entrega aberta só por "relacionada" (`relates`): **não** conta
 *   como bloqueio até alguém confirmar (a relação vira "depende de").
 * - Risco do prazo da entrega, nesta ordem: sem prazo → depois da entrega do projeto → vencida → vence em
 *   até 3 dias → em dia. Dias como AAAA-MM-DD (o prazo é um dia puro; hoje no fuso de quem consulta).
 *
 * Funções puras: quem chama já filtrou projetos e tarefas que a pessoa vê.
 */

const relationDomain = require('./relation')

const RISKS = Object.freeze(['none_due', 'after_project_due', 'overdue', 'due_soon', 'ok'])
const DUE_SOON_DAYS = 3
const DAY_MS = 86400000

/** Dia AAAA-MM-DD de uma data (null se vazia). */
function dayOf(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

/** Dias de `from` até `to` (AAAA-MM-DD); negativo se `to` vem antes. */
function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

/** Risco do prazo de uma entrega (ver RISKS). */
function deliveryRisk(dueDay, projectDueDay, today) {
  if (!dueDay) return 'none_due'
  if (projectDueDay && dueDay > projectDueDay) return 'after_project_due'
  const left = daysBetween(today, dueDay)
  if (left < 0) return 'overdue'
  return left <= DUE_SOON_DAYS ? 'due_soon' : 'ok'
}

/** A tarefa é uma entrega de TI? (aberta é responsabilidade de quem chama) */
function isTiDelivery(task, itPeople, itMembers) {
  if (!task.assigneeId) return false
  if (itPeople.indexOf(task.assigneeId) >= 0) return true
  return (itMembers[task.projectId] || []).indexOf(task.assigneeId) >= 0
}

const RISK_ORDER = { overdue: 0, after_project_due: 1, due_soon: 2, none_due: 3, ok: 4 }

/**
 * Monta o resultado por projeto.
 * input = {
 *   projects: [{ id, key, name, dueDate }]   — os que a pessoa vê por inteiro,
 *   tasks: [{ id, projectId, code, title, assigneeId, dueDate, createdAt, startedAt }] — só as abertas desses projetos,
 *   relations: [{ id, type, sourceId, targetId }] — as que tocam alguma entrega,
 *   itPeople: [userId], itMembers: { projectId: [userId] }, today: 'AAAA-MM-DD',
 *   linkableProjectIds: [projectId] — onde a pessoa pode relacionar tarefas (botão "Confirmar bloqueio"),
 * }
 * Devolve { projects: [{ project, deliveries, blocked, pending, counts }], totals }, só com projetos afetados.
 */
function buildTiDependencies(input) {
  const projects = {}
  input.projects.forEach((p) => {
    projects[p.id] = p
  })
  const open = {}
  input.tasks.forEach((t) => {
    if (projects[t.projectId]) open[t.id] = t
  })
  const deliveries = {}
  Object.keys(open).forEach((id) => {
    if (isTiDelivery(open[id], input.itPeople || [], input.itMembers || {})) deliveries[id] = open[id]
  })
  const linkable = input.linkableProjectIds || []
  const projectRef = (id) => ({ id, key: projects[id].key, name: projects[id].name })
  const taskRef = (t) => ({ id: t.id, code: t.code, title: t.title, project: projectRef(t.projectId), due_date: dayOf(t.dueDate) })

  // bloqueios: [antes, depois] com a entrega antes e outra tarefa aberta depois
  const waiting = {} // tarefa bloqueada -> { entregaId: relationId }
  const pendingRows = []
  input.relations.forEach((rel) => {
    const edge = relationDomain.precedenceOf(rel)
    if (edge) {
      const [before, after] = edge
      if (deliveries[before] && open[after] && before !== after) {
        waiting[after] = waiting[after] || {}
        waiting[after][before] = rel.id
      }
    }
  })
  input.relations.forEach((rel) => {
    if (rel.type !== 'relates') return
    const pairs = [
      [rel.sourceId, rel.targetId],
      [rel.targetId, rel.sourceId],
    ]
    pairs.forEach(([deliveryId, otherId]) => {
      // duas entregas relacionadas entre si são trabalho da própria TI: não entram
      if (!deliveries[deliveryId] || !open[otherId] || deliveries[otherId]) return
      // já bloqueada por essa mesma entrega: a relação extra não pede validação
      if (waiting[otherId] && waiting[otherId][deliveryId]) return
      pendingRows.push({ relationId: rel.id, task: open[otherId], delivery: deliveries[deliveryId] })
    })
  })

  const byProject = {}
  const entry = (projectId) => {
    if (!byProject[projectId]) byProject[projectId] = { deliveries: [], blocked: [], pending: [] }
    return byProject[projectId]
  }

  // quantas tarefas cada entrega bloqueia e de quais outros projetos
  const blocksOf = {}
  Object.keys(waiting).forEach((taskId) => {
    Object.keys(waiting[taskId]).forEach((deliveryId) => {
      blocksOf[deliveryId] = blocksOf[deliveryId] || []
      blocksOf[deliveryId].push(open[taskId])
    })
  })

  Object.keys(deliveries).forEach((id) => {
    const d = deliveries[id]
    const due = dayOf(d.dueDate)
    const since = dayOf(d.startedAt || d.createdAt)
    const blocks = blocksOf[id] || []
    const otherProjects = blocks
      .map((t) => t.projectId)
      .filter((pid, i, all) => pid !== d.projectId && all.indexOf(pid) === i)
      .map(projectRef)
    entry(d.projectId).deliveries.push(
      Object.assign(taskRef(d), {
        assignee_id: d.assigneeId,
        since: since,
        waiting_days: since ? Math.max(0, daysBetween(since, input.today)) : null,
        days_left: due ? daysBetween(input.today, due) : null,
        risk: deliveryRisk(due, dayOf(projects[d.projectId].dueDate), input.today),
        blocks: blocks.length,
        blocks_projects: otherProjects,
      }),
    )
  })

  Object.keys(waiting).forEach((taskId) => {
    const t = open[taskId]
    entry(t.projectId).blocked.push(
      Object.assign(taskRef(t), {
        waiting_on: Object.keys(waiting[taskId]).map((deliveryId) => Object.assign(taskRef(deliveries[deliveryId]), { relation_id: waiting[taskId][deliveryId] })),
      }),
    )
  })

  pendingRows.forEach((row) => {
    entry(row.task.projectId).pending.push(
      Object.assign(taskRef(row.task), {
        related_to: taskRef(row.delivery),
        relation_id: row.relationId,
        can_confirm: linkable.indexOf(row.task.projectId) >= 0,
      }),
    )
  })

  const byCode = (a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })
  const totals = { deliveries: 0, blocked: 0, pending: 0, none_due: 0, after_project_due: 0, overdue: 0, due_soon: 0, projects: 0 }
  const list = Object.keys(byProject)
    .map((projectId) => {
      const e = byProject[projectId]
      e.deliveries.sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || b.blocks - a.blocks || byCode(a, b))
      e.blocked.sort(byCode)
      e.pending.sort((a, b) => byCode(a, b) || byCode(a.related_to, b.related_to))
      const counts = { deliveries: e.deliveries.length, blocked: e.blocked.length, pending: e.pending.length }
      RISKS.forEach((risk) => {
        if (risk !== 'ok') counts[risk] = e.deliveries.filter((d) => d.risk === risk).length
      })
      Object.keys(counts).forEach((key) => {
        totals[key] += counts[key]
      })
      return { project: Object.assign(projectRef(projectId), { due_date: dayOf(projects[projectId].dueDate) }), counts, deliveries: e.deliveries, blocked: e.blocked, pending: e.pending }
    })
    .sort((a, b) => b.counts.blocked - a.counts.blocked || a.project.name.localeCompare(b.project.name))
  totals.projects = list.length
  return { projects: list, totals }
}

module.exports = { RISKS, DUE_SOON_DAYS, dayOf, daysBetween, deliveryRisk, isTiDelivery, buildTiDependencies }
