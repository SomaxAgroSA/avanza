/**
 * Exportar a documentação em PDF (regras de negócio §43, ADR-059): o navegador imprime; a API entrega
 * numa chamada só as páginas **publicadas** de um espaço (`space` = chave) ou de todos os espaços de um
 * módulo que a pessoa lê (`module` = id), na ordem de leitura, com o conteúdo e o que vai na capa,
 * no índice e no cabeçalho de cada página.
 *
 * - Leitura: as mesmas regras da tela (`docs.view` + visibilidade do espaço, domain/docs.js); espaço
 *   invisível = DOC_SPACE_NOT_FOUND. No módulo, só entram os espaços que a pessoa lê, pelo nome.
 * - Nunca sai rascunho: página nunca publicada fica de fora e a publicada sai como foi publicada.
 * - A escolha "esta página", "com as subpáginas" e "anexos" é feita na tela sobre esta resposta
 *   (o espaço inteiro já vem, para a estimativa de folhas e a troca de seleção sem nova busca).
 * - Só leitura: não grava histórico.
 */

const { appError } = require('../core/errors')
const rbac = require('../domain/rbac')
const docExport = require('../domain/doc-export')
const { iso, toUserSummary } = require('./presenters')
const { createDocAccess } = require('./doc-access')

const ID = /^[A-Za-z0-9_]{1,64}$/
const EMPTY = { type: 'doc', content: [] }

function invalid(fields) {
  return appError('VALIDATION_ERROR', undefined, { fields })
}

function createDocExportService(deps) {
  const access = createDocAccess(deps)

  const moduleRef = (item) => (item ? { id: item.id, name: item.name, color: item.color || 'blue' } : null)

  /** Espaços a exportar ({ space, access }) e o módulo pedido (ou null). */
  async function chosen(ctx, query) {
    const q = query || {}
    const spaceKey = typeof q.space === 'string' ? q.space.trim() : ''
    const moduleId = typeof q.module === 'string' ? q.module.trim() : ''
    if (!spaceKey && !moduleId) throw invalid({ space: 'required' })
    if (spaceKey && moduleId) throw invalid({ module: 'invalid_option' })
    if (spaceKey) return { module: null, items: [await access.loadSpaceByKey(ctx, spaceKey)] }
    const found = ID.test(moduleId) ? await deps.docModuleRepository.findById(moduleId) : null
    if (!found) throw appError('DOC_MODULE_NOT_FOUND')
    const items = (await access.readableSpaces(ctx)).filter((item) => item.space.moduleId === found.id).sort((a, b) => a.space.name.localeCompare(b.space.name))
    return { module: found, items }
  }

  async function exportDocs(ctx, query) {
    rbac.assertAuthenticated(ctx.principal)
    rbac.assertCan(ctx.principal, 'docs.view')
    const { module, items } = await chosen(ctx, query)
    const spaceIds = items.map((item) => item.space.id)
    const published = {}
    ;(await deps.docPageRepository.listPublishedContent(spaceIds)).forEach((page) => {
      published[page.id] = page
    })
    const authorIds = Object.keys(published)
      .map((id) => published[id].publishedBy)
      .filter((id, i, all) => id && all.indexOf(id) === i)
    const authors = {}
    ;(authorIds.length ? await deps.userRepository.findManyByIds(authorIds) : []).forEach((user) => {
      authors[user.id] = toUserSummary(user)
    })
    const modules = {}
    ;(await deps.docModuleRepository.list()).forEach((item) => {
      modules[item.id] = item
    })

    const spaces = []
    for (const { space } of items) {
      const order = docExport.readingOrder(await deps.docPageRepository.listTree(space.id))
      const pages = order
        .filter((entry) => published[entry.id])
        .map((entry) => {
          const page = published[entry.id]
          return {
            id: page.id,
            parent_id: entry.parentId,
            depth: entry.depth,
            title: page.title,
            version: page.version || 0,
            published_at: iso(page.publishedAt),
            published_by: page.publishedBy ? authors[page.publishedBy] || null : null,
            words: docExport.wordCount(page.contentText),
            content: page.content || EMPTY,
          }
        })
      // no módulo, espaço sem nada publicado não ganha folha
      if (module && pages.length === 0) continue
      const project = space.projectId ? await deps.projectRepository.findById(space.projectId) : null
      spaces.push({
        id: space.id,
        key: space.key,
        name: space.name,
        description: space.description || '',
        icon: space.icon || 'book',
        color: space.color || 'blue',
        module: moduleRef(space.moduleId ? modules[space.moduleId] : null),
        project: project ? { id: project.id, key: project.key, name: project.name } : null,
        home_page_id: space.homePageId || null,
        pages,
      })
    }
    return { module: moduleRef(module), spaces }
  }

  return { exportDocs }
}

module.exports = { createDocExportService }
