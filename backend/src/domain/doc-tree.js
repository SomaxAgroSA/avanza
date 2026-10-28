/**
 * Árvore de páginas de um espaço de documentação (expansão, Onda 2).
 * `pages`: [{ id, parentId }]. Raiz = parentId null. Profundidade da raiz = 1.
 */

const MAX_DEPTH = 8
const STEP = 1024

function parents(pages) {
  const map = {}
  pages.forEach((p) => {
    map[p.id] = p.parentId || null
  })
  return map
}

/** Mover `pageId` para dentro de `newParentId` criaria um ciclo (ela mesma ou uma subpágina sua)? */
function wouldCycle(pages, pageId, newParentId) {
  if (!newParentId) return false
  const map = parents(pages)
  let current = newParentId
  let guard = 0
  while (current && guard < 1000) {
    if (current === pageId) return true
    current = map[current]
    guard += 1
  }
  return false
}

function ancestorsOf(pages, id) {
  const map = parents(pages)
  const out = []
  let current = map[id]
  let guard = 0
  while (current && guard < 1000) {
    out.unshift(current)
    current = map[current]
    guard += 1
  }
  return out
}

function depthOf(pages, id) {
  return ancestorsOf(pages, id).length + 1
}

function childrenOf(pages, id) {
  return pages.filter((p) => (p.parentId || null) === (id || null)).map((p) => p.id)
}

function descendantsOf(pages, id) {
  const out = []
  const queue = childrenOf(pages, id)
  while (queue.length) {
    const next = queue.shift()
    out.push(next)
    childrenOf(pages, next).forEach((c) => queue.push(c))
  }
  return out
}

/** Níveis da subárvore a partir da página (ela mesma = 1). */
function subtreeHeight(pages, id) {
  const children = childrenOf(pages, id)
  if (!children.length) return 1
  return 1 + Math.max.apply(
    null,
    children.map((c) => subtreeHeight(pages, c)),
  )
}

/** Posição entre vizinhos (passo 1024); null = sem espaço (renumerar os irmãos). */
function positionBetween(prev, next) {
  const hasPrev = typeof prev === 'number'
  const hasNext = typeof next === 'number'
  if (!hasPrev && !hasNext) return STEP
  if (hasPrev && !hasNext) return prev + STEP
  if (!hasPrev && hasNext) return next - STEP
  if (next - prev < 1e-6) return null
  return (prev + next) / 2
}

module.exports = { MAX_DEPTH, STEP, wouldCycle, ancestorsOf, depthOf, childrenOf, descendantsOf, subtreeHeight, positionBetween }
