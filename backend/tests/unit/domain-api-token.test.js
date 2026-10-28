const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const apiToken = require('../../src/domain/api-token')

describe('domain/api-token', () => {
  it('formato kb_pat_ + 40 caracteres; o prefixo mostrado identifica sem revelar', () => {
    const value = apiToken.tokenValue('a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0')
    assert.equal(value, 'kb_pat_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0')
    assert.equal(apiToken.looksLikeToken(value), true)
    assert.equal(apiToken.looksLikeToken('kb_pat_curto'), false)
    assert.equal(apiToken.looksLikeToken('Bearer x'), false)
    assert.equal(apiToken.displayPrefix(value), 'kb_pat_a1B2')
  })

  it('nome obrigatório (até 80) e prazo da lista: 30, 90, 365 dias ou sem prazo', () => {
    assert.deepEqual(apiToken.tokenInput({ name: ' Integração BI ', expires_in_days: 90 }), { values: { name: 'Integração BI', expiresInDays: 90 }, fields: {} })
    assert.deepEqual(apiToken.tokenInput({ name: 'x', expires_in_days: 0 }).values.expiresInDays, 0)
    assert.deepEqual(apiToken.tokenInput({ name: '', expires_in_days: 45 }).fields, { name: 'required', expires_in_days: 'invalid_option' })
    assert.deepEqual(apiToken.tokenInput({ name: 'x'.repeat(81) }).fields, { name: 'too_long', expires_in_days: 'required' })
  })

  it('situação: revogado, vencido ou ativo; prazo em dias corridos', () => {
    const now = new Date('2026-10-01T12:00:00Z')
    assert.equal(apiToken.expiresAt(30, now).toISOString(), '2026-10-31T12:00:00.000Z')
    assert.equal(apiToken.expiresAt(0, now), null)
    assert.equal(apiToken.tokenState({ revokedAt: null, expiresAt: null }, now), 'active')
    assert.equal(apiToken.tokenState({ revokedAt: now, expiresAt: null }, now), 'revoked')
    assert.equal(apiToken.tokenState({ revokedAt: null, expiresAt: new Date('2026-09-30T00:00:00Z') }, now), 'expired')
  })

  it('"último uso" só é gravado a cada 5 minutos (evita uma escrita por requisição)', () => {
    const now = new Date('2026-10-01T12:00:00Z')
    assert.equal(apiToken.shouldTouch(null, now), true)
    assert.equal(apiToken.shouldTouch(new Date('2026-10-01T11:56:00Z'), now), false)
    assert.equal(apiToken.shouldTouch(new Date('2026-10-01T11:54:59Z'), now), true)
  })
})
