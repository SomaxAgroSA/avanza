const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const locale = require('../../src/domain/content-locale')

describe('domain/content-locale — cadastros traduzidos', () => {
  it('idioma da requisição: primeiro suportado do Accept-Language; padrão pt-BR', () => {
    assert.equal(locale.resolveLocale('es-ES,es;q=0.9,en;q=0.8'), 'es')
    assert.equal(locale.resolveLocale('en-US'), 'en')
    assert.equal(locale.resolveLocale('pt-BR'), 'pt-BR')
    assert.equal(locale.resolveLocale('pt'), 'pt-BR')
    assert.equal(locale.resolveLocale('fr-FR,de;q=0.5'), 'pt-BR')
    assert.equal(locale.resolveLocale(''), 'pt-BR')
    assert.equal(locale.resolveLocale(undefined), 'pt-BR')
  })

  it('texto no idioma, com o original (pt-BR) quando falta a tradução', () => {
    const type = { name: 'Documentação', description: 'Manuais, guias e registros', translations: { es: { name: 'Documentación' }, en: { name: 'Documentation', description: 'Manuals, guides and records' } } }
    assert.deepEqual(locale.localize(type, 'es', ['name', 'description']), { name: 'Documentación', description: 'Manuais, guias e registros' })
    assert.deepEqual(locale.localize(type, 'en', ['name', 'description']), { name: 'Documentation', description: 'Manuals, guides and records' })
    assert.deepEqual(locale.localize(type, 'pt-BR', ['name', 'description']), { name: 'Documentação', description: 'Manuais, guias e registros' })
    assert.deepEqual(locale.localize({ name: 'Bug', description: '' }, 'es', ['name', 'description']), { name: 'Bug', description: '' })
  })

  it('todas as versões para edição: original em pt-BR + en/es (vazio = usa o original)', () => {
    const type = { name: 'Suporte', description: 'Atendimento', translations: { es: { name: 'Soporte' } } }
    assert.deepEqual(locale.allVersions(type, ['name', 'description']), {
      'pt-BR': { name: 'Suporte', description: 'Atendimento' },
      en: { name: '', description: '' },
      es: { name: 'Soporte', description: '' },
    })
  })

  it('valida as traduções: só en/es, só os campos traduzíveis, textos aparados e limitados; vazios somem', () => {
    const limits = { name: 60, description: 255 }
    assert.deepEqual(locale.normalizeTranslations({ es: { name: '  Soporte ', description: '' }, en: { name: '' } }, limits), { value: { es: { name: 'Soporte' } } })
    assert.deepEqual(locale.normalizeTranslations(undefined, limits), { value: {} })
    assert.deepEqual(locale.normalizeTranslations({ fr: { name: 'Support' } }, limits), { error: 'invalid_locale' })
    assert.deepEqual(locale.normalizeTranslations({ es: { name: 'x'.repeat(61) } }, limits), { error: 'too_long' })
    assert.deepEqual(locale.normalizeTranslations({ es: { color: 'red' } }, limits), { error: 'invalid_type' })
    assert.deepEqual(locale.normalizeTranslations('es', limits), { error: 'invalid_type' })
    assert.deepEqual(locale.normalizeTranslations({ es: { name: 5 } }, limits), { error: 'invalid_type' })
  })
})
