import type { UserSummary } from './projects'

export type AttachmentKind = 'image' | 'document'

/** Arquivo enviado (anexo de tarefa, arquivo de elemento do quadro…): o que a galeria mostra. */
export interface FileItem {
  id: string
  name: string
  mime: string
  kind: AttachmentKind
  size: number
  uploadedBy: UserSummary | null
  createdAt: Date | null
  /** Endereço protegido do arquivo (a API confere o acesso). */
  url: string
  capabilities: { delete: boolean }
}

/** Arquivo do projeto (aba Arquivos), fora das tarefas. */
export interface ProjectFile extends FileItem {
  projectId: string
}

export interface Attachment extends FileItem {
  taskId: string
  /** Anexo de comentário (null = anexo da tarefa). */
  commentId: string | null
}

/** Mesmo limite do servidor (domain/attachment.js). */
export const MAX_FILE_SIZE = 20 * 1024 * 1024

/** Extensões aceitas (o servidor confere o CONTEÚDO; aqui é só um aviso rápido). */
export const ACCEPTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'zip', 'txt', 'log', 'md', 'csv', 'json'] as const
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const

/** Valor para o atributo `accept` do seletor de arquivos. */
export function acceptAttribute(imagesOnly = false): string {
  return (imagesOnly ? IMAGE_EXTENSIONS : ACCEPTED_EXTENSIONS).map((ext) => `.${ext}`).join(',')
}

export function extensionOf(name: string): string {
  return /\.([A-Za-z0-9]{1,10})$/.exec(name)?.[1]?.toLowerCase() ?? ''
}

/** Pré-checagem no navegador (código de validation.*), antes de enviar. */
export function fileIssue(file: { name: string; size: number }, imagesOnly = false): string | null {
  const ext = extensionOf(file.name)
  const allowed: readonly string[] = imagesOnly ? IMAGE_EXTENSIONS : ACCEPTED_EXTENSIONS
  if (!allowed.includes(ext)) return imagesOnly ? 'image_required' : 'unsupported_type'
  if (file.size <= 0) return 'empty_file'
  if (file.size > MAX_FILE_SIZE) return 'file_too_large'
  return null
}

/** Tamanho legível ("1,5 MB"). */
export function formatBytes(size: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`
}

/** Maior lado depois da compressão. */
export const MAX_IMAGE_DIMENSION = 2560
const COMPRESS_FROM_BYTES = 1.5 * 1024 * 1024

/**
 * Comprimir "quando apropriado" (diretriz §16): fotos grandes (JPEG/PNG/WebP) acima de 1,5 MB
 * ou maiores que 2560 px. GIF nunca (pode ser animado).
 */
export function shouldCompressImage(type: string, size: number, width: number, height: number): boolean {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return false
  return size > COMPRESS_FROM_BYTES || Math.max(width, height) > MAX_IMAGE_DIMENSION
}

/** Dimensões finais mantendo a proporção. */
export function fitWithin(width: number, height: number, max = MAX_IMAGE_DIMENSION): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

const GENERIC_PASTE = /^image\.(png|jpe?g|gif|webp)$/i

/**
 * Imagem colada (Ctrl+V) chega como "image.png": ganha um nome legível com data e hora
 * ("imagem-colada-20260930-140509.png"; `index` numera as seguintes). Arquivo com nome próprio fica igual.
 */
export function namePastedFile(file: File, base: string, now: Date = new Date(), index = 0): File {
  if (file.name && !GENERIC_PASTE.test(file.name)) return file
  const raw = extensionOf(file.name) || file.type.split('/')[1] || 'png'
  const ext = raw === 'jpeg' ? 'jpg' : raw
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return new File([file], `${base}-${stamp}${index > 0 ? `-${index + 1}` : ''}.${ext}`, { type: file.type, lastModified: file.lastModified })
}
