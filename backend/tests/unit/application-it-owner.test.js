/**
 * Responsável TI (regras de negócio §33 e §36): papel do projeto que só vê o resumo e as tarefas
 * atribuídas a ele ou marcadas "Visível para TI". Cada caminho de leitura é conferido aqui — inclusive
 * os que não existiam na versão PocketBase (quadro de todos os projetos, Gestão, cronograma, relatórios,
 * tempo real, notificações e menções).
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createTaskService } = require('../../src/application/tasks')
const { createProjectService } = require('../../src/application/projects')
const { createCharterService } = require('../../src/application/charter')
const { createTaskTypeService } = require('../../src/application/task-types')
const { createLookupService } = require('../../src/application/lookups')
const { createBoardService } = require('../../src/application/board')
const { createBacklogService } = require('../../src/application/backlog')
const { createTimelineService } = require('../../src/application/timeline')
const { createSprintService } = require('../../src/application/sprints')
const { createMilestoneService } = require('../../src/application/milestones')
const { createPlanService } = require('../../src/application/plan')
const { createPlanCollaborationService } = require('../../src/application/plan-collaboration')
const { createProjectFileService } = require('../../src/application/project-files')
const { createReportService } = require('../../src/application/reports')
const { createCommentService } = require('../../src/application/comments')
const { createAttachmentService } = require('../../src/application/attachments')
const { createAuditService } = require('../../src/application/audit-logs')
const { createRelationService } = require('../../src/application/relations')
const { createRealtimeService } = require('../../src/application/realtime')
const { createNotifier, createNotificationService } = require('../../src/application/notifications')
const { createExecutiveService } = require('../../src/application/executive')
const { createPrincipal } = require('../../src/domain/rbac')

async function ctxOf(deps, user) {
  const role = await deps.roleRepository.findById(user.roleId)
  return {
    principal: createPrincipal({ userId: user.id, roleId: role.id, roleCode: role.code, permissions: await deps.roleRepository.getPermissionCodes(role.id) }),
    ip: '1.1.1.1',
    userAgent: 'ua',
    correlationId: 'c',
  }
}

async function codeOf(fn) {
  try {
    await fn()
  } catch (err) {
    return err.code
  }
  return 'OK'
}

/**
 * Projeto CRM (dona Gabi, membro Mário) com o Tito como Responsável TI; um segundo projeto (SAP) em que
 * o Tito é membro comum. Tarefas: `mine` (do Tito), `shared` (marcada para TI), `other` (fechada a ele) e
 * `sapTask` (do SAP, onde ele vê tudo).
 */
async function setup() {
  const deps = createFakeDeps()
  const adminUser = await seedUser(deps, { roleCode: 'ADMIN', name: 'Admin' })
  const gabi = await seedUser(deps, { roleCode: 'MANAGER', name: 'Gabi' })
  const mario = await seedUser(deps, { roleCode: 'MEMBER', name: 'Mário' })
  const tito = await seedUser(deps, { roleCode: 'MEMBER', name: 'Tito TI' })
  const outsider = await seedUser(deps, { roleCode: 'MEMBER', name: 'Otto' })
  const ctx = {
    admin: await ctxOf(deps, adminUser),
    gabi: await ctxOf(deps, gabi),
    mario: await ctxOf(deps, mario),
    ti: await ctxOf(deps, tito),
    outsider: await ctxOf(deps, outsider),
  }

  const project = await deps.projectRepository.create({ name: 'CRM Corporativo', key: 'CRM', ownerId: gabi.id, createdBy: gabi.id, status: 'active', priority: 'medium' })
  const sap = await deps.projectRepository.create({ name: 'SAP', key: 'SAP', ownerId: gabi.id, createdBy: gabi.id, status: 'active', priority: 'medium' })
  for (const [p, u, role] of [
    [project, gabi, 'manager'],
    [project, mario, 'member'],
    [project, tito, 'it'],
    [sap, gabi, 'manager'],
    [sap, tito, 'member'],
  ]) {
    await deps.projectMemberRepository.add({ projectId: p.id, userId: u.id, role })
  }

  const doc = await createTaskTypeService(deps).createType(ctx.admin, { key: 'DOC', name: 'Documentação', icon: 'book', color: 'gray' })
  const statuses = createLookupService(deps, 'status')
  const todo = await statuses.create(ctx.admin, { key: 'TODO', name: 'A fazer', category: 'todo', color: 'gray', is_default: true })
  const dev = await statuses.create(ctx.admin, { key: 'DEV', name: 'Desenvolvimento', category: 'in_progress', color: 'amber' })
  await createLookupService(deps, 'priority').create(ctx.admin, { key: 'MEDIA', name: 'Média', color: 'amber', is_default: true })

  const tasks = createTaskService(deps)
  const newTask = (p, title, extra) => Object.assign({ project_id: p.id, task_type_id: doc.id, title }, extra)
  const mine = await tasks.createTask(ctx.gabi, newTask(project, 'Liberar acesso ao banco', { assignee_id: tito.id }))
  const shared = await tasks.createTask(ctx.gabi, newTask(project, 'Integração com o ERP'))
  await tasks.setTaskItVisible(ctx.gabi, shared.id, { it_visible: true })
  const other = await tasks.createTask(ctx.gabi, newTask(project, 'Tela de pedidos', { assignee_id: mario.id }))
  const sapTask = await tasks.createTask(ctx.gabi, newTask(sap, 'Migração do SAP'))

  return { deps, ctx, users: { admin: adminUser, gabi, mario, tito, outsider }, project, sap, tasks, mine, shared, other, sapTask, statuses: { todo, dev }, newTask }
}

