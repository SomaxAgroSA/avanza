/**
 * Tokens de API pessoais (regras de negócio §17): acesso à API sem o navegador (scripts, BI,
 * integrações). O token age como a pessoa, com as permissões dela no momento de cada chamada.
 * Só o hash fica guardado; o valor aparece uma única vez, na criação.
 */

const PREFIX = 'kb_pat_'
const RANDOM_LENGTH = 40
const NAME_MAX = 80
/** Prazos oferecidos, em dias; 0 = sem prazo. */
const EXPIRY_DAYS = Object.freeze([30, 90, 365, 0])
const MAX_PER_USER = 20
/** O "último uso" é gravado no máximo a cada 5 minutos. */
const TOUCH_INTERVAL_MS = 5 * 60000

const TOKEN_PATTERN = new RegExp(`^${PREFIX}[A-Za-z0-9]{${RANDOM_LENGTH}}$`)

function tokenValue(random) {
  return PREFIX + random
}

function looksLikeToken(value) {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}

/** Início visível do token ("kb_pat_a1B2…") para a pessoa reconhecer qual é. */
function displayPrefix(value) {
  return value.slice(0, PREFIX.length + 4)
}

function tokenInput(raw) {
  const input = raw || {}
  const fields = {}
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) fields.name = 'required'
  else if (name.length > NAME_MAX) fields.name = 'too_long'
  const days = input.expires_in_days
  if (days === undefined || days === null) fields.expires_in_days = 'required'
  else if (EXPIRY_DAYS.indexOf(days) < 0) fields.expires_in_days = 'invalid_option'
  return { values: { name, expiresInDays: days }, fields }
}

function expiresAt(days, now) {
  return days ? new Date(now.getTime() + days * 86400000) : null
}

/** 'active' | 'expired' | 'revoked'. */
function tokenState(token, now) {
  if (token.revokedAt) return 'revoked'
  if (token.expiresAt && token.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'active'
}

function shouldTouch(lastUsedAt, now) {
  return !lastUsedAt || now.getTime() - lastUsedAt.getTime() >= TOUCH_INTERVAL_MS
}

module.exports = { PREFIX, RANDOM_LENGTH, NAME_MAX, EXPIRY_DAYS, MAX_PER_USER, tokenValue, looksLikeToken, displayPrefix, tokenInput, expiresAt, tokenState, shouldTouch }
