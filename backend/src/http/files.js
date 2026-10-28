/**
 * Arquivos nas rotas: leitura dos uploads (multipart) e entrega dos arquivos guardados no Storage,
 * sempre depois de o caso de uso conferir a permissão.
 */

const { Readable } = require('node:stream')
const { appError } = require('../core/errors')
const { SNIFF_BYTES } = require('../domain/attachment')

// tipos que o navegador pode mostrar na própria aba (os mesmos do PocketBase); o resto baixa como anexo
const INLINE_TYPES = new Set([
  'image/png', 'image/jpg', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon', 'image/bmp',
  'video/webm', 'video/mp4', 'video/3gpp', 'video/quicktime', 'video/x-ms-wmv',
  'audio/basic', 'audio/aiff', 'audio/mpeg', 'audio/midi', 'audio/mp3', 'audio/wave', 'audio/wav', 'audio/x-wav',
  'audio/x-mpeg', 'audio/x-m4a', 'audio/aac', 'application/pdf', 'application/x-pdf',
])

const PASSTHROUGH = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']
// a mesma CSP que o PocketBase punha em todo arquivo servido: nada ativo roda a partir dele
const FILE_CSP = "default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; sandbox"

/**
 * Arquivos do campo `field`: nome, tamanho, os primeiros bytes (o tipo real é decidido por eles, não
 * pela extensão), o conteúdo inteiro e o `handle` que o repositório usa para gravar.
 */
async function readUploads(e, field) {
  const { files } = await e.multipart()
  return files
    .filter((file) => file.field === field)
    .map((file) => ({ name: file.name, size: file.size, head: file.buffer.subarray(0, SNIFF_BYTES), bytes: file.buffer, handle: file }))
}

/** Campo de texto do corpo multipart ('' quando não veio). */
async function formValue(e, name) {
  const { fields } = await e.multipart()
  return String(fields[name] || '').trim()
}

function contentDisposition(type, name) {
  const disposition = INLINE_TYPES.has(type) ? 'inline' : 'attachment'
  const ascii = String(name).replace(/[^\x20-\x7e]|["\\]/g, '_')
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/**
 * Responde com o arquivo `key` do Storage (repassa o Range; nosniff; CSP sandbox; sem cache), como o
 * PocketBase servia: `?download=1` força o download. A rota pode ter definido antes a CSP, o cache ou
 * o Content-Disposition (ex.: "attachment").
 */
async function serveStored(e, key, name) {
  const res = await e.runtime.storage.get(key, e.header('Range') || undefined)
  if (!res) throw appError('NOT_FOUND')
  const reply = e.reply
  PASSTHROUGH.forEach((header) => {
    const value = res.headers.get(header)
    if (value) reply.header(header, value)
  })
  reply.header('X-Content-Type-Options', 'nosniff')
  if (!reply.hasHeader('content-security-policy')) reply.header('Content-Security-Policy', FILE_CSP)
  if (!reply.hasHeader('cache-control') || reply.getHeader('cache-control') === 'no-store') reply.header('Cache-Control', 'private, no-store')
  if (e.query().download === '1') reply.header('Content-Disposition', contentDisposition('', name))
  else if (!reply.hasHeader('content-disposition')) {
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    reply.header('Content-Disposition', contentDisposition(type, name))
  }
  e.send(res.status, res.body ? Readable.fromWeb(res.body) : '')
  return { handled: true }
}

module.exports = { readUploads, formValue, serveStored, contentDisposition }
