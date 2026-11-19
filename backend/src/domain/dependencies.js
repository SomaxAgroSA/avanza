/**
 * Dependências por área (regras de negócio §42): o que outras áreas (TI, Finanças…) ainda devem aos
 * projetos e o que espera por elas.
 *
 * - **Entrega** = tarefa **aberta** atribuída a alguém de uma área (Configurações → Dependências por área,
 *   `dependency_areas`; sem ela, a área TI das antigas Pessoas de TI, `it_people`) ou ao Responsável TI do
 *   próprio projeto (papel `it`, ADR-051), que pertence à área TI. Cada entrega leva a área dela.
 * - **Bloqueada** = tarefa aberta que espera uma entrega aberta pela mesma regra de "bloqueada" do Avanza
 *   (`precedenceOf`: "bloqueia" e "depende de"; o que vem antes é a entrega). Pode ser de outro projeto: a
 *   tarefa conta no projeto dela e a entrega no dela.
 * - **A validar** = tarefa aberta ligada a uma entrega aberta só por "relacionada" (`relates`): **não** conta
 *   como bloqueio até alguém confirmar (a relação vira "depende de").
 * - Risco pelo **prazo da própria tarefa**, só ele: sem prazo → vencida → em dia. Dias como AAAA-MM-DD (o
 *   prazo é um dia puro; hoje no fuso de quem consulta). O encerramento do projeto não entra.
 *
 * Funções puras: quem chama já filtrou projetos e tarefas que a pessoa vê.
 */

const relationDomain = require('./relation')

const RISKS = Object.freeze(['none_due', 'overdue', 'ok'])
const TI_AREA_KEY = 'ti'
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

/** Risco do prazo de uma entrega (ver RISKS): só o prazo dela. */
function deliveryRisk(dueDay, today) {
  if (!dueDay) return 'none_due'
  return daysBetween(today, dueDay) < 0 ? 'overdue' : 'ok'
}

/**
 * Área da tarefa ({ key, name }) ou null. A lista de cada área vale primeiro (na ordem); depois, o
 * Responsável TI do próprio projeto conta na área TI. (Aberta é responsabilidade de quem chama.)
 */
function areaOf(task, areas, itMembers) {
  if (!task.assigneeId) return null
  const list = areas || []
  const listed = list.find((a) => a.user_ids.indexOf(task.assigneeId) >= 0)
  if (listed) return { key: listed.key, name: listed.name }
  if (((itMembers || {})[task.projectId] || []).indexOf(task.assigneeId) >= 0) {
    const ti = list.find((a) => a.key === TI_AREA_KEY)
    return { key: TI_AREA_KEY, name: ti ? ti.name : 'TI' }
  }
  return null
}

const RISK_ORDER = { overdue: 0, none_due: 1, ok: 2 }

/**
 * Monta o resultado por projeto.
 * input = {
 *   projects: [{ id, key, name, dueDate }]   — os que a pessoa vê por inteiro,
 *   tasks: [{ id, projectId, code, title, assigneeId, dueDate, createdAt, startedAt }] — só as abertas desses projetos,
 *   relations: [{ id, type, sourceId, targetId }] — as que tocam alguma entrega,
 *   areas: [{ key, name, user_ids }], itMembers: { projectId: [userId] }, today: 'AAAA-MM-DD',
 *   linkableProjectIds: [projectId] — onde a pessoa pode relacionar tarefas (botão "Confirmar bloqueio"),
 *   onlyArea: chave de uma área (opcional) — só as entregas dela (compatibilidade de /ti-dependencies),
 * }
 * Devolve { projects: [{ project, deliveries, blocked, pending, counts }], areas: [{ key, name, deliveries }], totals },
 * só com projetos afetados.
 */
