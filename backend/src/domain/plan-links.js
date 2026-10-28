/**
 * Dependências entre elementos do quadro (Gerenciamento de Projetos, GP-2).
 *
 * - Tipos pedidos: "depende de", "bloqueia" e "relacionado". Gravados só dois: `blocks` (A bloqueia B;
 *   "B depende de A" é a mesma ligação vista do outro lado) e `relates` (sem sentido).
 * - Bloqueio não pode formar ciclo (A bloqueia B que bloqueia A).
 * - Regra do quadro (configurável pelo gestor): `warn` só sinaliza a dependência pendente; `block`
 *   impede iniciar ou concluir o elemento enquanto quem o bloqueia não estiver encerrado
 *   (concluído ou cancelado).
 */

const LINK_TYPES = Object.freeze(['depends_on', 'blocks', 'relates'])
const DEPENDENCY_RULES = Object.freeze(['warn', 'block'])
const DEFAULT_DEPENDENCY_RULE = 'warn'
/** Categorias de status em que o elemento já começou. */
const STARTED_CATEGORIES = Object.freeze(['in_progress', 'review', 'done'])
/** Categorias de status em que o elemento está encerrado (não bloqueia mais ninguém). */
const CLOSED_CATEGORIES = Object.freeze(['done', 'canceled'])

function linkTypeIssue(type) {
  return LINK_TYPES.indexOf(type) >= 0 ? null : 'invalid_option'
}

function ruleIssue(rule) {
  return DEPENDENCY_RULES.indexOf(rule) >= 0 ? null : 'invalid_option'
}

/** Tipo pedido na tela → ligação gravada ("A depende de B" = "B bloqueia A"). */
function normalizeLink(itemId, otherId, type) {
  if (type === 'depends_on') return { fromId: otherId, toId: itemId, type: 'blocks' }
  if (type === 'blocks') return { fromId: itemId, toId: otherId, type: 'blocks' }
  return { fromId: itemId, toId: otherId, type: 'relates' }
}

/** Existe caminho de bloqueio de `start` até `target`? */
function reaches(links, start, target) {
  const next = {}
  links.forEach((l) => {
    if (l.type === 'blocks') (next[l.fromId] = next[l.fromId] || []).push(l.toId)
  })
  const seen = {}
  const queue = [start]
  while (queue.length) {
    const id = queue.shift()
    if (id === target) return true
    if (seen[id]) continue
    seen[id] = true
    ;(next[id] || []).forEach((n) => queue.push(n))
  }
  return false
}

/** Problema ao criar a ligação: com o próprio elemento, repetida ou ciclo de bloqueio (null = ok). */
function linkIssue(links, link) {
  if (link.fromId === link.toId) return 'self'
  const repeated = links.some(
    (l) =>
      l.type === link.type &&
      ((l.fromId === link.fromId && l.toId === link.toId) || (link.type === 'relates' && l.fromId === link.toId && l.toId === link.fromId)),
  )
  if (repeated) return 'duplicate'
  if (link.type === 'blocks' && reaches(links, link.toId, link.fromId)) return 'cycle'
  return null
}

/** Quem bloqueia o elemento e ainda não está encerrado. */
function pendingBlockers(itemId, links, isClosed) {
  return links.filter((l) => l.type === 'blocks' && l.toId === itemId && !isClosed(l.fromId)).map((l) => l.fromId)
}

/** A troca de status inicia ou conclui o elemento? (a regra "impedir" vale só nesses casos) */
function gatesDependency(fromCategory, toCategory) {
  if (toCategory === 'done') return fromCategory !== 'done'
  if (toCategory === 'in_progress' || toCategory === 'review') return STARTED_CATEGORIES.indexOf(fromCategory) < 0
  return false
}

const isClosedCategory = (category) => CLOSED_CATEGORIES.indexOf(category) >= 0

module.exports = {
  LINK_TYPES,
  DEPENDENCY_RULES,
  DEFAULT_DEPENDENCY_RULE,
  CLOSED_CATEGORIES,
  linkTypeIssue,
  ruleIssue,
  normalizeLink,
  linkIssue,
  pendingBlockers,
  gatesDependency,
  isClosedCategory,
}
