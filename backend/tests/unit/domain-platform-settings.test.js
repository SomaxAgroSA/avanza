const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const settings = require('../../src/domain/platform-settings')
const lockout = require('../../src/domain/lockout')
const user = require('../../src/domain/user')

describe('domain/platform-settings — valores e limites seguros', () => {
  it('padrões valem enquanto ninguém muda; valores guardados inválidos ou desconhecidos são ignorados', () => {
    assert.deepEqual(settings.normalizeSettings(null), settings.DEFAULTS)
    assert.equal(settings.DEFAULTS.audit_retention_months, 3)
    assert.equal(settings.DEFAULTS.lockout_threshold, 5)
    assert.equal(settings.DEFAULTS.password_min_length, 10)
    assert.equal(settings.DEFAULTS.platform_name, 'Avanza')
    const loaded = settings.normalizeSettings({ lockout_threshold: 8, password_min_length: 2, platform_name: '  ', extra: 1 })
    assert.equal(loaded.lockout_threshold, 8)
    assert.equal(loaded.password_min_length, 10)
    assert.equal(loaded.platform_name, 'Avanza')
    assert.equal('extra' in loaded, false)
  })

  it('valida a alteração parcial com limites: tentativas 3–20, minutos, senha 8–64, nome até 40, retenção da lista', () => {
    const current = settings.DEFAULTS
    const ok = settings.validateSettings({ lockout_threshold: 10, platform_name: '  Portal da Obra ', audit_retention_months: 0 }, current)
    assert.deepEqual(ok.fields, {})
    assert.equal(ok.values.lockout_threshold, 10)
    assert.equal(ok.values.platform_name, 'Portal da Obra')
    assert.equal(ok.values.audit_retention_months, 0)
    assert.equal(ok.values.password_min_length, 10)

    const bad = settings.validateSettings(
      {
        lockout_threshold: 2,
        lockout_base_minutes: 0,
        password_min_length: 100,
        platform_name: 'x'.repeat(41),
        audit_retention_months: 5,
        password_require_symbol: 'sim',
        unknown_key: true,
      },
      current,
    )
    assert.deepEqual(bad.fields, {
      lockout_threshold: 'too_small',
      lockout_base_minutes: 'too_small',
      password_min_length: 'too_large',
      platform_name: 'too_long',
      audit_retention_months: 'invalid_option',
      password_require_symbol: 'invalid_type',
      unknown_key: 'unknown_field',
    })
    assert.equal(settings.validateSettings({ lockout_threshold: 5.5 }, current).fields.lockout_threshold, 'invalid_type')
    assert.equal(settings.validateSettings({ platform_name: '   ' }, current).fields.platform_name, 'required')
  })

  it('o tempo máximo do bloqueio não pode ser menor que o inicial (considera o valor atual)', () => {
    const current = Object.assign({}, settings.DEFAULTS, { lockout_base_minutes: 30 })
    assert.equal(settings.validateSettings({ lockout_max_minutes: 20 }, current).fields.lockout_max_minutes, 'below_base')
    assert.deepEqual(settings.validateSettings({ lockout_base_minutes: 10, lockout_max_minutes: 20 }, current).fields, {})
  })

  it('diferença para o histórico só com o que mudou', () => {
    const before = settings.DEFAULTS
    const after = Object.assign({}, before, { lockout_threshold: 8, platform_name: 'Obra' })
    assert.deepEqual(settings.diffSettings(before, after), {
      old: { lockout_threshold: 5, platform_name: 'Avanza' },
      new: { lockout_threshold: 8, platform_name: 'Obra' },
    })
    assert.equal(settings.diffSettings(before, before), null)
  })
})

describe('domain/platform-settings — retenção do histórico', () => {
  it('corte em meses corridos (UTC); "manter sempre" não tem corte', () => {
    const now = new Date('2026-10-01T12:00:00Z')
    assert.equal(settings.retentionCutoff(3, now).toISOString(), '2026-07-01T12:00:00.000Z')
    assert.equal(settings.retentionCutoff(12, now).toISOString(), '2025-10-01T12:00:00.000Z')
    assert.equal(settings.retentionCutoff(0, now), null)
  })

  it('encurtar o prazo é qualquer mudança que apaga mais (manter sempre é o mais longo)', () => {
    assert.equal(settings.isShorterRetention(3, 1), true)
    assert.equal(settings.isShorterRetention(0, 24), true)
    assert.equal(settings.isShorterRetention(3, 6), false)
    assert.equal(settings.isShorterRetention(6, 0), false)
    assert.equal(settings.isShorterRetention(3, 3), false)
  })
})