const codes = (list) => list.map((t) => t.code).sort()

describe('Responsável TI — tarefas (§33/§36)', () => {
  it('vê e atualiza só as tarefas dele e as marcadas; o resto do projeto não existe para ele', async () => {
    const s = await setup()
    assert.deepEqual(codes((await s.tasks.listTasks(s.ctx.ti, {})).items), codes([s.mine, s.shared, s.sapTask]))
    assert.deepEqual(codes((await s.tasks.listTasks(s.ctx.ti, { project_id: s.project.id })).items), codes([s.mine, s.shared]))
    assert.deepEqual(codes((await s.tasks.listTasks(s.ctx.ti, { search: 'Tela' })).items), [])
    const detail = await s.tasks.getTask(s.ctx.ti, s.mine.id)
    assert.deepEqual(detail.capabilities, { edit: true, delete: false, assign: false, link: false, fork: false, comment: true })
    assert.equal((await s.tasks.updateTask(s.ctx.ti, s.mine.id, { status_id: s.statuses.dev.id })).status.key, 'DEV')
    assert.equal((await s.tasks.moveTask(s.ctx.ti, s.shared.id, { status_id: s.statuses.dev.id })).status.key, 'DEV')
    assert.equal(await codeOf(() => s.tasks.getTask(s.ctx.ti, s.other.id)), 'TASK_NOT_FOUND')
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.ti, s.other.id, { title: 'x' })), 'TASK_NOT_FOUND')
    assert.equal(await codeOf(() => s.tasks.deleteTask(s.ctx.ti, s.mine.id)), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.ti, s.mine.id, { assignee_id: s.users.mario.id })), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.tasks.createTask(s.ctx.ti, s.newTask(s.project, 'Nova'))), 'PROJECT_NOT_FOUND')
    // no projeto em que é membro comum, tudo como sempre
    assert.equal((await s.tasks.getTask(s.ctx.ti, s.sapTask.id)).capabilities.delete, false)
    assert.equal((await s.tasks.createTask(s.ctx.ti, s.newTask(s.sap, 'Do Tito'))).code, 'SAP-2')
  })

  it('a marca "Visível para TI": só a equipe marca; desmarcar fecha a tarefa de novo', async () => {
    const s = await setup()
    assert.equal(await codeOf(() => s.tasks.setTaskItVisible(s.ctx.ti, s.mine.id, { it_visible: true })), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.tasks.setTaskItVisible(s.ctx.gabi, s.other.id, { it_visible: 'sim' })), 'VALIDATION_ERROR')
    assert.equal((await s.tasks.setTaskItVisible(s.ctx.gabi, s.other.id, { it_visible: true })).it_visible, true)
    assert.equal((await s.tasks.getTask(s.ctx.ti, s.other.id)).code, s.other.code)
    assert.deepEqual(codes((await s.tasks.listTasks(s.ctx.gabi, { project_id: s.project.id, it_visible: 'true' })).items), codes([s.shared, s.other]))
    const entry = s.deps.store.audit.at(-1)
    assert.deepEqual([entry.action, entry.oldValue, entry.newValue], ['task.updated', { it_visible: false }, { it_visible: true }])
    await s.tasks.setTaskItVisible(s.ctx.gabi, s.other.id, { it_visible: false })
    assert.equal(await codeOf(() => s.tasks.getTask(s.ctx.ti, s.other.id)), 'TASK_NOT_FOUND')
  })

  it('o detalhe esconde o que ele não vê: elemento da Gestão e tarefa pai fechada', async () => {
    const s = await setup()
    const plan = createPlanService(s.deps)
    const group = await plan.createGroup(s.ctx.gabi, s.project.id, { name: 'Iniciação', color: 'blue' })
    const element = await plan.createItem(s.ctx.gabi, s.project.id, { group_id: group.id, name: 'Contrato com o fornecedor' })
    const child = await s.tasks.createTask(s.ctx.gabi, s.newTask(s.project, 'Subtarefa do TI', { assignee_id: s.users.tito.id, parent_task_id: s.other.id, plan_item_id: element.id }))
    const seen = await s.tasks.getTask(s.ctx.ti, child.id)
    assert.equal(seen.plan_item, null)
    assert.equal(seen.parent, null)
    assert.equal((await s.tasks.listTasks(s.ctx.ti, { project_id: s.project.id })).items.find((t) => t.id === child.id).plan_item, null)
    // a equipe continua vendo tudo
    const full = await s.tasks.getTask(s.ctx.gabi, child.id)
    assert.equal(full.plan_item.name, 'Contrato com o fornecedor')
    assert.equal(full.parent.code, s.other.code)
  })

  it('ligar/desligar no informe é da seção Informe: o Responsável TI não tem', async () => {
    const s = await setup()
    assert.equal(await codeOf(() => s.tasks.setTaskReport(s.ctx.ti, s.mine.id, { in_report: false })), 'FORBIDDEN')
    assert.equal((await s.tasks.setTaskReport(s.ctx.gabi, s.mine.id, { in_report: false })).in_report, false)
  })
})

