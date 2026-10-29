/**
 * Cores das marcas dos gráficos, só com tokens do tema. A rampa do verde (faint → soft → primary)
 * mede avanço (ex.: etapas do fluxo); success/warning/danger ficam reservados para estados (saúde,
 * atraso); neutral para o que não conta (sem quadro, sem situação).
 */
export const CHART_TONES = {
  primary: { bg: 'bg-primary', text: 'text-primary' },
  'primary-soft': { bg: 'bg-primary/55', text: 'text-primary/55' },
  'primary-faint': { bg: 'bg-primary/25', text: 'text-primary/25' },
  accent: { bg: 'bg-accent', text: 'text-accent' },
  info: { bg: 'bg-info-soft-fg', text: 'text-info-soft-fg' },
  success: { bg: 'bg-success', text: 'text-success' },
  warning: { bg: 'bg-warning', text: 'text-warning' },
  danger: { bg: 'bg-danger', text: 'text-danger' },
  neutral: { bg: 'bg-border-strong', text: 'text-border-strong' },
} as const

export type AppChartTone = keyof typeof CHART_TONES

/** Classe de fundo do tom (bolinhas de legenda e marcadores fora dos gráficos). */
export function chartToneBg(tone: AppChartTone): string {
  return CHART_TONES[tone].bg
}
