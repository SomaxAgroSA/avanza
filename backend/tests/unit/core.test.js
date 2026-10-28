const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { appError, isAppError, toErrorPayload } = require('../../src/core/errors')
const { success, failure } = require('../../src/core/response')
const { validate, rules } = require('../../src/core/validation')
const { parsePagination, parseSort, buildPageMeta } = require('../../src/core/pagination')

describe('core/errors', () => {
  it('cria erro de aplicação com código, status e detalhes', () => {
    const err = appError('ROLE_NOT_FOUND', undefined, { id: 'x' })
    assert.equal(isAppError(err), true)
    assert.equal(err.code, 'ROLE_NOT_FOUND')
    assert.equal(err.status, 404)
    assert.deepEqual(err.details, { id: 'x' })
    assert.ok(err.message.length > 0)
  })

  it('código desconhecido vira INTERNAL_ERROR (500)', () => {
    const err = appError('WHATEVER')
    assert.equal(err.code, 'INTERNAL_ERROR')
    assert.equal(err.status, 500)
  })

  it('erros inesperados não vazam mensagem interna', () => {
    const payload = toErrorPayload(new Error('sql: connection refused at 10.0.0.1'))
    assert.equal(payload.status, 500)
    assert.equal(payload.error.code, 'INTERNAL_ERROR')
    assert.ok(!payload.error.message.includes('10.0.0.1'))
  })

  it('erros de aplicação preservam código e detalhes', () => {
    const payload = toErrorPayload(appError('VALIDATION_ERROR', 'Dados inválidos', { fields: { email: 'required' } }))
    assert.equal(payload.status, 400)
    assert.deepEqual(payload.error, {
      code: 'VALIDATION_ERROR',
      message: 'Dados inválidos',
      details: { fields: { email: 'required' } },
    })
  })
})

describe('core/response', () => {
  it('envelope de sucesso', () => {
    assert.deepEqual(success({ id: 1 }, { total: 1 }), { data: { id: 1 }, meta: { total: 1 }, error: null })
  })

  it('envelope de sucesso sem dados usa null', () => {
    assert.deepEqual(success(), { data: null, meta: {}, error: null })
  })

  it('envelope de erro', () => {
    const body = failure({ code: 'X', message: 'm', details: {} }, { correlationId: 'c1' })
    assert.deepEqual(body, { data: null, meta: { correlationId: 'c1' }, error: { code: 'X', message: 'm', details: {} } })
  })
})

describe('core/validation', () => {
  it('retorna valores normalizados quando válido', () => {
    const result = validate(
      { email: '  Ana@Example.com ', name: ' Ana ' },
      {
        email: [rules.required(), rules.email()],
        name: [rules.required(), rules.maxLength(10)],
      },
    )
    assert.deepEqual(result.errors, {})
    assert.equal(result.value.email, 'Ana@Example.com')
    assert.equal(result.value.name, 'Ana')
  })

  it('acumula o primeiro erro de cada campo', () => {
    const result = validate(
      { email: 'invalido', name: '' },
      { email: [rules.required(), rules.email()], name: [rules.required()] },
    )
    assert.deepEqual(result.errors, { email: 'invalid_email', name: 'required' })
  })

  it('campos opcionais ausentes não são validados', () => {
    const result = validate({}, { description: [rules.maxLength(5)] })
    assert.deepEqual(result.errors, {})
    assert.equal('description' in result.value, false)
  })

  it('valida tamanho mínimo, enum, boolean e lista de strings', () => {
    const result = validate(
      { password: 'abc', status: 'x', remember: 'sim', codes: ['a', 1] },
      {
        password: [rules.minLength(10)],
        status: [rules.oneOf(['active', 'disabled'])],
        remember: [rules.boolean()],
        codes: [rules.stringArray()],
      },
    )
    assert.deepEqual(result.errors, {
      password: 'too_short',
      status: 'invalid_option',
      remember: 'invalid_type',
      codes: 'invalid_type',
    })
  })

  it('isoDate aceita datas ISO 8601 e rejeita o resto', () => {
    const ok = validate({ a: '2026-02-01', b: '2026-02-01T10:30:00Z' }, { a: [rules.isoDate()], b: [rules.isoDate()] })
    assert.deepEqual(ok.errors, {})
    assert.equal(ok.value.a.toISOString(), '2026-02-01T00:00:00.000Z')
    const bad = validate({ a: 'ontem', b: '2026-13-45' }, { a: [rules.isoDate()], b: [rules.isoDate()] })
    assert.deepEqual(bad.errors, { a: 'invalid_date', b: 'invalid_date' })
  })

  it('assertValid lança VALIDATION_ERROR com os campos', () => {
    const { assertValid } = require('../../src/core/validation')
    assert.throws(
      () => assertValid({}, { email: [rules.required()] }),
      (err) => err.code === 'VALIDATION_ERROR' && err.details.fields.email === 'required',
    )
  })
})

describe('core/pagination', () => {
  it('usa padrões e limita perPage', () => {
    assert.deepEqual(parsePagination({}), { page: 1, perPage: 20, offset: 0 })
    assert.deepEqual(parsePagination({ page: '3', perPage: '500' }), { page: 3, perPage: 100, offset: 200 })
    assert.deepEqual(parsePagination({ page: '-1', perPage: 'abc' }), { page: 1, perPage: 20, offset: 0 })
  })

  it('converte sort apenas para campos permitidos', () => {
    const allowed = { name: 'name', created_at: 'created' }
    assert.deepEqual(parseSort('-created_at', allowed, 'name'), [{ column: 'created', direction: 'DESC' }])
    assert.deepEqual(parseSort('name,-created_at', allowed, 'name'), [
      { column: 'name', direction: 'ASC' },
      { column: 'created', direction: 'DESC' },
    ])
    assert.deepEqual(parseSort('password', allowed, 'name'), [{ column: 'name', direction: 'ASC' }])
    assert.deepEqual(parseSort('name; DROP TABLE users', allowed, 'name'), [{ column: 'name', direction: 'ASC' }])
  })

  it('monta meta de paginação', () => {
    assert.deepEqual(buildPageMeta({ page: 2, perPage: 10 }, 35), { page: 2, perPage: 10, total: 35, totalPages: 4 })
    assert.deepEqual(buildPageMeta({ page: 1, perPage: 10 }, 0), { page: 1, perPage: 10, total: 0, totalPages: 0 })
  })
})
