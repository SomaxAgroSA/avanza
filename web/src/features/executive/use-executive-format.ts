import { useTranslation } from 'react-i18next'
import { formatNumber } from '@/core/utils/format'
import { mainHealthFactor, type ExecutiveHealth } from '@/domain/executive'
import type { HealthFactor, HealthLevel } from '@/domain/plan-management'

const dayDate = (day: string) => new Date(`${day}T00:00:00Z`)

/** Dia "AAAA-MM-DD" curto ("4 de nov."; com o ano quando não é o atual), sem deslocar pelo fuso. */
export function useDayText() {
  const { i18n } = useTranslation()
  return (day: string | null | undefined) => {
    if (!day) return '—'
    const date = dayDate(day)
    const sameYear = date.getUTCFullYear() === new Date().getFullYear()
    return new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' }).format(date)
  }
}

/** Horas ("1.200 h"). */
export function useHoursText() {
  const { t, i18n } = useTranslation()
  return (hours: number) => t('plan.report.hours', { value: formatNumber(Math.round(hours * 10) / 10, i18n.language) })
}

/** "13 tarefas · 7 elementos" — sem as partes zeradas (null quando tudo é zero). */
export function usePartsText() {
  const { t } = useTranslation()
  return (parts: { tasks?: number; items?: number; milestones?: number }): string | null => {
    const text = (['tasks', 'items', 'milestones'] as const)
      .filter((key) => (parts[key] ?? 0) > 0)
      .map((key) => t(`executive.parts.${key}`, { count: parts[key] }))
      .join(' · ')
    return text || null
  }
}

/** Nível da saúde ("Em dia", "Atenção", "Crítico", "Sem quadro"). */
export function useHealthLabel() {
  const { t } = useTranslation()
  return (level: HealthLevel) => t(`executive.hero.levels.${level}`)
}

/** "Prazos: 35% atrasado" — o pior fator, em poucas palavras. */
export function useHealthReason() {
  const factorText = useFactorText()
  return (health: ExecutiveHealth): string | null => {
    const factor = mainHealthFactor(health)
    return factor ? factorText(factor) : null
  }
}

export function useFactorText() {
  const { t } = useTranslation()
  return (factor: HealthFactor) => `${t(`plan.report.health.factors.${factor.key}`)}: ${shortReason(t, factor)}`
}

function shortReason(t: ReturnType<typeof useTranslation>['t'], factor: HealthFactor): string {
  if (factor.key === 'issues') return t('executive.portfolio.reason.issues', { count: factor.value ?? 0 })
  return t(`executive.portfolio.reason.${factor.key}`, { value: factor.value ?? 0 })
}
