import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { URGENCY_FILTER_VALUES } from '@/domain/urgency'

/** Opções do filtro de urgência (Alta, Média, Baixa, Sem urgência) para as listagens e o Kanban. */
export function useUrgencyFilterOptions() {
  const { t } = useTranslation()
  return useMemo(() => URGENCY_FILTER_VALUES.map((value) => ({ value, label: t(`tasks.urgency.${value}`) })), [t])
}
