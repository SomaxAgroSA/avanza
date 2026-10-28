/**
 * Casos de uso de anexos e imagens das tarefas (diretriz §16).
 *
 * - Anexar: `tasks.edit` + colaborar no projeto (o leitor só vê e baixa).
 * - Excluir: quem enviou ou o gestor do projeto (ou `projects.view_all`).
 * - O tipo do arquivo vem do CONTEÚDO (domain/attachment.js); nome e tamanho são validados aqui,
 *   e o PocketBase revalida tipo e tamanho ao gravar (segunda barreira).
 * - Campos personalizados de imagem/arquivo guardam IDs de anexos da própria tarefa.
 */

const { appError } = require('../core/errors')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const taskDomain = require('../domain/task')
const attachmentDomain = require('../domain/attachment')
const { buildAuditEntry, truncate } = require('./audit')
const { iso, toUserSummary } = require('./presenters')

function invalid(fields, details) {
  return appError('VALIDATION_ERROR', undefined, Object.assign({ fields }, details || {}))
}

function createAttachmentService(deps) {
  const attachments = deps.attachmentRepository

  async function loadTask(ctx, taskId, notFound) {
    rbac.assertAuthenticated(ctx.principal)
    const task = taskId ? await deps.taskRepository.findById(taskId) : null
    const project = task ? await deps.projectRepository.findById(task.projectId) : null
    if (!task || !project) throw appError(notFound || 'TASK_NOT_FOUND')
    const membership = await deps.projectMemberRepository.find(project.id, ctx.principal.userId)
    const access = projectDomain.resolveAccess(ctx.principal, project, membership)
    try {
      taskDomain.assertTaskAccess(access, project, 'view', task)
    } catch (err) {
      throw notFound ? appError(notFound) : err
    }
    return { task, project, access }
  }

  async function loadAttachment(ctx, id) {
    const attachment = id ? await attachments.findById(id) : null
    if (!attachment) throw appError('ATTACHMENT_NOT_FOUND')
    return Object.assign({ attachment }, await loadTask(ctx, attachment.taskId, 'ATTACHMENT_NOT_FOUND'))
  }

  async function canDelete(ctx, access, project, attachment) {
    // anexo de comentário segue a regra do comentário: autor ou gestor
    if (attachment.commentId) {
      const comment = await deps.commentRepository.findById(attachment.commentId)
      return !!comment && taskDomain.commentCapabilities(access, project, comment).delete
    }
    try {
      taskDomain.assertTaskAccess(access, project, 'edit')
    } catch (_) {
      return false
    }
    return attachment.uploadedBy === ctx.principal.userId || access.isManager
  }

  async function present(ctx, access, project, attachment, users) {
    return presentAttachment(attachment, attachment.uploadedBy ? users[attachment.uploadedBy] : null, await canDelete(ctx, access, project, attachment))
  }

  async function usersFor(list) {
    const ids = list.map((a) => a.uploadedBy).filter((id, i, all) => id && all.indexOf(id) === i)
    const map = {}
    if (ids.length > 0) {
      ;(await deps.userRepository.findManyByIds(ids)).forEach((u) => {
        map[u.id] = u
      })
    }
    return map
  }

  /** Campo de imagem/arquivo do tipo da tarefa, pelo nome técnico. */
  async function fileField(task, name) {
    const links = await deps.taskTypeFieldRepository.listByType(task.typeId)
    const fields = await deps.customFieldRepository.findManyByIds(links.map((l) => l.fieldId))
    const field = fields.find((f) => f.name === name)
    if (!field || (field.type !== 'image' && field.type !== 'file')) throw invalid({ field: 'unknown_field' })
    return field
  }

  /** Tipos dos campos da tarefa (para regravar os valores com a indexação certa). */
  async function fieldTypes(fieldIds) {
    const types = {}
    ;(await deps.customFieldRepository.findManyByIds(fieldIds)).forEach((f) => {
      types[f.id] = f.type
    })
    return types
  }

  async function audit(repos, ctx, task, action, oldValue, newValue) {
    await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'task', entityId: task.id, action, oldValue, newValue }))
  }

  // ------------------------------------------------------------------

  async function listAttachments(ctx, taskId) {
    const { task, project, access } = await loadTask(ctx, taskId)
    const list = await attachments.listByTask(task.id)
    const users = await usersFor(list)
    return Promise.all(list.map((a) => present(ctx, access, project, a, users)))
  }

  /**
   * `files`: [{ name, size, head (primeiros bytes), handle (arquivo da infraestrutura) }].
   * `fieldName` (opcional): campo de imagem/arquivo que recebe os anexos.
   */
  async function uploadAttachments(ctx, taskId, files, fieldName, commentId) {
    const { task, project, access } = await loadTask(ctx, taskId)
    // no comentário vale a regra do comentário (qualquer pessoa com acesso comenta; só o autor anexa ao seu)
    let comment = null
    if (commentId) {
      comment = await deps.commentRepository.findById(commentId)
      if (!comment || comment.taskId !== task.id || comment.deletedAt) throw appError('COMMENT_NOT_FOUND')
      taskDomain.assertCommentAccess(access, project, 'edit', comment)
    } else {
      taskDomain.assertTaskAccess(access, project, 'edit', task)
    }
    const list = Array.isArray(files) ? files : []
    if (list.length === 0) throw invalid({ files: 'required' })
    if (list.length > attachmentDomain.MAX_FILES_PER_UPLOAD) throw invalid({ files: 'too_many' })
    const field = fieldName && !comment ? await fileField(task, fieldName) : null

    // valida tudo antes de gravar qualquer arquivo
    const prepared = list.map((file, index) => {
      const name = attachmentDomain.safeFileName(file.name)
      const sizeIssue = attachmentDomain.sizeIssue(file.size)
      if (sizeIssue) throw invalid({ files: sizeIssue }, { index, name })
      const type = attachmentDomain.classify(name, file.head || [])
      if (type.error) throw invalid({ files: type.error }, { index, name })
      if (field && field.type === 'image' && type.kind !== 'image') throw invalid({ files: 'image_required' }, { index, name })
      return { name, size: file.size, mime: type.mime, kind: type.kind, handle: file.handle }
    })

    const created = await deps.unitOfWork.run(async (repos) => {
      const saved = []
      for (const file of prepared) {
        saved.push(
          await repos.attachmentRepository.create({
            taskId: task.id,
            commentId: comment ? comment.id : null,
            handle: file.handle,
            name: file.name,
            mime: file.mime,
            kind: file.kind,
            size: file.size,
            uploadedBy: ctx.principal.userId,
          }),
        )
      }
      const newValue = { attachments: saved.map((a) => a.name).join(', ') }
      if (comment) newValue.comment = truncate(taskDomain.plainText(comment.content), 200)
      if (field) {
        const values = (await repos.taskValueRepository.listByTasks([task.id]))[task.id] || {}
        const current = Array.isArray(values[field.id]) ? values[field.id] : []
        values[field.id] = current.concat(saved.map((a) => a.id))
        await repos.taskValueRepository.replace(task.id, values, await fieldTypes(Object.keys(values)))
        newValue.field = field.label
      }
      await audit(repos, ctx, task, 'attachment.added', null, newValue)
      return saved
    })
    const users = await usersFor(created)
    return Promise.all(created.map((a) => present(ctx, access, project, a, users)))
  }

  async function deleteAttachment(ctx, id) {
    const { attachment, task, project, access } = await loadAttachment(ctx, id)
    if (!(await canDelete(ctx, access, project, attachment))) {
      taskDomain.assertTaskAccess(access, project, 'edit', task)
      throw appError('FORBIDDEN')
    }
    await deps.unitOfWork.run(async (repos) => {
      // tira o anexo dos campos de imagem/arquivo que o referenciam
      const values = (await repos.taskValueRepository.listByTasks([task.id]))[task.id] || {}
      let changed = false
      Object.keys(values).forEach((fieldId) => {
        if (Array.isArray(values[fieldId]) && values[fieldId].indexOf(attachment.id) >= 0) {
          const rest = values[fieldId].filter((v) => v !== attachment.id)
          if (rest.length > 0) values[fieldId] = rest
          else delete values[fieldId]
          changed = true
        }
      })
      if (changed) await repos.taskValueRepository.replace(task.id, values, await fieldTypes(Object.keys(values)))
      await repos.attachmentRepository.delete(attachment.id)
      await audit(repos, ctx, task, 'attachment.deleted', { attachments: attachment.name }, null)
    })
    return { deleted: true }
  }

  /** Anexo para download (a infraestrutura serve o arquivo). */
  async function fileFor(ctx, id) {
    return (await loadAttachment(ctx, id)).attachment
  }

  return { listAttachments, uploadAttachments, deleteAttachment, fileFor }
}

/** Formato público do anexo (também usado nos comentários). */
function presentAttachment(attachment, uploader, canDelete) {
  return {
    id: attachment.id,
    task_id: attachment.taskId,
    comment_id: attachment.commentId || null,
    name: attachment.name,
    mime: attachment.mime,
    kind: attachment.kind,
    size: attachment.size,
    uploaded_by: uploader ? toUserSummary(uploader) : null,
    created_at: iso(attachment.createdAt),
    url: `/api/v1/attachments/${attachment.id}/file`,
    capabilities: { delete: !!canDelete },
  }
}

module.exports = { createAttachmentService, presentAttachment }
