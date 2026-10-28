/**
 * Casos de uso dos arquivos do projeto (regras de negócio §22): documentos e imagens ligados ao
 * projeto, fora das tarefas (contratos, atas, cronogramas…).
 *
 * - Ver e baixar: quem vê o projeto (inclusive o leitor).
 * - Enviar: `tasks.edit` + colaborar no projeto; excluir: quem enviou ou o gestor (domain/project.js).
 * - O tipo vem do CONTEÚDO (domain/attachment.js), com os mesmos tipos e limites dos anexos.
 * - O histórico fica no projeto (`project.file_added` / `project.file_deleted`).
 *
 * Porta: `projectFileRepository` { findById, listByProject (mais recentes primeiro), create, delete }.
 */

const { appError } = require('../core/errors')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const attachmentDomain = require('../domain/attachment')
const { buildAuditEntry } = require('./audit')
const { iso, toUserSummary } = require('./presenters')

function invalid(fields, details) {
  return appError('VALIDATION_ERROR', undefined, Object.assign({ fields }, details || {}))
}

function createProjectFileService(deps) {
  const files = deps.projectFileRepository

  /** Projeto e acesso; sem acesso, `notFound` (padrão: PROJECT_NOT_FOUND). */
  async function loadProject(ctx, projectId, notFound) {
    rbac.assertAuthenticated(ctx.principal)
    const project = projectId ? await deps.projectRepository.findById(projectId) : null
    if (!project) throw appError(notFound || 'PROJECT_NOT_FOUND')
    const membership = await deps.projectMemberRepository.find(project.id, ctx.principal.userId)
    const access = projectDomain.resolveAccess(ctx.principal, project, membership)
    try {
      projectDomain.assertFileAccess(access, project, 'view')
    } catch (err) {
      throw notFound ? appError(notFound) : err
    }
    return { project, access }
  }

  async function loadFile(ctx, id) {
    const file = id ? await files.findById(id) : null
    if (!file) throw appError('PROJECT_FILE_NOT_FOUND')
    return Object.assign({ file }, await loadProject(ctx, file.projectId, 'PROJECT_FILE_NOT_FOUND'))
  }

  const canDelete = (access, project, file) => {
    try {
      projectDomain.assertFileAccess(access, project, 'delete', file)
      return true
    } catch (_) {
      return false
    }
  }

  async function usersFor(list) {
    const ids = list.map((f) => f.uploadedBy).filter((id, i, all) => id && all.indexOf(id) === i)
    const map = {}
    if (ids.length > 0) {
      ;(await deps.userRepository.findManyByIds(ids)).forEach((u) => {
        map[u.id] = u
      })
    }
    return map
  }

  async function presentAll(access, project, list) {
    const users = await usersFor(list)
    return list.map((file) => presentProjectFile(file, file.uploadedBy ? users[file.uploadedBy] : null, canDelete(access, project, file)))
  }

  async function audit(repos, ctx, project, action, oldValue, newValue) {
    await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'project', entityId: project.id, action, oldValue, newValue }))
  }

  // ------------------------------------------------------------------

  async function listFiles(ctx, projectId) {
    const { project, access } = await loadProject(ctx, projectId)
    return presentAll(access, project, await files.listByProject(project.id))
  }

  /** `uploads`: [{ name, size, head (primeiros bytes), handle (arquivo da infraestrutura) }]. */
  async function uploadFiles(ctx, projectId, uploads) {
    const { project, access } = await loadProject(ctx, projectId)
    projectDomain.assertFileAccess(access, project, 'upload')
    const list = Array.isArray(uploads) ? uploads : []
    if (list.length === 0) throw invalid({ files: 'required' })
    if (list.length > attachmentDomain.MAX_FILES_PER_UPLOAD) throw invalid({ files: 'too_many' })

    // valida tudo antes de gravar qualquer arquivo
    const prepared = list.map((upload, index) => {
      const checked = attachmentDomain.inspectUpload(upload)
      if (checked.error) throw invalid({ files: checked.error }, { index, name: checked.name })
      return Object.assign({ handle: upload.handle }, checked)
    })

    const created = await deps.unitOfWork.run(async (repos) => {
      const saved = []
      for (const file of prepared) {
        saved.push(
          await repos.projectFileRepository.create({
            projectId: project.id,
            handle: file.handle,
            name: file.name,
            mime: file.mime,
            kind: file.kind,
            size: file.size,
            uploadedBy: ctx.principal.userId,
          }),
        )
      }
      await audit(repos, ctx, project, 'project.file_added', null, { attachments: saved.map((f) => f.name).join(', ') })
      return saved
    })
    return presentAll(access, project, created)
  }

  async function deleteFile(ctx, id) {
    const { file, project, access } = await loadFile(ctx, id)
    projectDomain.assertFileAccess(access, project, 'delete', file)
    await deps.unitOfWork.run(async (repos) => {
      await repos.projectFileRepository.delete(file.id)
      await audit(repos, ctx, project, 'project.file_deleted', { attachments: file.name }, null)
    })
    return { deleted: true }
  }

  /** Arquivo para download (a infraestrutura serve o conteúdo). */
  async function fileFor(ctx, id) {
    return (await loadFile(ctx, id)).file
  }

  return { listFiles, uploadFiles, deleteFile, fileFor }
}

/** Formato público do arquivo do projeto (o mesmo dos anexos, com `project_id`). */
function presentProjectFile(file, uploader, canDelete) {
  return {
    id: file.id,
    project_id: file.projectId,
    name: file.name,
    mime: file.mime,
    kind: file.kind,
    size: file.size,
    uploaded_by: uploader ? toUserSummary(uploader) : null,
    created_at: iso(file.createdAt),
    url: `/api/v1/project-files/${file.id}/file`,
    capabilities: { delete: !!canDelete },
  }
}

module.exports = { createProjectFileService, presentProjectFile }
