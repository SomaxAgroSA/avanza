const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createTaskService } = require('../../src/application/tasks')
const { createCustomFieldService } = require('../../src/application/custom-fields')
const { createTaskTypeService } = require('../../src/application/task-types')
const { createLookupService } = require('../../src/application/lookups')
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
    return err.code === 'VALIDATION_ERROR' ? `${err.code}:${JSON.stringify(err.details.fields)}` : err.code
  }
  return 'OK'
}

/** Cenário: projeto CRM (gestora Gabi, membro Mário, leitora Lia), tipos BUG e DOC, fluxo e prioridades. */
async function setup() {
  const deps = createFakeDeps()
  const adminUser = await seedUser(deps, { roleCode: 'ADMIN', name: 'Admin' })
  const admin = await ctxOf(deps, adminUser)
  const gabi = await seedUser(deps, { roleCode: 'MANAGER', name: 'Gabi' })
  const mario = await seedUser(deps, { roleCode: 'MEMBER', name: 'Mário' })
  const lia = await seedUser(deps, { roleCode: 'MEMBER', name: 'Lia' })
  const outsider = await seedUser(deps, { roleCode: 'MEMBER', name: 'Otto' })

  const project = await deps.projectRepository.create({ name: 'CRM Corporativo', key: 'CRM', ownerId: gabi.id, createdBy: gabi.id, status: 'active', priority: 'medium' })
  const other = await deps.projectRepository.create({ name: 'SAP', key: 'SAP', ownerId: adminUser.id, createdBy: adminUser.id, status: 'active', priority: 'medium' })
  await deps.projectMemberRepository.add({ projectId: project.id, userId: gabi.id, role: 'manager' })
  await deps.projectMemberRepository.add({ projectId: project.id, userId: mario.id, role: 'member' })
  await deps.projectMemberRepository.add({ projectId: project.id, userId: lia.id, role: 'viewer' })
  await deps.projectMemberRepository.add({ projectId: other.id, userId: adminUser.id, role: 'manager' })

  const fields = createCustomFieldService(deps)
  const types = createTaskTypeService(deps)
  const statuses = createLookupService(deps, 'status')
  const priorities = createLookupService(deps, 'priority')

  const versao = await fields.createField(admin, { label: 'Versão', type: 'text', searchable: true })
  const severidade = await fields.createField(admin, {
    label: 'Severidade',
    type: 'select',
    options: [{ label: 'Alta', color: 'red' }, { label: 'Média', color: 'amber', is_default: true }],
  })
  const bug = await types.createType(admin, { key: 'BUG', name: 'Bug', icon: 'bug', color: 'red' })
  await types.setTypeFields(admin, bug.id, [
    { field_id: versao.id, required: true },
    { field_id: severidade.id, required: true },
  ])
  const doc = await types.createType(admin, { key: 'DOC', name: 'Documentação', icon: 'book', color: 'gray' })

  const backlog = await statuses.create(admin, { key: 'BACKLOG', name: 'Backlog', category: 'backlog', color: 'gray' })
  const dev = await statuses.create(admin, { key: 'DEV', name: 'Desenvolvimento', category: 'in_progress', color: 'amber' })
  const done = await statuses.create(admin, { key: 'DONE', name: 'Concluído', category: 'done', color: 'green' })
  const high = await priorities.create(admin, { key: 'ALTA', name: 'Alta', color: 'orange' })
  const medium = await priorities.create(admin, { key: 'MEDIA', name: 'Média', color: 'amber', is_default: true })

  return {
    deps,
    tasks: createTaskService(deps),
    project,
    other,
    users: { admin: adminUser, gabi, mario, lia, outsider },
    ctx: { admin, gabi: await ctxOf(deps, gabi), mario: await ctxOf(deps, mario), lia: await ctxOf(deps, lia), outsider: await ctxOf(deps, outsider) },
    types: { bug, doc },
    fields: { versao, severidade },
    statuses: { backlog, dev, done },
    priorities: { high, medium },
  }
}

function newBug(s, extra) {
  return Object.assign({ project_id: s.project.id, task_type_id: s.types.bug.id, title: 'Erro ao salvar pedido', custom_values: { versao: '2.1' } }, extra)
}