describe('Responsável TI — projeto, resumo e ficha (§33/§35)', () => {
  it('abre o projeto e o resumo; membros, histórico e o resto do projeto ficam fechados', async () => {
    const s = await setup()
    const projects = createProjectService(s.deps)
    const charter = createCharterService(s.deps)
    await charter.updateCharter(s.ctx.gabi, s.project.id, { objective: 'Portal comercial' })
    await charter.createItem(s.ctx.gabi, s.project.id, { kind: 'result', title: 'Disponibilidade do banco', target: 99.5, unit: '%', owner_id: s.users.tito.id })
    await charter.createItem(s.ctx.gabi, s.project.id, { kind: 'feature', title: 'Tela de pedidos', task_ids: [s.other.id, s.mine.id] })

    const seen = await projects.getProject(s.ctx.ti, s.project.id)
    assert.equal(seen.my_role, 'it')
    assert.deepEqual(seen.capabilities, { edit: false, manage_members: false, archive: false, delete: false, transfer: false, upload_files: false, sections: ['charter'] })
    assert.ok((await projects.listProjects(s.ctx.ti, {})).items.some((p) => p.id === s.project.id && p.my_role === 'it'))

    const brief = await charter.getBrief(s.ctx.ti, s.project.id)
    assert.equal(brief.objective, 'Portal comercial')
    assert.deepEqual(codes(brief.tasks), codes([s.mine, s.shared]))
    assert.deepEqual(brief.items.map((i) => [i.kind, i.title, i.target, i.unit]), [['result', 'Disponibilidade do banco', 99.5, '%']])
    assert.equal(await codeOf(() => charter.getBrief(s.ctx.outsider, s.project.id)), 'PROJECT_NOT_FOUND')

    // a ficha (o perfil MEMBER tem a seção): só leitura e, nas funcionalidades, só as tarefas dele
    const full = await charter.getCharter(s.ctx.ti, s.project.id)
    assert.equal(full.capabilities.edit, false)
    const feature = full.items.find((i) => i.kind === 'feature')
    assert.deepEqual(feature.task_ids, [s.mine.id])
    assert.deepEqual(feature.tasks.map((t) => t.code), [s.mine.code])
    assert.equal(feature.progress.total, 2)
    assert.equal(await codeOf(() => charter.updateCharter(s.ctx.ti, s.project.id, { objective: 'x' })), 'PROJECT_NOT_FOUND')
    assert.equal(await codeOf(() => charter.createItem(s.ctx.ti, s.project.id, { kind: 'scope_in', title: 'x' })), 'PROJECT_NOT_FOUND')

    assert.equal(await codeOf(() => projects.listMembers(s.ctx.ti, s.project.id)), 'PROJECT_NOT_FOUND')
    assert.equal(await codeOf(() => projects.updateProject(s.ctx.ti, s.project.id, { name: 'x' })), 'PROJECT_NOT_FOUND')
    assert.equal(await codeOf(() => projects.removeMember(s.ctx.ti, s.project.id, s.users.tito.id)), 'PROJECT_NOT_FOUND')
    const audit = createAuditService(s.deps)
    assert.equal(await codeOf(() => audit.listEntityHistory(s.ctx.ti, 'project', s.project.id, {})), 'FORBIDDEN')
  })

  it('sem a seção Ficha no perfil, a ficha fecha (o resumo continua)', async () => {
    const s = await setup()
    const role = await s.deps.roleRepository.create({ code: 'TI_SEM_FICHA', name: 'TI sem ficha' })
    await s.deps.roleRepository.setPermissionCodes(role.id, ['projects.view', 'tasks.view', 'tasks.edit'])
    const tina = await seedUser(s.deps, { name: 'Tina', roleCode: 'TI_SEM_FICHA' })
    await s.deps.projectMemberRepository.add({ projectId: s.project.id, userId: tina.id, role: 'it' })
    const ctx = await ctxOf(s.deps, tina)
    const charter = createCharterService(s.deps)
    assert.deepEqual((await createProjectService(s.deps).getProject(ctx, s.project.id)).capabilities.sections, [])
    assert.equal(await codeOf(() => charter.getCharter(ctx, s.project.id)), 'FORBIDDEN')
    assert.equal((await charter.getBrief(ctx, s.project.id)).tasks.length, 1)
  })

  it('indicador sob a responsabilidade dele: registra a medição (com a seção Ficha)', async () => {
    const s = await setup()
    const charter = createCharterService(s.deps)
    const result = await charter.createItem(s.ctx.gabi, s.project.id, { kind: 'result', title: 'Disponibilidade', target: 99.5, unit: '%', owner_id: s.users.tito.id })
    const measured = await charter.addMeasurement(s.ctx.ti, result.id, { value: 98.7 })
    assert.equal(measured.current, 98.7)
    assert.equal((await charter.listMeasurements(s.ctx.ti, result.id)).length, 1)
    const notMine = await charter.createItem(s.ctx.gabi, s.project.id, { kind: 'result', title: 'Vendas', target: 10 })
    assert.equal(await codeOf(() => charter.addMeasurement(s.ctx.ti, notMine.id, { value: 1 })), 'PROJECT_NOT_FOUND')
  })
})

