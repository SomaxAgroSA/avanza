/**
 * Infraestrutura do tempo real: as conexões SSE desta instância e a escuta do canal do Postgres.
 *
 * Os gatilhos das tabelas observadas (db/migrations/0006_realtime.sql) avisam o canal
 * "realtime_<esquema>" depois do commit, com os identificadores da mudança. Cada instância da API
 * escuta o canal numa conexão dedicada, monta o evento uma vez (application/realtime.js#eventFor) e o
 * entrega às conexões que assinam o tópico — no formato SSE do PocketBase, que o web já usa.
 */

const crypto = require('node:crypto')

/** Nome do sinal de vida: não é tópico de ninguém, então o navegador ignora. */
const KEEPALIVE_EVENT = 'kamban_keepalive'
const RECONNECT_MS = 2000

function sseMessage(clientId, name, data) {
  return `id:${clientId}\nevent:${name}\ndata:${data}\n\n`
}

/**
 * @param {object} runtime { db, log }
 * @param {(change: object) => Promise<{ topic: string, payload: object }|null>} eventFor
 */
function createRealtimeHub(runtime, eventFor) {
  const clients = new Map()
  const channel = `realtime_${runtime.db.schema}`
  let listener = null
  let stopped = false

  function send(client, name, data) {
    try {
      client.write(sseMessage(client.id, name, data))
    } catch (_) {
      clients.delete(client.id)
    }
  }

  async function dispatch(payload) {
    if (clients.size === 0) return
    let change
    try {
      change = JSON.parse(payload)
    } catch (_) {
      return
    }
    // ninguém assina nada nesta instância: não monta o evento
    if (![...clients.values()].some((c) => c.subscriptions.size > 0)) return
    const event = await eventFor(change)
    if (!event) return
    const data = JSON.stringify(event.payload)
    clients.forEach((client) => {
      if (client.subscriptions.has(event.topic)) send(client, event.topic, data)
    })
  }

  async function listen() {
    if (stopped) return
    try {
      const client = await runtime.db.connect()
      listener = client
      client.on('notification', (msg) => {
        if (msg.channel !== channel) return
        // aviso em tempo real nunca derruba nada: o pior caso é a tela buscar na rede de segurança
        dispatch(msg.payload).catch((err) => runtime.log.warn({ err }, 'tempo real: aviso não entregue'))
      })
      client.on('error', (err) => {
        runtime.log.warn({ err }, 'tempo real: conexão de escuta caiu')
        reconnect(client)
      })
      await client.query(`LISTEN "${channel}"`)
    } catch (err) {
      runtime.log.warn({ err }, 'tempo real: não foi possível escutar o canal')
      reconnect(null)
    }
  }

  function reconnect(client) {
    if (client) {
      try {
        client.release(true)
      } catch (_) {
        // já devolvida
      }
    }
    listener = null
    if (stopped) return
    const timer = setTimeout(listen, RECONNECT_MS)
    timer.unref()
  }

  return {
    channel,

    start: listen,

    /** Registra uma conexão SSE; `write(text)` escreve no corpo. Devolve o cliente (com o id). */
    add(write) {
      const client = { id: crypto.randomBytes(20).toString('base64url'), write, subscriptions: new Set(), userId: null }
      clients.set(client.id, client)
      send(client, 'PB_CONNECT', JSON.stringify({ clientId: client.id }))
      return client
    },

    remove(id) {
      clients.delete(id)
    },

    get(id) {
      return clients.get(id) || null
    },

    /** Sinal de vida para todas as conexões desta instância; devolve quantas receberam. */
    keepAlive() {
      let sent = 0
      clients.forEach((client) => {
        send(client, KEEPALIVE_EVENT, '{}')
        sent++
      })
      return sent
    },

    size: () => clients.size,

    async stop() {
      stopped = true
      clients.clear()
      if (listener) {
        const client = listener
        listener = null
        await client.query(`UNLISTEN "${channel}"`).catch(() => {})
        client.release()
      }
    },
  }
}

module.exports = { createRealtimeHub, KEEPALIVE_EVENT }
