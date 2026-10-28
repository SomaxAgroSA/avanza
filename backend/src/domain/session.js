/**
 * Política de sessão web.
 *
 * - Sessão comum: expira no prazo absoluto (ttlHours) ou após `idleMinutes` sem uso.
 * - Sessão persistente ("lembrar-me"): expira em `rememberTtlDays` e é renovada a cada uso.
 * - `touchIntervalSeconds` limita a frequência de escrita de `last_seen_at` no banco.
 */

const DEFAULT_POLICY = Object.freeze({ ttlHours: 12, rememberTtlDays: 30, idleMinutes: 120, touchIntervalSeconds: 300 })

const HOUR = 3600 * 1000
const MINUTE = 60 * 1000

function positiveNumber(raw, fallback) {
  const n = Number(raw)
  return isFinite(n) && n > 0 ? n : fallback
}

function createPolicy(input) {
  const src = input || {}
  return Object.freeze({
    ttlHours: positiveNumber(src.ttlHours, DEFAULT_POLICY.ttlHours),
    rememberTtlDays: positiveNumber(src.rememberTtlDays, DEFAULT_POLICY.rememberTtlDays),
    idleMinutes: positiveNumber(src.idleMinutes, DEFAULT_POLICY.idleMinutes),
    touchIntervalSeconds: positiveNumber(src.touchIntervalSeconds, DEFAULT_POLICY.touchIntervalSeconds),
  })
}

function computeExpiry(now, remember, policy) {
  const ms = remember ? policy.rememberTtlDays * 24 * HOUR : policy.ttlHours * HOUR
  return new Date(now.getTime() + ms)
}

/**
 * Avalia a sessão no instante `now`.
 * @returns {{ valid: boolean, reason: null|'revoked'|'expired'|'idle', shouldTouch: boolean }}
 */
function evaluate(session, now, policy) {
  if (session.revokedAt) return { valid: false, reason: 'revoked', shouldTouch: false }
  if (now.getTime() >= session.expiresAt.getTime()) return { valid: false, reason: 'expired', shouldTouch: false }

  const idleMs = now.getTime() - session.lastSeenAt.getTime()
  if (!session.remember && idleMs >= policy.idleMinutes * MINUTE) {
    return { valid: false, reason: 'idle', shouldTouch: false }
  }
  return { valid: true, reason: null, shouldTouch: idleMs >= policy.touchIntervalSeconds * 1000 }
}

/** Nova expiração ao registrar uso: só sessões persistentes deslizam. */
function renewedExpiry(session, now, policy) {
  return session.remember ? computeExpiry(now, true, policy) : session.expiresAt
}

module.exports = { DEFAULT_POLICY, createPolicy, computeExpiry, evaluate, renewedExpiry }
