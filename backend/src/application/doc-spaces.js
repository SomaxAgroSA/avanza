/**
 * Espaços de documentação (expansão, Onda 2).
 * - Criar: `docs.manage` (+ gestor do projeto, se o espaço for de projeto). Ao criar, nasce a página
 *   inicial já publicada (versão 1) com o nome do espaço.
 * - Configurar/excluir: quem gerencia o espaço (domain/docs.js). Chave e projeto não mudam.
 * - Auditoria: doc_space.created/updated/deleted.
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const docsDomain = require('../domain/docs')
const content = require('../domain/doc-content')
const { OPTION_COLORS } = require('../domain/custom-field')
const { colorRule } = require('../domain/color')
const { buildAuditEntry, diff } = require('./audit')
const { iso } = require('./presenters')
const { createDocAccess } = require('./doc-access')

const idRule = rules.custom((value) => (typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value) ? null : 'invalid_type'))
const RULES = {
  key: [rules.required(), rules.custom((value) => docsDomain.spaceKeyIssue(value))],
  name: [rules.required(), rules.string(), rules.maxLength(80)],
  description: [rules.string(), rules.maxLength(500)],
  icon: [rules.oneOf(docsDomain.SPACE_ICONS)],
  color: [colorRule(OPTION_COLORS)],
  project_id: [idRule],
  visibility: [rules.required(), rules.oneOf(docsDomain.SPACE_VISIBILITIES)],
}
const EDITABLE = ['name', 'description', 'icon', 'color', 'visibility']

function invalid(fields) {
  return appError('VALIDATION_ERROR', undefined, { fields })
}

function createDocSpaceService(deps) {
  const spaces = deps.docSpaceRepository
  const access = createDocAccess(deps)

  async function audit(repos, ctx, entityId, action, oldValue, newValue) {
    await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'doc_space', entityId, action, oldValue, newValue }))
  }

  async function present(space, spaceAccess, pageCount) {
    const project = space.projectId ? await deps.projectRepository.findById(space.projectId) : null
    return {
      id: space.id,
      key: space.key,
      name: space.name,
      description: space.description || '',
      icon: space.icon || 'book',
      color: space.color || 'blue',
      visibility: space.visibility,
      project: project ? { id: project.id, key: project.key, name: project.name } : null,
      home_page_id: space.homePageId || null,
      page_count: pageCount === undefined ? null : pageCount,
      created_at: iso(space.createdAt),
      updated_at: iso(space.updatedAt),
      capabilities: { edit: spaceAccess.canEdit, manage: spaceAccess.canManage },
    }
  }

  async function listSpaces(ctx) {
    const readable = await access.readableSpaces(ctx)
    const counts = await deps.docPageRepository.countPublishedBySpaces(readable.map((item) => item.space.id))
    const presented = []
    for (const item of readable) presented.push(await present(item.space, item.access, counts[item.space.id] || 0))
    return presented.sort((a, b) => a.name.localeCompare(b.name))
  }

  async function getSpace(ctx, key) {
    const loaded = await access.loadSpaceByKey(ctx, key)
    const pages = (await deps.docPageRepository.listTree(loaded.space.id))
      .filter((page) => docsDomain.canSeePage(loaded.access, page))
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map((page) => ({
        id: page.id,
        parent_id: page.parentId || null,
        title: page.title,
        status: page.status,
        position: page.position || 0,
        has_draft: loaded.access.canEdit ? !!page.draftAt : false,
        is_home: page.id === loaded.space.homePageId,
        updated_at: iso(page.publishedAt || page.updatedAt),
      }))
    return {
      space: await present(loaded.space, loaded.access, pages.filter((p) => p.status === 'published').length),
      pages,
      capabilities: { edit: loaded.access.canEdit, manage: loaded.access.canManage },
    }
  }

  async function createSpace(ctx, input) {
    rbac.assertAuthenticated(ctx.principal)
    rbac.assertCan(ctx.principal, 'docs.manage')
    const data = assertValid(input || {}, RULES)
    const visibilityIssue = docsDomain.visibilityIssue(data.visibility, data.project_id)
    if (visibilityIssue) throw invalid({ visibility: visibilityIssue })
    if (data.project_id) {
      const project = await deps.projectRepository.findById(data.project_id)
      const projectAccess = project ? projectDomain.resolveAccess(ctx.principal, project, await deps.projectMemberRepository.find(project.id, ctx.principal.userId)) : null
      if (!project || !projectAccess.canView) throw appError('PROJECT_NOT_FOUND')
      if (!projectAccess.isManager) throw appError('FORBIDDEN')
    }
    if (await spaces.findByKey(data.key)) throw appError('DOC_SPACE_KEY_IN_USE')

    const now = deps.clock.now()
    const home = data.description
      ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: data.description }] }] }
      : { type: 'doc', content: [] }
    const cleaned = content.sanitizeDoc(home)
    const created = await deps.unitOfWork.run(async (repos) => {
      const space = await repos.docSpaceRepository.create({
        key: data.key,
        name: data.name,
        description: data.description || '',
        icon: data.icon || 'book',
        color: data.color || 'blue',
        projectId: data.project_id || null,
        visibility: data.visibility,
        createdBy: ctx.principal.userId,
      })
      const page = await repos.docPageRepository.create({
        spaceId: space.id,
        parentId: null,
        title: data.name,
        position: 0,
        status: 'published',
        content: cleaned.doc,
        contentText: cleaned.text,
        searchText: content.fold(`${data.name} ${cleaned.text}`),
        version: 1,
        publishedAt: now,
        publishedBy: ctx.principal.userId,
        createdBy: ctx.principal.userId,
      })
      await repos.docPageVersionRepository.create({ pageId: page.id, version: 1, title: data.name, content: cleaned.doc, author: ctx.principal.userId })
      const saved = await repos.docSpaceRepository.update(space.id, { homePageId: page.id })
      await audit(repos, ctx, space.id, 'doc_space.created', null, { key: space.key, name: space.name, visibility: space.visibility })
      return saved
    })
    return present(created, await access.accessOf(ctx, created), 1)
  }

  async function updateSpace(ctx, id, input) {
    const loaded = await access.loadSpace(ctx, id)
    if (!loaded.access.canManage) throw appError('FORBIDDEN')
    const source = input || {}
    const schema = {}
    EDITABLE.forEach((key) => {
      if (source[key] !== undefined) schema[key] = RULES[key]
    })
    const data = assertValid(source, schema)
    if (data.visibility) {
      const issue = docsDomain.visibilityIssue(data.visibility, loaded.space.projectId)
      if (issue) throw invalid({ visibility: issue })
    }
    const before = { name: loaded.space.name, description: loaded.space.description || '', icon: loaded.space.icon, color: loaded.space.color, visibility: loaded.space.visibility }
    const change = diff(before, data, EDITABLE)
    if (!change) return present(loaded.space, loaded.access)
    const saved = await deps.unitOfWork.run(async (repos) => {
      const updated = await repos.docSpaceRepository.update(loaded.space.id, change.newValue)
      await audit(repos, ctx, loaded.space.id, 'doc_space.updated', change.oldValue, change.newValue)
      return updated
    })
    return present(saved, await access.accessOf(ctx, saved))
  }

  async function deleteSpace(ctx, id) {
    const loaded = await access.loadSpace(ctx, id)
    if (!loaded.access.canManage) throw appError('FORBIDDEN')
    await deps.unitOfWork.run(async (repos) => {
      await repos.docSpaceRepository.delete(loaded.space.id)
      await audit(repos, ctx, loaded.space.id, 'doc_space.deleted', { key: loaded.space.key, name: loaded.space.name }, null)
    })
    return { deleted: true }
  }

  return { listSpaces, getSpace, createSpace, updateSpace, deleteSpace }
}

module.exports = { createDocSpaceService }
