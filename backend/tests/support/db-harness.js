/**
 * Banco de teste: um esquema novo (avanza_t_<aleatório>) no Postgres do Supabase local, com as
 * migrations reais, apagado no fim. Suba antes com `supabase start` (raiz do repositório).
 * KAMBAN_TEST_DATABASE_URL troca o servidor.
 */

const crypto = require('node:crypto')
const { Client } = require('pg')
const { createDatabase } = require('../../src/infrastructure/database')
const { migrate } = require('../../src/infrastructure/migrate')

const TEST_DATABASE_URL = process.env.KAMBAN_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
// Storage do Supabase local: URL e chave secreta do `supabase status` (ou das variáveis KAMBAN_TEST_*)
function localSupabase() {
  try {
    const out = require('node:child_process').execFileSync('supabase', ['status', '-o', 'json'], {
      cwd: require('node:path').resolve(__dirname, '..', '..', '..'),
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return JSON.parse(out.toString())
  } catch (_) {
    return {}
  }
}
const status = process.env.KAMBAN_TEST_SUPABASE_SECRET_KEY ? {} : localSupabase()
const TEST_STORAGE = {
  url: process.env.KAMBAN_TEST_SUPABASE_URL || status.API_URL || 'http://127.0.0.1:54321',
  secretKey: process.env.KAMBAN_TEST_SUPABASE_SECRET_KEY || status.SECRET_KEY || '',
}

async function dropSchema(schema) {
  const client = new Client({ connectionString: TEST_DATABASE_URL })
  await client.connect()
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  } finally {
    await client.end()
  }
}

/** `options.migrate=false` devolve o esquema vazio; `options.max` limita o pool. */
async function createTestDatabase(options) {
  const opts = options || {}
  const schema = `avanza_t_${crypto.randomBytes(5).toString('hex')}`
  const db = createDatabase({ url: TEST_DATABASE_URL, schema, max: opts.max || 5 })
  try {
    if (opts.migrate !== false) await migrate(db)
  } catch (err) {
    await db.close()
    await dropSchema(schema)
    throw new Error(`Não foi possível preparar o banco de teste (o Supabase local está rodando? "supabase start"): ${err.message}`)
  }
  return {
    db,
    schema,
    url: TEST_DATABASE_URL,
    async drop() {
      await db.close()
      await dropSchema(schema)
    },
  }
}

module.exports = { createTestDatabase, dropSchema, TEST_DATABASE_URL, TEST_STORAGE }
