import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PASSWORD_POLICY,
  DEFAULT_PLATFORM_INFO,
  acceptFor,
  brandingFileIssue,
  changedSettings,
  isShorterRetention,
  logoFor,
  passwordRuleKeys,
  platformSettingsSchema,
  type PlatformLimits,
  type PlatformSettingsValues,
} from './platform'
import { passwordSchemaFor } from './validation'

const LIMITS: PlatformLimits = {
  lockoutThreshold: { min: 3, max: 20 },
  lockoutBaseMinutes: { min: 1, max: 60 },
  lockoutMaxMinutes: { min: 1, max: 1440 },
  passwordMinLength: { min: 8, max: 64 },
  platformNameMax: 40,
}

const VALUES: PlatformSettingsValues = {
  auditRetentionMonths: 3,
  lockoutThreshold: 5,
  lockoutBaseMinutes: 5,
  lockoutMaxMinutes: 60,
  passwordMinLength: 10,
  passwordRequireMixedCase: false,
  passwordRequireSymbol: false,
  platformName: 'KAMBAN',
}

describe('domain/platform', () => {
  it('formulário: limites vindos do servidor; teto do bloqueio não fica abaixo do tempo inicial', () => {
    const schema = platformSettingsSchema(LIMITS)
    expect(schema.safeParse(VALUES).success).toBe(true)
    const bad = schema.safeParse({ ...VALUES, lockoutThreshold: 2, passwordMinLength: 65, platformName: '  ', lockoutBaseMinutes: 30, lockoutMaxMinutes: 20 })
    expect(bad.success).toBe(false)
    const issues = Object.fromEntries((bad.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]))
    expect(issues).toEqual({ lockoutThreshold: 'too_small', passwordMinLength: 'too_large', platformName: 'required', lockoutMaxMinutes: 'below_base' })
  })

  it('só o que mudou vai para o servidor', () => {
    expect(changedSettings(VALUES, { ...VALUES, lockoutThreshold: 8, platformName: ' Obra ' })).toEqual({ lockoutThreshold: 8, platformName: 'Obra' })
    expect(changedSettings(VALUES, { ...VALUES })).toEqual({})
  })

  it('encurtar a retenção ("manter sempre" é o prazo mais longo)', () => {
    expect(isShorterRetention(3, 1)).toBe(true)
    expect(isShorterRetention(0, 24)).toBe(true)
    expect(isShorterRetention(6, 0)).toBe(false)
    expect(isShorterRetention(3, 3)).toBe(false)
  })

  it('regras da senha para a dica, na ordem; o esquema segue a política', () => {
    expect(passwordRuleKeys(DEFAULT_PASSWORD_POLICY)).toEqual(['letters_numbers'])
    const strict = { ...DEFAULT_PASSWORD_POLICY, minLength: 12, requireMixedCase: true, requireSymbol: true }
    expect(passwordRuleKeys(strict)).toEqual(['letters_numbers', 'mixed_case', 'symbol'])
    const schema = passwordSchemaFor(strict)
    expect(schema.safeParse('Curta1#').error?.issues[0]?.message).toBe('too_short')
    expect(schema.safeParse('semmaiuscula12#').error?.issues[0]?.message).toBe('needs_mixed_case')
    expect(schema.safeParse('SemSimbolo1234').error?.issues[0]?.message).toBe('needs_symbol')
    expect(schema.safeParse('ComTudo1234#').success).toBe(true)
    expect(passwordSchemaFor(DEFAULT_PASSWORD_POLICY).safeParse('senhaForte123').success).toBe(true)
  })

  it('logo do tema: escuro usa a versão escura (ou a clara); sem logo enviado, a marca padrão do tema', () => {
    const info = { ...DEFAULT_PLATFORM_INFO, logoLightUrl: '/l.png', logoDarkUrl: '/d.png' }
    expect(logoFor(info, 'dark')).toBe('/d.png')
    expect(logoFor(info, 'light')).toBe('/l.png')
    expect(logoFor({ ...info, logoDarkUrl: null }, 'dark')).toBe('/l.png')
    expect(logoFor(DEFAULT_PLATFORM_INFO, 'light')).toBe('/brand/logo-light.svg')
    expect(logoFor(DEFAULT_PLATFORM_INFO, 'dark')).toBe('/brand/logo-dark.svg')
  })

  it('arquivo de identidade: tipos aceitos por lugar e até 1 MB', () => {
    expect(acceptFor('favicon')).toContain('.ico')
    expect(acceptFor('logo_light')).not.toContain('.ico')
    expect(brandingFileIssue('logo_light', new File(['x'], 'm.gif', { type: 'image/gif' }))).toBe('unsupported_type')
    expect(brandingFileIssue('logo_light', new File(['x'], 'm.ico'))).toBe('unsupported_type')
    expect(brandingFileIssue('favicon', new File(['x'], 'f.ico'))).toBeNull()
    expect(brandingFileIssue('logo_dark', new File([new Uint8Array(1024 * 1024 + 1)], 'm.png'))).toBe('file_too_large')
    expect(brandingFileIssue('logo_dark', new File([new Uint8Array(10)], 'm.svg'))).toBeNull()
  })
})
