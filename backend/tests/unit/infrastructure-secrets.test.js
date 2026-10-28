const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { createSecrets } = require('../../src/infrastructure/secrets')
const { createCrypto } = require('../../src/infrastructure/adapters')

describe('segredos', () => {
  it('cifram e decifram com a chave do servidor (IV novo a cada vez)', () => {
    const secrets = createSecrets('chave-do-servidor')
    const a = secrets.encrypt('senha SMTP ç')
    assert.notEqual(a, secrets.encrypt('senha SMTP ç'))
    assert.ok(a.startsWith('v1:'))
    assert.equal(secrets.decrypt(a), 'senha SMTP ç')
    assert.equal(secrets.encrypt(''), '')
    assert.equal(secrets.decrypt(''), '')
  })

  it('outra chave (ou valor adulterado) não abre', () => {
    const value = createSecrets('chave-a').encrypt('segredo')
    assert.throws(() => createSecrets('chave-b').decrypt(value))
    const parts = value.split(':')
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA')
    assert.throws(() => createSecrets('chave-a').decrypt(parts.join(':')))
  })
})

describe('HMAC dos webhooks', () => {
  it('sai em hexadecimal, como o $security.hs256 do PocketBase (vetor conhecido)', () => {
    assert.equal(
      createCrypto().hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog'),
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    )
  })
})
