const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const cf = require('../../src/domain/custom-field')

describe('domain/custom-field — catálogo de tipos', () => {
  it('suporta todos os tipos da diretriz', () => {
    assert.deepEqual(cf.FIELD_TYPES.slice().sort(), [
      'boolean', 'date', 'datetime', 'decimal', 'email', 'file', 'image', 'multiselect', 'number',
      'phone', 'project', 'select', 'text', 'textarea', 'url', 'user', 'users',
    ])
  })

  it('declara o que cada tipo permite', () => {
    assert.equal(cf.typeInfo('select').options, true)
    assert.equal(cf.typeInfo('text').options, false)
    assert.equal(cf.typeInfo('text').searchable, true)
    assert.equal(cf.typeInfo('select').searchable, false)
    assert.equal(cf.typeInfo('multiselect').sortable, false)
    assert.equal(cf.typeInfo('date').sortable, true)
    assert.equal(cf.typeInfo('file').defaultValue, false)
    assert.equal(cf.typeInfo('textarea').filterable, false)
  })
})

describe('domain/custom-field — nome técnico', () => {
  it('gera nome a partir do rótulo', () => {
    assert.equal(cf.slugifyName('Passos para reprodução'), 'passos_para_reproducao')
    assert.equal(cf.slugifyName('  Versão alvo!! '), 'versao_alvo')
    assert.equal(cf.slugifyName('123 Cliente'), 'cliente')
  })

  it('valida o nome técnico', () => {
    assert.equal(cf.nameIssue('severidade'), null)
    assert.equal(cf.nameIssue('Severidade'), 'invalid_format')
    assert.equal(cf.nameIssue('1abc'), 'invalid_format')
    assert.equal(cf.nameIssue('a'), 'invalid_format')
  })
})

describe('domain/custom-field — configuração por tipo', () => {
  it('aplica padrões e limites', () => {
    assert.deepEqual(cf.normalizeConfig('text', {}), { value: { max_length: 255 } })
    assert.deepEqual(cf.normalizeConfig('decimal', { decimals: 2, min: 0 }), { value: { decimals: 2, min: 0 } })
    assert.deepEqual(cf.normalizeConfig('boolean', { max_length: 3 }), { value: {} })
  })

  it('rejeita configurações inválidas', () => {
    assert.equal(cf.normalizeConfig('text', { max_length: 1000 }).error, 'max_length')
    assert.equal(cf.normalizeConfig('number', { min: 10, max: 1 }).error, 'min_greater_than_max')
    assert.equal(cf.normalizeConfig('decimal', { decimals: 9 }).error, 'decimals')
  })

  it('"permitir adicionar opções pela tarefa" só em seleção (desligado não é gravado)', () => {
    assert.deepEqual(cf.normalizeConfig('select', { allow_create_options: true }), { value: { allow_create_options: true } })
    assert.deepEqual(cf.normalizeConfig('multiselect', { allow_create_options: true }), { value: { allow_create_options: true } })
    assert.deepEqual(cf.normalizeConfig('select', { allow_create_options: false }), { value: {} })
    assert.deepEqual(cf.normalizeConfig('multiselect', {}), { value: {} })
    assert.equal(cf.normalizeConfig('select', { allow_create_options: 'sim' }).error, 'allow_create_options')
    assert.equal(cf.normalizeConfig('text', { allow_create_options: true }).error, 'allow_create_options')
    // desligado num tipo sem opções é só descartado
    assert.deepEqual(cf.normalizeConfig('boolean', { allow_create_options: false }), { value: {} })
  })

  it('aceita opções novas só em seleção com a configuração ligada', () => {
    assert.equal(cf.acceptsNewOptions({ type: 'select', config: { allow_create_options: true } }), true)
    assert.equal(cf.acceptsNewOptions({ type: 'multiselect', config: { allow_create_options: true } }), true)
    assert.equal(cf.acceptsNewOptions({ type: 'select', config: {} }), false)
    assert.equal(cf.acceptsNewOptions({ type: 'select', config: null }), false)
    assert.equal(cf.acceptsNewOptions({ type: 'text', config: { allow_create_options: true } }), false)
  })
})

describe('domain/custom-field — opções', () => {
  it('compara rótulos sem diferenciar maiúsculas, acentos e espaços repetidos', () => {
    assert.equal(cf.optionKey('  Crítica  Alta '), 'critica alta')
    assert.equal(cf.optionKey('CRITICA alta'), cf.optionKey('crítica   Alta'))
    assert.notEqual(cf.optionKey('Alta'), cf.optionKey('Alto'))
  })

  it('a opção nova recebe a cor seguinte à da última (a paleta recomeça no fim)', () => {
    assert.equal(cf.nextOptionColor('green'), 'teal')
    assert.equal(cf.nextOptionColor('pink'), 'gray')
    assert.equal(cf.nextOptionColor(null), 'gray')
    assert.equal(cf.nextOptionColor('roxo'), 'gray')
    assert.equal(cf.MAX_OPTION_LABEL, 60)
  })
})

