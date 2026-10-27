/**
 * Configurador geral da plataforma (regras de negócio §15): retenção do histórico, bloqueio de login,
 * política de senha e identidade (nome, logo e ícone do navegador).
 *
 * - Os padrões são os valores que antes ficavam fixos no código; valem até alguém mudar.
 * - Limites seguros: ninguém desliga uma proteção por engano (ex.: no mínimo 3 tentativas, senha de 8+).
 * - Letras e números na senha são sempre exigidos (piso); maiúsculas/minúsculas e símbolo são opcionais.
 */

const { PASSWORD_MAX } = require('./user')

/** Meses de permanência do histórico de auditoria; 0 = manter sempre. */
const RETENTION_MONTHS = Object.freeze([1, 3, 6, 12, 24, 0])

const DEFAULTS = Object.freeze({
  audit_retention_months: 3,
  lockout_threshold: 5,
  lockout_base_minutes: 5,
  lockout_max_minutes: 60,
  password_min_length: 10,
  password_require_mixed_case: false,
  password_require_symbol: false,
  platform_name: 'Avanza',
})

const LIMITS = Object.freeze({
  lockout_threshold: Object.freeze({ min: 3, max: 20 }),
  lockout_base_minutes: Object.freeze({ min: 1, max: 60 }),
  lockout_max_minutes: Object.freeze({ min: 1, max: 1440 }),
  password_min_length: Object.freeze({ min: 8, max: 64 }),
})
const NAME_MAX = 40

const INTEGER_KEYS = ['lockout_threshold', 'lockout_base_minutes', 'lockout_max_minutes', 'password_min_length']
const BOOLEAN_KEYS = ['password_require_mixed_case', 'password_require_symbol']
const KEYS = Object.keys(DEFAULTS)

/** Problema de um valor (null = válido). */
function valueIssue(key, value) {
  if (key === 'audit_retention_months') return RETENTION_MONTHS.indexOf(value) >= 0 ? null : 'invalid_option'
  if (INTEGER_KEYS.indexOf(key) >= 0) {
    if (typeof value !== 'number' || !Number.isInteger(value)) return 'invalid_type'
    if (value < LIMITS[key].min) return 'too_small'
    return value > LIMITS[key].max ? 'too_large' : null
  }
  if (BOOLEAN_KEYS.indexOf(key) >= 0) return typeof value === 'boolean' ? null : 'invalid_type'
  if (key === 'platform_name') {
    if (typeof value !== 'string') return 'invalid_type'
    const name = value.trim()
    if (!name) return 'required'
    return name.length > NAME_MAX ? 'too_long' : null
  }
  return 'unknown_field'
}

function clean(key, value) {
  return key === 'platform_name' ? value.trim() : value
}

/** Configurações guardadas → valores completos (o que faltar ou estiver inválido volta ao padrão). */
function normalizeSettings(stored) {
  const source = stored && typeof stored === 'object' ? stored : {}
  const out = {}
  KEYS.forEach((key) => {
    const value = source[key]
    out[key] = value !== undefined && valueIssue(key, value) === null ? clean(key, value) : DEFAULTS[key]
  })
  return out
}

/**
 * Alteração parcial sobre os valores atuais. Retorna { values, fields } — `fields` vazio = válido.
 * O teto do bloqueio é conferido contra o tempo inicial resultante (atual ou novo).
 */
function validateSettings(patch, current) {
  const fields = {}
  const values = Object.assign({}, normalizeSettings(current))
  Object.keys(patch || {}).forEach((key) => {
    const issue = valueIssue(key, patch[key])
    if (issue) fields[key] = issue
    else values[key] = clean(key, patch[key])
  })
  if (!fields.lockout_max_minutes && !fields.lockout_base_minutes && values.lockout_max_minutes < values.lockout_base_minutes) {
    fields.lockout_max_minutes = 'below_base'
  }
  return { values, fields }
}

/** { old, new } só com as chaves que mudaram (para o histórico); null se nada mudou. */
function diffSettings(before, after) {
  const changed = KEYS.filter((key) => before[key] !== after[key])
  if (changed.length === 0) return null
  const pick = (source) => changed.reduce((acc, key) => Object.assign(acc, { [key]: source[key] }), {})
  return { old: pick(before), new: pick(after) }
}

/** Data de corte do histórico (registros anteriores saem); null = manter sempre. */
function retentionCutoff(months, now) {
  if (!months) return null
  const cutoff = new Date(now.getTime())
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months)
  return cutoff
}

/** A mudança apaga mais do que antes? ("manter sempre" é o prazo mais longo.) */
function isShorterRetention(before, after) {
  const span = (months) => (months === 0 ? Infinity : months)
  return span(after) < span(before)
}

