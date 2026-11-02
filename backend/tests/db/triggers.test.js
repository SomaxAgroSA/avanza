const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { createTestDatabase } = require('../support/db-harness')
const { insertRow } = require('../../src/infrastructure/sql')
const { WATCHED } = require('../../src/domain/realtime')

describe('gatilhos', () => {
  let t
  let owner
  before(async () => {
    t = await createTestDatabase()
    const role = await t.db.one("SELECT id FROM roles WHERE code = 'ADMIN'")
    owner = await insertRow(t.db, 'users', { email: 'dono@avanza.test', name: 'Dono', role_id: role.id, status: 'active' })
  })
  after(() => t.drop())

  async function seedTask() {
    const key = `P${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    const project = await insertRow(t.db, 'projects', { name: 'P', key, owner_id: owner.id })
    const [type, status, priority] = await Promise.all([
      t.db.one('SELECT id FROM task_types LIMIT 1'),
      t.db.one('SELECT id FROM task_statuses LIMIT 1'),
      t.db.one('SELECT id FROM task_priorities LIMIT 1'),
    ])
    const task = await insertRow(t.db, 'tasks', { project_id: project.id, task_type_id: type.id, status_id: status.id, priority_id: priority.id, title: 'T', number: 1, code: `${key}-1` })
    return { project, task }
  }

  it('arquivos de registros apagados (inclusive em cascata) vão para a lixeira do Storage', async () => {
    const { project, task } = await seedTask()
    const attachment = await insertRow(t.db, 'attachments', { task_id: task.id, file: 'nota_abc123.pdf', name: 'nota.pdf' })
    await t.db.exec('DELETE FROM projects WHERE id = $1', [project.id])
    const trash = await t.db.query('SELECT key FROM storage_trash')
    assert.deepEqual(trash.map((row) => row.key), [`attachments/${attachment.id}/nota_abc123.pdf`])
  })

  it('a lixeira volta junto quando a transação é desfeita', async () => {
    const { task } = await seedTask()
    const attachment = await insertRow(t.db, 'attachments', { task_id: task.id, file: 'outro_def456.png', name: 'outro.png' })
    await assert.rejects(
      t.db.transaction(async (tx) => {
        await tx.exec('DELETE FROM attachments WHERE id = $1', [attachment.id])
        throw new Error('desfaz')
      }),
    )
    assert.equal(await t.db.one('SELECT key FROM storage_trash WHERE key LIKE $1', [`%${attachment.id}%`]), null)
  })

  it('trocar o logo manda o anterior para a lixeira', async () => {
    const settings = await t.db.one('SELECT id FROM platform_settings LIMIT 1')
    await t.db.exec("UPDATE platform_settings SET logo_light = 'logo_aaa.png' WHERE id = $1", [settings.id])
    await t.db.exec("UPDATE platform_settings SET logo_light = 'logo_bbb.png' WHERE id = $1", [settings.id])
    assert.ok(await t.db.one('SELECT key FROM storage_trash WHERE key = $1', [`platform_settings/${settings.id}/logo_aaa.png`]))
    assert.equal(await t.db.one('SELECT key FROM storage_trash WHERE key = $1', [`platform_settings/${settings.id}/logo_bbb.png`]), null)
  })

  it('toda tabela observada pelo tempo real tem o gatilho de aviso', async () => {
    const rows = await t.db.query(
      "SELECT c.relname AS table_name FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND g.tgname LIKE 'trg\\_%\\_realtime'",
      [t.schema],
    )
    const withTrigger = new Set(rows.map((row) => row.table_name))
    assert.deepEqual(WATCHED.filter((table) => !withTrigger.has(table)), [])
  })

    it('gravações nas tabelas observadas avisam o canal do tempo real depois do commit', async () => {
    const listener = await t.db.connect()
    const received = []
    listener.on('notification', (msg) => received.push(JSON.parse(msg.payload)))
    await listener.query(`LISTEN "realtime_${t.schema}"`)
    try {
      const { project, task } = await seedTask()
      await t.db.exec("UPDATE tags SET name = name WHERE false") // tabela não observada: nada
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.deepEqual(received.map((n) => n.collection), ['projects', 'tasks'])
      assert.deepEqual(received[1], { collection: 'tasks', action: 'create', id: task.id, projectId: project.id, taskId: null, itemId: null, userId: null })
      assert.equal(received[0].projectId, project.id)
    } finally {
      await listener.query(`UNLISTEN "realtime_${t.schema}"`)
      listener.release()
    }
  })
})