describe('Responsável TI — telas do projeto e visões de todos os projetos', () => {
  it('quadro, backlog, cronograma, sprints, marcos, Gestão e arquivos do projeto: PROJECT_NOT_FOUND', async () => {
    const s = await setup()
    const id = s.project.id
    const closed = {
      board: () => createBoardService(s.deps).getBoard(s.ctx.ti, id),
      backlog: () => createBacklogService(s.deps).getBacklog(s.ctx.ti, id),
      rank: () => createBacklogService(s.deps).rankTask(s.ctx.ti, s.mine.id, {}),
      timeline: () => createTimelineService(s.deps).getTimeline(s.ctx.ti, id),
      sprints: () => createSprintService(s.deps).listSprints(s.ctx.ti, id, {}),
      milestones: () => createMilestoneService(s.deps).listMilestones(s.ctx.ti, id),
      plan: () => createPlanService(s.deps).getPlan(s.ctx.ti, id),
      files: () => createProjectFileService(s.deps).listFiles(s.ctx.ti, id),
    }
    for (const [name, fn] of Object.entries(closed)) {
      const code = await codeOf(fn)
      assert.ok(code === 'PROJECT_NOT_FOUND' || code === 'TASK_NOT_FOUND', `${name}: ${code}`)
    }
  })

  it('Kanban de todos os projetos: o projeto em que é Responsável TI fica de fora (nem pedindo pelo id)', async () => {
    const s = await setup()
    const board = createBoardService(s.deps)
    const all = await board.getAllBoard(s.ctx.ti, {})
    assert.deepEqual(all.projects.map((p) => p.key), ['SAP'])
    const cards = all.columns.reduce((list, column) => list.concat(column.tasks.map((t) => t.code)), [])
    assert.deepEqual(cards, [s.sapTask.code])
    const asked = await board.getAllBoard(s.ctx.ti, { project_ids: s.project.id })
    assert.deepEqual(asked.projects, [])
    assert.equal(asked.columns.reduce((n, c) => n + c.tasks.length, 0), 0)
  })

  it('relatórios: só as tarefas visíveis a ele (também filtrando pelo projeto)', async () => {
    const s = await setup()
    const reports = createReportService(s.deps)
    const all = await reports.getReport(s.ctx.ti, {})
    assert.equal(all.indicators.total, 3)
    assert.equal((await reports.getReport(s.ctx.gabi, {})).indicators.total, 4)
    const rows = await reports.listIndicatorTasks(s.ctx.ti, { metric: 'open' })
    assert.deepEqual(codes(rows.items), codes([s.mine, s.shared, s.sapTask]))
    const filtered = await reports.listIndicatorTasks(s.ctx.ti, { metric: 'open', project_id: s.project.id })
    assert.deepEqual(codes(filtered.items), codes([s.mine, s.shared]))
    const team = await reports.listIndicatorTasks(s.ctx.gabi, { metric: 'open', project_id: s.project.id })
    assert.deepEqual(codes(team.items), codes([s.mine, s.shared, s.other]))
    assert.equal(await codeOf(() => reports.listIndicatorTasks(s.ctx.outsider, { metric: 'open', project_id: s.project.id })), 'PROJECT_NOT_FOUND')
  })

  it('painel executivo: segue a permissão global executive.view, não o papel no projeto', async () => {
    const s = await setup()
    assert.equal(await codeOf(() => createExecutiveService(s.deps).getDashboard(s.ctx.ti, {})), 'FORBIDDEN')
  })

  it('tempo real: não assina o tópico do projeto (só o dele e o do projeto em que é membro comum)', async () => {
    const s = await setup()
    const result = await createRealtimeService(s.deps).authorize(s.ctx.ti, [`project:${s.project.id}`, `project:${s.sap.id}`, `user:${s.users.tito.id}`])
    assert.deepEqual(result.allowed.sort(), [`project:${s.sap.id}`, `user:${s.users.tito.id}`].sort())
    assert.deepEqual(result.rejected, [`project:${s.project.id}`])
  })
})

