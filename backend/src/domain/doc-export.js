/**
 * Exportar a documentação em PDF (regras de negócio §43, ADR-059): ordem de leitura das páginas
 * publicadas de um espaço e o tamanho do texto de cada uma. O navegador monta e imprime as folhas.
 *
 * - Ordem = a da árvore: irmãos pela posição e cada página seguida das suas subpáginas.
 * - Só entra o que foi publicado. Página publicada debaixo de um rascunho nunca publicado sobe para o
 *   primeiro ancestral publicado (ou vira raiz), para a árvore exportada não apontar para o que não sai.
 */

/** `pages`: [{ id, parentId, position, status }] → [{ id, parentId, depth }] só das publicadas, na ordem de leitura. */
function readingOrder(pages) {
  const list = Array.isArray(pages) ? pages : []
  const known = new Set(list.map((p) => p.id))
  const children = new Map()
  list.forEach((page) => {
    const parent = page.parentId && known.has(page.parentId) ? page.parentId : null
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent).push(page)
  })
  children.forEach((siblings) => siblings.sort((a, b) => (a.position || 0) - (b.position || 0) || String(a.id).localeCompare(String(b.id))))
  const out = []
  const visit = (parentId, publishedParent, depth, guard) => {
    if (guard > 100) return
    ;(children.get(parentId) || []).forEach((page) => {
      const published = page.status === 'published'
      if (published) out.push({ id: page.id, parentId: publishedParent, depth: depth + 1 })
      visit(page.id, published ? page.id : publishedParent, published ? depth + 1 : depth, guard + 1)
    })
  }
  visit(null, null, 0, 0)
  return out
}

/** Palavras do texto publicado (para a estimativa de folhas). */
function wordCount(text) {
  const words = String(text || '')
    .trim()
    .split(/\s+/)
  return words.length === 1 && words[0] === '' ? 0 : words.length
}

module.exports = { readingOrder, wordCount }
