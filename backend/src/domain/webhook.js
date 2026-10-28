/**
 * Webhooks (regras de negócio §18): a plataforma avisa outros sistemas quando algo acontece, com um
 * POST assinado (HMAC-SHA256) para o endereço configurado. Os eventos são um catálogo público e
 * estável (mesmos nomes do histórico de auditoria); só o que está nele é enviado.
 */

const EVENTS = Object.freeze([
  'project.created',
  'project.updated',
  'project.archived',
  'project.unarchived',
  'project.deleted',
  'project.member_added',
  'project.member_removed',
  'task.created',
  'task.updated',
  'task.deleted',
  'task.linked',
  'task.unlinked',
  'task.forked',
  'comment.added',
  'comment.edited',
  'comment.deleted',
  'attachment.added',
  'attachment.deleted',
  'sprint.created',
  'sprint.updated',
  'sprint.deleted',
  'milestone.created',
  'milestone.updated',
  'milestone.deleted',
  'plan_item.created',
  'plan_item.updated',
  'plan_item.deleted',
  'plan_item.update_added',
  'doc_page.published',
  'doc_page.deleted',
  'user.created',
  'user.disabled',
  'user.enabled',
])
const EVENT_GROUPS = Object.freeze(Array.from(new Set(EVENTS.map((e) => e.split('.')[0]))))
/** Evento do "Enviar teste". */
const PING_EVENT = 'webhook.ping'

const NAME_MAX = 80
const URL_MAX = 500
const MAX_EVENTS = 100
const RETRY_MINUTES = [1, 5, 30, 120, 720]
const MAX_ATTEMPTS = 6
/** Falhas definitivas seguidas que desligam o webhook sozinho. */
const DISABLE_AFTER_FAILURES = 20
const TIMEOUT_SECONDS = 10

function isPublicEvent(action) {
  return EVENTS.indexOf(action) >= 0
}

function matches(events, action) {
  if (!isPublicEvent(action)) return false
  return events.indexOf(action) >= 0 || events.indexOf(`${action.split('.')[0]}.*`) >= 0
}

function eventIssue(event) {
  if (typeof event !== 'string') return true
  if (event.slice(-2) === '.*') return EVENT_GROUPS.indexOf(event.slice(0, -2)) < 0
  return !isPublicEvent(event)
}

/** Hosts que nunca recebem: metadados da nuvem e link-local (roubo de credenciais via SSRF). */
function alwaysBlocked(host) {
  return /^169\.254\./.test(host) || host === 'metadata.google.internal' || host === 'metadata' || host === '0.0.0.0' || /^fe80:/i.test(host) || /^fd00:ec2::254$/i.test(host)
}

function isLoopback(host) {
  return host === 'localhost' || /^127\./.test(host) || host === '::1'
}

/**
 * Problema do endereço (null = válido). `allowInsecure` (desenvolvimento/teste ou liberado na
 * configuração): aceita http e a própria máquina.
 */
function urlIssue(url, allowInsecure) {
  if (typeof url !== 'string' || !url.trim()) return 'required'
  const value = url.trim()
  if (value.length > URL_MAX) return 'too_long'
  const match = /^(https?):\/\/([^/?#\s]+)([/?#][^\s]*)?$/i.exec(value)
  if (!match) return 'invalid_url'
  const authority = match[2]
  if (authority.indexOf('@') >= 0) return 'invalid_url'
  const host = (authority[0] === '[' ? authority.slice(1, authority.indexOf(']')) : authority.split(':')[0]).toLowerCase()
  if (!host) return 'invalid_url'
  if (alwaysBlocked(host)) return 'blocked_host'
  if (!allowInsecure && isLoopback(host)) return 'blocked_host'
  if (!allowInsecure && match[1].toLowerCase() !== 'https') return 'insecure_url'
  return null
}

/**
 * Entrada do formulário. `options.partial` (edição): valida só o que veio.
 * Retorna { values, fields } — `fields` vazio = válido.
 */
function webhookInput(raw, options) {
  const input = raw || {}
  const opts = options || {}
  const fields = {}
  const values = {}
  const has = (key) => !opts.partial || input[key] !== undefined
  if (has('name')) {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name) fields.name = 'required'
    else if (name.length > NAME_MAX) fields.name = 'too_long'
    else values.name = name
  }
  if (has('url')) {
    const issue = urlIssue(input.url, !!opts.allowInsecure)
    if (issue) fields.url = issue
    else values.url = input.url.trim()
  }
  if (has('events')) {
    const list = Array.isArray(input.events) ? input.events : null
    if (!list || list.length === 0) fields.events = 'required'
    else if (list.length > MAX_EVENTS || list.some(eventIssue)) fields.events = 'invalid_option'
    else values.events = Array.from(new Set(list))
  }
  if (input.active !== undefined) {
    if (typeof input.active !== 'boolean') fields.active = 'invalid_type'
    else values.active = input.active
  } else if (!opts.partial) values.active = true
  return { values, fields }
}

/** Próxima tentativa depois de `attempts` falhas; null = desiste. */
function nextAttemptAt(attempts, now) {
  if (attempts >= MAX_ATTEMPTS) return null
  return new Date(now.getTime() + RETRY_MINUTES[Math.min(attempts, RETRY_MINUTES.length) - 1] * 60000)
}

function isSuccess(status) {
  return typeof status === 'number' && status >= 200 && status < 300
}

/** Corpo enviado: o que mudou vem do histórico (já sem dados sensíveis). */
function buildPayload(input) {
  const entry = input.entry || {}
  return {
    id: input.deliveryId,
    event: input.event,
    occurred_at: input.occurredAt.toISOString(),
    actor: entry.userId ? { id: entry.userId } : null,
    entity: entry.entityType ? { type: entry.entityType, id: entry.entityId } : null,
    data: entry.newValue || null,
    previous: entry.oldValue || null,
  }
}

/** Texto assinado: `${timestamp}.${corpo}` (o receptor confere a assinatura e a hora). */
function signingString(timestamp, body) {
  return `${timestamp}.${body}`
}

function newSecret(random) {
  return `whsec_${String(random).replace(/[^A-Za-z0-9]/g, '').slice(0, 32)}`
}

module.exports = {
  EVENTS,
  EVENT_GROUPS,
  PING_EVENT,
  MAX_ATTEMPTS,
  DISABLE_AFTER_FAILURES,
  TIMEOUT_SECONDS,
  isPublicEvent,
  matches,
  urlIssue,
  webhookInput,
  nextAttemptAt,
  isSuccess,
  buildPayload,
  signingString,
  newSecret,
}