describe('Responsável TI — colaboração nas tarefas dele', () => {
  it('comentários, anexos, histórico e relações: só nas tarefas visíveis; relações só com o que ele vê', async () => {
    const s = await setup()
    const comments = createCommentService(s.deps)
    const attachments = createAttachmentService(s.deps)
    const audit = createAuditService(s.deps)
    const relations = createRelationService(s.deps)

    await comments.createComment(s.ctx.ti, s.mine.id, { content: 'Acesso liberado' })
    assert.equal((await comments.listComments(s.ctx.ti, s.mine.id)).length, 1)
    assert.deepEqual(await attachments.listAttachments(s.ctx.ti, s.mine.id), [])
    assert.ok((await audit.listEntityHistory(s.ctx.ti, 'task', s.mine.id, {})).items.length > 0)
    for (const fn of [
      () => comments.listComments(s.ctx.ti, s.other.id),
      () => comments.createComment(s.ctx.ti, s.other.id, { content: 'x' }),
      () => attachments.listAttachments(s.ctx.ti, s.other.id),
      () => audit.listEntityHistory(s.ctx.ti, 'task', s.other.id, {}),
      () => relations.listRelations(s.ctx.ti, s.other.id),
    ]) {
      assert.equal(await codeOf(fn), 'TASK_NOT_FOUND')
    }

    await relations.createRelation(s.ctx.gabi, s.mine.id, { type: 'relates', target_id: s.other.id })
    await relations.createRelation(s.ctx.gabi, s.mine.id, { type: 'relates', target_id: s.shared.id })
    const seen = await relations.listRelations(s.ctx.ti, s.mine.id)
    const visible = JSON.stringify(seen)
    assert.ok(visible.includes(s.shared.code))
    assert.ok(!visible.includes(s.other.code), 'tarefa fechada não aparece nas relações')
    assert.equal(await codeOf(() => relations.createRelation(s.ctx.ti, s.mine.id, { type: 'relates', target_id: s.shared.id })), 'FORBIDDEN')
    assert.equal(await codeOf(() => relations.forkTask(s.ctx.ti, s.mine.id, { project_id: s.sap.id })), 'FORBIDDEN')
  })

  it('menções: ele só menciona quem já aparece na tarefa; a equipe só o menciona onde ele enxerga', async () => {
    const s = await setup()
    const comments = createCommentService(s.deps)
    const names = async (ctx, task) => (await comments.mentionCandidates(ctx, task.id)).map((u) => u.name).sort()
    // o Tito não recebe a lista da equipe: só a dona do projeto/autora (Gabi) e ele mesmo
    assert.deepEqual(await names(s.ctx.ti, s.mine), ['Gabi', 'Tito TI'])
    assert.equal(await codeOf(() => comments.createComment(s.ctx.ti, s.mine.id, { content: `oi @[Mário](${s.users.mario.id})` })), 'VALIDATION_ERROR')
    // a equipe: o Tito aparece só nas tarefas visíveis a ele
    assert.ok((await names(s.ctx.gabi, s.mine)).includes('Tito TI'))
    assert.ok(!(await names(s.ctx.gabi, s.other)).includes('Tito TI'))
    assert.equal(await codeOf(() => comments.createComment(s.ctx.gabi, s.other.id, { content: `@[Tito](${s.users.tito.id}) veja` })), 'VALIDATION_ERROR')
    // na Gestão (fechada a ele), também não
    const plan = createPlanService(s.deps)
    const group = await plan.createGroup(s.ctx.gabi, s.project.id, { name: 'G', color: 'blue' })
    const element = await plan.createItem(s.ctx.gabi, s.project.id, { group_id: group.id, name: 'Elemento' })
    const people = (await createPlanCollaborationService(s.deps).mentionCandidates(s.ctx.gabi, element.id)).map((u) => u.name)
    assert.ok(!people.includes('Tito TI'))
  })

  it('notificações (e os e-mails delas): só das tarefas visíveis a ele; nunca da Gestão', async () => {
    const s = await setup()
    const notifier = createNotifier(s.deps)
    const inbox = async () => (await createNotificationService(s.deps).listNotifications(s.ctx.ti, {})).items
    const before = (await inbox()).length
    const send = (task) =>
      s.deps.unitOfWork.run((repos) => notifier.notify(repos, { task, project: s.project, actorId: s.users.gabi.id, entries: [{ userId: s.users.tito.id, type: 'comment' }] }))
    assert.equal(await send(Object.assign({}, s.other, { assigneeId: s.users.mario.id, itVisible: false })), 0)
    assert.equal(await send({ id: s.shared.id, code: s.shared.code, title: s.shared.title, assigneeId: null, itVisible: true }), 1)
    const item = { id: 'pi1', name: 'Elemento' }
    assert.equal(await s.deps.unitOfWork.run((repos) => notifier.notifyItem(repos, { item, project: s.project, actorId: s.users.gabi.id, entries: [{ userId: s.users.tito.id, type: 'plan_mention' }] })), 0)
    assert.equal((await inbox()).length, before + 1)
  })
})