function buildDependencies(input) {
  const projects = {}
  input.projects.forEach((p) => {
    projects[p.id] = p
  })
  const open = {}
  input.tasks.forEach((t) => {
    if (projects[t.projectId]) open[t.id] = t
  })
  const configured = (input.areas || []).filter((a) => !input.onlyArea || a.key === input.onlyArea)
  const deliveries = {}
  const areaById = {}
  Object.keys(open).forEach((id) => {
    const area = areaOf(open[id], input.areas || [], input.itMembers || {})
    if (area && (!input.onlyArea || area.key === input.onlyArea)) {
      deliveries[id] = open[id]
      areaById[id] = area
    }
  })
  const linkable = input.linkableProjectIds || []
  const projectRef = (id) => ({ id, key: projects[id].key, name: projects[id].name })
  const taskRef = (t) => ({ id: t.id, code: t.code, title: t.title, project: projectRef(t.projectId), due_date: dayOf(t.dueDate) })
  const deliveryRef = (t) => Object.assign(taskRef(t), { area: areaById[t.id] })

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
      // duas entregas relacionadas entre si são trabalho das próprias áreas: não entram
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
      Object.assign(deliveryRef(d), {
        assignee_id: d.assigneeId,
        since: since,
        waiting_days: since ? Math.max(0, daysBetween(since, input.today)) : null,
        days_left: due ? daysBetween(input.today, due) : null,
        risk: deliveryRisk(due, input.today),
        blocks: blocks.length,
        blocks_projects: otherProjects,
      }),
    )
  })

  Object.keys(waiting).forEach((taskId) => {
    const t = open[taskId]
    entry(t.projectId).blocked.push(
      Object.assign(taskRef(t), {
        waiting_on: Object.keys(waiting[taskId]).map((deliveryId) => Object.assign(deliveryRef(deliveries[deliveryId]), { relation_id: waiting[taskId][deliveryId] })),
      }),
    )
  })

  pendingRows.forEach((row) => {
    entry(row.task.projectId).pending.push(
      Object.assign(taskRef(row.task), {
        related_to: deliveryRef(row.delivery),
        relation_id: row.relationId,
        can_confirm: linkable.indexOf(row.task.projectId) >= 0,
      }),
    )
  })

  const byCode = (a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })
  const byDue = (a, b) => (a.due_date && b.due_date ? a.due_date.localeCompare(b.due_date) : 0)
  const list = Object.keys(byProject)
    .map((projectId) => {
      const e = byProject[projectId]
      e.deliveries.sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || byDue(a, b) || b.blocks - a.blocks || byCode(a, b))
      e.blocked.sort(byCode)
      e.pending.sort((a, b) => byCode(a, b) || byCode(a.related_to, b.related_to))
      const counts = {
        deliveries: e.deliveries.length,
        blocked: e.blocked.length,
        pending: e.pending.length,
        none_due: e.deliveries.filter((d) => d.risk === 'none_due').length,
        overdue: e.deliveries.filter((d) => d.risk === 'overdue').length,
      }
      return { project: Object.assign(projectRef(projectId), { due_date: dayOf(projects[projectId].dueDate) }), counts, deliveries: e.deliveries, blocked: e.blocked, pending: e.pending }
    })
    .sort((a, b) => b.counts.blocked - a.counts.blocked || a.project.name.localeCompare(b.project.name))
  return { projects: list, areas: countAreas(configured, list), totals: sumTotals(list) }
}

const EMPTY_TOTALS = Object.freeze({ deliveries: 0, blocked: 0, pending: 0, none_due: 0, overdue: 0, projects: 0 })

/** Soma das contagens dos projetos (+ quantos projetos). */
function sumTotals(projects) {
  const totals = Object.assign({}, EMPTY_TOTALS)
  projects.forEach((p) => {
    Object.keys(p.counts).forEach((key) => {
      totals[key] += p.counts[key]
    })
  })
  totals.projects = projects.length
  return totals
}

/** Áreas configuradas (na ordem) com quantas entregas cada uma tem nos projetos dados. */
function countAreas(areas, projects) {
  return areas.map((a) => ({
    key: a.key,
    name: a.name,
    deliveries: projects.reduce((n, p) => n + p.deliveries.filter((d) => d.area.key === a.key).length, 0),
  }))
}

module.exports = { RISKS, TI_AREA_KEY, EMPTY_TOTALS, dayOf, daysBetween, deliveryRisk, areaOf, buildDependencies, sumTotals, countAreas }
