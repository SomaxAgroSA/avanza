/**
 * Links de uso único enviados por e-mail (regras de negócio §16): redefinir a senha ("Esqueci minha
 * senha") e criar a senha de quem foi convidado. Só o hash do token é guardado; o link vale uma vez.
 */

const PURPOSES = Object.freeze({ reset: 60, invite: 7 * 24 * 60 })
/** Pedidos de redefinição por conta, por hora (evita encher a caixa de alguém). */
const RESET_REQUESTS_PER_HOUR = 3

function expiresAt(purpose, now) {
  return new Date(now.getTime() + PURPOSES[purpose] * 60000)
}

/** 'valid' | 'used' | 'expired' | 'invalid' (inexistente). */
function tokenState(token, now) {
  if (!token) return 'invalid'
  if (token.usedAt) return 'used'
  return token.expiresAt && token.expiresAt.getTime() >= now.getTime() ? 'valid' : 'expired'
}

function canRequestReset(requestsInLastHour) {
  return requestsInLastHour < RESET_REQUESTS_PER_HOUR
}

module.exports = { PURPOSES, RESET_REQUESTS_PER_HOUR, expiresAt, tokenState, canRequestReset }