describe('domain/custom-field — validação de valores', () => {
  const field = (type, config, options) => ({ type, config: config || cf.normalizeConfig(type, {}).value, options: options || [] })

  it('texto e área de texto respeitam tamanho', () => {
    assert.deepEqual(cf.validateValue(field('text', { max_length: 5 }), '  abc '), { value: 'abc' })
    assert.equal(cf.validateValue(field('text', { max_length: 5 }), 'abcdef').error, 'too_long')
    assert.equal(cf.validateValue(field('textarea'), 42).error, 'invalid_type')
  })

  it('números inteiros e decimais com limites e casas', () => {
    assert.deepEqual(cf.validateValue(field('number', { min: 1, max: 10 }), 5), { value: 5 })
    assert.equal(cf.validateValue(field('number', {}), 2.5).error, 'not_integer')
    assert.equal(cf.validateValue(field('number', { min: 1 }), 0).error, 'too_small')
    assert.deepEqual(cf.validateValue(field('decimal', { decimals: 2 }), '3.14159'), { value: 3.14 })
    assert.equal(cf.validateValue(field('decimal', { decimals: 2, max: 3 }), 3.5).error, 'too_large')
  })

  it('booleano, data e data/hora', () => {
    assert.deepEqual(cf.validateValue(field('boolean'), true), { value: true })
    assert.equal(cf.validateValue(field('boolean'), 'sim').error, 'invalid_type')
    assert.deepEqual(cf.validateValue(field('date'), '2026-02-28'), { value: '2026-02-28' })
    assert.equal(cf.validateValue(field('date'), '2026-02-30').error, 'invalid_date')
    assert.deepEqual(cf.validateValue(field('datetime'), '2026-02-28T10:30:00Z'), { value: '2026-02-28T10:30:00.000Z' })
  })

  it('seleção única e múltipla aceitam só opções ativas', () => {
    const options = [
      { id: 'o1', label: 'Alta', is_active: true },
      { id: 'o2', label: 'Baixa', is_active: false },
    ]
    assert.deepEqual(cf.validateValue(field('select', {}, options), 'o1'), { value: 'o1' })
    assert.equal(cf.validateValue(field('select', {}, options), 'o2').error, 'invalid_option')
    assert.deepEqual(cf.validateValue(field('multiselect', {}, options), ['o1', 'o1']), { value: ['o1'] })
    assert.equal(cf.validateValue(field('multiselect', {}, options), ['o1', 'x']).error, 'invalid_option')
  })

  it('url, e-mail e telefone', () => {
    assert.deepEqual(cf.validateValue(field('url'), 'https://kamban.dev/x'), { value: 'https://kamban.dev/x' })
    assert.equal(cf.validateValue(field('url'), 'javascript:alert(1)').error, 'invalid_url')
    assert.equal(cf.validateValue(field('email'), 'x@').error, 'invalid_email')
    assert.deepEqual(cf.validateValue(field('phone'), '+55 (11) 99999-0000'), { value: '+55 (11) 99999-0000' })
    assert.equal(cf.validateValue(field('phone'), 'abc').error, 'invalid_phone')
  })

  it('usuários e projeto validam formato de ID (existência é checada na tarefa)', () => {
    assert.deepEqual(cf.validateValue(field('user'), 'abc123'), { value: 'abc123' })
    assert.deepEqual(cf.validateValue(field('users'), ['a1', 'a1', 'b2']), { value: ['a1', 'b2'] })
    assert.equal(cf.validateValue(field('project'), 12).error, 'invalid_type')
  })

  it('vazio vira null', () => {
    assert.deepEqual(cf.validateValue(field('text'), ''), { value: null })
    assert.deepEqual(cf.validateValue(field('multiselect'), []), { value: null })
    assert.deepEqual(cf.validateValue(field('number'), null), { value: null })
  })
})

describe('domain/task-type', () => {
  it('normaliza e valida a chave do tipo', () => {
    assert.equal(cf.normalizeTypeKey(' nova funcionalidade '), 'NOVA_FUNCIONALIDADE')
    assert.equal(cf.typeKeyIssue('BUG'), null)
    assert.equal(cf.typeKeyIssue('B'), 'invalid_format')
    assert.equal(cf.typeKeyIssue('1BUG'), 'invalid_format')
  })
})
