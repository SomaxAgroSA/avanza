/**
 * Módulo de uma versão anterior: cada publicação troca os nomes dos arquivos das telas (code splitting).
 * Uma aba aberta antes dela ainda pede os nomes antigos e a tela não carrega. Em vez de mostrar o erro,
 * recarrega a página uma vez para pegar a versão nova — com trava, para nunca recarregar em ciclo.
 */

const KEY = 'avanza:reloaded-for-new-version'
// dentro desse intervalo, uma segunda falha não recarrega de novo (o erro aparece)
const COOLDOWN_MS = 30_000

const CHUNK_ERRORS = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return CHUNK_ERRORS.test(message)
}

interface ReloadOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem'>
  reload?: () => void
  now?: () => number
}

/** Recarrega para pegar a versão nova (true), a não ser que já tenha recarregado agora há pouco (false). */
export function reloadForNewVersion(options: ReloadOptions = {}): boolean {
  const now = (options.now ?? Date.now)()
  const reload = options.reload ?? (() => window.location.reload())
  let storage = options.storage
  try {
    storage ??= window.sessionStorage
  } catch {
    storage = undefined
  }
  const last = storage?.getItem(KEY)
  if (last && now - Number(last) < COOLDOWN_MS) return false
  try {
    storage?.setItem(KEY, String(now))
  } catch {
    // sem armazenamento: recarrega mesmo assim (o pior caso é o erro aparecer na segunda vez)
  }
  reload()
  return true
}
