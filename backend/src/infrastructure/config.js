/**
 * Configuração via variáveis de ambiente (nenhum segredo em código).
 * Ver backend/.env.example e docs/deployment.md.
 */

const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')

/**
 * Limites por IP (o mesmo formato das regras do PocketBase): `label` é "MÉTODO /caminho" (exato) ou um
 * prefixo de caminho; vale a regra mais específica. `KAMBAN_RATE_LIMITS` (JSON) substitui a lista.
 */
const DEFAULT_RATE_LIMITS = Object.freeze([
  { label: 'POST /api/v1/auth/login', duration: 60, maxRequests: 10 },
  { label: '/api/v1/', duration: 60, maxRequests: 600 },
  { label: '/api/', duration: 10, maxRequests: 300 },
])

function parseHttp(value) {
  const match = /^(.*):(\d+)$/.exec(String(value))
  if (!match) throw new Error(`KAMBAN_HTTP inválido: "${value}" (use host:porta)`)
  return { host: match[1] || '0.0.0.0', port: Number(match[2]) }
}

function parseRateLimits(value) {
  if (!value) return DEFAULT_RATE_LIMITS.map((rule) => Object.assign({}, rule))
  const rules = JSON.parse(value)
  if (!Array.isArray(rules)) throw new Error('KAMBAN_RATE_LIMITS deve ser uma lista de regras')
  return rules.map((rule) => ({ label: String(rule.label), duration: Number(rule.duration), maxRequests: Number(rule.maxRequests) }))
}

/** `source`: variáveis (padrão: process.env) — os testes passam as suas. */
function load(source) {
  const vars = source || process.env
  const env = (name, fallback) => {
    const value = vars[name]
    return value === undefined || value === null || value === '' ? fallback : value
  }
  const environment = env('KAMBAN_ENV', 'development')
  return {
    root: ROOT,
    environment,
    isProduction: environment === 'production',
    isTest: environment === 'test',
    // webhooks para http:// e para a própria máquina: só fora de produção (ou KAMBAN_WEBHOOKS_ALLOW_INSECURE=true)
    allowInsecureWebhooks: environment !== 'production' || env('KAMBAN_WEBHOOKS_ALLOW_INSECURE', 'false') === 'true',
    appVersion: env('KAMBAN_VERSION', '0.1.0'),
    http: parseHttp(env('KAMBAN_HTTP', '127.0.0.1:8090')),
    // frontend (build do web) servido pela própria API
    publicDir: path.resolve(ROOT, env('KAMBAN_PUBLIC_DIR', 'public')),
    // proxy reverso confiável: o IP real vem do X-Forwarded-For (lista de IPs/sub-redes do proxy, ou "true")
    trustProxy: env('KAMBAN_TRUSTED_PROXY', ''),
    rateLimits: parseRateLimits(env('KAMBAN_RATE_LIMITS', '')),
    database: {
      url: env('KAMBAN_DATABASE_URL', ''),
      schema: env('KAMBAN_DB_SCHEMA', 'avanza'),
      poolSize: Number(env('KAMBAN_DB_POOL', 10)),
      // disable | require | verify-full (este com KAMBAN_DB_CA_FILE quando a empresa usa CA própria)
      sslMode: env('KAMBAN_DB_SSL', 'disable'),
      caFile: env('KAMBAN_DB_CA_FILE', ''),
    },
    storage: {
      url: env('KAMBAN_SUPABASE_URL', ''),
      secretKey: env('KAMBAN_SUPABASE_SECRET_KEY', ''),
      bucket: env('KAMBAN_STORAGE_BUCKET', 'avanza-files'),
    },
    // chave do servidor para cifrar segredos guardados no banco (senha do SMTP)
    secretKey: env('KAMBAN_SECRET_KEY', ''),
    // custo do bcrypt das senhas (o do PocketBase era 10); os testes baixam para ganhar tempo
    bcryptCost: Math.min(14, Math.max(4, Number(env('KAMBAN_BCRYPT_COST', 10)))),
    session: {
      ttlHours: Number(env('KAMBAN_SESSION_TTL_HOURS', 12)),
      rememberTtlDays: Number(env('KAMBAN_SESSION_REMEMBER_DAYS', 30)),
      idleMinutes: Number(env('KAMBAN_SESSION_IDLE_MINUTES', 120)),
      touchIntervalSeconds: Number(env('KAMBAN_SESSION_TOUCH_SECONDS', 300)),
    },
    cookie: {
      name: 'kb_session',
      // Em produção o cookie é sempre Secure; em desenvolvimento pode ser forçado via env.
      secure: environment === 'production' || env('KAMBAN_COOKIE_SECURE', 'false') === 'true',
    },
  }
}

module.exports = { load, DEFAULT_RATE_LIMITS }
