/**
 * Casos de uso de comentários de tarefas (diretriz §18).
 *
 * - Qualquer pessoa com acesso ao projeto comenta (inclusive leitor); o autor edita; autor ou gestor exclui.
 * - Menções: `@[Nome](idDoUsuario)` no texto; só pessoas com acesso ao projeto podem ser marcadas.
 * - Histórico: comentário adicionado/editado/excluído e pessoas mencionadas vão para a auditoria da tarefa.
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const taskDomain = require('../domain/task')
const { buildAuditEntry, truncate } = require('./audit')
const { iso, toUserSummary } = require('./presenters')
const { presentAttachment } = require('./attachments')
const { createNotifier } = require('./notifications')

const MAX_CONTENT = 10000
const MAX_MENTIONS = 20
const EXCERPT = 500

function invalid(field, code) {
  return appError('VALIDATION_ERROR', undefined, { fields: { [field]: code } })
}

function createCommentService(deps) {
  const comments = deps.commentRepository
  const notifier = createNotifier(deps)

  async function loadTask(ctx, taskId) {
    rbac.assertAuthenticated(ctx.principal)
    const task = taskId ? await deps.taskRepository.findById(taskId) : null
    const project = task ? await deps.projectRepository.findById(task.projectId) : null
    if (!task || !project) throw appError('TASK_NOT_FOUND')
    const membership = await deps.projectMemberRepository.find(project.id, ctx.principal.userId)
    // Responsável TI: comenta nas tarefas visíveis a ele (§33)
    const access = taskDomain.scopedAccess(projectDomain.resolveAccess(ctx.principal, project, membership), task)
    taskDomain.assertTaskAccess(access, project, 'view', task)
    return { task, project, access }
  }

  /**
   * Pessoas ativas que enxergam a tarefa (dono e membros de qualquer papel; o Responsável TI só nas
   * tarefas visíveis a ele, §33). Quem pede como Responsável TI (\`access.scoped\`) não vê a lista de
   * membros: menciona só quem já aparece na tarefa (dono do projeto, autor, responsável, relator e quem
   * comentou).
   */
  async function participants(project, task, access) {
    let ids = (await deps.projectMemberRepository.listByProject(project.id))
      .filter((m) => taskDomain.memberSeesTask(project, m, m.userId, task))
      .map((m) => m.userId)
    if (ids.indexOf(project.ownerId) < 0) ids.push(project.ownerId)
    if (access && access.scoped) {
      const involved = [project.ownerId, task.creatorId, task.assigneeId, task.reporterId].concat((await comments.listByTask(task.id)).map((c) => c.userId))
      ids = ids.filter((id) => involved.indexOf(id) >= 0)
    }
    return (await deps.userRepository.findManyByIds(ids)).filter((u) => u.status === 'active')
  }

  function parseContent(input) {
    const data = assertValid(input, { content: [rules.required(), rules.maxLength(MAX_CONTENT)] })
    return data.content.trim()
  }

  /** Valida as menções do texto contra quem tem acesso ao projeto. */
  async function resolveMentions(project, task, access, content) {
    const ids = taskDomain.extractMentions(content)
    if (ids.length > MAX_MENTIONS) throw invalid('content', 'too_many_mentions')
    if (ids.length === 0) return []
    const allowed = await participants(project, task, access)
    const found = ids.map((id) => allowed.find((u) => u.id === id))
    if (found.some((u) => !u)) throw invalid('content', 'invalid_mention')
    return found
  }

  function present(comment, ctx, access, project, users, files) {
    const author = users[comment.userId]
    const capabilities = taskDomain.commentCapabilities(access, project, comment)
    return {
      id: comment.id,
      task_id: comment.taskId,
      author: author ? toUserSummary(author) : null,
      content: comment.deletedAt ? '' : comment.content,
      mentions: comment.deletedAt ? [] : (comment.mentions || []).map((id) => (users[id] ? toUserSummary(users[id]) : { id, name: null, email: null, avatar_url: null })),
      deleted: !!comment.deletedAt,
      created_at: iso(comment.createdAt),
      edited_at: iso(comment.editedAt),
      attachments: comment.deletedAt ? [] : ((files || {})[comment.id] || []).map((a) => presentAttachment(a, users[a.uploadedBy] || null, capabilities.delete)),
      capabilities,
    }
  }

  async function usersFor(list) {
    const ids = []
    list.forEach((c) => {
      ;[c.userId].concat(c.mentions || []).forEach((id) => {
        if (id && ids.indexOf(id) < 0) ids.push(id)
      })
    })
    const map = {}
    if (ids.length > 0) {
      ;(await deps.userRepository.findManyByIds(ids)).forEach((u) => {
        map[u.id] = u
      })
    }
    return map
  }

  function auditValue(content, mentioned) {
    const value = { comment: truncate(taskDomain.plainText(content), EXCERPT) }
    if (mentioned.length > 0) value.mentions = mentioned.map((u) => u.name).join(', ')
    return value
  }

  async function audit(repos, ctx, task, action, oldValue, newValue) {
    await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'task', entityId: task.id, action, oldValue, newValue }))
  }

  async function findComment(id) {
    const comment = id ? await comments.findById(id) : null
    if (!comment) throw appError('COMMENT_NOT_FOUND')
    return comment
  }

  // ------------------------------------------------------------------

  async function listComments(ctx, taskId) {
    const { task, project, access } = await loadTask(ctx, taskId)
    const list = await comments.listByTask(task.id)
    const users = await usersFor(list)
    const files = list.length ? await deps.attachmentRepository.listByComments(list.map((c) => c.id)) : {}
    return list.map((c) => present(c, ctx, access, project, users, files))
  }

  async function mentionCandidates(ctx, taskId) {
    const { task, project, access } = await loadTask(ctx, taskId)
    return (await participants(project, task, access))
      .map(toUserSummary)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async function createComment(ctx, taskId, input) {
    const { task, project, access } = await loadTask(ctx, taskId)
    taskDomain.assertCommentAccess(access, project, 'create')
    const content = parseContent(input)
    const mentioned = await resolveMentions(project, task, access, content)
    const created = await deps.unitOfWork.run(async (repos) => {
      const comment = await repos.commentRepository.create({ taskId: task.id, userId: ctx.principal.userId, content, mentions: mentioned.map((u) => u.id) })
      await audit(repos, ctx, task, 'comment.added', null, auditValue(content, mentioned))
      // menção tem prioridade; responsável e autor da tarefa recebem "comentário"
      await notifier.notify(repos, {
        task,
        project,
        actorId: ctx.principal.userId,
        entries: mentioned
          .map((u) => ({ userId: u.id, type: 'mention' }))
          .concat([
            { userId: task.assigneeId, type: 'comment' },
            { userId: task.creatorId, type: 'comment' },
          ]),
        data: { comment: truncate(taskDomain.plainText(content), 200) },
      })
      return comment
    })
    return present(created, ctx, access, project, await usersFor([created]))
  }

  async function updateComment(ctx, id, input) {
    const comment = await findComment(id)
    const { task, project, access } = await loadTask(ctx, comment.taskId)
    taskDomain.assertCommentAccess(access, project, 'edit', comment)
    const content = parseContent(input)
    if (content === comment.content) return present(comment, ctx, access, project, await usersFor([comment]), await deps.attachmentRepository.listByComments([comment.id]))
    const mentioned = await resolveMentions(project, task, access, content)
    const previous = comment.content
    const previousMentions = await deps.userRepository.findManyByIds(comment.mentions || [])
    const saved = await deps.unitOfWork.run(async (repos) => {
      const result = await repos.commentRepository.update(comment.id, { content, mentions: mentioned.map((u) => u.id), editedAt: deps.clock.now() })
      await audit(repos, ctx, task, 'comment.edited', auditValue(previous, previousMentions), auditValue(content, mentioned))
      // só quem passou a ser mencionado na edição
      const before = previousMentions.map((u) => u.id)
      await notifier.notify(repos, {
        task,
        project,
        actorId: ctx.principal.userId,
        entries: mentioned.filter((u) => before.indexOf(u.id) < 0).map((u) => ({ userId: u.id, type: 'mention' })),
        data: { comment: truncate(taskDomain.plainText(content), 200) },
      })
      return result
    })
    return present(saved, ctx, access, project, await usersFor([saved]), await deps.attachmentRepository.listByComments([saved.id]))
  }

  /** Exclusão lógica: o registro fica (autor e data), o texto some. */
  async function deleteComment(ctx, id) {
    const comment = await findComment(id)
    const { task, project, access } = await loadTask(ctx, comment.taskId)
    taskDomain.assertCommentAccess(access, project, 'delete', comment)
    await deps.unitOfWork.run(async (repos) => {
      await repos.commentRepository.update(comment.id, { content: '', mentions: [], deletedAt: deps.clock.now() })
      // os arquivos do comentário saem junto
      await repos.attachmentRepository.deleteByComment(comment.id)
      await audit(repos, ctx, task, 'comment.deleted', { comment: truncate(taskDomain.plainText(comment.content), EXCERPT) }, null)
    })
    return { deleted: true }
  }

  return { listComments, mentionCandidates, createComment, updateComment, deleteComment }
}

module.exports = { createCommentService }
