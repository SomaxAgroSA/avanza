/**
 * Páginas de documentação (expansão, Onda 2).
 *
 * - Página nova nasce **rascunho** (só quem edita vê). Salvar o rascunho não mexe no que os leitores
 *   veem; **publicar** grava o conteúdo, cria a próxima versão e limpa o rascunho.
 * - Conteúdo sempre higienizado (domain/doc-content.js) e texto indexado sem acento (busca).
 * - Árvore: subpáginas até 8 níveis, sem ciclo; excluir leva as subpáginas; a página inicial do
 *   espaço não é excluída nem movida.
 * - Arquivos (imagens e anexos) validados pelo conteúdo, como os anexos das tarefas; baixa quem vê a
 *   página.
 * - Auditoria: doc_page.created/published/moved/deleted/restored (rascunhos não geram histórico).
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const content = require('../domain/doc-content')
const tree = require('../domain/doc-tree')
const attachmentDomain = require('../domain/attachment')
const { buildAuditEntry } = require('./audit')
const { iso, toUserSummary } = require('./presenters')
const { createDocAccess } = require('./doc-access')

const TITLE_RULES = [rules.required(), rules.string(), rules.maxLength(200)]
const idRule = rules.custom((value) => (typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value) ? null : 'invalid_type'))
const SEARCH_LIMIT = 30
const RECENT_LIMIT = 10
const EMPTY = { type: 'doc', content: [] }

function invalid(fields, extra) {
  return appError('VALIDATION_ERROR', undefined, Object.assign({ fields }, extra || {}))
}

function createDocPageService(deps) {
  const pages = deps.docPageRepository
  const versions = deps.docPageVersionRepository
  const access = createDocAccess(deps)

  async function audit(repos, ctx, page, action, oldValue, newValue) {
    await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'doc_page', entityId: page.id, action, oldValue, newValue }))
  }

  async function user(id) {
    const found = id ? await deps.userRepository.findById(id) : null
    return found ? toUserSummary(found) : null
  }

  function requireEdit(loaded) {
    if (!loaded.access.canEdit) throw appError('FORBIDDEN')
  }

  function parseTitle(value) {
    return assertValid({ title: value }, { title: TITLE_RULES }).title
  }

  function clean(doc) {
    const result = content.sanitizeDoc(doc)
    if (result.error) throw invalid({ content: result.error })
    return result
  }

  async function visibleTree(loaded) {
    return pages.listTree(loaded.space.id)
  }

  async function present(loaded, page) {
    const all = await visibleTree(loaded)
    const visible = all.filter((p) => p.status === 'published' || loaded.access.canEdit)
    const byId = {}
    all.forEach((p) => {
      byId[p.id] = p
    })
    return {
      id: page.id,
      space: { id: loaded.space.id, key: loaded.space.key, name: loaded.space.name },
      parent_id: page.parentId || null,
      title: page.title,
      status: page.status,
      content: page.status === 'published' ? page.content || EMPTY : null,
      version: page.version || 0,
      published_at: iso(page.publishedAt),
      published_by: await user(page.publishedBy),
      created_by: await user(page.createdBy),
      is_home: page.id === loaded.space.homePageId,
      ancestors: tree.ancestorsOf(all, page.id).map((id) => ({ id, title: byId[id] ? byId[id].title : '' })),
      children: visible
        .filter((p) => (p.parentId || null) === page.id)
        .sort((a, b) => (a.position || 0) - (b.position || 0))
        .map((p) => ({ id: p.id, title: p.title, status: p.status })),
      draft: loaded.access.canEdit && page.draftAt ? { title: page.draftTitle || page.title, by: await user(page.draftBy), at: iso(page.draftAt) } : null,
      capabilities: { edit: loaded.access.canEdit, manage: loaded.access.canManage },
    }
  }

  async function getPage(ctx, id) {
    const loaded = await access.loadPage(ctx, id)
    return present(loaded, loaded.page)
  }

  async function createPage(ctx, spaceId, input) {
    const loaded = await access.loadSpace(ctx, spaceId)
    requireEdit(loaded)
    const source = input || {}
    const title = parseTitle(source.title)
    const parentId = source.parent_id ? assertValid({ parent_id: source.parent_id }, { parent_id: [idRule] }).parent_id : null
    const all = await pages.listTree(loaded.space.id)
    if (parentId) {
      const parent = all.find((p) => p.id === parentId)
      if (!parent) throw invalid({ parent_id: 'not_found' })
      if (tree.depthOf(all, parentId) + 1 > tree.MAX_DEPTH) throw appError('DOC_PAGE_TOO_DEEP')
    }
    const siblings = all.filter((p) => (p.parentId || null) === parentId)
    const position = siblings.reduce((max, p) => Math.max(max, p.position || 0), 0) + tree.STEP
    const now = deps.clock.now()
    const created = await deps.unitOfWork.run(async (repos) => {
      const page = await repos.docPageRepository.create({
        spaceId: loaded.space.id,
        parentId,
        title,
        position,
        status: 'draft',
        content: null,
        contentText: '',
        searchText: '',
        version: 0,
        draft: EMPTY,
        draftTitle: title,
        draftBy: ctx.principal.userId,
        draftAt: now,
        createdBy: ctx.principal.userId,
      })
      await audit(repos, ctx, page, 'doc_page.created', null, { title, space: loaded.space.key })
      return page
    })
    return present(loaded, created)
  }

  async function getDraft(ctx, id) {
    const loaded = await access.loadPage(ctx, id)
    requireEdit(loaded)
    const page = loaded.page
    return {
      title: page.draftAt ? page.draftTitle || page.title : page.title,
      content: page.draftAt ? page.draft || EMPTY : page.content || EMPTY,
      saved_at: iso(page.draftAt),
      by: page.draftAt ? await user(page.draftBy) : null,
    }
  }

  async function saveDraft(ctx, id, input) {
    const loaded = await access.loadPage(ctx, id)
    requireEdit(loaded)
    const source = input || {}
    const title = parseTitle(source.title)
    const cleaned = clean(source.content)
    const now = deps.clock.now()
    await pages.update(loaded.page.id, { draft: cleaned.doc, draftTitle: title, draftBy: ctx.principal.userId, draftAt: now })
    return { saved_at: iso(now) }
  }

  async function discardDraft(ctx, id) {
    const loaded = await access.loadPage(ctx, id)
    requireEdit(loaded)
    await pages.update(loaded.page.id, { draft: null, draftTitle: '', draftBy: null, draftAt: null })
    return { discarded: true }
  }

  async function publishWith(ctx, loaded, title, doc, action, extra) {
    const cleaned = clean(doc)
    const version = (loaded.page.version || 0) + 1
    const now = deps.clock.now()
    const saved = await deps.unitOfWork.run(async (repos) => {
      const updated = await repos.docPageRepository.update(loaded.page.id, {
        title,
        content: cleaned.doc,
        contentText: cleaned.text,
        searchText: content.fold(`${title} ${cleaned.text}`),
        status: 'published',
        version,
        publishedAt: now,
        publishedBy: ctx.principal.userId,
        draft: null,
        draftTitle: '',
        draftBy: null,
        draftAt: null,
      })
      await repos.docPageVersionRepository.create({ pageId: loaded.page.id, version, title, content: cleaned.doc, author: ctx.principal.userId })
      await audit(repos, ctx, loaded.page, action, null, Object.assign({ title, version }, extra || {}))
      return updated
    })
    return present(loaded, saved)
  }

  async function publishPage(ctx, id, input) {
    const loaded = await access.loadPage(ctx, id)
    requireEdit(loaded)
    const source = input || {}
    const page = loaded.page
    const title = parseTitle(source.title !== undefined ? source.title : page.draftAt ? page.draftTitle || page.title : page.title)
    const doc = source.content !== undefined ? source.content : page.draftAt ? page.draft : page.content
    return publishWith(ctx, loaded, title, doc, 'doc_page.published')
  }

  async function movePage(ctx, id, input) {
    const loaded = await access.loadPage(ctx, id)
    requireEdit(loaded)
    if (loaded.page.id === loaded.space.homePageId) throw appError('DOC_PAGE_IS_HOME')
    const source = input || {}
    const data = assertValid(
      { parent_id: source.parent_id || undefined, prev_id: source.prev_id || undefined, next_id: source.next_id || undefined },
      { parent_id: [idRule], prev_id: [idRule], next_id: [idRule] },
    )
    const parentId = data.parent_id || null
    const all = await pages.listTree(loaded.space.id)
    if (parentId && !all.some((p) => p.id === parentId)) throw invalid({ parent_id: 'not_found' })
    if (tree.wouldCycle(all, loaded.page.id, parentId)) throw appError('DOC_PAGE_CYCLE')
    const parentDepth = parentId ? tree.depthOf(all, parentId) : 0
    if (parentDepth + tree.subtreeHeight(all, loaded.page.id) > tree.MAX_DEPTH) throw appError('DOC_PAGE_TOO_DEEP')

    let siblings = all.filter((p) => (p.parentId || null) === parentId && p.id !== loaded.page.id).sort((a, b) => (a.position || 0) - (b.position || 0))
    const place = () => {
      let prev = null
      let next = null
      if (data.next_id) {
        const index = siblings.findIndex((p) => p.id === data.next_id)
        if (index >= 0) {
          next = siblings[index]
          prev = index > 0 ? siblings[index - 1] : null
        }
      } else if (data.prev_id) {
        const index = siblings.findIndex((p) => p.id === data.prev_id)
        if (index >= 0) {
          prev = siblings[index]
          next = siblings[index + 1] || null
        }
      } else prev = siblings[siblings.length - 1] || null
      return tree.positionBetween(prev ? prev.position || 0 : null, next ? next.position || 0 : null)
    }
    let position = place()
    if (position === null) {
      await pages.renumber(siblings.map((p) => p.id))
      siblings = (await pages.listTree(loaded.space.id))
        .filter((p) => (p.parentId || null) === parentId && p.id !== loaded.page.id)
        .sort((a, b) => (a.position || 0) - (b.position || 0))
      position = place()
    }
    const parent = parentId ? all.find((p) => p.id === parentId) : null
    const saved = await deps.unitOfWork.run(async (repos) => {
      const updated = await repos.docPageRepository.update(loaded.page.id, { parentId, position })
      if ((loaded.page.parentId || null) !== parentId) await audit(repos, ctx, loaded.page, 'doc_page.moved', { parent: loaded.page.parentId || null }, { parent: parent ? parent.title : null })
      return updated
    })
    return present(loaded, saved)
  }

  async function deletePage(ctx, id) {
    const loaded = await access.loadPage(ctx, id)
    requireEdit(loaded)
    if (loaded.page.id === loaded.space.homePageId) throw appError('DOC_PAGE_IS_HOME')
    const all = await pages.listTree(loaded.space.id)
    const ids = [loaded.page.id].concat(tree.descendantsOf(all, loaded.page.id))
    await deps.unitOfWork.run(async (repos) => {
      await repos.docPageRepository.deleteMany(ids)
      await audit(repos, ctx, loaded.page, 'doc_page.deleted', { title: loaded.page.title, subpages: ids.length - 1 }, null)
    })
    return { deleted: ids.length }
  }

  async function listVersions(ctx, id) {
    const loaded = await access.loadPage(ctx, id)
    const list = []
    for (const v of await versions.listByPage(loaded.page.id)) list.push({ version: v.version, title: v.title, author: await user(v.author), created_at: iso(v.createdAt) })
    return list
  }

  async function findVersion(loaded, version) {
    const number = Number(version)
    const found = Number.isInteger(number) ? await versions.find(loaded.page.id, number) : null
    if (!found) throw appError('DOC_VERSION_NOT_FOUND')
    return found
  }

  async function getVersion(ctx, id, version) {
    const loaded = await access.loadPage(ctx, id)
    const found = await findVersion(loaded, version)
    return { version: found.version, title: found.title, content: found.content || EMPTY, author: await user(found.author), created_at: iso(found.createdAt) }
  }

  async function restoreVersion(ctx, id, version) {
    const loaded = await access.loadPage(ctx, id)
    requireEdit(loaded)
    const found = await findVersion(loaded, version)
    return publishWith(ctx, loaded, found.title, found.content || EMPTY, 'doc_page.restored', { from_version: found.version })
  }

  async function spacesIndex(ctx) {
    const readable = await access.readableSpaces(ctx)
    const index = {}
    readable.forEach((item) => {
      index[item.space.id] = item.space
    })
    return index
  }

  async function search(ctx, query) {
    const q = String((query && query.q) || '').trim()
    if (q.length < 2) throw invalid({ q: 'too_short' })
    if (q.length > 100) throw invalid({ q: 'too_long' })
    const index = await spacesIndex(ctx)
    const ids = Object.keys(index)
    if (!ids.length) return []
    return (await pages.search(ids, content.fold(q), SEARCH_LIMIT)).map((page) => ({
      page_id: page.id,
      title: page.title,
      space: { id: page.spaceId, key: index[page.spaceId].key, name: index[page.spaceId].name },
      snippet: content.snippet(page.contentText || '', q, 80),
      published_at: iso(page.publishedAt),
    }))
  }

  async function recent(ctx) {
    const index = await spacesIndex(ctx)
    const ids = Object.keys(index)
    if (!ids.length) return []
    const list = []
    for (const page of await pages.recent(ids, RECENT_LIMIT)) {
      list.push({
        page_id: page.id,
        title: page.title,
        space: { id: page.spaceId, key: index[page.spaceId].key, name: index[page.spaceId].name },
        published_at: iso(page.publishedAt),
        published_by: await user(page.publishedBy),
      })
    }
    return list
  }

  /** `files`: [{ name, size, head (primeiros bytes), handle (arquivo da infraestrutura) }]. */
  async function uploadFiles(ctx, pageId, files) {
    const loaded = await access.loadPage(ctx, pageId)
    requireEdit(loaded)
    const list = Array.isArray(files) ? files : []
    if (list.length === 0) throw invalid({ files: 'required' })
    if (list.length > attachmentDomain.MAX_FILES_PER_UPLOAD) throw invalid({ files: 'too_many' })
    const prepared = list.map((file, index) => {
      const name = attachmentDomain.safeFileName(file.name)
      const sizeIssue = attachmentDomain.sizeIssue(file.size)
      if (sizeIssue) throw invalid({ files: sizeIssue }, { index, name })
      const type = attachmentDomain.classify(name, file.head || [])
      if (type.error) throw invalid({ files: type.error }, { index, name })
      return { name, size: file.size, mime: type.mime, kind: type.kind, handle: file.handle }
    })
    const created = await deps.unitOfWork.run(async (repos) => {
      const saved = []
      for (const file of prepared) {
        saved.push(await repos.docFileRepository.create({ spaceId: loaded.space.id, pageId: loaded.page.id, handle: file.handle, name: file.name, mime: file.mime, kind: file.kind, size: file.size, uploadedBy: ctx.principal.userId }))
      }
      return saved
    })
    return created.map((file) => ({ id: file.id, name: file.name, kind: file.kind, mime: file.mime, size: file.size, url: `/api/v1/docs/files/${file.id}` }))
  }

  /** Arquivo para download: baixa quem vê a página (rascunho só quem edita). */
  async function fileFor(ctx, fileId) {
    const file = fileId ? await deps.docFileRepository.findById(fileId) : null
    if (!file) throw appError('DOC_FILE_NOT_FOUND')
    try {
      await access.loadPage(ctx, file.pageId)
    } catch (err) {
      if (err && err.code === 'DOC_PAGE_NOT_FOUND') throw appError('DOC_FILE_NOT_FOUND')
      throw err
    }
    return file
  }

  return { getPage, createPage, getDraft, saveDraft, discardDraft, publishPage, movePage, deletePage, listVersions, getVersion, restoreVersion, search, recent, uploadFiles, fileFor }
}

module.exports = { createDocPageService }