describe('application/tasks — criação', () => {
  it('numera por projeto, aplica padrões (status, prioridade, valores) e registra histórico', async () => {
    const s = await setup()
    const first = await s.tasks.createTask(s.ctx.mario, newBug(s))
    const second = await s.tasks.createTask(s.ctx.mario, newBug(s, { title: 'Outro' }))
    assert.equal(first.code, 'CRM-1')
    assert.equal(second.code, 'CRM-2')
    assert.equal(first.status.key, 'BACKLOG')
    assert.equal(first.priority.key, 'MEDIA')
    assert.equal(first.creator.name, 'Mário')
    const media = s.fields.severidade.options.find((o) => o.label === 'Média')
    assert.deepEqual(first.custom_values, { versao: '2.1', severidade: media.id })
    assert.deepEqual(first.capabilities, { edit: true, delete: false, assign: true, link: true, fork: true, comment: true })
    const audit = s.deps.store.audit.at(-1)
    assert.equal(audit.action, 'task.created')
    assert.equal(audit.entityType, 'task')
    assert.equal(audit.newValue.code, 'CRM-2')
  })

  it('valida campos obrigatórios do tipo e valores', async () => {
    const s = await setup()
    assert.equal(
      await codeOf(() => s.tasks.createTask(s.ctx.mario, newBug(s, { custom_values: {} }))),
      'VALIDATION_ERROR:{"custom_values.versao":"required"}',
    )
    assert.equal(
      await codeOf(() => s.tasks.createTask(s.ctx.mario, newBug(s, { title: ' ', custom_values: { versao: '1', severidade: 'x' } }))),
      'VALIDATION_ERROR:{"title":"required"}',
    )
    assert.equal(
      await codeOf(() => s.tasks.createTask(s.ctx.mario, newBug(s, { custom_values: { versao: '1', severidade: 'x' } }))),
      'VALIDATION_ERROR:{"custom_values.severidade":"invalid_option"}',
    )
    // horas: zero não é valor (para limpar, envia-se null)
    assert.equal(await codeOf(() => s.tasks.createTask(s.ctx.mario, newBug(s, { estimated_hours: 0 }))), 'VALIDATION_ERROR:{"estimated_hours":"too_small"}')
    assert.equal((await s.tasks.createTask(s.ctx.mario, newBug(s, { estimated_hours: 1.255 }))).estimated_hours, 1.26)
  })

  it('responsável precisa colaborar no projeto (leitor e estranho não)', async () => {
    const s = await setup()
    assert.equal(
      await codeOf(() => s.tasks.createTask(s.ctx.mario, newBug(s, { assignee_id: s.users.lia.id }))),
      'VALIDATION_ERROR:{"assignee_id":"not_member"}',
    )
    assert.equal(
      await codeOf(() => s.tasks.createTask(s.ctx.mario, newBug(s, { assignee_id: s.users.outsider.id }))),
      'VALIDATION_ERROR:{"assignee_id":"not_member"}',
    )
    const ok = await s.tasks.createTask(s.ctx.mario, newBug(s, { assignee_id: s.users.gabi.id }))
    assert.equal(ok.assignee.name, 'Gabi')
  })

  it('acesso: leitor não cria; quem não é do projeto não enxerga; arquivado bloqueia', async () => {
    const s = await setup()
    assert.equal(await codeOf(() => s.tasks.createTask(s.ctx.lia, newBug(s))), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.tasks.createTask(s.ctx.outsider, newBug(s))), 'PROJECT_NOT_FOUND')
    await s.deps.projectRepository.update(s.project.id, { archivedAt: new Date() })
    assert.equal(await codeOf(() => s.tasks.createTask(s.ctx.gabi, newBug(s))), 'PROJECT_ARCHIVED')
  })

  it('tipo, status e prioridade inativos não podem ser usados', async () => {
    const s = await setup()
    await s.deps.taskTypeRepository.update(s.types.doc.id, { isActive: false })
    assert.equal(
      await codeOf(() => s.tasks.createTask(s.ctx.mario, { project_id: s.project.id, task_type_id: s.types.doc.id, title: 'x' })),
      'VALIDATION_ERROR:{"task_type_id":"invalid_option"}',
    )
    await s.deps.statusRepository.update(s.statuses.dev.id, { isActive: false })
    assert.equal(
      await codeOf(() => s.tasks.createTask(s.ctx.mario, newBug(s, { status_id: s.statuses.dev.id }))),
      'VALIDATION_ERROR:{"status_id":"invalid_option"}',
    )
  })
})

describe('application/tasks — edição e histórico', () => {
  it('mudar status preenche início/conclusão e o histórico mostra nomes', async () => {
    const s = await setup()
    const task = await s.tasks.createTask(s.ctx.mario, newBug(s))
    const started = await s.tasks.updateTask(s.ctx.mario, task.id, { status_id: s.statuses.dev.id })
    assert.ok(started.started_at)
    assert.equal(started.completed_at, null)
    const closed = await s.tasks.updateTask(s.ctx.mario, task.id, { status_id: s.statuses.done.id, priority_id: s.priorities.high.id })
    assert.ok(closed.completed_at)
    const audit = s.deps.store.audit.at(-1)
    assert.equal(audit.action, 'task.updated')
    assert.deepEqual(audit.oldValue, { task_status: 'Desenvolvimento', task_priority: 'Média' })
    assert.deepEqual(audit.newValue, { task_status: 'Concluído', task_priority: 'Alta' })
  })

  it('campos personalizados no histórico usam o rótulo e o nome da opção', async () => {
    const s = await setup()
    const task = await s.tasks.createTask(s.ctx.mario, newBug(s))
    const alta = s.fields.severidade.options.find((o) => o.label === 'Alta')
    await s.tasks.updateTask(s.ctx.mario, task.id, { custom_values: { severidade: alta.id, versao: '2.2' } })
    const audit = s.deps.store.audit.at(-1)
    assert.deepEqual(audit.oldValue, { 'cf:Versão': '2.1', 'cf:Severidade': 'Média' })
    assert.deepEqual(audit.newValue, { 'cf:Versão': '2.2', 'cf:Severidade': 'Alta' })
  })

  it('sem mudanças não grava histórico', async () => {
    const s = await setup()
    const task = await s.tasks.createTask(s.ctx.mario, newBug(s))
    const before = s.deps.store.audit.length
    await s.tasks.updateTask(s.ctx.mario, task.id, { title: task.title, custom_values: { versao: '2.1' } })
    assert.equal(s.deps.store.audit.length, before)
  })

  it('trocar o tipo descarta valores de campos que o novo tipo não tem', async () => {
    const s = await setup()
    const task = await s.tasks.createTask(s.ctx.mario, newBug(s))
    const changed = await s.tasks.updateTask(s.ctx.mario, task.id, { task_type_id: s.types.doc.id })
    assert.equal(changed.type.key, 'DOC')
    assert.deepEqual(changed.custom_values, {})
    assert.deepEqual(s.deps.store.taskValues.filter((v) => v.taskId === task.id), [])
  })

  it('leitor não edita; quem não é do projeto recebe TASK_NOT_FOUND', async () => {
    const s = await setup()
    const task = await s.tasks.createTask(s.ctx.mario, newBug(s))
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.lia, task.id, { title: 'x' })), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.tasks.getTask(s.ctx.outsider, task.id)), 'TASK_NOT_FOUND')
    // leitora não edita, mas comenta (regra do produto — diretriz §18)
    assert.deepEqual((await s.tasks.getTask(s.ctx.lia, task.id)).capabilities, { edit: false, delete: false, assign: false, link: false, fork: false, comment: true })
  })

  it('exclusão: MEMBER não tem tasks.delete; gestora exclui e fica no histórico', async () => {
    const s = await setup()
    const task = await s.tasks.createTask(s.ctx.mario, newBug(s))
    assert.equal(await codeOf(() => s.tasks.deleteTask(s.ctx.mario, task.id)), 'FORBIDDEN')
    assert.deepEqual(await s.tasks.deleteTask(s.ctx.gabi, task.id), { deleted: true })
    assert.equal(await codeOf(() => s.tasks.getTask(s.ctx.gabi, task.id)), 'TASK_NOT_FOUND')
    assert.equal(s.deps.store.audit.at(-1).action, 'task.deleted')
    assert.deepEqual(s.deps.store.taskValues.filter((v) => v.taskId === task.id), [])
  })
})

