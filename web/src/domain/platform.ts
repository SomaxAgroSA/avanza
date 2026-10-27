import { z } from 'zod'

/**
 * Configurador geral (regras de negócio §15): identidade da plataforma, política de senha, bloqueio de
 * login e retenção do histórico. Os limites vêm do servidor (que sempre valida); aqui só o que a tela
 * precisa para orientar e evitar idas e vindas.
 */

export const BRANDING_SLOTS = ['logo_light', 'logo_dark', 'favicon'] as const
export type BrandingSlot = (typeof BRANDING_SLOTS)[number]

export const BRANDING_MAX_BYTES = 1024 * 1024
const LOGO_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'svg']
const FAVICON_EXTENSIONS = [...LOGO_EXTENSIONS, 'ico']

/** Meses de permanência do histórico; 0 = manter sempre. */
export type RetentionMonths = 0 | 1 | 3 | 6 | 12 | 24

export interface PlatformInfo {
  name: string
  logoLightUrl: string | null
  logoDarkUrl: string | null
  faviconUrl: string | null
  /** O envio de e-mail está ligado: "Esqueci minha senha", convites e notificações por e-mail. */
  passwordReset: boolean
}

export const DEFAULT_PLATFORM_INFO: PlatformInfo = { name: 'Avanza', logoLightUrl: null, logoDarkUrl: null, faviconUrl: null, passwordReset: false }

/** Marca padrão (pasta web/public/brand), usada enquanto ninguém envia outra no Configurador geral. */
export const DEFAULT_BRANDING: Record<BrandingSlot, string> = {
  logo_light: '/brand/logo-light.png',
  logo_dark: '/brand/logo-dark.png',
  favicon: '/brand/favicon-64.png',
}

export interface PlatformSettingsValues {
  auditRetentionMonths: number
  lockoutThreshold: number
  lockoutBaseMinutes: number
  lockoutMaxMinutes: number
  passwordMinLength: number
  passwordRequireMixedCase: boolean
  passwordRequireSymbol: boolean
  platformName: string
}

export interface Range {
  min: number
  max: number
}

export interface PlatformLimits {
  lockoutThreshold: Range
  lockoutBaseMinutes: Range
  lockoutMaxMinutes: Range
  passwordMinLength: Range
  platformNameMax: number
}

export interface BrandingFile {
  name: string
  mime: string
  size: number
}

export interface PlatformSettings {
  values: PlatformSettingsValues
  defaults: PlatformSettingsValues
  limits: PlatformLimits
  retentionOptions: number[]
  branding: Record<BrandingSlot, BrandingFile | null>
  updatedAt: Date | null
}

export interface PasswordPolicy {
  minLength: number
  maxLength: number
  requireLettersNumbers: boolean
  requireMixedCase: boolean
  requireSymbol: boolean
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = { minLength: 10, maxLength: 72, requireLettersNumbers: true, requireMixedCase: false, requireSymbol: false }

const int = (range: Range) => z.number({ error: 'invalid_type' }).int('not_integer').min(range.min, 'too_small').max(range.max, 'too_large')

/** Esquema do formulário a partir dos limites do servidor. */
export function platformSettingsSchema(limits: PlatformLimits) {
  return z
    .object({
      auditRetentionMonths: z.number(),
      lockoutThreshold: int(limits.lockoutThreshold),
      lockoutBaseMinutes: int(limits.lockoutBaseMinutes),
      lockoutMaxMinutes: int(limits.lockoutMaxMinutes),
      passwordMinLength: int(limits.passwordMinLength),
      passwordRequireMixedCase: z.boolean(),
      passwordRequireSymbol: z.boolean(),
      platformName: z.string().trim().min(1, 'required').max(limits.platformNameMax, 'too_long'),
    })
    .refine((v) => v.lockoutMaxMinutes >= v.lockoutBaseMinutes, { path: ['lockoutMaxMinutes'], message: 'below_base' })
}

/** Só as chaves alteradas (nome sem espaços nas pontas), para o PATCH e para o histórico. */
export function changedSettings(before: PlatformSettingsValues, after: PlatformSettingsValues): Partial<PlatformSettingsValues> {
  const next = { ...after, platformName: after.platformName.trim() }
  const out: Partial<PlatformSettingsValues> = {}
  ;(Object.keys(next) as (keyof PlatformSettingsValues)[]).forEach((key) => {
    if (next[key] !== before[key]) Object.assign(out, { [key]: next[key] })
  })
  return out
}

export function isShorterRetention(before: number, after: number): boolean {
  const span = (months: number) => (months === 0 ? Infinity : months)
  return span(after) < span(before)
}

/** Exigências além do tamanho, na ordem em que a dica mostra. */
export function passwordRuleKeys(policy: PasswordPolicy): ('letters_numbers' | 'mixed_case' | 'symbol')[] {
  const keys: ('letters_numbers' | 'mixed_case' | 'symbol')[] = []
  if (policy.requireLettersNumbers) keys.push('letters_numbers')
  if (policy.requireMixedCase) keys.push('mixed_case')
  if (policy.requireSymbol) keys.push('symbol')
  return keys
}

/**
 * Logo do tema: o enviado no Configurador (no escuro, a versão escura ou, sem ela, a clara) ou a marca
 * padrão do tema.
 */
export function logoFor(info: PlatformInfo, theme: 'light' | 'dark'): string {
  if (theme === 'dark') return info.logoDarkUrl ?? info.logoLightUrl ?? DEFAULT_BRANDING.logo_dark
  return info.logoLightUrl ?? DEFAULT_BRANDING.logo_light
}

export function acceptFor(slot: BrandingSlot): string {
  return (slot === 'favicon' ? FAVICON_EXTENSIONS : LOGO_EXTENSIONS).map((ext) => `.${ext}`).join(',')
}

/** Conferência rápida antes de enviar (o servidor confere o conteúdo de verdade). */
export function brandingFileIssue(slot: BrandingSlot, file: File): 'unsupported_type' | 'file_too_large' | null {
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? ''
  const allowed = slot === 'favicon' ? FAVICON_EXTENSIONS : LOGO_EXTENSIONS
  if (!allowed.includes(ext)) return 'unsupported_type'
  return file.size > BRANDING_MAX_BYTES ? 'file_too_large' : null
}
