/** Âncora da tabela "Projetos que requerem atenção" (indicadores, rosca e síntese levam até ela). */
export const TABLE_ID = 'panorama-table'

/** Rola até a tabela (sem animação quando a pessoa pede menos movimento). */
export function scrollToTable() {
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.requestAnimationFrame(() => document.getElementById(TABLE_ID)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }))
}
