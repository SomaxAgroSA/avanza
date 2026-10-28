const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { parseEnv } = require('../../scripts/env')

describe('scripts/env — leitura do backend/.env', () => {
  it('lê CHAVE=valor, ignora comentários e tira aspas', () => {
    const vars = parseEnv(['# comentário', 'KAMBAN_ENV=production', 'KAMBAN_HTTP = 0.0.0.0:8090 ', 'KAMBAN_ADMIN_NAME="Ana Souza"', "KAMBAN_X='a=b'", 'inválida', ''].join('\n'))
    assert.deepEqual(vars, { KAMBAN_ENV: 'production', KAMBAN_HTTP: '0.0.0.0:8090', KAMBAN_ADMIN_NAME: 'Ana Souza', KAMBAN_X: 'a=b' })
  })
})
