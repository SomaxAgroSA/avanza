/**
 * Prepara o backend/.env para desenvolvimento com o Supabase local (`supabase start` na raiz): se o
 * arquivo não existe, copia o .env.example e preenche a conexão, a URL e a chave secreta que o
 * `supabase status` mostra. Nunca sobrescreve um .env existente.
 * Uso: npm run setup
 */

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { ROOT } = require('./env')

function supabaseStatus() {
  try {
    const out = execFileSync('supabase', ['status', '-o', 'json'], { cwd: path.resolve(ROOT, '..'), stdio: ['ignore', 'pipe', 'ignore'] })
    return JSON.parse(out.toString())
  } catch (_) {
    return null
  }
}

function main() {
  const target = path.join(ROOT, '.env')
  if (fs.existsSync(target)) return console.log('backend/.env já existe (nada a fazer).')
  const status = supabaseStatus()
  if (!status) {
    console.error('Supabase local não encontrado. Rode na raiz do repositório: supabase start (precisa do Docker).')
    process.exit(1)
  }
  const values = {
    KAMBAN_DATABASE_URL: status.DB_URL,
    KAMBAN_SUPABASE_URL: status.API_URL,
    KAMBAN_SUPABASE_SECRET_KEY: status.SECRET_KEY || status.SERVICE_ROLE_KEY,
  }
  const text = fs
    .readFileSync(path.join(ROOT, '.env.example'), 'utf8')
    .split(/\r?\n/)
    .map((line) => {
      const match = /^([A-Z0-9_]+)=/.exec(line)
      return match && values[match[1]] !== undefined ? `${match[1]}=${values[match[1]]}` : line
    })
    .join('\n')
  fs.writeFileSync(target, text, { mode: 0o600 })
  console.log('backend/.env criado com o Supabase local. Defina KAMBAN_ADMIN_EMAIL/KAMBAN_ADMIN_PASSWORD e rode: npm run create-admin')
}

main()
