/**
 * Quadro do projeto — GP-3: painel do elemento (docs/diretriz_feature_gerenciamento_projetos.md §12).
 *
 * - Atualizações: quem vê o quadro publica e responde (um nível), inclusive o leitor; o autor edita;
 *   o autor ou o gestor exclui (exclusão lógica). @menções só de quem participa do projeto e
 *   notificam (`plan_mention`); a resposta avisa o autor da principal (`plan_reply`).
 * - Imagens e arquivos vão na própria atualização (colados ou anexados): seguem junto com o texto
 *   (tudo ou nada; tipo decidido pelo conteúdo, como nos anexos das tarefas) ou o autor anexa
 *   depois; o autor ou o gestor exclui; quem vê o quadro baixa. Excluir a atualização apaga os
 *   arquivos dela.
 * - Projeto arquivado: só leitura. Elemento que a pessoa não vê: 404 (anti-IDOR).
 * - Histórico do elemento (plan_item.update_*, plan_item.file_*) na mesma transação.
 */

const { appError } = require('../core/errors')
const updatesDomain = require('../domain/plan-updates')
const attachmentDomain = require('../domain/attachment')
const { extractMentions, plainText } = require('../domain/mentions')
const { truncate } = require('./audit')
const { iso, toUserSummary } = require('./presenters')
const { createPlanSupport, invalid, indexBy } = require('./plan-support')
const { createNotifier } = require('./notifications')

const EXCERPT = 500
const NOTIFY_EXCERPT = 200

