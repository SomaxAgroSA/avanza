const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { createTestDatabase, TEST_STORAGE } = require('../support/db-harness')
const { createStorage, guardStorage } = require('../../src/infrastructure/storage')
const { emptyStorageTrash } = require('../../src/infrastructure/jobs')

describe('uploads e lixeira do Storage', () => {
  let t
  let storage
  let guarded
  before(async () => {
    t = await createTestDatabase()
    storage = createStorage(Object.assign({}, TEST_STORAGE, { bucket: `avanza-t-${crypto.randomBytes(4).toString('hex')}` }))
    await storage.ensureBucket()
    guarded = guardStorage(storage, t.db)
  })
  after(async () => {
    await storage.dropBucket()
    await t.drop()
  })

  const trash = async () => (await t.db.query('SELECT "key" FROM storage_trash ORDER BY "key"')).map((row) => row.key)

  it('upload numa transação confirmada fica (e sai da lixeira)', async () => {
    await t.db.transaction(() => guarded.put('attachments/ok1/a.txt', Buffer.from('a'), 'text/plain'))
    assert.deepEqual(await trash(), [])
    assert.equal((await storage.read('attachments/ok1/a.txt')).toString(), 'a')
  })

  it('upload numa transação desfeita fica na lixeira e a rotina apaga o arquivo', async () => {
    await assert.rejects(
      t.db.transaction(async () => {
        await guarded.put('attachments/falha1/b.txt', Buffer.from('b'), 'text/plain')
        throw new Error('a gravação falhou depois do upload')
      }),
    )
    assert.deepEqual(await trash(), ['attachments/falha1/b.txt'])
    const runtime = { db: t.db, storage }
    // com menos de 10 min, a rotina ainda não mexe (a transação poderia estar aberta)
    assert.deepEqual(await emptyStorageTrash(runtime), { removed: 0 })
    assert.deepEqual(await emptyStorageTrash(runtime, 0), { removed: 1 })
    assert.deepEqual(await trash(), [])
    assert.equal(await storage.get('attachments/falha1/b.txt'), null)
  })
})
