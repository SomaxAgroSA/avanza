/**
 * Regras de anexos (diretriz §16): tipos permitidos, detecção do tipo REAL pelo conteúdo
 * (assinatura dos primeiros bytes) e nome de arquivo seguro. Nunca confiar só na extensão.
 *
 * Fora da lista de propósito: SVG e HTML (podem conter script), executáveis e afins.
 */

const MAX_FILE_SIZE = 20 * 1024 * 1024
const MAX_FILES_PER_UPLOAD = 10
/** Bytes lidos para identificar o tipo (e checar se texto é mesmo texto). */
const SNIFF_BYTES = 4096

const OOXML = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

/** extensão -> { mime, kind, family } — family é a assinatura de conteúdo exigida. */
const ALLOWED = {
  png: { mime: 'image/png', kind: 'image', family: 'png' },
  jpg: { mime: 'image/jpeg', kind: 'image', family: 'jpeg' },
  jpeg: { mime: 'image/jpeg', kind: 'image', family: 'jpeg' },
  gif: { mime: 'image/gif', kind: 'image', family: 'gif' },
  webp: { mime: 'image/webp', kind: 'image', family: 'webp' },
  pdf: { mime: 'application/pdf', kind: 'document', family: 'pdf' },
  docx: { mime: OOXML.docx, kind: 'document', family: 'zip' },
  xlsx: { mime: OOXML.xlsx, kind: 'document', family: 'zip' },
  pptx: { mime: OOXML.pptx, kind: 'document', family: 'zip' },
  zip: { mime: 'application/zip', kind: 'document', family: 'zip' },
  doc: { mime: 'application/msword', kind: 'document', family: 'ole' },
  xls: { mime: 'application/vnd.ms-excel', kind: 'document', family: 'ole' },
  ppt: { mime: 'application/vnd.ms-powerpoint', kind: 'document', family: 'ole' },
  txt: { mime: 'text/plain', kind: 'document', family: 'text' },
  log: { mime: 'text/plain', kind: 'document', family: 'text' },
  md: { mime: 'text/plain', kind: 'document', family: 'text' },
  csv: { mime: 'text/csv', kind: 'document', family: 'text' },
  json: { mime: 'application/json', kind: 'document', family: 'text' },
}

/** Tipos aceitos pelo campo de arquivo do PocketBase (segunda barreira, também por conteúdo). */
const STORAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/zip',
  OOXML.docx,
  OOXML.xlsx,
  OOXML.pptx,
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/x-ole-storage',
  'text/plain',
  'text/csv',
  'application/json',
]

function startsWith(bytes, signature, offset) {
  const at = offset || 0
  if (bytes.length < at + signature.length) return false
  for (let i = 0; i < signature.length; i++) {
    if (bytes[at + i] !== signature[i]) return false
  }
  return true
}

const ascii = (text) => text.split('').map((c) => c.charCodeAt(0))

/** Família do conteúdo pela assinatura (ou 'text' se parece texto; null se desconhecido). */
function sniff(bytes) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'gif'
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'webp'
  if (startsWith(bytes, ascii('%PDF-'))) return 'pdf'
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'zip'
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole'
  return looksLikeText(bytes) ? 'text' : null
}

/** Texto: sem byte nulo e quase sem caracteres de controle (tab, quebra de linha e ESC são aceitos). */
function looksLikeText(bytes) {
  if (bytes.length === 0) return false
  let control = 0
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b === 0) return false
    if (b < 0x09 || (b > 0x0d && b < 0x20 && b !== 0x1b)) control++
  }
  return control / bytes.length < 0.02
}

function extensionOf(name) {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(String(name || ''))
  return match ? match[1].toLowerCase() : ''
}

/**
 * Classifica o arquivo pelo nome E pelo conteúdo.
 * Retorna { mime, kind, ext } ou { error: 'unsupported_type' | 'type_mismatch' }.
 */
function classify(name, headBytes) {
  const ext = extensionOf(name)
  const allowed = ALLOWED[ext]
  if (!allowed) return { error: 'unsupported_type' }
  const family = sniff(headBytes || [])
  if (family !== allowed.family) return { error: 'type_mismatch' }
  return { mime: allowed.mime, kind: allowed.kind, ext }
}

function sizeIssue(size) {
  if (!size || size <= 0) return 'empty_file'
  return size > MAX_FILE_SIZE ? 'file_too_large' : null
}

/** Nome exibido/baixado: só o nome base, sem caracteres perigosos, até 150 caracteres. */
function safeFileName(name) {
  const base = String(name || '')
    .split(/[\\/]/)
    .pop()
    // remove caracteres de controle (intencional: nomes de arquivo não podem tê-los)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .trim()
  if (!base) return 'arquivo'
  if (base.length <= 150) return base
  const ext = extensionOf(base)
  const suffix = ext ? `.${ext}` : ''
  return base.slice(0, 150 - suffix.length) + suffix
}

module.exports = {
  MAX_FILE_SIZE,
  MAX_FILES_PER_UPLOAD,
  SNIFF_BYTES,
  STORAGE_MIME_TYPES,
  ALLOWED_EXTENSIONS: Object.keys(ALLOWED),
  classify,
  sizeIssue,
  safeFileName,
  extensionOf,
}
