import { useLayoutEffect, useRef } from 'react'

/**
 * Linha de ferramentas que se adapta à largura medindo a si mesma (ajustes 23 e 24/11/2026): enquanto o
 * conteúdo não cabe, compacta mais um passo de `levels` (os passos se somam) e volta ao completo quando a tela
 * alarga. Sem estado do React: só o atributo `data-compact` na linha ("1 2 3"), lido pelas classes
 * `[[data-compact~='n']_&]` de cada item. O `ref` vai num elemento de dentro da linha (ou nela mesma): a linha é
 * o `[data-toolbar]` mais próximo (AppToolbar).
 */
export function useFitToolbar<T extends HTMLElement = HTMLDivElement>(levels: readonly string[]) {
  const ref = useRef<T>(null)
  const key = levels.join(' ')
  useLayoutEffect(() => {
    const bar = ref.current?.closest<HTMLElement>('[data-toolbar]')
    if (!bar || !key) return
    const fit = () => {
      bar.removeAttribute('data-compact')
      const applied: string[] = []
      for (const level of key.split(' ')) {
        if (bar.scrollWidth <= bar.clientWidth) return
        applied.push(level)
        bar.setAttribute('data-compact', applied.join(' '))
      }
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return () => bar.removeAttribute('data-compact')
    const observer = new ResizeObserver(fit)
    observer.observe(bar)
    return () => {
      observer.disconnect()
      bar.removeAttribute('data-compact')
    }
  })
  return ref
}
