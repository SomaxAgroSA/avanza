/**
 * Configuração via variáveis de ambiente (nenhum segredo em código).
 * Ver backend/.env.example e docs/deployment.md.
 */

function env(name, fallback) {
  const value = $os.getenv(name)
  return value === undefined || value === null || value === '' ? fallback : value
}

function load() {
  const environment = env('KAMBAN_ENV', 'development')
  return {
    environment,
    isProduction: environment === 'production',
    // webhooks para http:// e para a própria máquina: só fora de produção (ou KAMBAN_WEBHOOKS_ALLOW_INSECURE=true)
    allowInsecureWebhooks: environment !== 'production' || env('KAMBAN_WEBHOOKS_ALLOW_INSECURE', 'false') === 'true',
    appVersion: env('KAMBAN_VERSION', '0.1.0'),
    session: {
      ttlHours: env('KAMBAN_SESSION_TTL_HOURS', 12),
      rememberTtlDays: env('KAMBAN_SESSION_REMEMBER_DAYS', 30),
      idleMinutes: env('KAMBAN_SESSION_IDLE_MINUTES', 120),
      touchIntervalSeconds: env('KAMBAN_SESSION_TOUCH_SECONDS', 300),
    },
    cookie: {
      name: 'kb_session',
      // Em produção o cookie é sempre Secure; em desenvolvimento pode ser forçado via env.
      secure: environment === 'production' || env('KAMBAN_COOKIE_SECURE', 'false') === 'true',
    },
  }
}

module.exports = { load }
