import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { URGENCY_FILTER_VALUES, isUrgency } from '@/domain/urgency'
import { UrgencyLight } from './TaskUrgency'

/** Opções do campo Urgência nos formulários e no painel da tarefa: Alta, Média, Baixa e Sem urgência, com o semáforo. */
export function useUrgencyChoices() {
  const { t } = useTranslation()
  return useMemo(
    () => URGENCY_FILTER_VALUES.map((value) => ({ value, label: t(`tasks.urgency.${value}`), prefix: <UrgencyLight urgency={isUrgency(value) ? value : null} /> })),
    [t],
  )
}