describe('application/tasks — obrigatórios por status', () => {
  /** DOC exige "Parecer" em Desenvolvimento e Concluído (não no Backlog). */
  async function withParecer() {
    const s = await setup()
    const fields = createCustomFieldService(s.deps)
    const types = createTaskTypeService(s.deps)
    const parecer = await fields.createField(s.ctx.admin, { label: 'Parecer', type: 'textarea' })
    await types.setTypeFields(s.ctx.admin, s.types.doc.id, [{ field_id: parecer.id, required_status_ids: [s.statuses.dev.id, s.statuses.done.id] }])
    const newDoc = (extra) => Object.assign({ project_id: s.project.id, task_type_id: s.types.doc.id, title: 'Manual' }, extra)
    return Object.assign(s, { newDoc })
  }
  const details = async (fn) => {
    try {
      await fn()
    } catch (err) {
      return { code: err.code, fields: err.details.fields, status: err.details.status }
    }
    return null
  }

  it('criar: exige os campos do status inicial', async () => {
    const s = await withParecer()
    assert.equal((await s.tasks.createTask(s.ctx.mario, s.newDoc())).status.key, 'BACKLOG')
    const failed = await details(() => s.tasks.createTask(s.ctx.mario, s.newDoc({ status_id: s.statuses.dev.id })))
    assert.deepEqual(failed, { code: 'VALIDATION_ERROR', fields: { 'custom_values.parecer': 'required' }, status: { id: s.statuses.dev.id, name: 'Desenvolvimento' } })
    const ok = await s.tasks.createTask(s.ctx.mario, s.newDoc({ status_id: s.statuses.dev.id, custom_values: { parecer: 'Aprovado' } }))
    assert.equal(ok.status.key, 'DEV')
  })

  it('mudar de status (edição e arraste do Kanban) exige os campos do novo status', async () => {
    const s = await withParecer()
    const doc = await s.tasks.createTask(s.ctx.mario, s.newDoc())
    assert.deepEqual((await details(() => s.tasks.updateTask(s.ctx.mario, doc.id, { status_id: s.statuses.dev.id }))).fields, { 'custom_values.parecer': 'required' })
    assert.deepEqual((await details(() => s.tasks.moveTask(s.ctx.mario, doc.id, { status_id: s.statuses.dev.id }))).status, { id: s.statuses.dev.id, name: 'Desenvolvimento' })
    assert.equal((await s.tasks.getTask(s.ctx.mario, doc.id)).status.key, 'BACKLOG')
    // preenchendo junto, a mudança passa
    const moved = await s.tasks.updateTask(s.ctx.mario, doc.id, { status_id: s.statuses.dev.id, custom_values: { parecer: 'Aprovado' } })
    assert.equal(moved.status.key, 'DEV')
    // os campos do tipo informam onde cada um é exigido
    assert.deepEqual(moved.fields[0].required_status_ids, [s.statuses.dev.id, s.statuses.done.id])
  })

  it('no status que exige, não dá para esvaziar o campo; em outro status, dá', async () => {
    const s = await withParecer()
    const doc = await s.tasks.createTask(s.ctx.mario, s.newDoc({ status_id: s.statuses.dev.id, custom_values: { parecer: 'Aprovado' } }))
    assert.deepEqual((await details(() => s.tasks.updateTask(s.ctx.mario, doc.id, { custom_values: { parecer: '' } }))).fields, { 'custom_values.parecer': 'required' })
    const back = await s.tasks.updateTask(s.ctx.mario, doc.id, { status_id: s.statuses.backlog.id, custom_values: { parecer: '' } })
    assert.equal(back.custom_values.parecer, undefined)
  })
})

