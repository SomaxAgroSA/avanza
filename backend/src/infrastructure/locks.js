/**
 * Trava entre instâncias da API (pg_try_advisory_lock): uma rotina por vez em todo o cluster. A trava
 * é da conexão — se a instância cair no meio, o Postgres a solta sozinho.
 */

/**
 * Executa `fn` se conseguir a trava `name`; senão devolve `{ busy: true }` na hora.
 * @returns {Promise<{ busy: boolean, result?: any }>}
 */
async function withLock(db, name, fn) {
  const key = `${db.schema}:${name}`
  const client = await db.connect()
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [key])
    if (!rows[0].ok) return { busy: true }
    try {
      return { busy: false, result: await fn() }
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).catch(() => {})
    }
  } finally {
    client.release()
  }
}

module.exports = { withLock }
