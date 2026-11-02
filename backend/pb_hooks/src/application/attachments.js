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

  function loadTask(ctx, taskId, notFound) {
    rbac.assertAuthenticated(ctx.principal)
    const task = taskId ? deps.taskRepository.findById(taskId) : null
    const project = task ? deps.projectRepository.findById(task.projectId) : null
    if (!task || !project) throw appError(notFound || 'TASK_NOT_FOUND')
    const membership = deps.projectMemberRepository.find(project.id, ctx.principal.userId)
    const access = taskDomain.scopedAccess(projectDomain.resolveAccess(ctx.principal, project, membership), task)
    try {
      taskDomain.assertTaskAccess(access, project, 'view', task)
    } catch (err) {
      throw notFound ? appError(notFound) : err
    }
    return { task, project, access }
  }

  function loadAttachment(ctx, id) {
    const attachment = id ? attachments.findById(id) : null
    if (!attachment) throw appError('ATTACHMENT_NOT_FOUND')
    return Object.assign({ attachment }, loadTask(ctx, attachment.taskId, 'ATTACHMENT_NOT_FOUND'))
  }

  function canDelete(ctx, access, project, attachment) {
    // anexo de comentário segue a regra do comentário: autor ou gestor
    if (attachment.commentId) {
      const comment = deps.commentRepository.findById(attachment.commentId)
      return !!comment && taskDomain.commentCapabilities(access, project, comment).delete
    }
    try {
      taskDomain.assertTaskAccess(access, project, 'edit')
    } catch (_) {
      return false
    }
    return attachment.uploadedBy === ctx.principal.userId || access.isManager
  }

  function present(ctx, access, project, attachment, users) {
    return presentAttachment(attachment, attachment.uploadedBy ? users[attachment.uploadedBy] : null, canDelete(ctx, access, project, attachment))
  }

  function usersFor(list) {
    const ids = list.map((a) => a.uploadedBy).filter((id, i, all) => id && all.indexOf(id) === i)
    const map = {}
    if (ids.length > 0) {
      deps.userRepository.findManyByIds(ids).forEach((u) => {
        map[u.id] = u
      })
    }
    return map
  }

  /** Campo de imagem/arquivo do tipo da tarefa, pelo nome técnico. */
  function fileField(task, name) {
    const links = deps.taskTypeFieldRepository.listByType(task.typeId)
    const fields = deps.customFieldRepository.findManyByIds(links.map((l) => l.fieldId))
    const field = fields.find((f) => f.name === name)
    if (!field || (field.type !== 'image' && field.type !== 'file')) throw invalid({ field: 'unknown_field' })
    return field
  }

  /** Tipos dos campos da tarefa (para regravar os valores com a indexação certa). */
  function fieldTypes(fieldIds) {
    const types = {}
    deps.customFieldRepository.findManyByIds(fieldIds).forEach((f) => {
      types[f.id] = f.type
    })
    return types
  }

  function audit(repos, ctx, task, action, oldValue, newValue) {
    repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'task', entityId: task.id, action, oldValue, newValue }))
  }

  // ------------------------------------------------------------------

  function listAttachments(ctx, taskId) {
    const { task, project, access } = loadTask(ctx, taskId)
    const list = attachments.listByTask(task.id)
    const users = usersFor(list)
    return list.map((a) => present(ctx, access, project, a, users))
  }

  /**
   * `files`: [{ name, size, head (primeiros bytes), handle (arquivo da infraestrutura) }].
   * `fieldName` (opcional): campo de imagem/arquivo que recebe os anexos.
   */
  function uploadAttachments(ctx, taskId, files, fieldName, commentId) {
    const { task, project, access } = loadTask(ctx, taskId)
    // no comentário vale a regra do comentário (qualquer pessoa com acesso comenta; só o autor anexa ao seu)
    let comment = null
    if (commentId) {
      comment = deps.commentRepository.findById(commentId)
      if (!comment || comment.taskId !== task.id || comment.deletedAt) throw appError('COMMENT_NOT_FOUND')
      taskDomain.assertCommentAccess(access, project, 'edit', comment)
    } else {
      taskDomain.assertTaskAccess(access, project, 'edit', task)
    }
    const list = Array.isArray(files) ? files : []
    if (list.length === 0) throw invalid({ files: 'required' })
    if (list.length > attachmentDomain.MAX_FILES_PER_UPLOAD) throw invalid({ files: 'too_many' })
    const field = fieldName && !comment ? fileField(task, fieldName) : null

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

    const created = deps.unitOfWork.run((repos) => {
      const saved = prepared.map((file) =>
        repos.attachmentRepository.create({
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
      const newValue = { attachments: saved.map((a) => a.name).join(', ') }
      if (comment) newValue.comment = truncate(taskDomain.plainText(comment.content), 200)
      if (field) {
        const values = repos.taskValueRepository.listByTasks([task.id])[task.id] || {}
        const current = Array.isArray(values[field.id]) ? values[field.id] : []
        values[field.id] = current.concat(saved.map((a) => a.id))
        repos.taskValueRepository.replace(task.id, values, fieldTypes(Object.keys(values)))
        newValue.field = field.label
      }
      audit(repos, ctx, task, 'attachment.added', null, newValue)
      return saved
    })
    const users = usersFor(created)
    return created.map((a) => present(ctx, access, project, a, users))
  }

  function deleteAttachment(ctx, id) {
    const { attachment, task, project, access } = loadAttachment(ctx, id)
    if (!canDelete(ctx, access, project, attachment)) {
      taskDomain.assertTaskAccess(access, project, 'edit', task)
      throw appError('FORBIDDEN')
    }
    deps.unitOfWork.run((repos) => {
      // tira o anexo dos campos de imagem/arquivo que o referenciam
      const values = repos.taskValueRepository.listByTasks([task.id])[task.id] || {}
      let changed = false
      Object.keys(values).forEach((fieldId) => {
        if (Array.isArray(values[fieldId]) && values[fieldId].indexOf(attachment.id) >= 0) {
          const rest = values[fieldId].filter((v) => v !== attachment.id)
          if (rest.length > 0) values[fieldId] = rest
          else delete values[fieldId]
          changed = true
        }
      })
      if (changed) repos.taskValueRepository.replace(task.id, values, fieldTypes(Object.keys(values)))
      repos.attachmentRepository.delete(attachment.id)
      audit(repos, ctx, task, 'attachment.deleted', { attachments: attachment.name }, null)
    })
    return { deleted: true }
  }

  /** Anexo para download (a infraestrutura serve o arquivo). */
  function fileFor(ctx, id) {
    return loadAttachment(ctx, id).attachment
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
