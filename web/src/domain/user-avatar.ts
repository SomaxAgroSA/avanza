/**
 * Foto do usuário (regras de negócio §23): opcional — sem foto, o avatar mostra as iniciais. PNG, JPG ou
 * WebP até 2 MB; a tela confere antes de enviar e o servidor confere o conteúdo de verdade.
 */

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const AVATAR_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']

/** Valor do `accept` do seletor de arquivo. */
export const AVATAR_ACCEPT = AVATAR_EXTENSIONS.map((ext) => `.${ext}`).join(',')

export function avatarFileIssue(file: File): 'unsupported_type' | 'file_too_large' | null {
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? ''
  if (!AVATAR_EXTENSIONS.includes(ext)) return 'unsupported_type'
  return file.size > AVATAR_MAX_BYTES ? 'file_too_large' : null
}

/** Foto escolhida no formulário: `file` = nova foto; `removed` = tirar a atual. Nada = fica como está. */
export interface AvatarChoice {
  file: File | null
  removed: boolean
}

export const NO_AVATAR_CHANGE: AvatarChoice = { file: null, removed: false }
