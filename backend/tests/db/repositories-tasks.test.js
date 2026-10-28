const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { createTestDatabase, TEST_STORAGE } = require('../support/db-harness')
const { createStorage } = require('../../src/infrastructure/storage')
const { insertRow } = require('../../src/infrastructure/sql')
const repositories = require('../../src/infrastructure/repositories/tasks')

describe('repositórios de tarefas (Postgres)', () => {
  let t
  let storage
  let r
  let owner
  let member
  let outsider
  let type
  const status = {}
  let priorities

  before(async () => {
    t = await createTestDatabase()
    storage = createStorage(Object.assign({}, TEST_STORAGE, { bucket: `avanza-t-${crypto.randomBytes(4).toString('hex')}` }))
    await storage.ensureBucket()
    const ctx = { storage }
    r = {
      tasks: repositories.createTaskRepository(t.db, ctx),
      tags: repositories.createTaskTagRepository(t.db, ctx),
      values: repositories.createTaskValueRepository(t.db, ctx),
      comments: repositories.createCommentRepository(t.db, ctx),
      attachments: repositories.createAttachmentRepository(t.db, ctx),
      notifications: repositories.createNotificationRepository(t.db, ctx),
      sprints: repositories.createSprintRepository(t.db, ctx),
      milestones: repositories.createMilestoneRepository(t.db, ctx),
      relations: repositories.createRelationRepository(t.db, ctx),
    }
    const role = await t.db.one("SELECT id FROM roles WHERE code = 'ADMIN'")
    const user = (name) => insertRow(t.db, 'users', { email: `${name}@avanza.test`, name, role_id: role.id, status: 'active' })
    owner = await user('dono')
    member = await user('membro')
    outsider = await user('fora')
    type = await t.db.one('SELECT id FROM task_types ORDER BY "order" LIMIT 1')
    ;(await t.db.query('SELECT id, key FROM task_statuses')).forEach((row) => {
      status[row.key] = row.id
    })
    priorities = (await t.db.query('SELECT id FROM task_priorities ORDER BY "order"')).map((row) => row.id)
  })

  after(async () => {
    if (storage) await storage.dropBucket()
    if (t) await t.drop()
  })

  async function seedProject(options) {
    const opts = options || {}
    const key = `P${crypto.randomBytes(3).toString('hex').toUpperCase()}`
    const project = await insertRow(t.db, 'projects', { name: key, key, owner_id: owner.id, archived_at: opts.archived ? new Date() : null })
    await insertRow(t.db, 'project_members', { project_id: project.id, user_id: owner.id, role: 'owner' })
    if (opts.member !== false) await insertRow(t.db, 'project_members', { project_id: project.id, user_id: member.id, role: 'member' })
    return project
  }

  /** Cria a tarefa como o caso de uso: número na transação, código "CHAVE-n". */
  async function seedTask(project, data) {
    return t.db.transaction(async () => {
      const number = await r.tasks.nextNumber(project.id)
      return r.tasks.create(
        Object.assign(
          { projectId: project.id, number, code: `${project.key}-${number}`, title: `Tarefa ${number}`, typeId: type.id, statusId: status.BACKLOG, priorityId: priorities[2], creatorId: owner.id, position: number * 1024 },
          data,
        ),
      )
    })
  }

  const setCreated = (table, id, iso) => t.db.exec(`UPDATE ${table} SET created = $2 WHERE id = $1`, [id, new Date(iso)])
  const codes = (list) => list.map((task) => task.code)

  it('grava e lê a tarefa com as mesmas convenções do PocketBase', async () => {
    const project = await seedProject()
    const task = await seedTask(project, {
      description: 'Detalhes',
      assigneeId: null,
      reporterId: member.id,
      startDate: '2026-11-02',
      dueDate: new Date('2026-11-10T12:00:00.000Z'),
      estimatedHours: null,
      actualHours: 2.5,
      checklist: [{ text: 'a', done: false }],
    })
    assert.equal(task.number, 1)
    assert.equal(task.code, `${project.key}-1`)
    assert.equal(task.assigneeId, null)
    assert.equal(task.reporterId, member.id)
    assert.equal(task.sprintId, null)
    assert.equal(task.estimatedHours, null)
    assert.equal(task.actualHours, 2.5)
    assert.deepEqual(task.checklist, [{ text: 'a', done: false }])
    assert.deepEqual(task.startDate, new Date('2026-11-02T00:00:00.000Z'))
    assert.deepEqual(task.dueDate, new Date('2026-11-10T12:00:00.000Z'))
    assert.equal(task.completedAt, null)
    assert.ok(task.createdAt instanceof Date)
    assert.deepEqual(await r.tasks.findById(task.id), task)
    assert.equal(await r.tasks.findById('naoexiste123456'), null)

    // relação vazia vira NULL; horas nulas viram 0 (não informado)
    const raw = await t.db.one('SELECT reporter_id, estimated_hours, description FROM tasks WHERE id = $1', [task.id])
    assert.deepEqual(raw, { reporter_id: member.id, estimated_hours: 0, description: 'Detalhes' })
    const cleared = await r.tasks.update(task.id, { reporterId: null, dueDate: null, actualHours: null, description: null })
    assert.equal(cleared.reporterId, null)
    assert.equal(cleared.dueDate, null)
    assert.equal(cleared.actualHours, null)
    assert.equal(cleared.description, '')

    // gravar sem colunas próprias ainda renova "updated" (ordenação por atividade)
    await t.db.exec('SELECT pg_sleep(0.01)')
    const touched = await r.tasks.update(task.id, {})
    assert.ok(touched.updatedAt > cleared.updatedAt)
    await assert.rejects(r.tasks.update('naoexiste123456', { title: 'x' }), (err) => err.code === 'NOT_FOUND')
  })

  it('nextNumber: duas criações simultâneas no mesmo projeto não repetem o número', async () => {
    const project = await seedProject()
    await seedTask(project)
    const createOne = (pause) =>
      t.db.transaction(async () => {
        const number = await r.tasks.nextNumber(project.id)
        // sem a trava, a outra transação leria o mesmo MAX(number) nesse intervalo
        if (pause) await t.db.query('SELECT pg_sleep(0.15)')
        return r.tasks.create({ projectId: project.id, number, code: `${project.key}-${number}`, title: 'x', typeId: type.id, statusId: status.BACKLOG, priorityId: priorities[0] })
      })
    const created = await Promise.all([createOne(true), createOne(false), createOne(false)])
    assert.deepEqual(created.map((task) => task.number).sort(), [2, 3, 4])
    // a trava é do projeto: outro projeto numera em paralelo
    assert.equal((await seedTask(await seedProject())).number, 1)
  })

  describe('listagem geral', () => {
    let project
    let field
    let sprint
    let tag
    let list

    before(async () => {
      project = await seedProject()
      field = await insertRow(t.db, 'custom_fields', { name: `cliente_${crypto.randomBytes(3).toString('hex')}`, label: 'Cliente', type: 'text', searchable: true })
      sprint = await r.sprints.create({ projectId: project.id, name: 'S1', state: 'active', order: 1 })
      tag = await insertRow(t.db, 'tags', { name: 'urgente', name_key: `urgente_${crypto.randomBytes(3).toString('hex')}`, color: 'red' })
      list = [
        await seedTask(project, { title: 'Alpha 100% pronto', dueDate: '2026-11-10', priorityId: priorities[2], statusId: status.DESENVOLVIMENTO, assigneeId: member.id }),
        await seedTask(project, { title: 'beta', priorityId: priorities[0], sprintId: sprint.id }),
        await seedTask(project, { title: 'Gamma', dueDate: '2026-11-05', priorityId: priorities[1], statusId: status.DESENVOLVIMENTO }),
        await seedTask(project, { title: 'delta 1000 pronto', priorityId: priorities[3], statusId: status.CONCLUIDO }),
      ]
      for (let i = 0; i < list.length; i++) await setCreated('tasks', list[i].id, `2026-10-0${i + 1}T00:00:00.000Z`)
      await r.tags.replace(list[2].id, [tag.id])
      await r.values.replace(list[3].id, { [field.id]: 'Cliente ACME' }, { [field.id]: 'text' })
    })

    const query = (extra) =>
      Object.assign({ scope: { viewAll: true, userId: owner.id }, projectId: project.id, sort: [{ column: 'code', direction: 'ASC' }], pagination: { perPage: 50, offset: 0 } }, extra)
    const listed = async (extra) => {
      const result = await r.tasks.list(query(extra))
      return { codes: codes(result.items), total: result.total }
    }
    const nth = (...indexes) => indexes.map((i) => list[i].code)

    it('filtra por status, responsável, tag e sprint', async () => {
      assert.deepEqual(await listed({ statusIds: [status.DESENVOLVIMENTO] }), { codes: nth(0, 2), total: 2 })
      assert.deepEqual(await listed({ statusIds: [] }), { codes: [], total: 0 })
      assert.deepEqual(await listed({ assigneeId: member.id }), { codes: nth(0), total: 1 })
      assert.deepEqual(await listed({ tagId: tag.id }), { codes: nth(2), total: 1 })
      assert.deepEqual(await listed({ sprintId: sprint.id }), { codes: nth(1), total: 1 })
      assert.deepEqual(await listed({ sprintId: 'none' }), { codes: nth(0, 2, 3), total: 3 })
      assert.deepEqual(await listed({ priorityId: priorities[1], typeId: type.id }), { codes: nth(2), total: 1 })
    })

    it('respeita o escopo de quem não vê todos os projetos', async () => {
      assert.equal((await listed({ scope: { viewAll: false, userId: member.id } })).total, 4)
      assert.equal((await listed({ scope: { viewAll: false, userId: outsider.id } })).total, 0)
    })

    it('busca no título, no código e nos campos pesquisáveis (sem diferenciar maiúsculas; % é literal)', async () => {
      const search = (text, fieldIds) => listed({ search: { text, fieldIds: fieldIds || [] } })
      assert.deepEqual((await search('ALPHA')).codes, nth(0))
      assert.deepEqual((await search('100%')).codes, nth(0))
      assert.deepEqual((await search('_ pronto')).codes, [])
      assert.deepEqual((await search(list[1].code.toLowerCase())).codes, nth(1))
      assert.deepEqual((await search('acme')).codes, [])
      assert.deepEqual((await search('acme', [field.id])).codes, nth(3))
    })

    it('ordena (prazo vazio sempre no fim, prioridade pela ordem) e pagina com o total', async () => {
      assert.deepEqual((await listed({ sort: [{ column: 'due_date', direction: 'ASC' }] })).codes, nth(2, 0, 1, 3))
      assert.deepEqual((await listed({ sort: [{ column: 'due_date', direction: 'DESC' }] })).codes, nth(0, 2, 1, 3))
      assert.deepEqual((await listed({ sort: [{ column: 'priority', direction: 'ASC' }] })).codes, nth(1, 2, 0, 3))
      assert.deepEqual((await listed({ sort: [{ column: 'status', direction: 'DESC' }] })).codes, nth(3, 0, 2, 1))
      assert.deepEqual((await listed({ sort: [{ column: 'code', direction: 'DESC' }] })).codes, nth(3, 2, 1, 0))
      assert.deepEqual(await listed({ pagination: { perPage: 2, offset: 2 } }), { codes: nth(2, 3), total: 4 })
    })
  })

  it('quadro e backlog: consulta enxuta, ordem manual, encerradas mais recentes e renumeração', async () => {
    const project = await seedProject()
    const dev = status.DESENVOLVIMENTO
    const a = await seedTask(project, { statusId: dev, position: 3000, description: 'longa' })
    const b = await seedTask(project, { statusId: dev, position: 1000 })
    const c = await seedTask(project, { statusId: dev, position: 2000 })
    const done1 = await seedTask(project, { statusId: status.CONCLUIDO, completedAt: '2026-10-01T10:00:00Z' })
    const done2 = await seedTask(project, { statusId: status.CONCLUIDO, completedAt: '2026-10-05T10:00:00Z' })
    const doneNull = await seedTask(project, { statusId: status.CONCLUIDO })

    const open = await r.tasks.listForBoard(project.id, dev, { closed: false, limit: 50 })
    assert.deepEqual(codes(open), codes([b, c, a]))
    assert.equal(open[2].description, '')
    assert.equal(open[2].typeId, type.id)
    assert.deepEqual(Object.keys(open[2]).sort(), Object.keys(a).sort())
    assert.deepEqual(codes(await r.tasks.listForBoard(project.id, dev, { closed: false, limit: 2 })), codes([b, c]))
    assert.deepEqual(codes(await r.tasks.listForBoard(project.id, status.CONCLUIDO, { closed: true, limit: 50 })), codes([done2, done1, doneNull]))

    assert.deepEqual(await r.tasks.countByStatus(project.id), { [dev]: 3, [status.CONCLUIDO]: 3 })
    assert.equal(await r.tasks.maxPosition(project.id, dev), 3000)
    assert.equal(await r.tasks.maxPosition(project.id, status.ANALISE), null)

    await r.tasks.renumber(project.id, dev)
    assert.deepEqual((await r.tasks.listForBoard(project.id, dev, { closed: false, limit: 50 })).map((task) => [task.code, task.position]), [
      [b.code, 1024],
      [c.code, 2048],
      [a.code, 3072],
    ])

    const p1 = await seedTask(project, { statusId: status.BACKLOG, position: 500 })
    const p2 = await seedTask(project, { statusId: status.PRIORIZADO, position: 100 })
    const p3 = await seedTask(project, { statusId: status.BACKLOG, position: 900 })
    const backlogIds = [status.BACKLOG, status.PRIORIZADO]
    assert.deepEqual(codes(await r.tasks.listBacklog(project.id, backlogIds, 0)), codes([p2, p1, p3]))
    assert.deepEqual(codes(await r.tasks.listBacklog(project.id, backlogIds, 2)), codes([p2, p1]))
    assert.deepEqual(await r.tasks.listBacklog(project.id, [], 0), [])
    assert.equal(await r.tasks.maxPositionIn(project.id, backlogIds), 900)
    assert.equal(await r.tasks.maxPositionIn(project.id, [status.ANALISE]), null)
    await r.tasks.renumberMany(project.id, backlogIds)
    assert.deepEqual((await r.tasks.listBacklog(project.id, backlogIds, 0)).map((task) => task.position), [1024, 2048, 3072])
  })

  it('relatórios: linhas enxutas com escopo, arquivados e "sem responsável"', async () => {
    const active = await seedProject()
    const archived = await seedProject({ archived: true })
    const mine = await seedTask(active, { assigneeId: member.id, dueDate: '2026-12-01', startedAt: '2026-10-02T00:00:00Z' })
    const nobody = await seedTask(active, { priorityId: priorities[0] })
    const old = await seedTask(archived)
    const ids = (list) => list.map((row) => row.id).filter((id) => [mine.id, nobody.id, old.id].indexOf(id) >= 0).sort()

    const scoped = await r.tasks.listForReport({ scope: { viewAll: false, userId: member.id }, includeArchived: false })
    assert.deepEqual(ids(scoped), [mine.id, nobody.id].sort())
    assert.deepEqual(ids(await r.tasks.listForReport({ scope: { viewAll: true }, includeArchived: true })), [mine.id, nobody.id, old.id].sort())
    assert.deepEqual(ids(await r.tasks.listForReport({ scope: { viewAll: true }, includeArchived: false, projectId: active.id, assigneeId: 'none' })), [nobody.id])
    assert.deepEqual(ids(await r.tasks.listForReport({ scope: { viewAll: true }, projectId: active.id, priorityId: priorities[0], statusId: status.BACKLOG, typeId: type.id })), [nobody.id])
    const row = scoped.find((item) => item.id === mine.id)
    assert.deepEqual(row, {
      id: mine.id,
      projectId: active.id,
      typeId: type.id,
      statusId: status.BACKLOG,
      priorityId: priorities[2],
      assigneeId: member.id,
      createdAt: mine.createdAt,
      startedAt: new Date('2026-10-02T00:00:00Z'),
      completedAt: null,
      dueDate: new Date('2026-12-01T00:00:00Z'),
    })
  })

  it('subtarefas, forks, sprint e lembretes', async () => {
    const project = await seedProject()
    const parent = await seedTask(project)
    const child1 = await seedTask(project, { parentTaskId: parent.id, statusId: status.CONCLUIDO })
    const child2 = await seedTask(project, { parentTaskId: parent.id, dueDate: '2026-10-20', assigneeId: member.id, statusId: status.DESENVOLVIMENTO })
    const fork = await seedTask(project, { forkedFromTaskId: parent.id, dueDate: '2026-10-20' })
    assert.deepEqual(codes(await r.tasks.listChildren(parent.id)), codes([child1, child2]))
    assert.deepEqual(codes(await r.tasks.listForks(parent.id)), codes([fork]))
    assert.deepEqual(await r.tasks.subtaskStats([parent.id, child1.id], [status.CONCLUIDO]), { [parent.id]: { done: 1, total: 2 } })
    assert.deepEqual(await r.tasks.subtaskStats([], [status.CONCLUIDO]), {})

    const sprint = await r.sprints.create({ projectId: project.id, name: 'S', state: 'planned', order: 1 })
    await r.tasks.update(child2.id, { sprintId: sprint.id })
    assert.deepEqual(codes(await r.tasks.listBySprint(sprint.id)), codes([child2]))
    assert.deepEqual(codes(await r.tasks.listByProject(project.id, 2)), codes([parent, child1]))
    assert.equal((await r.tasks.listByProject(project.id, 0)).length, 4)
    assert.deepEqual(codes(await r.tasks.findManyByIds([fork.id, parent.id])).sort(), codes([parent, fork]).sort())

    const due = await r.tasks.listForReminders({ before: new Date('2026-10-21T00:00:00Z'), statusIds: [status.DESENVOLVIMENTO, status.BACKLOG] })
    assert.deepEqual(codes(due.filter((task) => task.projectId === project.id)), codes([child2]))
    assert.deepEqual(await r.tasks.listForReminders({ before: new Date(), statusIds: [] }), [])

    // excluir a sprint tira a sprint das tarefas (FK com SET NULL)
    await r.sprints.delete(sprint.id)
    assert.equal((await r.tasks.findById(child2.id)).sprintId, null)
  })

  it('tags e valores personalizados: substituição e leitura em lote, com as colunas de índice', async () => {
    const project = await seedProject()
    const [one, two] = [await seedTask(project), await seedTask(project)]
    const tags = []
    for (const name of ['x', 'y']) tags.push(await insertRow(t.db, 'tags', { name, name_key: `${name}_${crypto.randomBytes(3).toString('hex')}` }))
    await r.tags.replace(one.id, [tags[0].id, tags[1].id])
    await r.tags.replace(two.id, [tags[1].id])
    await r.tags.replace(one.id, [tags[0].id])
    assert.deepEqual(await r.tags.listByTasks([one.id, two.id]), { [one.id]: [tags[0].id], [two.id]: [tags[1].id] })
    await r.tags.replace(two.id, [])
    assert.deepEqual(await r.tags.listByTasks([two.id]), {})
    assert.deepEqual(await r.tags.listByTasks([]), {})

    const field = (name, fieldType) => insertRow(t.db, 'custom_fields', { name: `${name}_${crypto.randomBytes(3).toString('hex')}`, label: name, type: fieldType })
    const [num, when, multi, flag] = [await field('num', 'number'), await field('quando', 'date'), await field('multi', 'multiselect'), await field('flag', 'boolean')]
    const values = { [num.id]: 42.5, [when.id]: '2026-11-03', [multi.id]: ['a', 'b'], [flag.id]: true }
    const types = { [num.id]: 'number', [when.id]: 'date', [multi.id]: 'multiselect', [flag.id]: 'boolean' }
    await r.values.replace(one.id, values, types)
    assert.deepEqual(await r.values.listByTasks([one.id, two.id]), { [one.id]: values })
    const index = await t.db.query('SELECT field_id, value_text, value_number, value_date, value_bool FROM task_custom_values WHERE task_id = $1', [one.id])
    const byField = {}
    index.forEach((row) => {
      byField[row.field_id] = row
    })
    assert.deepEqual(byField[num.id], { field_id: num.id, value_text: '', value_number: 42.5, value_date: null, value_bool: false })
    assert.deepEqual(byField[when.id].value_date, new Date('2026-11-03T00:00:00Z'))
    assert.equal(byField[multi.id].value_text, 'a,b')
    assert.equal(byField[flag.id].value_bool, true)
    await r.values.replace(one.id, { [num.id]: 1 }, types)
    assert.deepEqual(await r.values.listByTasks([one.id]), { [one.id]: { [num.id]: 1 } })
  })

  it('comentários: ordem de criação, edição e contagem sem os excluídos', async () => {
    const project = await seedProject()
    const task = await seedTask(project)
    const first = await r.comments.create({ taskId: task.id, userId: owner.id, content: 'primeiro', mentions: [member.id] })
    const second = await r.comments.create({ taskId: task.id, userId: member.id, content: 'segundo' })
    await setCreated('comments', first.id, '2026-10-01T00:00:00Z')
    await setCreated('comments', second.id, '2026-10-02T00:00:00Z')
    assert.deepEqual(first.mentions, [member.id])
    assert.deepEqual(second.mentions, [])
    assert.equal(second.editedAt, null)
    assert.deepEqual((await r.comments.listByTask(task.id)).map((c) => c.content), ['primeiro', 'segundo'])

    const edited = await r.comments.update(second.id, { content: 'editado', editedAt: new Date('2026-10-03T00:00:00Z') })
    assert.equal(edited.content, 'editado')
    assert.deepEqual(edited.editedAt, new Date('2026-10-03T00:00:00Z'))
    assert.deepEqual(await r.comments.countByTasks([task.id]), { [task.id]: 2 })
    await r.comments.update(first.id, { deletedAt: new Date() })
    assert.deepEqual(await r.comments.countByTasks([task.id]), { [task.id]: 1 })
    assert.deepEqual(await r.comments.countByTasks([]), {})
    assert.equal((await r.comments.findById(first.id)).deletedAt instanceof Date, true)
  })

  it('anexos: arquivo no Storage, listagens, cópia para outra tarefa e lixeira ao excluir', async () => {
    const project = await seedProject()
    const task = await seedTask(project)
    const other = await seedTask(project)
    const comment = await r.comments.create({ taskId: task.id, userId: owner.id, content: 'com anexo' })
    const bytes = Buffer.from('conteúdo do relatório')
    const upload = (name, commentId) =>
      r.attachments.create({
        taskId: task.id,
        commentId,
        handle: { buffer: bytes, mime: 'text/plain', name, size: bytes.length },
        name,
        mime: 'text/plain',
        kind: 'file',
        size: bytes.length,
        uploadedBy: owner.id,
      })
    const file = await upload('Relatório Final.txt', null)
    const onComment = await upload('nota.txt', comment.id)
    assert.deepEqual(file, {
      id: file.id,
      taskId: task.id,
      name: 'Relatório Final.txt',
      mime: 'text/plain',
      kind: 'file',
      size: bytes.length,
      uploadedBy: owner.id,
      commentId: null,
      createdAt: file.createdAt,
    })
    const key = await r.attachments.fileKeyOf(file.id)
    assert.match(key, new RegExp(`^attachments/${file.id}/relatorio_final_[a-z0-9]{10}\\.txt$`))
    assert.deepEqual(await storage.read(key), bytes)
    await assert.rejects(r.attachments.fileKeyOf('naoexiste123456'), (err) => err.code === 'ATTACHMENT_NOT_FOUND')

    assert.deepEqual((await r.attachments.listByTask(task.id)).map((a) => a.id), [file.id])
    assert.deepEqual(await r.attachments.listByComments([comment.id]), { [comment.id]: [onComment] })
    assert.deepEqual(await r.attachments.countByTasks([task.id, other.id]), { [task.id]: 1 })
    assert.deepEqual((await r.attachments.findManyByIds([file.id, onComment.id])).map((a) => a.id).sort(), [file.id, onComment.id].sort())

    const copy = await r.attachments.copyTo(file.id, { taskId: other.id, uploadedBy: member.id })
    assert.notEqual(copy.id, file.id)
    assert.equal(copy.taskId, other.id)
    assert.equal(copy.uploadedBy, member.id)
    assert.equal(copy.name, file.name)
    assert.deepEqual(await storage.read(await r.attachments.fileKeyOf(copy.id)), bytes)

    // o repositório nunca apaga do Storage: o gatilho manda a chave para a lixeira
    await r.attachments.delete(file.id)
    await r.attachments.deleteByComment(comment.id)
    assert.equal(await r.attachments.findById(file.id), null)
    const trash = (await t.db.query('SELECT key FROM storage_trash')).map((row) => row.key)
    assert.ok(trash.indexOf(key) >= 0)
    assert.ok(trash.some((k) => k.indexOf(`attachments/${onComment.id}/`) === 0))
    assert.deepEqual(await storage.read(key), bytes)
  })

  it('notificações: chave de deduplicação (inclusive entre transações simultâneas), lidas e não lidas', async () => {
    const project = await seedProject()
    const task = await seedTask(project)
    const base = { userId: member.id, type: 'due_soon', taskId: task.id, actorId: owner.id, data: { code: task.code } }
    const first = await r.notifications.create(Object.assign({ dedupeKey: `due:${task.id}` }, base))
    assert.equal(first.dedupeKey, `due:${task.id}`)
    assert.deepEqual(first.data, { code: task.code })
    assert.equal(first.planItemId, null)
    assert.equal(first.readAt, null)
    assert.equal(await r.notifications.existsKey(member.id, `due:${task.id}`), true)
    assert.equal(await r.notifications.existsKey(owner.id, `due:${task.id}`), false)
    // mesma chave: nada novo, volta a que já existe
    assert.equal((await r.notifications.create(Object.assign({ dedupeKey: `due:${task.id}` }, base))).id, first.id)

    const createIn = (pause) =>
      t.db.transaction(async () => {
        const created = await r.notifications.create(Object.assign({ dedupeKey: `late:${task.id}` }, base))
        if (pause) await t.db.query('SELECT pg_sleep(0.15)')
        return created
      })
    const [a, b] = await Promise.all([createIn(true), createIn(false)])
    assert.equal(a.id, b.id)
    assert.deepEqual(await t.db.one('SELECT COUNT(*) AS n FROM notifications WHERE dedupe_key = $1', [`late:${task.id}`]), { n: 1 })

    // sem chave: nenhuma deduplicação
    const plain1 = await r.notifications.create(Object.assign({}, base, { type: 'assigned' }))
    const plain2 = await r.notifications.create(Object.assign({}, base, { type: 'assigned', data: null }))
    assert.notEqual(plain1.id, plain2.id)
    assert.deepEqual(plain2.data, {})
    await setCreated('notifications', first.id, '2026-10-01T00:00:00Z')
    await setCreated('notifications', a.id, '2026-10-02T00:00:00Z')
    await setCreated('notifications', plain1.id, '2026-10-03T00:00:00Z')
    await setCreated('notifications', plain2.id, '2026-10-04T00:00:00Z')

    const page = (unreadOnly, perPage, offset) => r.notifications.listByUser(member.id, { unreadOnly, pagination: { perPage, offset } })
    const all = await page(false, 2, 0)
    assert.deepEqual(all.items.map((n) => n.id), [plain2.id, plain1.id])
    assert.equal(all.total, 4)
    assert.equal(await r.notifications.countUnread(member.id), 4)

    const readAt = new Date('2026-10-05T00:00:00Z')
    await r.notifications.markRead(plain2.id, readAt)
    assert.deepEqual((await r.notifications.findById(plain2.id)).readAt, readAt)
    const unread = await page(true, 10, 0)
    assert.deepEqual(unread.items.map((n) => n.id), [plain1.id, a.id, first.id])
    assert.equal(unread.total, 3)
    assert.equal(await r.notifications.markAllRead(member.id, readAt), 3)
    assert.equal(await r.notifications.countUnread(member.id), 0)
    assert.equal(await r.notifications.markAllRead(member.id, readAt), 0)
  })

  it('sprints: encerradas por último, depois a ordem manual e a criação; datas como dia puro', async () => {
    const project = await seedProject()
    const s1 = await r.sprints.create({ projectId: project.id, name: 'S1', goal: '', state: 'planned', order: 2, startDate: '2026-11-01', endDate: '2026-11-14', createdBy: owner.id })
    const s2 = await r.sprints.create({ projectId: project.id, name: 'S2', state: 'active', order: 1 })
    const s3 = await r.sprints.create({ projectId: project.id, name: 'S3', state: 'closed', order: 0 })
    const s4 = await r.sprints.create({ projectId: project.id, name: 'S4', state: 'planned', order: 1 })
    await setCreated('sprints', s2.id, '2026-10-01T00:00:00Z')
    await setCreated('sprints', s4.id, '2026-10-02T00:00:00Z')
    assert.equal(s1.startDate, '2026-11-01')
    assert.equal(s1.endDate, '2026-11-14')
    assert.equal(s2.startDate, null)
    assert.equal(s2.createdBy, null)
    assert.equal(s2.goal, '')
    const names = (list) => list.map((s) => s.name)
    assert.deepEqual(names(await r.sprints.listByProject(project.id, { includeClosed: true })), ['S2', 'S4', 'S1', 'S3'])
    assert.deepEqual(names(await r.sprints.listByProject(project.id, { includeClosed: false })), ['S2', 'S4', 'S1'])

    const updated = await r.sprints.update(s1.id, { startDate: null, order: 5, goal: 'meta' })
    assert.equal(updated.startDate, null)
    assert.equal(updated.endDate, '2026-11-14')
    assert.equal(updated.order, 5)
    assert.equal(updated.goal, 'meta')
    assert.deepEqual(names(await r.sprints.findManyByIds([s3.id, s1.id])).sort(), ['S1', 'S3'])
    await r.sprints.delete(s3.id)
    assert.equal(await r.sprints.findById(s3.id), null)
  })

  it('marcos: pela data, empate pela criação', async () => {
    const project = await seedProject()
    const m1 = await r.milestones.create({ projectId: project.id, name: 'M1', dueDate: '2026-12-01', state: 'pending', createdBy: owner.id })
    const m2 = await r.milestones.create({ projectId: project.id, name: 'M2', dueDate: '2026-11-01', state: 'pending' })
    const m3 = await r.milestones.create({ projectId: project.id, name: 'M3', dueDate: '2026-11-01', state: 'done' })
    await setCreated('project_milestones', m2.id, '2026-10-01T00:00:00Z')
    await setCreated('project_milestones', m3.id, '2026-10-02T00:00:00Z')
    assert.equal(m1.dueDate, '2026-12-01')
    assert.equal(m1.description, '')
    assert.equal(m1.createdBy, owner.id)
    assert.deepEqual((await r.milestones.listByProject(project.id)).map((m) => m.name), ['M2', 'M3', 'M1'])
    const moved = await r.milestones.update(m1.id, { dueDate: '2026-10-15', description: 'antes' })
    assert.equal(moved.dueDate, '2026-10-15')
    assert.deepEqual((await r.milestones.listByProject(project.id)).map((m) => m.name), ['M1', 'M2', 'M3'])
    await r.milestones.delete(m3.id)
    assert.equal(await r.milestones.findById(m3.id), null)
  })

  it('relações: por tarefa, entre o par, precedência e bloqueios', async () => {
    const project = await seedProject()
    const [t1, t2, t3] = [await seedTask(project), await seedTask(project), await seedTask(project)]
    const blocks = await r.relations.create({ type: 'blocks', sourceId: t1.id, targetId: t2.id, createdBy: owner.id })
    const depends = await r.relations.create({ type: 'depends_on', sourceId: t3.id, targetId: t2.id })
    const related = await r.relations.create({ type: 'relates_to', sourceId: t2.id, targetId: t1.id })
    await setCreated('task_relations', blocks.id, '2026-10-01T00:00:00Z')
    await setCreated('task_relations', depends.id, '2026-10-02T00:00:00Z')
    await setCreated('task_relations', related.id, '2026-10-03T00:00:00Z')
    assert.deepEqual(blocks, { id: blocks.id, type: 'blocks', sourceId: t1.id, targetId: t2.id, createdBy: owner.id, createdAt: blocks.createdAt })
    assert.equal(depends.createdBy, null)

    const ids = (list) => list.map((rel) => rel.id)
    assert.deepEqual(ids(await r.relations.listByTask(t2.id)), [blocks.id, depends.id, related.id])
    assert.deepEqual(ids(await r.relations.listBetween(t2.id, t1.id)), [blocks.id, related.id])
    assert.deepEqual(ids(await r.relations.precedenceFrom([t1.id])), [blocks.id])
    assert.deepEqual(ids(await r.relations.precedenceFrom([t2.id])), [depends.id])
    assert.deepEqual(await r.relations.precedenceFrom([]), [])
    const blockers = await r.relations.blockersOf([t2.id, t3.id])
    assert.deepEqual(
      blockers.sort((x, y) => (x.taskId < y.taskId ? -1 : 1)),
      [{ taskId: t2.id, blockerId: t1.id }, { taskId: t3.id, blockerId: t2.id }].sort((x, y) => (x.taskId < y.taskId ? -1 : 1)),
    )
    await assert.rejects(r.relations.create({ type: 'blocks', sourceId: t1.id, targetId: t2.id }), (err) => err.code === 'RELATION_EXISTS')

    await r.relations.deleteByTask(t1.id)
    assert.deepEqual(ids(await r.relations.listByTask(t2.id)), [depends.id])
    await r.relations.delete(depends.id)
    assert.equal(await r.relations.findById(depends.id), null)
  })

  it('excluir a tarefa leva valores, tags, comentários, anexos e relações (cascata)', async () => {
    const project = await seedProject()
    const task = await seedTask(project)
    const other = await seedTask(project, { parentTaskId: task.id })
    const tag = await insertRow(t.db, 'tags', { name: 'z', name_key: `z_${crypto.randomBytes(3).toString('hex')}` })
    await r.tags.replace(task.id, [tag.id])
    await r.comments.create({ taskId: task.id, userId: owner.id, content: 'x' })
    await r.relations.create({ type: 'blocks', sourceId: task.id, targetId: other.id })
    await r.notifications.create({ userId: member.id, type: 'assigned', taskId: task.id })
    await r.tasks.delete(task.id)
    assert.equal(await r.tasks.findById(task.id), null)
    assert.equal((await r.tasks.findById(other.id)).parentTaskId, null)
    const [left] = await t.db.query(
      `SELECT (SELECT COUNT(*) FROM task_tag_relations WHERE task_id = $1) AS tags, (SELECT COUNT(*) FROM comments WHERE task_id = $1) AS comments,
              (SELECT COUNT(*) FROM task_relations WHERE source_task_id = $1) AS relations, (SELECT COUNT(*) FROM notifications WHERE task_id = $1) AS notifications`,
      [task.id],
    )
    assert.deepEqual(left, { tags: 0, comments: 0, relations: 0, notifications: 0 })
  })
})
