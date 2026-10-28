/**
 * Limite de requisições por IP, com as mesmas regras que o PocketBase usava: `label` é um prefixo de
 * caminho ("/api/v1/") ou método + caminho ("POST /api/v1/auth/login"); vale a regra que casa com o
 * caminho mais longo (com método, em caso de empate). Janela fixa de `duration` segundos.
 *
 * Contagem em memória, por instância da API: com várias instâncias atrás de um balanceador, cada uma
 * aplica o limite sozinha (o total por IP pode chegar a N vezes o configurado).
 */

function parseRule(rule) {
  const match = /^([A-Z]+)\s+(\S+)$/.exec(String(rule.label).trim())
  return {
    label: rule.label,
    method: match ? match[1] : null,
    prefix: match ? match[2] : String(rule.label).trim(),
    windowMs: Math.max(1, Number(rule.duration)) * 1000,
    max: Math.max(0, Number(rule.maxRequests)),
  }
}

function createRateLimiter(rules, options) {
  const now = (options && options.now) || Date.now
  let parsed = []
  let enabled = true
  const counters = new Map()

  function configure(nextRules, nextEnabled) {
    parsed = (nextRules || []).map(parseRule)
    enabled = nextEnabled !== false
    counters.clear()
  }
  configure(rules)

  function ruleFor(method, path) {
    let best = null
    parsed.forEach((rule) => {
      if (rule.method && rule.method !== method) return
      if (path.indexOf(rule.prefix) !== 0) return
      const better = !best || rule.prefix.length > best.prefix.length || (rule.prefix.length === best.prefix.length && rule.method && !best.method)
      if (better) best = rule
    })
    return best
  }

  return {
    configure,

    /** `{ allowed, rule, retryAfter }` — conta a requisição na janela da regra que vale para ela. */
    hit(method, path, ip) {
      if (!enabled) return { allowed: true }
      const rule = ruleFor(String(method).toUpperCase(), path)
      if (!rule) return { allowed: true }
      const key = `${rule.label}|${ip}`
      const at = now()
      let entry = counters.get(key)
      if (!entry || at - entry.start >= rule.windowMs) {
        entry = { start: at, count: 0 }
        counters.set(key, entry)
      }
      entry.count++
      if (entry.count <= rule.max) return { allowed: true, rule: rule.label }
      return { allowed: false, rule: rule.label, retryAfter: Math.ceil((entry.start + rule.windowMs - at) / 1000) }
    },

    /** Descarta janelas vencidas (chamado de tempos em tempos). */
    sweep() {
      const at = now()
      const longest = parsed.reduce((max, rule) => Math.max(max, rule.windowMs), 0)
      counters.forEach((entry, key) => {
        if (at - entry.start >= longest) counters.delete(key)
      })
    },

    size: () => counters.size,
  }
}

module.exports = { createRateLimiter }
