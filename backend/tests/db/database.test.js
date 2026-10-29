const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { PERMISSIONS } = require('../../src/domain/permissions')
const { createTestDatabase } = require('../support/db-harness')
const { migrate } = require('../../src/infrastructure/migrate')
const { assertSchemaName } = require('../../src/infrastructure/database')

describe('migrations', () => {
  let t
  before(async () => {
    t = await createTestDatabase()
  })
  after(() => t.drop())

  it('criam as tabelas com RLS e os cadastros iniciais', async () => {
    const tables = await t.db.query('SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = $1', [t.schema])
    assert.ok(tables.length >= 47)
    assert.deepEqual(tables.filter((row) => !row.rowsecurity).map((row) => row.tablename), [])
    const [counts] = await t.db.query(
      'SELECT (SELECT count(*) FROM permissions) AS permissions, (SELECT count(*) FROM roles) AS roles, (SELECT count(*) FROM task_types) AS types',
    )
    assert.deepEqual(counts, { permissions: PERMISSIONS.length, roles: 5, types: 8 })
  })

  it('não reaplicam o que já rodou', async () => {
    assert.deepEqual(await migrate(t.db), [])
  })

  it('mantêm "updated" em dia e "created" distinto dentro da mesma transação', async () => {
    // a hora de cada gravação (clock_timestamp), não a do início da transação (now)
    await t.db.transaction(async (tx) => {
      await tx.exec("INSERT INTO tags (id, name, name_key, color) VALUES ('tagaaaaaaaaaaa1', 'a', 'tagaaaaaaaaaaa1', 'red')")
      await tx.exec('SELECT pg_sleep(0.01)')
      await tx.exec("INSERT INTO tags (id, name, name_key, color) VALUES ('tagaaaaaaaaaaa2', 'b', 'tagaaaaaaaaaaa2', 'red')")
    })
    const [first, second] = await t.db.query("SELECT created, updated FROM tags WHERE id LIKE 'tagaaaaaaaaaaa%' ORDER BY id")
    assert.ok(second.created > first.created)
    await t.db.exec('SELECT pg_sleep(0.01)')
    await t.db.exec("UPDATE tags SET name = 'c' WHERE id = 'tagaaaaaaaaaaa1'")
    const after = await t.db.one("SELECT created, updated FROM tags WHERE id = 'tagaaaaaaaaaaa1'")
    assert.ok(after.updated > first.updated)
    // milissegundos: a data que volta do JS é a mesma gravada
    assert.deepEqual(await t.db.one('SELECT count(*) AS n FROM tags WHERE created = $1', [after.created]), { n: 1 })
  })

  it('a API REST do Supabase (papéis anon/authenticated) não lê nem grava nada do esquema', async () => {
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(
        t.db.transaction(async (tx) => {
          await tx.exec(`SET LOCAL ROLE ${role}`)
          await tx.query(`SELECT id FROM "${t.schema}".users LIMIT 1`)
        }),
        (err) => err.code === '42501',
        role,
      )
    }
  })

  it('recusam nome de esquema fora do padrão', () => {
    assert.throws(() => assertSchemaName('avanza; DROP TABLE x'), /inválido/)
  })
})

describe('transações', () => {
  let t
  before(async () => {
    // uma conexão só: se uma leitura dentro da transação pedisse outra conexão, o teste travaria
    t = await createTestDatabase({ max: 1 })
  })
  after(() => t.drop())

  it('confirmam no fim e desfazem tudo num erro', async () => {
    await t.db.transaction((tx) => tx.exec("INSERT INTO tags (id, name, name_key, color) VALUES ('tagbbbbbbbbbbb1', 'ok', 'tagbbbbbbbbbbb1', 'red')"))
    await assert.rejects(
      t.db.transaction(async (tx) => {
        await tx.exec("INSERT INTO tags (id, name, name_key, color) VALUES ('tagbbbbbbbbbbb2', 'falha', 'tagbbbbbbbbbbb2', 'red')")
        throw new Error('falhou')
      }),
      /falhou/,
    )
    const rows = await t.db.query("SELECT id FROM tags WHERE id LIKE 'tagbbbbbbbbbbb%' ORDER BY id")
    assert.deepEqual(rows.map((row) => row.id), ['tagbbbbbbbbbbb1'])
  })

  it('consultas pelo banco dentro da transação usam a mesma conexão (e veem o que ela gravou)', async () => {
    const seen = await t.db.transaction(async (tx) => {
      await tx.exec("INSERT INTO tags (id, name, name_key, color) VALUES ('tagccccccccccc1', 'dentro', 'tagccccccccccc1', 'red')")
      return t.db.one("SELECT name FROM tags WHERE id = 'tagccccccccccc1'")
    })
    assert.deepEqual(seen, { name: 'dentro' })
  })

  it('aninhadas juntam-se à de fora', async () => {
    await assert.rejects(
      t.db.transaction(async () => {
        await t.db.transaction((inner) => inner.exec("INSERT INTO tags (id, name, name_key, color) VALUES ('tagddddddddddd1', 'x', 'tagddddddddddd1', 'red')"))
        throw new Error('desfaz a de dentro também')
      }),
    )
    assert.equal(await t.db.one("SELECT id FROM tags WHERE id = 'tagddddddddddd1'"), null)
  })
})
