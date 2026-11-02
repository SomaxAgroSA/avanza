const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const realtime = require('../../src/domain/realtime')

describe('domain/realtime — tópicos', () => {
  it('tópicos do projeto e da pessoa; o resto não é aceito', () => {
    assert.equal(realtime.projectTopic('abc123'), 'project:abc123')
    assert.equal(realtime.userTopic('u1'), 'user:u1')
    assert.deepEqual(realtime.parseTopic('project:abc123'), { kind: 'project', id: 'abc123' })
    assert.deepEqual(realtime.parseTopic('user:u1'), { kind: 'user', id: 'u1' })
    assert.equal(realtime.parseTopic('tasks'), null)
    assert.equal(realtime.parseTopic('tasks/*'), null)
    assert.equal(realtime.parseTopic('project:'), null)
    assert.equal(realtime.parseTopic('project:../x'), null)
    assert.equal(realtime.parseTopic('project:a?options={}'), null)
  })

  it('no máximo 50 tópicos por conexão, sem repetidos', () => {
    assert.deepEqual(realtime.normalizeTopics(['project:a', 'project:a', 'user:u']), ['project:a', 'user:u'])
    assert.equal(realtime.normalizeTopics(Array.from({ length: 60 }, (_, i) => `project:p${i}`)).length, 50)
  })
})

describe('domain/realtime — eventos', () => {
  it('evento só com identificadores (quem recebe busca de novo pela API, com as permissões)', () => {
    assert.deepEqual(realtime.buildEvent({ collection: 'tasks', action: 'update', id: 't1', projectId: 'p1' }), {
      topic: 'project:p1',
      payload: { collection: 'tasks', action: 'update', id: 't1', project_id: 'p1', task_id: 't1', item_id: null },
    })
    assert.deepEqual(realtime.buildEvent({ collection: 'comments', action: 'create', id: 'c1', projectId: 'p1', taskId: 't1' }).payload.task_id, 't1')
    assert.deepEqual(realtime.buildEvent({ collection: 'plan_item_updates', action: 'create', id: 'u1', projectId: 'p1', itemId: 'i1' }).payload.item_id, 'i1')
    assert.deepEqual(realtime.buildEvent({ collection: 'notifications', action: 'create', id: 'n1', userId: 'u9' }), {
      topic: 'user:u9',
      payload: { collection: 'notifications', action: 'create', id: 'n1', project_id: null, task_id: null, item_id: null },
    })
    // sem destino conhecido: não há evento
    assert.equal(realtime.buildEvent({ collection: 'tasks', action: 'update', id: 't1' }), null)
    assert.equal(realtime.buildEvent({ collection: 'audit_logs', action: 'create', id: 'a1', projectId: 'p1' }), null)
  })

  it('coleções acompanhadas: tarefas, quadro do projeto, gestão, sprints, marcos, projeto e notificações', () => {
    ;['tasks', 'comments', 'attachments', 'task_relations', 'sprints', 'project_milestones', 'project_charters', 'charter_items', 'charter_measurements', 'projects', 'project_members', 'project_groups', 'plan_items', 'plan_item_updates', 'plan_journal', 'plan_issues', 'plan_columns', 'notifications'].forEach((c) =>
      assert.ok(realtime.WATCHED.includes(c), c),
    )
    assert.equal(realtime.WATCHED.includes('sessions'), false)
    assert.equal(realtime.WATCHED.includes('audit_logs'), false)
  })
})
