const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createFakeDeps, seedUser } = require('../support/fakes')
const { createTaskService } = require('../../pb_hooks/src/application/tasks')
const { createCustomFieldService } = require('../../pb_hooks/src/application/custom-fields')
const { createTaskTypeService } = require('../../pb_hooks/src/application/task-types')
const { createLookupService } = require('../../pb_hooks/src/application/lookups')
const { createCharterService } = require('../../pb_hooks/src/application/charter')
const { createProjectService } = require('../../pb_hooks/src/application/projects')
const { createPrincipal } = require('../../pb_hooks/src/domain/rbac')

function ctxOf(deps, user) {
  const role = deps.roleRepository.findById(user.roleId)
  return {
    principal: createPrincipal({ userId: user.id, roleId: role.id, roleCode: role.code, permissions: deps.roleRepository.getPermissionCodes(role.id) }),
    ip: '1.1.1.1',
    userAgent: 'ua',
    correlationId: 'c',
  }
}

function codeOf(fn) {
  try {
    fn()
  } catch (err) {
    return err.code === 'VALIDATION_ERROR' ? `${err.code}:${JSON.stringify(err.details.fields)}` : err.code
  }
  return 'OK'
}

/** Cenário: projeto CRM (gestora Gabi, membro Mário, leitora Lia), tipos BUG e DOC, fluxo e prioridades. */
function setup() {
  const deps = createFakeDeps()
  const adminUser = seedUser(deps, { roleCode: 'ADMIN', name: 'Admin' })
  const admin = ctxOf(deps, adminUser)
  const gabi = seedUser(deps, { roleCode: 'MANAGER', name: 'Gabi' })
  const mario = seedUser(deps, { roleCode: 'MEMBER', name: 'Mário' })
  const lia = seedUser(deps, { roleCode: 'MEMBER', name: 'Lia' })
  const outsider = seedUser(deps, { roleCode: 'MEMBER', name: 'Otto' })

  const project = deps.projectRepository.create({ name: 'CRM Corporativo', key: 'CRM', ownerId: gabi.id, createdBy: gabi.id, status: 'active', priority: 'medium' })
  const other = deps.projectRepository.create({ name: 'SAP', key: 'SAP', ownerId: adminUser.id, createdBy: adminUser.id, status: 'active', priority: 'medium' })
  deps.projectMemberRepository.add({ projectId: project.id, userId: gabi.id, role: 'manager' })
  deps.projectMemberRepository.add({ projectId: project.id, userId: mario.id, role: 'member' })
  deps.projectMemberRepository.add({ projectId: project.id, userId: lia.id, role: 'viewer' })
  deps.projectMemberRepository.add({ projectId: other.id, userId: adminUser.id, role: 'manager' })

  const fields = createCustomFieldService(deps)
  const types = createTaskTypeService(deps)
  const statuses = createLookupService(deps, 'status')
  const priorities = createLookupService(deps, 'priority')

  const versao = fields.createField(admin, { label: 'Versão', type: 'text', searchable: true })
  const severidade = fields.createField(admin, {
    label: 'Severidade',
    type: 'select',
    options: [{ label: 'Alta', color: 'red' }, { label: 'Média', color: 'amber', is_default: true }],
  })
  const bug = types.createType(admin, { key: 'BUG', name: 'Bug', icon: 'bug', color: 'red' })
  types.setTypeFields(admin, bug.id, [
    { field_id: versao.id, required: true },
    { field_id: severidade.id, required: true },
  ])
  const doc = types.createType(admin, { key: 'DOC', name: 'Documentação', icon: 'book', color: 'gray' })

  const backlog = statuses.create(admin, { key: 'BACKLOG', name: 'Backlog', category: 'backlog', color: 'gray' })
  const dev = statuses.create(admin, { key: 'DEV', name: 'Desenvolvimento', category: 'in_progress', color: 'amber' })
  const done = statuses.create(admin, { key: 'DONE', name: 'Concluído', category: 'done', color: 'green' })
  const high = priorities.create(admin, { key: 'ALTA', name: 'Alta', color: 'orange' })
  const medium = priorities.create(admin, { key: 'MEDIA', name: 'Média', color: 'amber', is_default: true })

  return {
    deps,
    tasks: createTaskService(deps),
    project,
    other,
    users: { admin: adminUser, gabi, mario, lia, outsider },
    ctx: { admin, gabi: ctxOf(deps, gabi), mario: ctxOf(deps, mario), lia: ctxOf(deps, lia), outsider: ctxOf(deps, outsider) },
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
  it('numera por projeto, aplica padrões (status, prioridade, valores) e registra histórico', () => {
    const s = setup()
    const first = s.tasks.createTask(s.ctx.mario, newBug(s))
    const second = s.tasks.createTask(s.ctx.mario, newBug(s, { title: 'Outro' }))
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

  it('valida campos obrigatórios do tipo e valores', () => {
    const s = setup()
    assert.equal(
      codeOf(() => s.tasks.createTask(s.ctx.mario, newBug(s, { custom_values: {} }))),
      'VALIDATION_ERROR:{"custom_values.versao":"required"}',
    )
    assert.equal(
      codeOf(() => s.tasks.createTask(s.ctx.mario, newBug(s, { title: ' ', custom_values: { versao: '1', severidade: 'x' } }))),
      'VALIDATION_ERROR:{"title":"required"}',
    )
    assert.equal(
      codeOf(() => s.tasks.createTask(s.ctx.mario, newBug(s, { custom_values: { versao: '1', severidade: 'x' } }))),
      'VALIDATION_ERROR:{"custom_values.severidade":"invalid_option"}',
    )
    // horas: zero não é valor (para limpar, envia-se null)
    assert.equal(codeOf(() => s.tasks.createTask(s.ctx.mario, newBug(s, { estimated_hours: 0 }))), 'VALIDATION_ERROR:{"estimated_hours":"too_small"}')
    assert.equal(s.tasks.createTask(s.ctx.mario, newBug(s, { estimated_hours: 1.255 })).estimated_hours, 1.26)
  })

  it('responsável precisa colaborar no projeto (leitor e estranho não)', () => {
    const s = setup()
    assert.equal(
      codeOf(() => s.tasks.createTask(s.ctx.mario, newBug(s, { assignee_id: s.users.lia.id }))),
      'VALIDATION_ERROR:{"assignee_id":"not_member"}',
    )
    assert.equal(
      codeOf(() => s.tasks.createTask(s.ctx.mario, newBug(s, { assignee_id: s.users.outsider.id }))),
      'VALIDATION_ERROR:{"assignee_id":"not_member"}',
    )
    const ok = s.tasks.createTask(s.ctx.mario, newBug(s, { assignee_id: s.users.gabi.id }))
    assert.equal(ok.assignee.name, 'Gabi')
  })

  it('acesso: leitor não cria; quem não é do projeto não enxerga; arquivado bloqueia', () => {
    const s = setup()
    assert.equal(codeOf(() => s.tasks.createTask(s.ctx.lia, newBug(s))), 'FORBIDDEN')
    assert.equal(codeOf(() => s.tasks.createTask(s.ctx.outsider, newBug(s))), 'PROJECT_NOT_FOUND')
    s.deps.projectRepository.update(s.project.id, { archivedAt: new Date() })
    assert.equal(codeOf(() => s.tasks.createTask(s.ctx.gabi, newBug(s))), 'PROJECT_ARCHIVED')
  })

  it('tipo, status e prioridade inativos não podem ser usados', () => {
    const s = setup()
    s.deps.taskTypeRepository.update(s.types.doc.id, { isActive: false })
    assert.equal(
      codeOf(() => s.tasks.createTask(s.ctx.mario, { project_id: s.project.id, task_type_id: s.types.doc.id, title: 'x' })),
      'VALIDATION_ERROR:{"task_type_id":"invalid_option"}',
    )
    s.deps.statusRepository.update(s.statuses.dev.id, { isActive: false })
    assert.equal(
      codeOf(() => s.tasks.createTask(s.ctx.mario, newBug(s, { status_id: s.statuses.dev.id }))),
      'VALIDATION_ERROR:{"status_id":"invalid_option"}',
    )
  })
})

describe('application/tasks — edição e histórico', () => {
  it('mudar status preenche início/conclusão e o histórico mostra nomes', () => {
    const s = setup()
    const task = s.tasks.createTask(s.ctx.mario, newBug(s))
    const started = s.tasks.updateTask(s.ctx.mario, task.id, { status_id: s.statuses.dev.id })
    assert.ok(started.started_at)
    assert.equal(started.completed_at, null)
    const closed = s.tasks.updateTask(s.ctx.mario, task.id, { status_id: s.statuses.done.id, priority_id: s.priorities.high.id })
    assert.ok(closed.completed_at)
    const audit = s.deps.store.audit.at(-1)
    assert.equal(audit.action, 'task.updated')
    assert.deepEqual(audit.oldValue, { task_status: 'Desenvolvimento', task_priority: 'Média' })
    assert.deepEqual(audit.newValue, { task_status: 'Concluído', task_priority: 'Alta' })
  })

  it('campos personalizados no histórico usam o rótulo e o nome da opção', () => {
    const s = setup()
    const task = s.tasks.createTask(s.ctx.mario, newBug(s))
    const alta = s.fields.severidade.options.find((o) => o.label === 'Alta')
    s.tasks.updateTask(s.ctx.mario, task.id, { custom_values: { severidade: alta.id, versao: '2.2' } })
    const audit = s.deps.store.audit.at(-1)
    assert.deepEqual(audit.oldValue, { 'cf:Versão': '2.1', 'cf:Severidade': 'Média' })
    assert.deepEqual(audit.newValue, { 'cf:Versão': '2.2', 'cf:Severidade': 'Alta' })
  })

  it('sem mudanças não grava histórico', () => {
    const s = setup()
    const task = s.tasks.createTask(s.ctx.mario, newBug(s))
    const before = s.deps.store.audit.length
    s.tasks.updateTask(s.ctx.mario, task.id, { title: task.title, custom_values: { versao: '2.1' } })
    assert.equal(s.deps.store.audit.length, before)
  })

  it('trocar o tipo descarta valores de campos que o novo tipo não tem', () => {
    const s = setup()
    const task = s.tasks.createTask(s.ctx.mario, newBug(s))
    const changed = s.tasks.updateTask(s.ctx.mario, task.id, { task_type_id: s.types.doc.id })
    assert.equal(changed.type.key, 'DOC')
    assert.deepEqual(changed.custom_values, {})
    assert.deepEqual(s.deps.store.taskValues.filter((v) => v.taskId === task.id), [])
  })

  it('leitor não edita; quem não é do projeto recebe TASK_NOT_FOUND', () => {
    const s = setup()
    const task = s.tasks.createTask(s.ctx.mario, newBug(s))
    assert.equal(codeOf(() => s.tasks.updateTask(s.ctx.lia, task.id, { title: 'x' })), 'FORBIDDEN')
    assert.equal(codeOf(() => s.tasks.getTask(s.ctx.outsider, task.id)), 'TASK_NOT_FOUND')
    // leitora não edita, mas comenta (regra do produto — diretriz §18)
    assert.deepEqual(s.tasks.getTask(s.ctx.lia, task.id).capabilities, { edit: false, delete: false, assign: false, link: false, fork: false, comment: true })
  })

  it('exclusão: MEMBER não tem tasks.delete; gestora exclui e fica no histórico', () => {
    const s = setup()
    const task = s.tasks.createTask(s.ctx.mario, newBug(s))
    assert.equal(codeOf(() => s.tasks.deleteTask(s.ctx.mario, task.id)), 'FORBIDDEN')
    assert.deepEqual(s.tasks.deleteTask(s.ctx.gabi, task.id), { deleted: true })
    assert.equal(codeOf(() => s.tasks.getTask(s.ctx.gabi, task.id)), 'TASK_NOT_FOUND')
    assert.equal(s.deps.store.audit.at(-1).action, 'task.deleted')
    assert.deepEqual(s.deps.store.taskValues.filter((v) => v.taskId === task.id), [])
  })
})

describe('application/tasks — obrigatórios por status', () => {
  /** DOC exige "Parecer" em Desenvolvimento e Concluído (não no Backlog). */
  function withParecer() {
    const s = setup()
    const fields = createCustomFieldService(s.deps)
    const types = createTaskTypeService(s.deps)
    const parecer = fields.createField(s.ctx.admin, { label: 'Parecer', type: 'textarea' })
    types.setTypeFields(s.ctx.admin, s.types.doc.id, [{ field_id: parecer.id, required_status_ids: [s.statuses.dev.id, s.statuses.done.id] }])
    const newDoc = (extra) => Object.assign({ project_id: s.project.id, task_type_id: s.types.doc.id, title: 'Manual' }, extra)
    return Object.assign(s, { newDoc })
  }
  const details = (fn) => {
    try {
      fn()
    } catch (err) {
      return { code: err.code, fields: err.details.fields, status: err.details.status }
    }
    return null
  }

  it('criar: exige os campos do status inicial', () => {
    const s = withParecer()
    assert.equal(s.tasks.createTask(s.ctx.mario, s.newDoc()).status.key, 'BACKLOG')
    const failed = details(() => s.tasks.createTask(s.ctx.mario, s.newDoc({ status_id: s.statuses.dev.id })))
    assert.deepEqual(failed, { code: 'VALIDATION_ERROR', fields: { 'custom_values.parecer': 'required' }, status: { id: s.statuses.dev.id, name: 'Desenvolvimento' } })
    const ok = s.tasks.createTask(s.ctx.mario, s.newDoc({ status_id: s.statuses.dev.id, custom_values: { parecer: 'Aprovado' } }))
    assert.equal(ok.status.key, 'DEV')
  })

  it('mudar de status (edição e arraste do Kanban) exige os campos do novo status', () => {
    const s = withParecer()
    const doc = s.tasks.createTask(s.ctx.mario, s.newDoc())
    assert.deepEqual(details(() => s.tasks.updateTask(s.ctx.mario, doc.id, { status_id: s.statuses.dev.id })).fields, { 'custom_values.parecer': 'required' })
    assert.deepEqual(details(() => s.tasks.moveTask(s.ctx.mario, doc.id, { status_id: s.statuses.dev.id })).status, { id: s.statuses.dev.id, name: 'Desenvolvimento' })
    assert.equal(s.tasks.getTask(s.ctx.mario, doc.id).status.key, 'BACKLOG')
    // preenchendo junto, a mudança passa
    const moved = s.tasks.updateTask(s.ctx.mario, doc.id, { status_id: s.statuses.dev.id, custom_values: { parecer: 'Aprovado' } })
    assert.equal(moved.status.key, 'DEV')
    // os campos do tipo informam onde cada um é exigido
    assert.deepEqual(moved.fields[0].required_status_ids, [s.statuses.dev.id, s.statuses.done.id])
  })

  it('no status que exige, não dá para esvaziar o campo; em outro status, dá', () => {
    const s = withParecer()
    const doc = s.tasks.createTask(s.ctx.mario, s.newDoc({ status_id: s.statuses.dev.id, custom_values: { parecer: 'Aprovado' } }))
    assert.deepEqual(details(() => s.tasks.updateTask(s.ctx.mario, doc.id, { custom_values: { parecer: '' } })).fields, { 'custom_values.parecer': 'required' })
    const back = s.tasks.updateTask(s.ctx.mario, doc.id, { status_id: s.statuses.backlog.id, custom_values: { parecer: '' } })
    assert.equal(back.custom_values.parecer, undefined)
  })
})

describe('application/tasks — tipo traduzido', () => {
  it('o tipo da tarefa aparece no idioma da requisição; o histórico guarda o original', () => {
    const s = setup()
    createTaskTypeService(s.deps).updateType(s.ctx.admin, s.types.doc.id, { translations: { es: { name: 'Documentación' } } })
    const created = s.tasks.createTask(s.ctx.mario, { project_id: s.project.id, task_type_id: s.types.doc.id, title: 'Manual' })
    s.deps.locale = 'es'
    assert.equal(s.tasks.getTask(s.ctx.mario, created.id).type.name, 'Documentación')
    assert.equal(s.tasks.listTasks(s.ctx.mario, {}).items.find((t) => t.id === created.id).type.name, 'Documentación')
    const history = s.deps.store.audit.find((e) => e.action === 'task.created' && e.entityId === created.id)
    assert.equal(history.newValue.task_type, 'Documentação')
  })
})

describe('application/tasks — listagem', () => {
  it('só lista tarefas de projetos visíveis, com busca, filtros e ordenação', () => {
    const s = setup()
    s.tasks.createTask(s.ctx.mario, newBug(s, { title: 'Erro no login', priority_id: s.priorities.high.id }))
    s.tasks.createTask(s.ctx.mario, newBug(s, { title: 'Relatório lento', assignee_id: s.users.mario.id }))
    s.tasks.createTask(s.ctx.admin, { project_id: s.other.id, task_type_id: s.types.doc.id, title: 'Manual SAP' })

    assert.deepEqual(s.tasks.listTasks(s.ctx.mario, {}).items.map((t) => t.code), ['CRM-1', 'CRM-2'])
    assert.equal(s.tasks.listTasks(s.ctx.admin, {}).meta.total, 3)
    assert.equal(s.tasks.listTasks(s.ctx.outsider, {}).meta.total, 0)

    assert.deepEqual(s.tasks.listTasks(s.ctx.mario, { search: 'login' }).items.map((t) => t.code), ['CRM-1'])
    assert.deepEqual(s.tasks.listTasks(s.ctx.mario, { search: 'crm-2' }).items.map((t) => t.code), ['CRM-2'])
    assert.deepEqual(s.tasks.listTasks(s.ctx.mario, { assignee_id: 'me' }).items.map((t) => t.code), ['CRM-2'])
    assert.deepEqual(s.tasks.listTasks(s.ctx.mario, { priority_id: s.priorities.high.id }).items.map((t) => t.code), ['CRM-1'])
    assert.deepEqual(s.tasks.listTasks(s.ctx.admin, { project_id: s.other.id }).items.map((t) => t.code), ['SAP-1'])
    assert.deepEqual(s.tasks.listTasks(s.ctx.mario, { sort: '-code' }).items.map((t) => t.code), ['CRM-2', 'CRM-1'])

    const item = s.tasks.listTasks(s.ctx.mario, { search: 'login' }).items[0]
    assert.equal(item.project.key, 'CRM')
    assert.equal(item.priority.name, 'Alta')
    assert.equal(item.custom_values, undefined)
  })

  it('filtra por categoria do status (abertas x encerradas)', () => {
    const s = setup()
    const a = s.tasks.createTask(s.ctx.mario, newBug(s))
    s.tasks.createTask(s.ctx.mario, newBug(s))
    s.tasks.updateTask(s.ctx.mario, a.id, { status_id: s.statuses.done.id })
    assert.deepEqual(s.tasks.listTasks(s.ctx.mario, { category: 'backlog,todo,in_progress' }).items.map((t) => t.code), ['CRM-2'])
    assert.deepEqual(s.tasks.listTasks(s.ctx.mario, { category: 'done' }).items.map((t) => t.code), ['CRM-1'])
  })
})

describe('application/tasks — informe do projeto', () => {
  it('toda tarefa entra no informe por padrão; quem edita tira e devolve, com histórico', () => {
    const s = setup()
    const task = s.tasks.createTask(s.ctx.mario, newBug(s))
    assert.equal(task.in_report, true)

    const out = s.tasks.setTaskReport(s.ctx.mario, task.id, { in_report: false })
    assert.equal(out.in_report, false)
    const audit = s.deps.store.audit.at(-1)
    assert.equal(audit.action, 'task.updated')
    assert.deepEqual(audit.oldValue, { in_report: true })
    assert.deepEqual(audit.newValue, { in_report: false })

    const before = s.deps.store.audit.length
    s.tasks.setTaskReport(s.ctx.mario, task.id, { in_report: false })
    assert.equal(s.deps.store.audit.length, before)
    assert.equal(s.tasks.setTaskReport(s.ctx.gabi, task.id, { in_report: true }).in_report, true)
  })

  it('não exige os campos obrigatórios do status (só liga/desliga)', () => {
    const s = setup()
    const task = s.tasks.createTask(s.ctx.mario, newBug(s))
    s.deps.taskValueRepository.replace(task.id, {}, {})
    assert.equal(s.tasks.setTaskReport(s.ctx.mario, task.id, { in_report: false }).in_report, false)
  })

  it('valida o valor e o acesso (leitor não altera; estranho não enxerga)', () => {
    const s = setup()
    const task = s.tasks.createTask(s.ctx.mario, newBug(s))
    assert.equal(codeOf(() => s.tasks.setTaskReport(s.ctx.mario, task.id, { in_report: 'sim' })), 'VALIDATION_ERROR:{"in_report":"invalid_type"}')
    assert.equal(codeOf(() => s.tasks.setTaskReport(s.ctx.lia, task.id, { in_report: false })), 'FORBIDDEN')
    assert.equal(codeOf(() => s.tasks.setTaskReport(s.ctx.outsider, task.id, { in_report: false })), 'TASK_NOT_FOUND')
  })

  it('a listagem filtra por in_report', () => {
    const s = setup()
    const a = s.tasks.createTask(s.ctx.mario, newBug(s))
    const b = s.tasks.createTask(s.ctx.mario, newBug(s, { title: 'Outra' }))
    s.tasks.setTaskReport(s.ctx.mario, b.id, { in_report: false })
    const codes = (value) => s.tasks.listTasks(s.ctx.mario, { project_id: s.project.id, in_report: value }).items.map((t) => t.code)
    assert.deepEqual(codes('true'), [a.code])
    assert.deepEqual(codes('false'), [b.code])
    assert.equal(codeOf(() => codes('talvez')), 'VALIDATION_ERROR:{"in_report":"invalid_option"}')
  })
})

describe('application/tasks — urgência (semáforo)', () => {
  it('nasce sem urgência; quem edita escolhe alta/média/baixa ou limpa, com histórico', () => {
    const s = setup()
    const task = s.tasks.createTask(s.ctx.mario, newBug(s))
    assert.equal(task.urgency, null)
    assert.equal(s.tasks.setTaskUrgency(s.ctx.mario, task.id, { urgency: 'high' }).urgency, 'high')
    const audit = s.deps.store.audit.at(-1)
    assert.equal(audit.action, 'task.updated')
    assert.deepEqual([audit.oldValue, audit.newValue], [{ urgency: null }, { urgency: 'high' }])
    const before = s.deps.store.audit.length
    s.tasks.setTaskUrgency(s.ctx.mario, task.id, { urgency: 'high' })
    assert.equal(s.deps.store.audit.length, before)
    assert.equal(s.tasks.setTaskUrgency(s.ctx.gabi, task.id, { urgency: null }).urgency, null)
  })

  it('valida o valor e o acesso; não exige os campos do status', () => {
    const s = setup()
    const task = s.tasks.createTask(s.ctx.mario, newBug(s))
    s.deps.taskValueRepository.replace(task.id, {}, {})
    assert.equal(s.tasks.setTaskUrgency(s.ctx.mario, task.id, { urgency: 'low' }).urgency, 'low')
    assert.equal(codeOf(() => s.tasks.setTaskUrgency(s.ctx.mario, task.id, { urgency: 'urgente' })), 'VALIDATION_ERROR:{"urgency":"invalid_option"}')
    assert.equal(codeOf(() => s.tasks.setTaskUrgency(s.ctx.mario, task.id, {})), 'VALIDATION_ERROR:{"urgency":"invalid_option"}')
    assert.equal(codeOf(() => s.tasks.setTaskUrgency(s.ctx.lia, task.id, { urgency: 'high' })), 'FORBIDDEN')
    assert.equal(codeOf(() => s.tasks.setTaskUrgency(s.ctx.outsider, task.id, { urgency: 'high' })), 'TASK_NOT_FOUND')
  })

  it('a listagem filtra por urgência (none = sem urgência)', () => {
    const s = setup()
    const a = s.tasks.createTask(s.ctx.mario, newBug(s))
    const b = s.tasks.createTask(s.ctx.mario, newBug(s, { title: 'Outra' }))
    s.tasks.setTaskUrgency(s.ctx.mario, b.id, { urgency: 'medium' })
    const codes = (value) => s.tasks.listTasks(s.ctx.mario, { project_id: s.project.id, urgency: value }).items.map((t) => t.code)
    assert.deepEqual(codes('medium'), [b.code])
    assert.deepEqual(codes('none'), [a.code])
    assert.equal(codeOf(() => codes('roja')), 'VALIDATION_ERROR:{"urgency":"invalid_option"}')
  })
})

describe('application/tasks — área responsável', () => {
  function withAreas(s) {
    const areas = createLookupService(s.deps, 'area')
    const admin = s.ctx.admin || s.ctx.gabi
    return { ti: areas.create(admin, { key: 'TI', name: 'Dpto. TI', color: 'blue' }), mkt: areas.create(admin, { key: 'MKT', name: 'Marketing', color: 'pink' }), areas, admin }
  }

  it('nasce com a área do formulário; muda pela lista com histórico; null limpa; filtra (none = sem área)', () => {
    const s = setup()
    const { ti, mkt } = withAreas(s)
    const a = s.tasks.createTask(s.ctx.mario, newBug(s, { area_id: ti.id }))
    const b = s.tasks.createTask(s.ctx.mario, newBug(s, { title: 'Outra' }))
    assert.deepEqual([a.area.name, b.area], ['Dpto. TI', null])

    assert.equal(s.tasks.setTaskArea(s.ctx.mario, b.id, { area_id: mkt.id }).area.name, 'Marketing')
    const audit = s.deps.store.audit.at(-1)
    assert.deepEqual([audit.action, audit.oldValue, audit.newValue], ['task.updated', { area: null }, { area: 'Marketing' }])
    const codes = (value) => s.tasks.listTasks(s.ctx.mario, { project_id: s.project.id, area_id: value }).items.map((t) => t.code)
    assert.deepEqual(codes(mkt.id), [b.code])
    assert.equal(s.tasks.setTaskArea(s.ctx.mario, a.id, { area_id: null }).area, null)
    assert.deepEqual(codes('none'), [a.code])
  })

  it('valida área ativa e acesso; não exige os campos do status', () => {
    const s = setup()
    const { ti, areas, admin } = withAreas(s)
    const task = s.tasks.createTask(s.ctx.mario, newBug(s))
    s.deps.taskValueRepository.replace(task.id, {}, {})
    assert.equal(s.tasks.setTaskArea(s.ctx.mario, task.id, { area_id: ti.id }).area.key, 'TI')
    areas.update(admin, ti.id, { is_active: false })
    assert.equal(codeOf(() => s.tasks.setTaskArea(s.ctx.mario, task.id, { area_id: ti.id })), 'OK')
    assert.equal(codeOf(() => s.tasks.setTaskArea(s.ctx.mario, task.id, { area_id: 'nada' })), 'VALIDATION_ERROR:{"area_id":"invalid_option"}')
    assert.equal(codeOf(() => s.tasks.setTaskArea(s.ctx.lia, task.id, { area_id: null })), 'FORBIDDEN')
    assert.equal(codeOf(() => s.tasks.createTask(s.ctx.mario, newBug(s, { area_id: ti.id }))), 'VALIDATION_ERROR:{"area_id":"invalid_option"}')
  })
})

describe('Responsável TI: só o resumo do projeto e as próprias tarefas', () => {
  function withTi(s) {
    const tito = seedUser(s.deps, { roleCode: 'MEMBER', name: 'Tito TI' })
    s.deps.projectMemberRepository.add({ projectId: s.project.id, userId: tito.id, role: 'it' })
    const ti = ctxOf(s.deps, tito)
    const mine = s.tasks.createTask(s.ctx.gabi, newBug(s, { title: 'Liberar acesso ao banco', assignee_id: tito.id }))
    const other = s.tasks.createTask(s.ctx.gabi, newBug(s, { title: 'Tela de pedidos' }))
    return { tito, ti, mine, other }
  }

  it('vê e atualiza só as tarefas atribuídas a ele; o resto do projeto não existe para ele', () => {
    const s = setup()
    const { ti, mine, other } = withTi(s)
    assert.deepEqual(s.tasks.listTasks(ti, {}).items.map((t) => t.code), [mine.code])
    assert.deepEqual(s.tasks.listTasks(ti, { project_id: s.project.id }).items.map((t) => t.code), [mine.code])
    assert.equal(s.tasks.getTask(ti, mine.id).capabilities.edit, true)
    assert.equal(s.tasks.updateTask(ti, mine.id, { status_id: s.statuses.dev.id }).status.key, 'DEV')
    assert.equal(codeOf(() => s.tasks.getTask(ti, other.id)), 'TASK_NOT_FOUND')
    assert.equal(codeOf(() => s.tasks.deleteTask(ti, mine.id)), 'FORBIDDEN')
    assert.equal(codeOf(() => s.tasks.updateTask(ti, mine.id, { assignee_id: s.users.mario.id })), 'FORBIDDEN')
    assert.equal(codeOf(() => s.tasks.createTask(ti, newBug(s))), 'PROJECT_NOT_FOUND')
  })

  it('o resumo traz objetivo, tarefas e itens da ficha dele; a ficha completa e o histórico ficam fechados', () => {
    const s = setup()
    const { tito, ti, mine } = withTi(s)
    const charter = createCharterService(s.deps)
    const projects = createProjectService(s.deps)
    charter.updateCharter(s.ctx.gabi, s.project.id, { objective: 'Portal comercial' })
    charter.createItem(s.ctx.gabi, s.project.id, { kind: 'result', title: 'Disponibilidade do banco', target: 99.5, unit: '%', owner_id: tito.id })
    charter.createItem(s.ctx.gabi, s.project.id, { kind: 'feature', title: 'Tela de pedidos' })
    const brief = charter.getBrief(ti, s.project.id)
    assert.equal(brief.objective, 'Portal comercial')
    assert.deepEqual(brief.tasks.map((t) => t.code), [mine.code])
    assert.deepEqual(brief.items.map((i) => i.title), ['Disponibilidade do banco'])
    assert.equal(projects.getProject(ti, s.project.id).my_role, 'it')
    assert.equal(codeOf(() => charter.getCharter(ti, s.project.id)), 'PROJECT_NOT_FOUND')
    assert.equal(codeOf(() => projects.listMembers(ti, s.project.id)), 'PROJECT_NOT_FOUND')
    assert.equal(codeOf(() => charter.getBrief(s.ctx.outsider, s.project.id)), 'PROJECT_NOT_FOUND')
  })
})