describe('application/tasks — tipo traduzido', () => {
  it('o tipo da tarefa aparece no idioma da requisição; o histórico guarda o original', async () => {
    const s = await setup()
    await createTaskTypeService(s.deps).updateType(s.ctx.admin, s.types.doc.id, { translations: { es: { name: 'Documentación' } } })
    const created = await s.tasks.createTask(s.ctx.mario, { project_id: s.project.id, task_type_id: s.types.doc.id, title: 'Manual' })
    s.deps.locale = 'es'
    assert.equal((await s.tasks.getTask(s.ctx.mario, created.id)).type.name, 'Documentación')
    assert.equal((await s.tasks.listTasks(s.ctx.mario, {})).items.find((t) => t.id === created.id).type.name, 'Documentación')
    const history = s.deps.store.audit.find((e) => e.action === 'task.created' && e.entityId === created.id)
    assert.equal(history.newValue.task_type, 'Documentação')
  })
})

describe('application/tasks — listagem', () => {
  it('só lista tarefas de projetos visíveis, com busca, filtros e ordenação', async () => {
    const s = await setup()
    await s.tasks.createTask(s.ctx.mario, newBug(s, { title: 'Erro no login', priority_id: s.priorities.high.id }))
    await s.tasks.createTask(s.ctx.mario, newBug(s, { title: 'Relatório lento', assignee_id: s.users.mario.id }))
    await s.tasks.createTask(s.ctx.admin, { project_id: s.other.id, task_type_id: s.types.doc.id, title: 'Manual SAP' })

    assert.deepEqual((await s.tasks.listTasks(s.ctx.mario, {})).items.map((t) => t.code), ['CRM-1', 'CRM-2'])
    assert.equal((await s.tasks.listTasks(s.ctx.admin, {})).meta.total, 3)
    assert.equal((await s.tasks.listTasks(s.ctx.outsider, {})).meta.total, 0)

    assert.deepEqual((await s.tasks.listTasks(s.ctx.mario, { search: 'login' })).items.map((t) => t.code), ['CRM-1'])
    assert.deepEqual((await s.tasks.listTasks(s.ctx.mario, { search: 'crm-2' })).items.map((t) => t.code), ['CRM-2'])
    assert.deepEqual((await s.tasks.listTasks(s.ctx.mario, { assignee_id: 'me' })).items.map((t) => t.code), ['CRM-2'])
    assert.deepEqual((await s.tasks.listTasks(s.ctx.mario, { priority_id: s.priorities.high.id })).items.map((t) => t.code), ['CRM-1'])
    assert.deepEqual((await s.tasks.listTasks(s.ctx.admin, { project_id: s.other.id })).items.map((t) => t.code), ['SAP-1'])
    assert.deepEqual((await s.tasks.listTasks(s.ctx.mario, { sort: '-code' })).items.map((t) => t.code), ['CRM-2', 'CRM-1'])
    // "minhas tarefas primeiro": as de quem consulta antes, sem esconder as outras; cada grupo na ordem pedida
    assert.deepEqual((await s.tasks.listTasks(s.ctx.mario, { sort: 'code', mine_first: 'true' })).items.map((t) => t.code), ['CRM-2', 'CRM-1'])
    assert.equal((await s.tasks.listTasks(s.ctx.mario, { mine_first: 'true' })).meta.total, 2)
    assert.deepEqual((await s.tasks.listTasks(s.ctx.mario, { sort: 'code', mine_first: 'false' })).items.map((t) => t.code), ['CRM-1', 'CRM-2'])
    await assert.rejects(() => s.tasks.listTasks(s.ctx.mario, { mine_first: 'sim' }), { code: 'VALIDATION_ERROR' })

    const item = (await s.tasks.listTasks(s.ctx.mario, { search: 'login' })).items[0]
    assert.equal(item.project.key, 'CRM')
    assert.equal(item.priority.name, 'Alta')
    assert.equal(item.custom_values, undefined)
  })

  it('filtra por categoria do status (abertas x encerradas)', async () => {
    const s = await setup()
    const a = await s.tasks.createTask(s.ctx.mario, newBug(s))
    await s.tasks.createTask(s.ctx.mario, newBug(s))
    await s.tasks.updateTask(s.ctx.mario, a.id, { status_id: s.statuses.done.id })
    assert.deepEqual((await s.tasks.listTasks(s.ctx.mario, { category: 'backlog,todo,in_progress' })).items.map((t) => t.code), ['CRM-2'])
    assert.deepEqual((await s.tasks.listTasks(s.ctx.mario, { category: 'done' })).items.map((t) => t.code), ['CRM-1'])
  })

  it('Prioridade e Urgência aceitam vários valores separados por vírgula (botões da Lista de tarefas, §44)', async () => {
    const s = await setup()
    const a = await s.tasks.createTask(s.ctx.mario, newBug(s, { priority_id: s.priorities.high.id, urgency: 'high' }))
    const b = await s.tasks.createTask(s.ctx.mario, newBug(s, { priority_id: s.priorities.medium.id, urgency: 'low' }))
    const c = await s.tasks.createTask(s.ctx.mario, newBug(s, { priority_id: s.priorities.medium.id }))
    const codes = async (query) => (await s.tasks.listTasks(s.ctx.mario, Object.assign({ sort: 'code' }, query))).items.map((t) => t.code)
    assert.deepEqual(await codes({ priority_id: `${s.priorities.high.id},${s.priorities.medium.id}` }), [a.code, b.code, c.code])
    assert.deepEqual(await codes({ priority_id: s.priorities.medium.id }), [b.code, c.code])
    assert.deepEqual(await codes({ urgency: 'high,none' }), [a.code, c.code])
    assert.deepEqual(await codes({ urgency: 'low', priority_id: `${s.priorities.high.id},${s.priorities.medium.id}` }), [b.code])
    assert.equal(await codeOf(() => codes({ urgency: 'high,roja' })), 'VALIDATION_ERROR:{"urgency":"invalid_option"}')
    assert.equal(await codeOf(() => codes({ priority_id: 'ok,não é id' })), 'VALIDATION_ERROR:{"priority_id":"invalid_type"}')
  })

  it('a Lista de tarefas do menu (tasks.list) não muda o que a pessoa vê: a API segue só tasks.view (§44)', async () => {
    const s = await setup()
    await s.tasks.createTask(s.ctx.mario, newBug(s, { assignee_id: s.users.mario.id }))
    const role = await s.deps.roleRepository.findById(s.users.mario.roleId)
    const perms = await s.deps.roleRepository.getPermissionCodes(role.id)
    assert.ok(perms.includes('tasks.list'))
    await s.deps.roleRepository.setPermissionCodes(role.id, perms.filter((code) => code !== 'tasks.list'))
    const withoutMenu = await ctxOf(s.deps, s.users.mario)
    assert.equal((await s.tasks.listTasks(withoutMenu, {})).meta.total, 1)
    assert.equal((await s.tasks.listTasks(withoutMenu, { project_id: s.project.id, assignee_id: 'me' })).meta.total, 1)
  })
})

