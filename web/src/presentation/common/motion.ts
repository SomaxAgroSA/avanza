/**
 * Movimento na interface: só quando a pessoa não pediu "reduzir movimento" e fora da impressão
 * (o CSS também zera animações e transições nesses dois casos — styles/index.css).
 */
export function motionAllowed(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches && !window.matchMedia('print').matches
}

/** Rola até o elemento (suave quando o movimento é permitido), alinhado ao topo da área que rola. */
export function scrollToElement(element: Element | null) {
  element?.scrollIntoView({ behavior: motionAllowed() ? 'smooth' : 'auto', block: 'start' })
}
