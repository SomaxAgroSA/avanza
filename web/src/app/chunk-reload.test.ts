import { describe, expect, it, vi } from 'vitest'
import { isChunkLoadError, reloadForNewVersion } from './chunk-reload'

describe('módulo de uma versão anterior', () => {
  it('reconhece a falha ao carregar um módulo (Chrome, Safari, Firefox e CSS)', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: http://x/assets/KanbanPage-a1.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: http://x/a.js'))).toBe(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/index-b2.css'))).toBe(true)
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })

  it('recarrega uma vez para pegar a versão nova; de novo logo em seguida, não (evita ciclo)', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    const reload = vi.fn()
    expect(reloadForNewVersion({ storage, reload, now: () => 1_000 })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    // a versão nova também falhou em seguida: deixa o erro aparecer
    expect(reloadForNewVersion({ storage, reload, now: () => 5_000 })).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
    // bem depois (outra publicação), recarrega de novo
    expect(reloadForNewVersion({ storage, reload, now: () => 60_000 })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