describe('application/tasks — informe do projeto', () => {
  it('toda tarefa entra no informe por padrão; quem edita tira e devolve, com histórico', async () => {
    const s = await setup()
    const task = await s.tasks.createTask(s.ctx.mario, newBug(s))
    assert.equal(task.in_report, true)

    const out = await s.tasks.setTaskReport(s.ctx.mario, task.id, { in_report: false })
    assert.equal(out.in_report, false)
    const audit = s.deps.store.audit.at(-1)
    assert.equal(audit.action, 'task.updated')
    assert.deepEqual(audit.oldValue, { in_report: true })
    assert.deepEqual(audit.newValue, { in_report: false })

    const before = s.deps.store.audit.length
    await s.tasks.setTaskReport(s.ctx.mario, task.id, { in_report: false })
    assert.equal(s.deps.store.audit.length, before)
    assert.equal((await s.tasks.setTaskReport(s.ctx.gabi, task.id, { in_report: true })).in_report, true)
  })

  it('não exige os campos obrigatórios do status (só liga/desliga)', async () => {
    const s = await setup()
    const task = await s.tasks.createTask(s.ctx.mario, newBug(s))
    await s.deps.taskValueRepository.replace(task.id, {}, {})
    assert.equal((await s.tasks.setTaskReport(s.ctx.mario, task.id, { in_report: false })).in_report, false)
  })

  it('valida o valor e o acesso (leitor não altera; estranho não enxerga)', async () => {
    const s = await setup()
    const task = await s.tasks.createTask(s.ctx.mario, newBug(s))
    assert.equal(await codeOf(() => s.tasks.setTaskReport(s.ctx.mario, task.id, { in_report: 'sim' })), 'VALIDATION_ERROR:{"in_report":"invalid_type"}')
    assert.equal(await codeOf(() => s.tasks.setTaskReport(s.ctx.lia, task.id, { in_report: false })), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.tasks.setTaskReport(s.ctx.outsider, task.id, { in_report: false })), 'TASK_NOT_FOUND')
  })

  it('a listagem filtra por in_report', async () => {
    const s = await setup()
    const a = await s.tasks.createTask(s.ctx.mario, newBug(s))
    const b = await s.tasks.createTask(s.ctx.mario, newBug(s, { title: 'Outra' }))
    await s.tasks.setTaskReport(s.ctx.mario, b.id, { in_report: false })
    const codes = async (value) => (await s.tasks.listTasks(s.ctx.mario, { project_id: s.project.id, in_report: value })).items.map((t) => t.code)
    assert.deepEqual(await codes('true'), [a.code])
    assert.deepEqual(await codes('false'), [b.code])
    assert.equal(await codeOf(() => codes('talvez')), 'VALIDATION_ERROR:{"in_report":"invalid_option"}')
  })
})