function passwordPolicy(values) {
  const v = normalizeSettings(values)
  return {
    min_length: v.password_min_length,
    max_length: PASSWORD_MAX,
    require_letters_numbers: true,
    require_mixed_case: v.password_require_mixed_case,
    require_symbol: v.password_require_symbol,
  }
}

function lockoutPolicy(values) {
  const v = normalizeSettings(values)
  return { threshold: v.lockout_threshold, baseMinutes: v.lockout_base_minutes, maxMinutes: v.lockout_max_minutes }
}

// ------------------------------------------------------------------ identidade (logo e ícone)

const BRANDING_SLOTS = Object.freeze(['logo_light', 'logo_dark', 'favicon'])
const BRANDING_MAX_BYTES = 1024 * 1024

/** extensão → { mime, family }; ICO só serve de ícone do navegador. */
const BRANDING_TYPES = {
  png: { mime: 'image/png', family: 'png' },
  jpg: { mime: 'image/jpeg', family: 'jpeg' },
  jpeg: { mime: 'image/jpeg', family: 'jpeg' },
  webp: { mime: 'image/webp', family: 'webp' },
  svg: { mime: 'image/svg+xml', family: 'svg' },
  ico: { mime: 'image/x-icon', family: 'ico', faviconOnly: true },
}
const BRANDING_MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'])

function startsWith(bytes, signature, offset) {
  const at = offset || 0
  if (bytes.length < at + signature.length) return false
  for (let i = 0; i < signature.length; i++) {
    if (bytes[at + i] !== signature[i]) return false
  }
  return true
}
const ascii = (text) => text.split('').map((c) => c.charCodeAt(0))

function bytesToText(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i])
  return out
}

/**
 * SVG aceito só sem nada ativo: script, atributos de evento, foreignObject/iframe/embed/object,
 * DOCTYPE/ENTITY, links javascript: e referências externas (só âncoras internas e data:image).
 * O arquivo também é servido com CSP sandbox e nosniff (segunda barreira).
 */
const SVG_FORBIDDEN = [
  /<\s*script/i,
  /\son[a-z]+\s*=/i,
  /<\s*(foreignObject|iframe|embed|object|audio|video)/i,
  /<!\s*(DOCTYPE|ENTITY)/i,
  /javascript\s*:/i,
  /(?:href|src)\s*=\s*["']?\s*(?!#|data:image\/)[a-z][a-z0-9+.-]*:/i,
  /url\(\s*["']?\s*(?!#|data:image\/)[a-z][a-z0-9+.-]*:/i,
  /@import/i,
]

function svgIssue(bytes) {
  const text = bytesToText(bytes)
  if (!/<svg[\s>]/i.test(text)) return 'type_mismatch'
  return SVG_FORBIDDEN.some((pattern) => pattern.test(text)) ? 'unsafe_svg' : null
}

function sniffFamily(bytes) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'webp'
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return 'ico'
  return null
}

/**
 * Classifica o arquivo de identidade pelo lugar, pelo nome e pelo conteúdo (SVG: o arquivo inteiro).
 * Retorna { mime, ext } ou { error: 'invalid_slot' | 'unsupported_type' | 'type_mismatch' | 'unsafe_svg' }.
 */
function classifyBranding(slot, name, bytes) {
  if (BRANDING_SLOTS.indexOf(slot) < 0) return { error: 'invalid_slot' }
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(String(name || ''))
  const ext = match ? match[1].toLowerCase() : ''
  const type = BRANDING_TYPES[ext]
  if (!type || (type.faviconOnly && slot !== 'favicon')) return { error: 'unsupported_type' }
  const content = bytes || []
  if (type.family === 'svg') {
    const issue = svgIssue(content)
    return issue ? { error: issue } : { mime: type.mime, ext }
  }
  return sniffFamily(content) === type.family ? { mime: type.mime, ext } : { error: 'type_mismatch' }
}

function brandingSizeIssue(size) {
  if (!size || size <= 0) return 'empty_file'
  return size > BRANDING_MAX_BYTES ? 'file_too_large' : null
}

module.exports = {
  RETENTION_MONTHS,
  DEFAULTS,
  LIMITS,
  NAME_MAX,
  BRANDING_SLOTS,
  BRANDING_MAX_BYTES,
  BRANDING_MIME_TYPES,
  normalizeSettings,
  validateSettings,
  diffSettings,
  retentionCutoff,
  isShorterRetention,
  passwordPolicy,
  lockoutPolicy,
  classifyBranding,
  brandingSizeIssue,
}
