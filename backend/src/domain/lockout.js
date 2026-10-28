/**
 * Bloqueio progressivo de conta (diretriz §27; complementa o rate limit por IP).
 *
 * - Falhas contam por e-mail (guardado só como hash) dentro de uma janela; entrar com sucesso zera.
 * - N falhas bloqueiam por T minutos; a cada N novas o tempo dobra, até o teto. Padrão: 5 falhas,
 *   5 minutos, até 60 — ajustável no Configurador geral (`policy` de domain/platform-settings.lockoutPolicy).
 * - Durante o bloqueio a senha nem é conferida e a tentativa não conta (o prazo não se estende).
 * - E-mails inexistentes seguem a mesma regra: a resposta não revela se a conta existe.
 */

const THRESHOLD = 5
const BASE_MINUTES = 5
const MAX_MINUTES = 60
/** Falhas mais antigas que isso deixam de contar. */
const WINDOW_MINUTES = 24 * 60

const DEFAULT_POLICY = Object.freeze({ threshold: THRESHOLD, baseMinutes: BASE_MINUTES, maxMinutes: MAX_MINUTES })

function lockMinutes(failures, policy) {
  const p = policy || DEFAULT_POLICY
  if (failures < p.threshold) return 0
  const level = Math.floor(failures / p.threshold) - 1
  return Math.min(p.maxMinutes, p.baseMinutes * Math.pow(2, level))
}

/** Até quando a conta fica bloqueada (null = não está). */
function lockedUntil(failures, lastFailureAt, policy) {
  const minutes = lockMinutes(failures, policy)
  if (!minutes || !lastFailureAt) return null
  return new Date(lastFailureAt.getTime() + minutes * 60000)
}

module.exports = { THRESHOLD, WINDOW_MINUTES, DEFAULT_POLICY, lockMinutes, lockedUntil }
