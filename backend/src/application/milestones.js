/**
 * Marcos do projeto (expansão, Onda 1): entregas-chave com data e situação, na timeline.
 *
 * - Ver: quem vê o projeto. Criar/editar/excluir: gestor ou dono (mesma regra das sprints —
 *   `projects.edit` + gestor, projeto não arquivado).
 * - Anti-IDOR: marco de projeto que a pessoa não vê responde MILESTONE_NOT_FOUND.
 * - Histórico: no próprio projeto (entity_type = project), ações milestone.*.
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const timeline = require('../domain/timeline')
const { buildAuditEntry } = require('./audit')
const { iso } = require('./presenters')

const RULES = {
  name: [rules.required(), rules.string(), rules.maxLength(timeline.MILESTONE_NAME_MAX)],
  description: [rules.string(), rules.maxLength(timeline.MILESTONE_DESCRIPTION_MAX)],
  due_date: [rules.required(), rules.isoDate()],
  state: [rules.oneOf(timeline.MILESTONE_STATES)],
}

function presentMilestone(milestone) {
  return {
    id: milestone.id,
    project_id: milestone.projectId,
    name: milestone.name,
    description: milestone.description || '',
    due_date: milestone.dueDate,
    state: milestone.state || 'pending',
    created_at: iso(milestone.createdAt),
    updated_at: iso(milestone.updatedAt),
  }
}

const dayOf = (date) => date.toISOString().slice(0, 10)

function createMilestoneService(deps) {
  const milestones = deps.milestoneRepository

  async function projectAccess(ctx, projectId) {
    rbac.assertAuthenticated(ctx.principal)
    const project = projectId ? await deps.projectRepository.findById(projectId) : null
    if (!project) throw appError('PROJECT_NOT_FOUND')
    const access = projectDomain.resolveAccess(ctx.principal, project, await deps.projectMemberRepository.find(project.id, ctx.principal.userId))
    projectDomain.assertAccess(access, project, 'view')
    return { project, access }
  }

  async function load(ctx, id) {
    rbac.assertAuthenticated(ctx.principal)
    const milestone = id ? await milestones.findById(id) : null
    const project = milestone ? await deps.projectRepository.findById(milestone.projectId) : null
    if (!milestone || !project) throw appError('MILESTONE_NOT_FOUND')
    const access = projectDomain.resolveAccess(ctx.principal, project, await deps.projectMemberRepository.find(project.id, ctx.principal.userId))
    if (!access.canView) throw appError('MILESTONE_NOT_FOUND')
    return { milestone, project, access }
  }

  /** Valida o corpo; `partial` = só os campos enviados (edição). */
  function parse(input, partial) {
    const source = input || {}
    const schema = {}
    Object.keys(RULES).forEach((key) => {
      if (!partial || source[key] !== undefined) schema[key] = RULES[key]
    })
    const data = assertValid(source, schema)
    const out = {}
    if (data.name !== undefined) out.name = data.name
    if (data.description !== undefined) out.description = data.description
    if (data.due_date !== undefined) out.dueDate = dayOf(data.due_date)
    if (data.state !== undefined) out.state = data.state
    return out
  }

  async function audit(repos, ctx, project, action, oldValue, newValue) {
    await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'project', entityId: project.id, action, oldValue, newValue }))
  }

  const snapshot = (m) => ({ name: m.name, due_date: m.dueDate, state: m.state || 'pending', description: m.description || '' })

  async function listMilestones(ctx, projectId) {
    const { project } = await projectAccess(ctx, projectId)
    return (await milestones.listByProject(project.id)).map(presentMilestone)
  }

  async function createMilestone(ctx, projectId, input) {
    const { project, access } = await projectAccess(ctx, projectId)
    projectDomain.assertAccess(access, project, 'edit')
    const data = parse(input, false)
    const created = await deps.unitOfWork.run(async (repos) => {
      const milestone = await repos.milestoneRepository.create({
        projectId: project.id,
        name: data.name,
        description: data.description || '',
        dueDate: data.dueDate,
        state: data.state || 'pending',
        createdBy: ctx.principal.userId,
      })
      await audit(repos, ctx, project, 'milestone.created', null, snapshot(milestone))
      return milestone
    })
    return presentMilestone(created)
  }

  async function updateMilestone(ctx, id, input) {
    const { milestone, project, access } = await load(ctx, id)
    projectDomain.assertAccess(access, project, 'edit')
    const patch = parse(input, true)
    const before = snapshot(milestone)
    const after = snapshot(Object.assign({}, milestone, patch))
    if (JSON.stringify(before) === JSON.stringify(after)) return presentMilestone(milestone)
    const saved = await deps.unitOfWork.run(async (repos) => {
      const updated = await repos.milestoneRepository.update(milestone.id, patch)
      await audit(repos, ctx, project, 'milestone.updated', before, after)
      return updated
    })
    return presentMilestone(saved)
  }

  async function deleteMilestone(ctx, id) {
    const { milestone, project, access } = await load(ctx, id)
    projectDomain.assertAccess(access, project, 'edit')
    await deps.unitOfWork.run(async (repos) => {
      await repos.milestoneRepository.delete(milestone.id)
      await audit(repos, ctx, project, 'milestone.deleted', snapshot(milestone), null)
    })
    return { deleted: true }
  }

  return { listMilestones, createMilestone, updateMilestone, deleteMilestone }
}

module.exports = { createMilestoneService, presentMilestone }
