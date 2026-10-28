/**
 * Conexão com o Postgres (Supabase): pool com o search_path no esquema do Avanza, consultas
 * parametrizadas e transações. Único módulo que conhece o driver `pg`.
 *
 * A transação aberta fica no contexto assíncrono (AsyncLocalStorage): dentro de `transaction(fn)`,
 * qualquer consulta pelo banco — inclusive de repositórios montados fora dela — usa a mesma conexão.
 * Assim uma leitura no meio de uma gravação nunca pede uma segunda conexão ao pool (com o pool
 * cheio, isso travaria) e enxerga o que a transação já gravou. Transações aninhadas juntam-se à de
 * fora (como o runInTransaction do PocketBase): um erro desfaz tudo. `detached` consulta por fora da
 * transação aberta (o que precisa valer mesmo se ela for desfeita).
 *
 * Toda conexão recebe o search_path do esquema antes da primeira consulta (com o Supavisor, use o modo
 * sessão: o modo transação não guarda o search_path).
 */

const { AsyncLocalStorage } = require('node:async_hooks')
const { Pool, types } = require('pg')

// count(*) e afins chegam como bigint (texto no driver); os volumes do Avanza cabem num number
types.setTypeParser(20, (value) => parseInt(value, 10))

const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/

function assertSchemaName(schema) {
  if (!SCHEMA_PATTERN.test(schema)) throw new Error(`Nome de esquema inválido: "${schema}"`)
  return schema
}

/** Consultas sobre um cliente (conexão) ou o pool. */
function executor(target) {
  return {
    /** Linhas do resultado. */
    async query(text, params) {
      return (await target.query(text, params)).rows
    },
    /** Primeira linha (ou null). */
    async one(text, params) {
      return (await target.query(text, params)).rows[0] || null
    },
    /** Quantidade de linhas afetadas. */
    async exec(text, params) {
      return (await target.query(text, params)).rowCount
    },
  }
}

/**
 * @param {object} options
 * @param {string} options.url conexão do Postgres (postgres://…)
 * @param {string} [options.schema='avanza']
 * @param {number} [options.max=10] conexões no pool
 * @param {object|boolean} [options.ssl] opções TLS do driver
 * @param {(message: string, err: Error) => void} [options.onError]
 */
function createDatabase(options) {
  const schema = assertSchemaName(options.schema || 'avanza')
  const pool = new Pool({
    connectionString: options.url,
    max: options.max || 10,
    ssl: options.ssl,
    application_name: 'avanza-api',
  })
  const onError = options.onError || (() => {})
  // conexões ociosas podem cair (rede, reinício do banco): o pool descarta e abre outra
  pool.on('error', (err) => onError('postgres: conexão ociosa caiu', err))
  const ready = new WeakSet()

  /** Conexão do pool já no esquema do Avanza. */
  async function acquire() {
    const client = await pool.connect()
    if (!ready.has(client)) {
      try {
        await client.query(`SET search_path TO "${schema}"`)
      } catch (err) {
        client.release(err)
        throw err
      }
      ready.add(client)
    }
    return client
  }

  /** Uma consulta numa conexão emprestada do pool (fora de transação). */
  const pooled = {
    query: async (text, params) => {
      const client = await acquire()
      try {
        return await client.query(text, params)
      } finally {
        client.release()
      }
    },
  }

  const storage = new AsyncLocalStorage()
  const root = executor(pooled)
  const current = () => storage.getStore() || root

  return {
    schema,
    query: (text, params) => current().query(text, params),
    one: (text, params) => current().one(text, params),
    exec: (text, params) => current().exec(text, params),

    /** Executa `fn(tx)` numa transação (ou na transação já aberta neste contexto). */
    async transaction(fn) {
      const open = storage.getStore()
      if (open) return fn(open)
      const client = await acquire()
      const tx = executor(client)
      try {
        await client.query('BEGIN')
        const result = await storage.run(tx, () => fn(tx))
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.release()
      }
    },

    /** Consultas por fora da transação aberta neste contexto. */
    detached: root,

    /** Conexão dedicada (LISTEN do tempo real, travas); devolva com `release()`. */
    connect: acquire,

    close: () => pool.end(),
  }
}

module.exports = { createDatabase, assertSchemaName }
