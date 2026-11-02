import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Area } from '@/domain/workflow'

/** Opções do filtro "Área": as áreas ativas e "Sin área". */
export function useAreaFilterOptions(areas: Area[] | undefined) {
  const { t } = useTranslation()
  return useMemo(() => [...(areas ?? []).map((a) => ({ value: a.id, label: a.name })), { value: 'none', label: t('areas.none') }], [areas, t])
}