describe('application/tasks — urgência (semáforo)', () => {
  it('nasce sem urgência; quem edita escolhe alta/média/baixa ou limpa, com histórico', async () => {
    const s = await setup()
    const task = await s.tasks.createTask(s.ctx.mario, newBug(s))
    assert.equal(task.urgency, null)
    assert.equal((await s.tasks.setTaskUrgency(s.ctx.mario, task.id, { urgency: 'high' })).urgency, 'high')
    const audit = s.deps.store.audit.at(-1)
    assert.equal(audit.action, 'task.updated')
    assert.deepEqual([audit.oldValue, audit.newValue], [{ urgency: null }, { urgency: 'high' }])
    const before = s.deps.store.audit.length
    await s.tasks.setTaskUrgency(s.ctx.mario, task.id, { urgency: 'high' })
    assert.equal(s.deps.store.audit.length, before)
    assert.equal((await s.tasks.setTaskUrgency(s.ctx.gabi, task.id, { urgency: null })).urgency, null)
  })

  it('valida o valor e o acesso; não exige os campos do status', async () => {
    const s = await setup()
    const task = await s.tasks.createTask(s.ctx.mario, newBug(s))
    await s.deps.taskValueRepository.replace(task.id, {}, {})
    assert.equal((await s.tasks.setTaskUrgency(s.ctx.mario, task.id, { urgency: 'low' })).urgency, 'low')
    assert.equal(await codeOf(() => s.tasks.setTaskUrgency(s.ctx.mario, task.id, { urgency: 'urgente' })), 'VALIDATION_ERROR:{"urgency":"invalid_option"}')
    assert.equal(await codeOf(() => s.tasks.setTaskUrgency(s.ctx.mario, task.id, {})), 'VALIDATION_ERROR:{"urgency":"invalid_option"}')
    assert.equal(await codeOf(() => s.tasks.setTaskUrgency(s.ctx.lia, task.id, { urgency: 'high' })), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.tasks.setTaskUrgency(s.ctx.outsider, task.id, { urgency: 'high' })), 'TASK_NOT_FOUND')
  })

  it('a listagem filtra por urgência (none = sem urgência)', async () => {
    const s = await setup()
    const a = await s.tasks.createTask(s.ctx.mario, newBug(s))
    const b = await s.tasks.createTask(s.ctx.mario, newBug(s, { title: 'Outra' }))
    await s.tasks.setTaskUrgency(s.ctx.mario, b.id, { urgency: 'medium' })
    const codes = async (value) => (await s.tasks.listTasks(s.ctx.mario, { project_id: s.project.id, urgency: value })).items.map((t) => t.code)
    assert.deepEqual(await codes('medium'), [b.code])
    assert.deepEqual(await codes('none'), [a.code])
    assert.equal(await codeOf(() => codes('roja')), 'VALIDATION_ERROR:{"urgency":"invalid_option"}')
  })

  it('também entra na criação e na edição (null limpa), com histórico', async () => {
    const s = await setup()
    const task = await s.tasks.createTask(s.ctx.mario, newBug(s, { urgency: 'high' }))
    assert.equal(task.urgency, 'high')
    assert.equal(s.deps.store.audit.at(-1).newValue.urgency, 'high')
    const edited = await s.tasks.updateTask(s.ctx.mario, task.id, { urgency: null })
    assert.equal(edited.urgency, null)
    assert.deepEqual([s.deps.store.audit.at(-1).oldValue, s.deps.store.audit.at(-1).newValue], [{ urgency: 'high' }, { urgency: null }])
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.mario, task.id, { urgency: 'roja' })), 'VALIDATION_ERROR:{"urgency":"invalid_option"}')
  })
})

describe('application/tasks — área responsável (§32)', () => {
  async function withAreas(s) {
    const areas = createLookupService(s.deps, 'area')
    const ti = await areas.create(s.ctx.admin, { key: 'TI', name: 'Dpto. TI', color: 'blue' })
    const mkt = await areas.create(s.ctx.admin, { key: 'MKT', name: 'Marketing', color: 'pink' })
    return { ti, mkt, areas }
  }

  it('nasce com a área do formulário; muda pela lista com histórico; null limpa; filtra (none = sem área)', async () => {
    const s = await setup()
    const { ti, mkt } = await withAreas(s)
    const a = await s.tasks.createTask(s.ctx.mario, newBug(s, { area_id: ti.id }))
    const b = await s.tasks.createTask(s.ctx.mario, newBug(s, { title: 'Outra' }))
    assert.deepEqual([a.area, b.area], [{ id: ti.id, key: 'TI', name: 'Dpto. TI', color: 'blue' }, null])
    assert.equal(s.deps.store.audit.find((e) => e.action === 'task.created' && e.entityId === a.id).newValue.area, 'Dpto. TI')

    assert.equal((await s.tasks.setTaskArea(s.ctx.mario, b.id, { area_id: mkt.id })).area.name, 'Marketing')
    const audit = s.deps.store.audit.at(-1)
    assert.deepEqual([audit.action, audit.oldValue, audit.newValue], ['task.updated', { area: null }, { area: 'Marketing' }])
    const before = s.deps.store.audit.length
    await s.tasks.setTaskArea(s.ctx.mario, b.id, { area_id: mkt.id })
    assert.equal(s.deps.store.audit.length, before)

    const codes = async (value) => (await s.tasks.listTasks(s.ctx.mario, { project_id: s.project.id, area_id: value })).items.map((t) => t.code)
    assert.deepEqual(await codes(mkt.id), [b.code])
    assert.equal((await s.tasks.setTaskArea(s.ctx.mario, a.id, { area_id: null })).area, null)
    assert.deepEqual(await codes('none'), [a.code])
    assert.equal(await codeOf(() => codes('a b')), 'VALIDATION_ERROR:{"area_id":"invalid_type"}')
  })

  it('valida área ativa e acesso; não exige os campos do status', async () => {
    const s = await setup()
    const { ti, areas } = await withAreas(s)
    const task = await s.tasks.createTask(s.ctx.mario, newBug(s))
    await s.deps.taskValueRepository.replace(task.id, {}, {})
    assert.equal((await s.tasks.setTaskArea(s.ctx.mario, task.id, { area_id: ti.id })).area.key, 'TI')
    await areas.update(s.ctx.admin, ti.id, { is_active: false })
    // a área que a tarefa já tem continua valendo, mesmo inativa
    assert.equal(await codeOf(() => s.tasks.setTaskArea(s.ctx.mario, task.id, { area_id: ti.id })), 'OK')
    assert.equal(await codeOf(() => s.tasks.setTaskArea(s.ctx.mario, task.id, { area_id: 'nada' })), 'VALIDATION_ERROR:{"area_id":"invalid_option"}')
    assert.equal(await codeOf(() => s.tasks.setTaskArea(s.ctx.mario, task.id, {})), 'VALIDATION_ERROR:{"area_id":"invalid_type"}')
    assert.equal(await codeOf(() => s.tasks.setTaskArea(s.ctx.lia, task.id, { area_id: null })), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.tasks.setTaskArea(s.ctx.outsider, task.id, { area_id: null })), 'TASK_NOT_FOUND')
    assert.equal(await codeOf(() => s.tasks.createTask(s.ctx.mario, newBug(s, { area_id: ti.id }))), 'VALIDATION_ERROR:{"area_id":"invalid_option"}')
  })

  it('também na edição completa (null limpa), com o nome da área no histórico', async () => {
    const s = await setup()
    const { ti, mkt } = await withAreas(s)
    const task = await s.tasks.createTask(s.ctx.mario, newBug(s, { area_id: ti.id }))
    assert.equal((await s.tasks.updateTask(s.ctx.mario, task.id, { area_id: mkt.id })).area.name, 'Marketing')
    assert.deepEqual([s.deps.store.audit.at(-1).oldValue, s.deps.store.audit.at(-1).newValue], [{ area: 'Dpto. TI' }, { area: 'Marketing' }])
    assert.equal((await s.tasks.updateTask(s.ctx.mario, task.id, { area_id: null })).area, null)
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.mario, task.id, { area_id: 'nada' })), 'VALIDATION_ERROR:{"area_id":"invalid_option"}')
  })
})

