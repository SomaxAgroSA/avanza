import type { TFunction } from 'i18next'
import type { HealthFactor, HealthLevel } from '@/domain/plan-management'

/** Tom do selo de cada nível de saúde (relatório do quadro e painel executivo). */
export const HEALTH_TONE: Record<HealthLevel, 'success' | 'warning' | 'danger' | 'neutral'> = { ok: 'success', attention: 'warning', critical: 'danger', none: 'neutral' }

/** Frase do fator com o seu valor (nunca só a nota). */
export function factorDetail(t: TFunction, factor: HealthFactor): string {
  if (factor.level === 'none') return t(`plan.report.health.noData.${factor.key}`)
  switch (factor.key) {
    case 'schedule':
      return t('plan.report.health.detail.schedule', { value: factor.value, count: factor.count ?? 0, of: factor.of ?? 0 })
    case 'progress':
      return t('plan.report.health.detail.progress', { planned: factor.planned ?? 0, actual: factor.actual ?? 0, value: factor.value })
    case 'stuck':
      return t('plan.report.health.detail.stuck', { value: factor.value, count: factor.count ?? 0, of: factor.of ?? 0 })
    case 'effort':
      return t('plan.report.health.detail.effort', { value: factor.value, hours: factor.hours ?? 0 })
    default:
      return t('plan.report.health.detail.issues', { count: factor.value ?? 0 })
  }
}
