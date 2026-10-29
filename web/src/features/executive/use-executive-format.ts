import { useTranslation } from 'react-i18next'
import { formatDay, formatNumber } from '@/core/utils/format'
import { executiveDuration, mainHealthFactor, type ExecutiveHealth } from '@/domain/executive'
import type { HealthFactor, HealthLevel } from '@/domain/plan-management'

/** Dia "AAAA-MM-DD" no formato do idioma (sem deslocar o dia pelo fuso). */
export function useDayText() {
  const { i18n } = useTranslation()
  return (day: string | null | undefined) => (day ? formatDay(new Date(`${day}T00:00:00Z`), i18n.language) : '—')
}

/** Horas ("1.200 h"), ou "—" sem dados. */
export function useHoursText() {
  const { t, i18n } = useTranslation()
  return (hours: number | null) => (hours === null ? '—' : t('plan.report.hours', { value: formatNumber(Math.round(hours * 10) / 10, i18n.language) }))
}

/** Tempo médio: horas abaixo de 24 h; depois, dias. */
export function useAverageTimeText() {
  const { t, i18n } = useTranslation()
  return (hours: number | null) => {
    const parts = executiveDuration(hours)
    return parts ? t(`reports.units.${parts.unit}`, { value: formatNumber(parts.value, i18n.language) }) : '—'
  }
}

/** Nível da saúde: os do relatório do quadro; sem quadro de gestão tem rótulo próprio. */
export function useHealthLabel() {
  const { t } = useTranslation()
  return (level: HealthLevel) => (level === 'none' ? t('executive.health.none') : t(`plan.report.health.levels.${level}`))
}

/** "Prazos: 35% atrasado" — o pior fator, em poucas palavras. */
export function useHealthReason() {
  const { t } = useTranslation()
  return (health: ExecutiveHealth): string | null => {
    const factor = mainHealthFactor(health)
    if (!factor) return null
    return `${t(`plan.report.health.factors.${factor.key}`)}: ${shortReason(t, factor)}`
  }
}

function shortReason(t: ReturnType<typeof useTranslation>['t'], factor: HealthFactor): string {
  if (factor.key === 'issues') return t('executive.portfolio.reason.issues', { count: factor.value ?? 0 })
  return t(`executive.portfolio.reason.${factor.key}`, { value: factor.value ?? 0 })
}
