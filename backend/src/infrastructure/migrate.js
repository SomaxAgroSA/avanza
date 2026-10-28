/**
 * Executor das migrations SQL (backend/db/migrations, em ordem de nome). Cada arquivo roda numa
 * transação e fica registrado em `schema_migrations`; uma trava do Postgres impede duas instâncias da
 * API de migrarem ao mesmo tempo. Os arquivos não qualificam nomes: rodam no esquema configurado.
 */

const fs = require('node:fs')
const path = require('node:path')

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'db', 'migrations')

function pendingFiles(dir, applied) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.sql') && !applied.has(name))
    .sort()
}

/**
 * @param {ReturnType<import('./database').createDatabase>} db
 * @param {{ dir?: string, log?: (message: string) => void }} [options]
 * @returns {Promise<string[]>} migrations aplicadas agora
 */
async function migrate(db, options) {
  const dir = (options && options.dir) || MIGRATIONS_DIR
  const log = (options && options.log) || (() => {})
  const client = await db.connect()
  const lockKey = `avanza:migrate:${db.schema}`
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${db.schema}"`)
    await client.query(`SET search_path TO "${db.schema}"`)
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey])
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())',
    )
    const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((row) => row.name))
    const done = []
    for (const name of pendingFiles(dir, applied)) {
      const sql = fs.readFileSync(path.join(dir, name), 'utf8')
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        err.message = `migration ${name}: ${err.message}`
        throw err
      }
      log(`migration aplicada: ${name}`)
      done.push(name)
    }
    return done
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]).catch(() => {})
    client.release()
  }
}

module.exports = { migrate, MIGRATIONS_DIR }
