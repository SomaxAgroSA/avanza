const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { createStorage, encodeKey } = require('../../src/infrastructure/storage')
const { TEST_STORAGE } = require('../support/db-harness')

describe('Supabase Storage', () => {
  const storage = createStorage(Object.assign({}, TEST_STORAGE, { bucket: `avanza-t-${crypto.randomBytes(4).toString('hex')}` }))

  before(async () => {
    assert.equal(await storage.ensureBucket(), true)
    assert.equal(await storage.ensureBucket(), false)
  })
  after(() => storage.dropBucket())

  it('grava, lê (inteiro e por faixa) e apaga', async () => {
    const key = 'attachments/abc123/relatorio final.txt'
    await storage.put(key, Buffer.from('0123456789'), 'text/plain')
    assert.equal((await storage.read(key)).toString(), '0123456789')
    const part = await storage.get(key, 'bytes=2-4')
    assert.equal(part.status, 206)
    assert.equal(Buffer.from(await part.arrayBuffer()).toString(), '234')
    await storage.remove([key])
    assert.equal(await storage.get(key), null)
  })

  it('recusa chaves fora do formato (sem subir de pasta)', () => {
    assert.throws(() => encodeKey('attachments/abc/../../segredo'), /inválida/)
    assert.throws(() => encodeKey('../x/y'), /inválida/)
    assert.doesNotThrow(() => encodeKey('doc_files/abc123/imagem.png'))
  })
})
