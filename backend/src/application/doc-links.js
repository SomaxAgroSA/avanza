/**
 * Documentação vinculada às tarefas (página ↔ tarefa, muitos para muitos).
 *
 * - Vincular e desvincular: quem edita o espaço da página e vê a tarefa. Tarefa invisível responde
 *   TASK_NOT_FOUND e página invisível DOC_PAGE_NOT_FOUND (anti-IDOR).
 * - As listas mostram só o que a pessoa vê: da página, as tarefas visíveis; da tarefa, as páginas dos
 *   espaços que ela lê (rascunho só para quem edita, como na própria documentação).
 * - Auditoria no histórico da tarefa: task.doc_linked / task.doc_unlinked.
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const rbac = require('../domain/rbac')
const projectDomain = require('../domain/project')
const taskDomain = require('../domain/task')
const docsDomain = require('../domain/docs')
const { buildAuditEntry } = require('./audit')
const { iso } = require('./presenters')
const { createDocAccess } = require('./doc-access')
const { createTaskService } = require('./tasks')

const MAX_LINKS = 50
const idPattern = /^[A-Za-z0-9_]{1,64}$/
const TASK_IDS_RULES = {
  task_ids: [
    rules.required(),
    rules.custom((value) =>
      Array.isArray(value) && value.length > 0 && value.length <= MAX_LINKS && value.every((id) => typeof id === 'string' && idPattern.test(id)) ? null : 'invalid_type',
    ),
  ],
}

function createDocLinkService(deps) {
  const links = deps.docPageTaskRepository
  const access = createDocAccess(deps)
  const taskService = createTaskService(deps)

  /** Visibilidade das tarefas, com o acesso ao projeto em cache durante a chamada. */
  function taskVisibility(ctx) {
    const projects = new Map()
    async function projectAccess(projectId) {
      if (!projects.has(projectId)) {
        const project = await deps.projectRepository.findById(projectId)
        projects.set(projectId, project ? { project, access: projectDomain.resolveAccess(ctx.principal, project, await deps.projectMemberRepository.find(project.id, ctx.principal.userId)) } : null)
      }
      return projects.get(projectId)
    }
    return async function sees(task) {
      if (!task) return false
      const found = await projectAccess(task.projectId)
      if (!found) return false
      try {
        taskDomain.assertTaskAccess(taskDomain.scopedAccess(found.access, task), found.project, 'view', task)
        return true
      } catch (_) {
        return false
      }
    }
  }

  async function loadTask(ctx, id) {
    rbac.assertAuthenticated(ctx.principal)
    const task = typeof id === 'string' && idPattern.test(id) ? await deps.taskRepository.findById(id) : null
    if (!task || !(await taskVisibility(ctx)(task))) throw appError('TASK_NOT_FOUND')
    return task
  }

  async function audit(repos, ctx, taskId, action, oldValue, newValue) {
    await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'task', entityId: taskId, action, oldValue, newValue }))
  }

  /** Resumos das tarefas visíveis dos vínculos, na ordem em que foram vinculadas. */
  async function visibleTasks(ctx, list) {
    const sees = taskVisibility(ctx)
    const ids = [...new Set(list.map((link) => link.taskId))]
    const tasks = ids.length ? await deps.taskRepository.findManyByIds(ids) : []
    const byId = new Map(tasks.map((t) => [t.id, t]))
    const visible = []
    for (const id of ids) {
      const task = byId.get(id)
      if (task && (await sees(task))) visible.push(task)
    }
    return visible.length ? taskService.summarize(visible, ctx) : []
  }

  async function editablePage(ctx, pageId) {
    const loaded = await access.loadPage(ctx, pageId)
    if (!loaded.access.canEdit) throw appError('FORBIDDEN')
    return loaded
  }

  async function listPageTasks(ctx, pageId) {
    const loaded = await access.loadPage(ctx, pageId)
    return visibleTasks(ctx, await links.listByPages([loaded.page.id]))
  }

  async function linkTasks(ctx, pageId, input) {
    const loaded = await editablePage(ctx, pageId)
    const data = assertValid(input || {}, TASK_IDS_RULES)
    const tasks = []
    for (const id of [...new Set(data.task_ids)]) tasks.push(await loadTask(ctx, id))
    await deps.unitOfWork.run(async (repos) => {
      for (const task of tasks) {
        const added = await repos.docPageTaskRepository.add({ pageId: loaded.page.id, taskId: task.id, createdBy: ctx.principal.userId })
        if (added) await audit(repos, ctx, task.id, 'task.doc_linked', null, { doc_page: loaded.page.title, doc_space: loaded.space.key })
      }
    })
    return listPageTasks(ctx, loaded.page.id)
  }

  async function unlinkTask(ctx, pageId, taskId) {
    const loaded = await editablePage(ctx, pageId)
    const task = await loadTask(ctx, taskId)
    const removed = await deps.unitOfWork.run(async (repos) => {
      const done = await repos.docPageTaskRepository.remove(loaded.page.id, task.id)
      if (done) await audit(repos, ctx, task.id, 'task.doc_unlinked', { doc_page: loaded.page.title, doc_space: loaded.space.key }, null)
      return done
    })
    return { deleted: !!removed }
  }

  /** Páginas vinculadas à tarefa que a pessoa lê (sem o conteúdo: a tela abre a página pelo id). */
  async function listTaskDocs(ctx, taskId) {
    const task = await loadTask(ctx, taskId)
    const out = []
    const spaces = new Map()
    for (const link of await links.listByTask(task.id)) {
      const page = await deps.docPageRepository.findById(link.pageId)
      if (!page) continue
      if (!spaces.has(page.spaceId)) {
        const space = await deps.docSpaceRepository.findById(page.spaceId)
        spaces.set(page.spaceId, space ? { space, access: await access.accessOf(ctx, space) } : null)
      }
      const found = spaces.get(page.spaceId)
      if (!found || !docsDomain.canSeePage(found.access, page)) continue
      out.push({
        id: page.id,
        title: page.title,
        status: page.status,
        is_home: page.id === found.space.homePageId,
        space: { id: found.space.id, key: found.space.key, name: found.space.name, icon: found.space.icon || 'book', color: found.space.color || 'blue' },
        updated_at: iso(page.publishedAt || page.updatedAt),
        linked_at: iso(link.createdAt),
        capabilities: { unlink: found.access.canEdit },
      })
    }
    return out
  }

  /** { pageId: [{ id, code, title }] } das tarefas visíveis — para a árvore do espaço. */
  async function tasksByPage(ctx, pageIds) {
    const all = await links.listByPages(pageIds)
    if (all.length === 0) return {}
    const summaries = await visibleTasks(ctx, all)
    const byId = new Map(summaries.map((t) => [t.id, t]))
    const out = {}
    all.forEach((link) => {
      const task = byId.get(link.taskId)
      if (!task) return
      ;(out[link.pageId] = out[link.pageId] || []).push({ id: task.id, code: task.code, title: task.title })
    })
    return out
  }

  return { listPageTasks, linkTasks, unlinkTask, listTaskDocs, tasksByPage }
}

module.exports = { createDocLinkService }
