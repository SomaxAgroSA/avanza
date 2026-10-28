/**
 * Montagem padronizada de entradas de auditoria.
 * `ctx` é o contexto da requisição: { principal, ip, userAgent, correlationId }.
 */

const MAX_USER_AGENT = 512

function truncate(value, max) {
  const str = String(value || '')
  return str.length > max ? str.slice(0, max) : str
}

function buildAuditEntry(ctx, input) {
  const actorId = input.userId !== undefined ? input.userId : ctx.principal ? ctx.principal.userId : null
  return {
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    oldValue: input.oldValue || null,
    newValue: input.newValue || null,
    userId: actorId,
    ip: ctx.ip || '',
    userAgent: truncate(ctx.userAgent, MAX_USER_AGENT),
    correlationId: ctx.correlationId || '',
  }
}

/**
 * Compara dois objetos nas chaves informadas e devolve apenas o que mudou,
 * no formato { oldValue, newValue } — ou null se nada mudou.
 */
function diff(before, after, keys) {
  const oldValue = {}
  const newValue = {}
  keys.forEach((key) => {
    if (after[key] !== undefined && after[key] !== before[key]) {
      oldValue[key] = before[key] === undefined ? null : before[key]
      newValue[key] = after[key]
    }
  })
  return Object.keys(newValue).length > 0 ? { oldValue, newValue } : null
}

module.exports = { buildAuditEntry, diff, truncate, MAX_USER_AGENT }
