/**
 * Timeline do projeto (expansão, Onda 1 — docs/roadmap-expansao.md).
 *
 * - Cada tarefa ocupa do **início planejado** ao **prazo** (dias inteiros). Só uma das datas vira
 *   uma barra de um dia; sem nenhuma, a tarefa fica em "Sem datas".
 * - Início não pode passar do prazo (mesmo dia pode).
 * - Dependências vêm das relações "bloqueia" e "depende de" (quem vem antes → quem vem depois).
 *   Conflito = a tarefa começa **antes do prazo** da tarefa de que depende (começar no mesmo dia do
 *   prazo é permitido). É um aviso: nada é reprogramado sozinho nesta onda.
 * - Marcos: entregas-chave do projeto (nome, data, situação pendente/atingido).
 */

const relation = require('./relation')

const MILESTONE_STATES = Object.freeze(['pending', 'done'])
const MILESTONE_NAME_MAX = 120
const MILESTONE_DESCRIPTION_MAX = 1000

const dayOf = (date) => (date ? date.toISOString().slice(0, 10) : null)

/** 'after_due_date' se o início passa do prazo; null se ok (ou se falta uma das datas). */
function datesIssue(startDate, dueDate) {
  if (!startDate || !dueDate) return null
  return dayOf(startDate) > dayOf(dueDate) ? 'after_due_date' : null
}

/** Período da barra em dias AAAA-MM-DD; null = sem datas. */
function spanOf(task) {
  const start = dayOf(task.startDate)
  const end = dayOf(task.dueDate)
  if (!start && !end) return null
  return { start: start || end, end: end || start }
}

/** Setas de dependência entre as tarefas `taskIds` (sem repetir o mesmo par). */
function dependencyEdges(relations, taskIds) {
  const inSet = {}
  taskIds.forEach((id) => {
    inSet[id] = true
  })
  const seen = {}
  const edges = []
  relations.forEach((rel) => {
    const pair = relation.precedenceOf(rel)
    if (!pair) return
    const from = pair[0]
    const to = pair[1]
    if (!inSet[from] || !inSet[to]) return
    const key = `${from}>${to}`
    if (seen[key]) return
    seen[key] = true
    edges.push({ id: rel.id, type: rel.type, from, to })
  })
  return edges
}

/** A tarefa `after` começa antes do prazo de `before` (de que ela depende)? */
function isConflict(before, after) {
  const a = spanOf(before)
  const b = spanOf(after)
  if (!a || !b) return false
  return b.start < a.end
}

function milestoneNameIssue(name) {
  const text = typeof name === 'string' ? name.trim() : ''
  if (!text) return 'required'
  if (text.length > MILESTONE_NAME_MAX) return 'too_long'
  return null
}

module.exports = {
  MILESTONE_STATES,
  MILESTONE_NAME_MAX,
  MILESTONE_DESCRIPTION_MAX,
  datesIssue,
  spanOf,
  dependencyEdges,
  isConflict,
  milestoneNameIssue,
}
