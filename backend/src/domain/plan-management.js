/**
 * Quadro do projeto — GP-4: Gestão (docs/diretriz_feature_gerenciamento_projetos.md §15) e linha de
 * base do Cronograma (§13).
 *
 * - Diário do projeto: registros datados ("01/02/2024 — Reunião de abertura do projeto."). Quem edita
 *   o quadro registra; o autor ou o gestor edita e exclui.
 * - Gestão dos problemas: problemas numerados (#1, #2… por projeto) com data, descrição, responsável
 *   e situação (Em andamento, Pendente, Resolvido). Quem edita o quadro abre e atualiza; quem abriu
 *   ou o gestor exclui. Resolvido guarda o dia.
 * - Linha de base: foto do cronograma dos elementos para comparar com o atual.
 */

const JOURNAL_MAX = 5000
const ISSUE_DESCRIPTION_MAX = 2000
const ISSUE_STATES = ['in_progress', 'pending', 'resolved']
const DEFAULT_ISSUE_STATE = 'pending'

const text = (value) => (typeof value === 'string' ? value.trim() : '')
const isId = (value) => typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value)
const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(`${value}T00:00:00Z`))

function dayField(source, key, issues, data, partial) {
  if (partial && source[key] === undefined) return
  if (source[key] === undefined || source[key] === null || source[key] === '') issues[key] = 'required'
  else if (isDay(source[key])) data[key] = source[key]
  else issues[key] = 'invalid_date'
}

function textField(source, key, max, issues, data, partial) {
  if (partial && source[key] === undefined) return
  const value = text(source[key])
  if (!value) issues[key] = 'required'
  else if (value.length > max) issues[key] = 'too_long'
  else data[key] = value
}

/* ------------------------------------------------------------------ diário */

/** `{ entry_date*, content* }` (`partial`: só o que veio). */
function journalInput(input, partial) {
  const source = input || {}
  const issues = {}
  const data = {}
  dayField(source, 'entry_date', issues, data, partial)
  textField(source, 'content', JOURNAL_MAX, issues, data, partial)
  return { issues, data }
}

/** `can` = capacidades do quadro ({ edit, manage }). */
function journalCapabilities(can, entry, userId) {
  const own = !!can.edit && (entry.authorId === userId || !!can.manage)
  return { edit: own, delete: own }
}

const time = (value) => (value ? new Date(value).getTime() : 0)

/** Do dia mais recente para o mais antigo; no mesmo dia, o último registrado primeiro. */
function sortJournal(list) {
  return list.slice().sort((a, b) => (a.entryDate < b.entryDate ? 1 : a.entryDate > b.entryDate ? -1 : time(b.createdAt) - time(a.createdAt)))
}

/* ------------------------------------------------------------------ problemas */

/** `{ opened_on*, description*, state, owner_id }`; sem situação, nasce Pendente. */
function issueInput(input, partial) {
  const source = input || {}
  const issues = {}
  const data = {}
  dayField(source, 'opened_on', issues, data, partial)
  textField(source, 'description', ISSUE_DESCRIPTION_MAX, issues, data, partial)
  if (source.state !== undefined) {
    if (ISSUE_STATES.indexOf(source.state) < 0) issues.state = 'invalid_option'
    else data.state = source.state
  } else if (!partial) data.state = DEFAULT_ISSUE_STATE
  if (source.owner_id !== undefined) {
    if (source.owner_id === null || source.owner_id === '') data.owner_id = null
    else if (isId(source.owner_id)) data.owner_id = source.owner_id
    else issues.owner_id = 'invalid_type'
  }
  return { issues, data }
}

/** Dia da resolução: guardado ao resolver (e mantido); voltar para aberto limpa. */
function resolvedOn(issue, nextState, today) {
  if (nextState !== 'resolved') return null
  return issue.state === 'resolved' && issue.resolvedOn ? issue.resolvedOn : today
}

function issueCapabilities(can, issue, userId) {
  return { edit: !!can.edit, delete: !!can.manage || (!!can.edit && issue.createdBy === userId) }
}

/* ------------------------------------------------------------------ linha de base */

/** `{ id: { start, end } }` dos elementos de primeiro nível com cronograma (uma data = as duas pontas). */
function baselineSnapshot(items) {
  const out = {}
  items.forEach((item) => {
    if (item.parentId || (!item.startDate && !item.endDate)) return
    out[item.id] = { start: item.startDate || item.endDate, end: item.endDate || item.startDate }
  })
  return out
}

module.exports = {
  JOURNAL_MAX,
  ISSUE_DESCRIPTION_MAX,
  ISSUE_STATES,
  DEFAULT_ISSUE_STATE,
  journalInput,
  journalCapabilities,
  sortJournal,
  issueInput,
  resolvedOn,
  issueCapabilities,
  baselineSnapshot,
}
