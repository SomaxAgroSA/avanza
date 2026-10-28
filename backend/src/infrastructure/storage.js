/**
 * Arquivos no Supabase Storage (bucket privado), pela API REST com a chave secreta — só o servidor
 * fala com o Storage; o navegador recebe os arquivos pela API do Avanza, que confere a permissão.
 * Chaves no formato "<tabela>/<id do registro>/<nome guardado>", como o PocketBase organizava.
 */

const KEY_PATTERN = /^[a-z0-9_]+\/[a-z0-9]+\/[^/\\]+$/

function encodeKey(key) {
  if (!KEY_PATTERN.test(key) || key.indexOf('..') >= 0) throw new Error(`Chave de arquivo inválida: ${key}`)
  return key.split('/').map(encodeURIComponent).join('/')
}

/**
 * Nome guardado de um arquivo enviado, como o PocketBase fazia: o nome original normalizado
 * (minúsculas, [a-z0-9_]) + "_" + 10 caracteres aleatórios + a extensão. Evita colisão e caracteres
 * problemáticos na chave; o nome original continua no registro para exibição e download.
 */
function storedFileName(originalName) {
  const name = String(originalName || 'arquivo')
  const dot = name.lastIndexOf('.')
  const rawExt = dot > 0 ? name.slice(dot + 1) : ''
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)
  let base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100)
  const random = (length) => {
    const bytes = require('node:crypto').randomBytes(length)
    let out = ''
    for (let i = 0; i < length; i++) out += 'abcdefghijklmnopqrstuvwxyz0123456789'[bytes[i] % 36]
    return out
  }
  if (base.length < 3) base = (base ? base + '_' : '') + random(5)
  return `${base}_${random(10)}${ext ? '.' + ext : ''}`
}

/**
 * @param {{ url: string, secretKey: string, bucket: string, fetch?: typeof fetch }} options
 */
function createStorage(options) {
  const base = String(options.url || '').replace(/\/+$/, '') + '/storage/v1'
  const bucket = options.bucket
  const doFetch = options.fetch || fetch
  const auth = { apikey: options.secretKey, Authorization: `Bearer ${options.secretKey}` }

  async function call(method, path, init) {
    const res = await doFetch(`${base}${path}`, Object.assign({ method }, init, { headers: Object.assign({}, auth, (init && init.headers) || {}) }))
    return res
  }

  async function fail(res, what) {
    const text = await res.text().catch(() => '')
    const err = new Error(`Storage: ${what} falhou (${res.status}) ${text.slice(0, 200)}`)
    err.status = res.status
    return err
  }

  return {
    bucket,

    /** Cria o bucket privado se ainda não existe. */
    async ensureBucket() {
      const found = await call('GET', `/bucket/${encodeURIComponent(bucket)}`)
      if (found.ok) return false
      const res = await call('POST', '/bucket', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bucket, name: bucket, public: false }),
      })
      if (!res.ok) throw await fail(res, `criar o bucket ${bucket}`)
      return true
    },

    async put(key, bytes, contentType) {
      const res = await call('POST', `/object/${encodeURIComponent(bucket)}/${encodeKey(key)}`, {
        headers: { 'Content-Type': contentType || 'application/octet-stream', 'x-upsert': 'true', 'Cache-Control': 'no-store' },
        body: bytes,
      })
      if (!res.ok) throw await fail(res, `gravar ${key}`)
    },

    /**
     * Resposta do Storage (corpo em stream) — repassa o Range do navegador. 404 vira null.
     * @returns {Promise<Response|null>}
     */
    async get(key, range) {
      const res = await call('GET', `/object/authenticated/${encodeURIComponent(bucket)}/${encodeKey(key)}`, {
        headers: range ? { Range: range } : {},
      })
      if (res.status === 404 || res.status === 400) {
        // o Storage responde 400 "not_found" para objeto inexistente em algumas versões
        const body = await res.text().catch(() => '')
        if (res.status === 404 || /not.?found/i.test(body)) return null
        const err = new Error(`Storage: ler ${key} falhou (400) ${body.slice(0, 200)}`)
        err.status = 400
        throw err
      }
      if (!res.ok && res.status !== 206) throw await fail(res, `ler ${key}`)
      return res
    },

    /** Conteúdo inteiro (cópias e testes). */
    async read(key) {
      const res = await this.get(key)
      return res ? Buffer.from(await res.arrayBuffer()) : null
    },

    async remove(keys) {
      const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean)
      if (list.length === 0) return
      list.forEach(encodeKey)
      const res = await call('DELETE', `/object/${encodeURIComponent(bucket)}`, {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: list }),
      })
      if (!res.ok) throw await fail(res, 'apagar arquivos')
    },

    /** Esvazia e apaga o bucket (só nos testes). */
    async dropBucket() {
      await call('POST', `/bucket/${encodeURIComponent(bucket)}/empty`)
      const res = await call('DELETE', `/bucket/${encodeURIComponent(bucket)}`)
      if (!res.ok && res.status !== 404) throw await fail(res, `apagar o bucket ${bucket}`)
    },
  }
}

/**
 * Storage dos repositórios: antes de enviar, a chave entra na lixeira por fora da transação; dentro
 * dela, sai. Se a transação for confirmada, o arquivo fica; se for desfeita, a entrada fica e a rotina
 * "storage-trash" apaga o arquivo — nenhum upload de uma gravação que falhou sobra no bucket.
 */
function guardStorage(storage, db) {
  return Object.assign({}, storage, {
    async put(key, bytes, contentType) {
      await db.detached.exec('INSERT INTO storage_trash ("key") VALUES ($1) ON CONFLICT ("key") DO UPDATE SET created = clock_timestamp()', [key])
      await storage.put(key, bytes, contentType)
      await db.exec('DELETE FROM storage_trash WHERE "key" = $1', [key])
    },
  })
}

module.exports = { createStorage, encodeKey, storedFileName, guardStorage }