function createPlanCollaborationService(deps) {
  const updates = deps.planUpdateRepository
  const files = deps.planFileRepository
  const support = createPlanSupport(deps)
  const { loadItem, loadOwned, audit } = support
  const notifier = createNotifier(deps)

  /** Pode publicar: vê o quadro e o projeto não está arquivado. */
  const canComment = (can, project) => can.view && !project.archivedAt
  const who = (can, project) => ({ comment: canComment(can, project), manager: can.manage })

  /** Pessoas ativas com acesso ao projeto (dono e membros de qualquer papel). */
  async function participants(project) {
    const ids = (await deps.projectMemberRepository.listByProject(project.id)).map((m) => m.userId)
    if (ids.indexOf(project.ownerId) < 0) ids.push(project.ownerId)
    return (await deps.userRepository.findManyByIds(ids)).filter((u) => u.status === 'active')
  }

  async function resolveMentions(project, content) {
    const ids = extractMentions(content)
    if (ids.length > updatesDomain.MAX_MENTIONS) throw invalid({ content: 'too_many_mentions' })
    if (ids.length === 0) return []
    const allowed = await participants(project)
    const found = ids.map((id) => allowed.find((u) => u.id === id))
    if (found.some((u) => !u)) throw invalid({ content: 'invalid_mention' })
    return found
  }

  function readContent(raw, withFiles) {
    const input = raw || {}
    const issue = updatesDomain.contentIssue(input.content, withFiles)
    if (issue) throw invalid({ content: issue })
    return typeof input.content === 'string' ? input.content.trim() : ''
  }

  /** Valida todos os arquivos antes de gravar qualquer um. `list`: [{ name, size, head, handle }]. */
  function prepareFiles(list) {
    const incoming = Array.isArray(list) ? list : []
    const issue = updatesDomain.uploadIssue(incoming)
    if (issue) throw invalid({ files: issue })
    return incoming.map((file) => {
      const name = attachmentDomain.safeFileName(file.name)
      const sizeIssue = attachmentDomain.sizeIssue(file.size)
      if (sizeIssue) throw invalid({ files: sizeIssue })
      const type = attachmentDomain.classify(name, file.head || [])
      if (type.error) throw invalid({ files: type.error })
      return { name, size: file.size, mime: type.mime, kind: type.kind, handle: file.handle }
    })
  }

  const saveFiles = async (repos, ctx, update, prepared) => {
    const saved = []
    for (const f of prepared) saved.push(await repos.planFileRepository.create(Object.assign({ projectId: update.projectId, itemId: update.itemId, updateId: update.id, uploadedBy: ctx.principal.userId }, f)))
    return saved
  }

  const filesOf = async (itemId) => {
    const out = {}
    ;(await files.listByItem(itemId))
      .slice()
      .sort((a, b) => (a.createdAt ? new Date(a.createdAt).getTime() : 0) - (b.createdAt ? new Date(b.createdAt).getTime() : 0))
      .forEach((f) => {
        if (f.updateId) (out[f.updateId] = out[f.updateId] || []).push(f)
      })
    return out
  }
  const names = (list) => list.map((f) => f.name).join(', ')

  async function usersFor(list) {
    const ids = []
    list.forEach((u) => {
      ;[u.authorId || u.uploadedBy].concat(u.mentions || []).forEach((id) => {
        if (id && ids.indexOf(id) < 0) ids.push(id)
      })
    })
    return indexBy(ids.length ? await deps.userRepository.findManyByIds(ids) : [])
  }

  /** `attached`: { update_id: [arquivo] } (as respostas usam o mesmo mapa). */
  function presentUpdate(update, users, rights, userId, attached) {
    const author = update.authorId ? users[update.authorId] : null
    const own = update.deletedAt ? [] : (attached && attached[update.id]) || []
    const out = {
      id: update.id,
      item_id: update.itemId,
      parent_id: update.parentId || null,
      author: author ? toUserSummary(author) : null,
      content: update.deletedAt ? '' : update.content,
      mentions: update.deletedAt ? [] : (update.mentions || []).map((id) => (users[id] ? toUserSummary(users[id]) : { id, name: null, email: null, avatar_url: null })),
      deleted: !!update.deletedAt,
      created_at: iso(update.createdAt),
      edited_at: iso(update.editedAt),
      capabilities: updatesDomain.capabilities(rights, update, userId),
      files: own.map((f) => presentFile(f, users, canDeleteFile(rights, f, userId))),
    }
    if (update.replies) out.replies = update.replies.map((r) => presentUpdate(r, users, rights, userId, attached))
    return out
  }

  const auditValue = (content, mentioned, attached) => {
    const value = {}
    if (content) value.update = truncate(plainText(content), EXCERPT)
    if (mentioned.length > 0) value.mentions = mentioned.map((u) => u.name).join(', ')
    if (attached && attached.length > 0) value.files = names(attached)
    return value
  }

  async function loadUpdate(ctx, id) {
    const found = await loadOwned(ctx, updates, id, 'PLAN_UPDATE_NOT_FOUND')
    const item = await deps.planItemRepository.findById(found.record.itemId)
    if (!item) throw appError('PLAN_UPDATE_NOT_FOUND')
    return { update: found.record, item, project: found.project, can: found.can }
  }

  /* ------------------------------------------------------------------ atualizações */

  async function listUpdates(ctx, itemId) {
    const { item, project, can } = await loadItem(ctx, itemId)
    const list = await updates.listByItem(item.id)
    const attached = await filesOf(item.id)
    const users = await usersFor(list)
    const rights = who(can, project)
    return { updates: updatesDomain.threads(list).map((t) => presentUpdate(t, users, rights, ctx.principal.userId, attached)), capabilities: { post: rights.comment } }
  }

  async function mentionCandidates(ctx, itemId) {
    const { project } = await loadItem(ctx, itemId)
    return (await participants(project))
      .map(toUserSummary)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** `uploads`: imagens/arquivos que seguem junto (multipart); com eles o texto pode ficar vazio. */
  async function createUpdate(ctx, itemId, raw, uploads) {
    const { item, project, can } = await loadItem(ctx, itemId)
    if (!canComment(can, project)) throw appError(project.archivedAt ? 'PROJECT_ARCHIVED' : 'FORBIDDEN')
    const prepared = prepareFiles(uploads)
    const content = readContent(raw, prepared.length > 0)
    let parent = null
    const parentId = raw && raw.parent_id
    if (parentId) {
      parent = typeof parentId === 'string' ? await updates.findById(parentId) : null
      if (!parent || parent.itemId !== item.id || parent.parentId || parent.deletedAt) throw invalid({ parent_id: 'invalid_option' })
    }
    const mentioned = await resolveMentions(project, content)
    const created = await deps.unitOfWork.run(async (repos) => {
      const saved = await repos.planUpdateRepository.create({ projectId: project.id, itemId: item.id, parentId: parent ? parent.id : null, authorId: ctx.principal.userId, content, mentions: mentioned.map((u) => u.id) })
      const stored = await saveFiles(repos, ctx, saved, prepared)
      await audit(repos, ctx, 'plan_item', item.id, 'plan_item.update_added', null, auditValue(content, mentioned, stored))
      // menção tem prioridade; a resposta avisa o autor da atualização principal
      await notifier.notifyItem(repos, {
        item,
        project,
        actorId: ctx.principal.userId,
        entries: mentioned.map((u) => ({ userId: u.id, type: 'plan_mention' })).concat(parent ? [{ userId: parent.authorId, type: 'plan_reply' }] : []),
        data: { update: truncate(plainText(content), NOTIFY_EXCERPT) },
      })
      return { saved, stored }
    })
    return presentUpdate(created.saved, await usersFor([created.saved].concat(created.stored)), who(can, project), ctx.principal.userId, { [created.saved.id]: created.stored })
  }

  async function editUpdate(ctx, id, raw) {
    const { update, item, project, can } = await loadUpdate(ctx, id)
    if (!updatesDomain.capabilities(who(can, project), update, ctx.principal.userId).edit) throw appError(project.archivedAt ? 'PROJECT_ARCHIVED' : 'FORBIDDEN')
    const attached = await filesOf(item.id)
    const content = readContent(raw, (attached[update.id] || []).length > 0)
    const present = async (u) => presentUpdate(u, await usersFor([u].concat(attached[u.id] || [])), who(can, project), ctx.principal.userId, attached)
    if (content === update.content) return await present(update)
    const mentioned = await resolveMentions(project, content)
    const before = await deps.userRepository.findManyByIds(update.mentions || [])
    const saved = await deps.unitOfWork.run(async (repos) => {
      const result = await repos.planUpdateRepository.update(update.id, { content, mentions: mentioned.map((u) => u.id), editedAt: deps.clock.now() })
      await audit(repos, ctx, 'plan_item', item.id, 'plan_item.update_edited', auditValue(update.content, before), auditValue(content, mentioned))
      // só quem passou a ser mencionado na edição
      const previous = before.map((u) => u.id)
      await notifier.notifyItem(repos, {
        item,
        project,
        actorId: ctx.principal.userId,
        entries: mentioned.filter((u) => previous.indexOf(u.id) < 0).map((u) => ({ userId: u.id, type: 'plan_mention' })),
        data: { update: truncate(plainText(content), NOTIFY_EXCERPT) },
      })
      return result
    })
    return await present(saved)
  }

  /** Exclusão lógica: autor e data ficam; o texto e os arquivos dela somem; as respostas continuam. */
  async function deleteUpdate(ctx, id) {
    const { update, item, project, can } = await loadUpdate(ctx, id)
    if (!updatesDomain.capabilities(who(can, project), update, ctx.principal.userId).delete) throw appError(project.archivedAt ? 'PROJECT_ARCHIVED' : 'FORBIDDEN')
    const own = (await filesOf(item.id))[update.id] || []
    const before = auditValue(update.content, [], own)
    await deps.unitOfWork.run(async (repos) => {
      for (const f of own) await repos.planFileRepository.delete(f.id)
      await repos.planUpdateRepository.update(update.id, { content: '', mentions: [], deletedAt: deps.clock.now() })
      await audit(repos, ctx, 'plan_item', item.id, 'plan_item.update_deleted', before, null)
    })
    return { deleted: true }
  }

  /* ------------------------------------------------------------------ arquivos */

  /** O autor anexa mais depois (mesmas regras do envio junto com o texto). */
  async function addFiles(ctx, updateId, uploads) {
    const { update, project, can } = await loadUpdate(ctx, updateId)
    if (!updatesDomain.capabilities(who(can, project), update, ctx.principal.userId).edit) throw appError(project.archivedAt ? 'PROJECT_ARCHIVED' : 'FORBIDDEN')
    const prepared = prepareFiles(uploads)
    if (prepared.length === 0) throw invalid({ files: 'required' })
    const stored = await deps.unitOfWork.run(async (repos) => {
      const saved = await saveFiles(repos, ctx, update, prepared)
      await audit(repos, ctx, 'plan_item', update.itemId, 'plan_item.file_added', null, { files: names(saved) })
      return saved
    })
    const users = await usersFor(stored)
    const rights = who(can, project)
    return stored.map((f) => presentFile(f, users, canDeleteFile(rights, f, ctx.principal.userId)))
  }

  /** Quem enviou (e ainda pode publicar) ou o gestor exclui. */
  const canDeleteFile = (rights, file, userId) => !!rights.comment && (file.uploadedBy === userId || !!rights.manager)

  function presentFile(file, users, canDelete) {
    const uploader = file.uploadedBy ? users[file.uploadedBy] : null
    return {
      id: file.id,
      item_id: file.itemId,
      update_id: file.updateId || null,
      name: file.name,
      mime: file.mime,
      kind: file.kind,
      size: file.size,
      uploaded_by: uploader ? toUserSummary(uploader) : null,
      created_at: iso(file.createdAt),
      url: `/api/v1/plan/files/${file.id}/file`,
      capabilities: { delete: !!canDelete },
    }
  }

  async function loadFile(ctx, id) {
    const found = await loadOwned(ctx, files, id, 'PLAN_FILE_NOT_FOUND')
    return { file: found.record, project: found.project, can: found.can }
  }

  async function deleteFile(ctx, id) {
    const { file, project, can } = await loadFile(ctx, id)
    if (!canDeleteFile(who(can, project), file, ctx.principal.userId)) throw appError(project.archivedAt ? 'PROJECT_ARCHIVED' : 'FORBIDDEN')
    await deps.unitOfWork.run(async (repos) => {
      await repos.planFileRepository.delete(file.id)
      await audit(repos, ctx, 'plan_item', file.itemId, 'plan_item.file_deleted', { files: file.name }, null)
    })
    return { deleted: true }
  }

  /** Arquivo para download (a infraestrutura serve o conteúdo protegido). */
  async function fileFor(ctx, id) {
    return (await loadFile(ctx, id)).file
  }

  return { listUpdates, mentionCandidates, createUpdate, editUpdate, deleteUpdate, addFiles, deleteFile, fileFor }
}

module.exports = { createPlanCollaborationService }
