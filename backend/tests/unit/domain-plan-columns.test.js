/**
 * Quadro do projeto — GP-5: colunas personalizadas (definição, valores e troca de tipo).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const cols = require('../../src/domain/plan-columns')

let seq = 0
const newId = () => `op${++seq}`

describe('domain/plan-columns — definição', () => {
  it('nome e tipo obrigatórios; tipos: texto, número, data, caixa, lista, pessoa e link', () => {
    assert.deepEqual(cols.COLUMN_TYPES, ['text', 'number', 'date', 'checkbox', 'dropdown', 'people', 'link'])
    assert.deepEqual(cols.columnInput({ name: ' Fornecedor ', type: 'text' }, false, newId), { issues: {}, data: { name: 'Fornecedor', type: 'text', settings: {} } })
    assert.deepEqual(cols.columnInput({}, false, newId).issues, { name: 'required', type: 'required' })
    assert.deepEqual(cols.columnInput({ name: 'x'.repeat(61), type: 'formula' }, false, newId).issues, { name: 'too_long', type: 'invalid_option' })
    assert.deepEqual(cols.columnInput({ name: 'Só o nome' }, true, newId), { issues: {}, data: { name: 'Só o nome' } })
  })

  it('lista: opções com nome e cor (as que já existem mantêm o id); número: unidade curta', () => {
    const { data } = cols.columnInput({ name: 'Fase', type: 'dropdown', settings: { options: [{ name: 'Piloto', color: 'blue' }, { id: 'keep', name: ' Produção ', color: 'green' }] } }, false, newId)
    assert.equal(data.settings.options.length, 2)
    assert.match(data.settings.options[0].id, /^op\d+$/)
    assert.deepEqual(data.settings.options[1], { id: 'keep', name: 'Produção', color: 'green' })
    assert.deepEqual(cols.columnInput({ name: 'F', type: 'dropdown', settings: { options: [{ name: 'A', color: 'blue' }, { name: 'a', color: 'red' }] } }, false, newId).issues, { settings: 'duplicate_option' })
    assert.deepEqual(cols.columnInput({ name: 'F', type: 'dropdown', settings: { options: [{ name: '', color: 'blue' }] } }, false, newId).issues, { settings: 'invalid_option' })
    assert.deepEqual(cols.columnInput({ name: 'Custo', type: 'number', settings: { unit: 'R$' } }, false, newId).data.settings, { unit: 'R$' })
    assert.deepEqual(cols.columnInput({ name: 'Custo', type: 'number', settings: { unit: 'muito longa' } }, false, newId).issues, { settings: 'too_long' })
  })
})

describe('domain/plan-columns — valores', () => {
  const dropdown = { id: 'c1', type: 'dropdown', settings: { options: [{ id: 'o1', name: 'Piloto', color: 'blue' }] } }
  const v = (column, raw) => cols.normalizeValue(column, raw)

  it('cada tipo valida e normaliza; null (ou vazio) limpa', () => {
    assert.deepEqual(v({ type: 'text' }, '  Acme  '), { value: 'Acme' })
    assert.deepEqual(v({ type: 'text' }, '   '), { value: null })
    assert.deepEqual(v({ type: 'text' }, 'x'.repeat(501)), { issue: 'too_long' })
    assert.deepEqual(v({ type: 'number' }, 12.345), { value: 12.35 })
    assert.deepEqual(v({ type: 'number' }, '12'), { issue: 'invalid_type' })
    assert.deepEqual(v({ type: 'number' }, 1e13), { issue: 'too_large' })
    assert.deepEqual(v({ type: 'date' }, '2026-10-01'), { value: '2026-10-01' })
    assert.deepEqual(v({ type: 'date' }, '01/10/2026'), { issue: 'invalid_date' })
    assert.deepEqual(v({ type: 'checkbox' }, true), { value: true })
    assert.deepEqual(v({ type: 'checkbox' }, 'sim'), { issue: 'invalid_type' })
    assert.deepEqual(v(dropdown, 'o1'), { value: 'o1' })
    assert.deepEqual(v(dropdown, 'o9'), { issue: 'invalid_option' })
    assert.deepEqual(v({ type: 'people' }, 'user_1'), { value: 'user_1' })
    assert.deepEqual(v({ type: 'link' }, ' https://acme.com/pedido?id=1 '), { value: 'https://acme.com/pedido?id=1' })
    assert.deepEqual(v({ type: 'link' }, 'javascript:alert(1)'), { issue: 'invalid_url' })
    assert.deepEqual(v({ type: 'link' }, null), { value: null })
  })

  it('valores do elemento: só os das colunas que existem', () => {
    assert.deepEqual(cols.presentValues({ c1: 'o1', gone: 'x' }, [dropdown]), { c1: 'o1' })
    assert.deepEqual(cols.presentValues(null, [dropdown]), {})
  })
})

describe('domain/plan-columns — alterar o tipo', () => {
  const convert = (from, to, values, extra) => cols.convertValues(Object.assign({ id: 'c', settings: {} }, from), Object.assign({ settings: {} }, to), values, Object.assign({ newId, nameOf: (id) => ({ u1: 'Ana' })[id] || null }, extra))

  it('texto ↔ número, texto → link e data quando dá; o que não converte se perde (e é contado)', () => {
    const r = convert({ type: 'text' }, { type: 'number' }, { a: '12,5', b: '7', c: 'abc' })
    assert.deepEqual(r.values, { a: 12.5, b: 7, c: null })
    assert.equal(r.lost, 1)
    assert.deepEqual(convert({ type: 'number' }, { type: 'text' }, { a: 3.5 }).values, { a: '3.5' })
    assert.deepEqual(convert({ type: 'text' }, { type: 'link' }, { a: 'https://x.com', b: 'site' }).values, { a: 'https://x.com', b: null })
    assert.deepEqual(convert({ type: 'text' }, { type: 'date' }, { a: '2026-10-01', b: '01/10/2026', c: 'amanhã' }).values, { a: '2026-10-01', b: '2026-10-01', c: null })
    assert.deepEqual(convert({ type: 'date' }, { type: 'text' }, { a: '2026-10-01' }).values, { a: '2026-10-01' })
    assert.equal(convert({ type: 'checkbox' }, { type: 'number' }, { a: true, b: false }).lost, 1)
  })

  it('para lista: os textos viram opções (sem repetir); de lista para texto fica o nome da opção; pessoa vira o nome', () => {
    const r = convert({ type: 'text' }, { type: 'dropdown' }, { a: 'Piloto', b: 'piloto', c: 'Produção' })
    assert.deepEqual(r.settings.options.map((o) => o.name), ['Piloto', 'Produção'])
    assert.equal(r.values.a, r.values.b)
    assert.equal(r.lost, 0)
    const back = convert({ type: 'dropdown', settings: r.settings }, { type: 'text' }, r.values)
    assert.deepEqual(back.values, { a: 'Piloto', b: 'Piloto', c: 'Produção' })
    assert.deepEqual(convert({ type: 'people' }, { type: 'text' }, { a: 'u1', b: 'u9' }).values, { a: 'Ana', b: null })
  })

  it('valores vazios não contam como perda', () => {
    assert.equal(convert({ type: 'text' }, { type: 'number' }, { a: null }).lost, 0)
  })
})