describe('domain/platform-settings — política de senha e bloqueio', () => {
  it('política vem das configurações; letras e números são sempre exigidos', () => {
    const policy = settings.passwordPolicy(Object.assign({}, settings.DEFAULTS, { password_min_length: 12, password_require_mixed_case: true }))
    assert.deepEqual(policy, { min_length: 12, max_length: 72, require_letters_numbers: true, require_mixed_case: true, require_symbol: false })
  })

  it('senha conferida pela política: tamanho, letras e números, maiúsculas e minúsculas, símbolo', () => {
    const strict = settings.passwordPolicy(Object.assign({}, settings.DEFAULTS, { password_min_length: 12, password_require_mixed_case: true, password_require_symbol: true }))
    assert.equal(user.passwordIssue('curta1A!', strict), 'too_short')
    assert.equal(user.passwordIssue('somenteletrasAA!', strict), 'weak_password')
    assert.equal(user.passwordIssue('minusculas123!', strict), 'needs_mixed_case')
    assert.equal(user.passwordIssue('MaiusculaS1234', strict), 'needs_symbol')
    assert.equal(user.passwordIssue('MaiusculaS12#4', strict), null)
    // sem política: a regra de sempre (10 caracteres, letras e números)
    assert.equal(user.passwordIssue('senhaForte123'), null)
    assert.equal(user.passwordIssue('curta1'), 'too_short')
  })

  it('bloqueio usa a política configurada (tentativas, tempo inicial que dobra e teto)', () => {
    const policy = settings.lockoutPolicy(Object.assign({}, settings.DEFAULTS, { lockout_threshold: 3, lockout_base_minutes: 10, lockout_max_minutes: 30 }))
    assert.deepEqual(policy, { threshold: 3, baseMinutes: 10, maxMinutes: 30 })
    assert.equal(lockout.lockMinutes(2, policy), 0)
    assert.equal(lockout.lockMinutes(3, policy), 10)
    assert.equal(lockout.lockMinutes(6, policy), 20)
    assert.equal(lockout.lockMinutes(9, policy), 30)
    const last = new Date('2026-09-30T12:00:00Z')
    assert.equal(lockout.lockedUntil(3, last, policy).toISOString(), '2026-09-30T12:10:00.000Z')
    // sem política: os padrões de sempre
    assert.equal(lockout.lockMinutes(5), 5)
  })
})

describe('domain/platform-settings — identidade (logo e ícone)', () => {
  const ascii = (text) => text.split('').map((c) => c.charCodeAt(0))
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]
  const ICO = [0x00, 0x00, 0x01, 0x00, 0x01, 0x00]

  it('aceita PNG, JPEG, WebP, ICO e SVG, conferindo o conteúdo e o lugar', () => {
    assert.deepEqual(settings.classifyBranding('logo_light', 'marca.png', PNG), { mime: 'image/png', ext: 'png' })
    assert.deepEqual(settings.classifyBranding('favicon', 'favicon.ico', ICO), { mime: 'image/x-icon', ext: 'ico' })
    assert.deepEqual(settings.classifyBranding('logo_dark', 'marca.svg', ascii('<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>')), {
      mime: 'image/svg+xml',
      ext: 'svg',
    })
    assert.deepEqual(settings.classifyBranding('logo_light', 'marca.png', ICO), { error: 'type_mismatch' })
    assert.deepEqual(settings.classifyBranding('logo_light', 'marca.gif', ascii('GIF89a')), { error: 'unsupported_type' })
    // ICO só serve de ícone do navegador
    assert.deepEqual(settings.classifyBranding('logo_light', 'marca.ico', ICO), { error: 'unsupported_type' })
    assert.deepEqual(settings.classifyBranding('banner', 'marca.png', PNG), { error: 'invalid_slot' })
  })

  it('SVG com script, eventos, conteúdo externo ou entidades é recusado', () => {
    const unsafe = [
      '<svg><script>alert(1)</script></svg>',
      '<svg onload="alert(1)"></svg>',
      '<svg><a href="javascript:alert(1)"><rect/></a></svg>',
      '<svg><foreignObject><div>x</div></foreignObject></svg>',
      '<svg><image href="https://evil.example/x.png"/></svg>',
      '<!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>',
      '<svg><use xlink:href="data:text/html;base64,PHNjcmlwdD4="/></svg>',
    ]
    unsafe.forEach((text) => assert.deepEqual(settings.classifyBranding('logo_light', 'm.svg', ascii(text)), { error: 'unsafe_svg' }, text))
    assert.deepEqual(settings.classifyBranding('logo_light', 'm.svg', ascii('não é svg')), { error: 'type_mismatch' })
  })

  it('tamanho máximo de 1 MB', () => {
    assert.equal(settings.brandingSizeIssue(0), 'empty_file')
    assert.equal(settings.brandingSizeIssue(settings.BRANDING_MAX_BYTES + 1), 'file_too_large')
    assert.equal(settings.brandingSizeIssue(2048), null)
  })
})
