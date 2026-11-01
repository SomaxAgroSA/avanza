import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { TASK_URGENCIES } from '@/domain/tasks'

/** Opções do filtro de urgência (Alta, Média, Baixa, Sem urgência) para as listagens. */
export function useUrgencyFilterOptions() {
  const { t } = useTranslation()
  return useMemo(() => [...TASK_URGENCIES, 'none' as const].map((value) => ({ value, label: t(`tasks.urgency.${value}`) })), [t])
}