describe('application/tasks — etapa da Gestão (§28, ADR-052)', () => {
  /** Etapas do CRM: 1.0 Base de clientes (com o subgrupo 1.1 Critérios); uma etapa no SAP. */
  async function withStages() {
    const s = await setup()
    const group = (projectId, name, position, parentId) => s.deps.projectGroupRepository.create({ projectId, name, color: 'blue', position, parentId: parentId || null })
    const base = await group(s.project.id, 'Base de clientes', 1024)
    const criterios = await group(s.project.id, 'Critérios', 1024, base.id)
    const sap = await group(s.other.id, 'Fase SAP', 1024)
    return Object.assign(s, { stages: { base, criterios, sap } })
  }
  const doc = (s, extra) => Object.assign({ project_id: s.project.id, task_type_id: s.types.doc.id, title: 'Unir a base de clientes' }, extra)
  const rowsOf = (s, groupId) => s.deps.store.planItems.filter((i) => i.groupId === groupId)
  /** O mesmo contexto sem uma permissão (perfil personalizado). */
  const without = (ctx, code) =>
    Object.assign({}, ctx, { principal: createPrincipal({ userId: ctx.principal.userId, roleId: 'r', roleCode: 'CUSTOM', permissions: Array.from(ctx.principal.permissions).filter((p) => p !== code) }) })

  it('criar com etapa: nasce uma linha na etapa com título, datas e responsável da tarefa, e a tarefa fica ligada a ela', async () => {
    const s = await withStages()
    const task = await s.tasks.createTask(
      s.ctx.mario,
      doc(s, { plan_group_id: s.stages.criterios.id, start_date: '2026-01-12', due_date: '2026-01-30', assignee_id: s.users.mario.id }),
    )
    const rows = rowsOf(s, s.stages.criterios.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].name, 'Unir a base de clientes')
    assert.equal(rows[0].projectId, s.project.id)
    assert.equal(rows[0].parentId, null)
    assert.equal(rows[0].startDate, '2026-01-12')
    assert.equal(rows[0].endDate, '2026-01-30')
    assert.equal(rows[0].ownerId, s.users.mario.id)
    assert.equal(rows[0].statusId, null)
    assert.equal(rows[0].createdBy, s.users.mario.id)
    assert.deepEqual(task.plan_item, { id: rows[0].id, name: 'Unir a base de clientes' })
    // histórico dos dois lados, como se a linha fosse criada no quadro
    const created = s.deps.store.audit.find((a) => a.action === 'plan_item.created')
    assert.equal(created.entityId, rows[0].id)
    assert.equal(created.newValue.plan_group, 'Critérios')
    assert.equal(created.newValue.name, 'Unir a base de clientes')
    assert.equal(s.deps.store.audit.at(-1).action, 'task.created')
    assert.equal(s.deps.store.audit.at(-1).newValue.plan_item, 'Unir a base de clientes')
  })

  it('sem datas: a linha começa hoje e termina no mesmo dia; vai para o fim da etapa', async () => {
    const s = await withStages()
    await s.tasks.createTask(s.ctx.mario, doc(s, { title: 'Primeira', plan_group_id: s.stages.base.id }))
    await s.tasks.createTask(s.ctx.mario, doc(s, { title: 'Segunda', plan_group_id: s.stages.base.id }))
    const [first, second] = rowsOf(s, s.stages.base.id)
    assert.equal(first.startDate, '2026-01-10')
    assert.equal(first.endDate, '2026-01-10')
    assert.equal(first.ownerId, null)
    assert.ok(second.position > first.position)
  })

  it('editar a tarefa depois não muda a linha (cópia só na criação)', async () => {
    const s = await withStages()
    const task = await s.tasks.createTask(s.ctx.mario, doc(s, { plan_group_id: s.stages.base.id, due_date: '2026-01-20' }))
    await s.tasks.updateTask(s.ctx.mario, task.id, { title: 'Outro título', due_date: '2026-02-20' })
    const [row] = rowsOf(s, s.stages.base.id)
    assert.equal(row.name, 'Unir a base de clientes')
    assert.equal(row.endDate, '2026-01-20')
  })

  it('etapa de outro projeto ou inexistente é recusada; etapa e elemento juntos também (nada é criado)', async () => {
    const s = await withStages()
    assert.equal(await codeOf(() => s.tasks.createTask(s.ctx.mario, doc(s, { plan_group_id: s.stages.sap.id }))), 'VALIDATION_ERROR:{"plan_group_id":"invalid_option"}')
    assert.equal(await codeOf(() => s.tasks.createTask(s.ctx.mario, doc(s, { plan_group_id: 'naoexiste' }))), 'VALIDATION_ERROR:{"plan_group_id":"invalid_option"}')
    const item = await s.deps.planItemRepository.create({ projectId: s.project.id, groupId: s.stages.base.id, name: 'Já existe', position: 1 })
    assert.equal(
      await codeOf(() => s.tasks.createTask(s.ctx.mario, doc(s, { plan_group_id: s.stages.base.id, plan_item_id: item.id }))),
      'VALIDATION_ERROR:{"plan_group_id":"exclusive"}',
    )
    assert.equal(s.deps.store.planItems.length, 1)
    assert.equal(s.deps.store.tasks.length, 0)
  })

  it('exige ver a Gestão (plan.view): sem ela, FORBIDDEN — não precisa de plan.edit', async () => {
    const s = await withStages()
    assert.equal(await codeOf(() => s.tasks.createTask(without(s.ctx.mario, 'plan.view'), doc(s, { plan_group_id: s.stages.base.id }))), 'FORBIDDEN')
    assert.equal(s.deps.store.tasks.length, 0)
    const task = await s.tasks.createTask(without(s.ctx.mario, 'plan.edit'), doc(s, { plan_group_id: s.stages.base.id }))
    assert.equal(task.plan_item.name, 'Unir a base de clientes')
    // leitor do projeto não cria tarefa, com ou sem etapa
    assert.equal(await codeOf(() => s.tasks.createTask(s.ctx.lia, doc(s, { plan_group_id: s.stages.base.id }))), 'FORBIDDEN')
  })

  it('PATCH com etapa: só quando a tarefa ainda não está na Gestão; cria a linha com os dados atuais', async () => {
    const s = await withStages()
    const loose = await s.tasks.createTask(s.ctx.mario, doc(s, { title: 'Sem etapa' }))
    const placed = await s.tasks.updateTask(s.ctx.mario, loose.id, { plan_group_id: s.stages.criterios.id, due_date: '2026-01-25' })
    const [row] = rowsOf(s, s.stages.criterios.id)
    assert.equal(row.name, 'Sem etapa')
    assert.equal(row.endDate, '2026-01-25')
    assert.deepEqual(placed.plan_item, { id: row.id, name: 'Sem etapa' })
    const audit = s.deps.store.audit.at(-1)
    assert.equal(audit.action, 'task.updated')
    assert.deepEqual([audit.oldValue.plan_item, audit.newValue.plan_item], [null, 'Sem etapa'])
    assert.ok(s.deps.store.audit.some((a) => a.action === 'plan_item.created' && a.entityId === row.id))
    // já ligada: recusa (trocar de elemento continua pelo painel da Gestão)
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.mario, loose.id, { plan_group_id: s.stages.base.id })), 'VALIDATION_ERROR:{"plan_group_id":"already_linked"}')
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.mario, loose.id, { plan_group_id: s.stages.base.id, plan_item_id: null })), 'VALIDATION_ERROR:{"plan_group_id":"exclusive"}')
    assert.equal(rowsOf(s, s.stages.base.id).length, 0)
  })

  it('PATCH com etapa de outro projeto, sem plan.view ou por leitor é recusado', async () => {
    const s = await withStages()
    const loose = await s.tasks.createTask(s.ctx.mario, doc(s))
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.mario, loose.id, { plan_group_id: s.stages.sap.id })), 'VALIDATION_ERROR:{"plan_group_id":"invalid_option"}')
    assert.equal(await codeOf(() => s.tasks.updateTask(without(s.ctx.mario, 'plan.view'), loose.id, { plan_group_id: s.stages.base.id })), 'FORBIDDEN')
    assert.equal(await codeOf(() => s.tasks.updateTask(s.ctx.lia, loose.id, { plan_group_id: s.stages.base.id })), 'FORBIDDEN')
    assert.equal(s.deps.store.planItems.length, 0)
  })
})
