import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { NO_AREA, type Area } from '@/domain/workflow'

/** Opções do filtro "Área" (listagens, Kanban e Backlog): as áreas ativas e "Sem área". */
export function useAreaFilterOptions(areas: Area[] | undefined) {
  const { t } = useTranslation()
  return useMemo(() => [...(areas ?? []).map((a) => ({ value: a.id, label: a.name })), { value: NO_AREA, label: t('areas.none') }], [areas, t])
}
