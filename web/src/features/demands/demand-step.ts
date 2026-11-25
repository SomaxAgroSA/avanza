import { useTranslation } from 'react-i18next'
import { CircleCheckBig, ClipboardCheck, Inbox, PlayCircle, UserCheck, type LucideIcon } from 'lucide-react'
import type { DemandStatus } from '@/domain/demands'
import type { PaletteColor } from '@/domain/task-config'

/** Cor e ícone de cada passo (paleta das opções, como os status): o mesmo em listas, caixas, página e linha do tempo. */
export const DEMAND_STATUS_LOOK: Record<DemandStatus, { color: PaletteColor; icon: LucideIcon }> = {
  unassigned: { color: 'violet', icon: Inbox },
  assigned: { color: 'blue', icon: UserCheck },
  in_progress: { color: 'green', icon: PlayCircle },
  to_validate: { color: 'amber', icon: ClipboardCheck },
  done: { color: 'gray', icon: CircleCheckBig },
}

/** Cor do passo (paleta), para quem o desenha fora do selo (linha do tempo das tarefas, ajuste 25/11). */
export const demandStepColor = (status: DemandStatus): PaletteColor => DEMAND_STATUS_LOOK[status].color

/**
 * Passo do fluxo por extenso (ajuste 25/11): "Atribuída a Jorge Benitez" quando atribuída (com a pessoa); nos
 * outros passos, o nome do passo ("Sem atribuir", "Em andamento", "Para validar"…).
 */
export function useDemandStepText(): (status: DemandStatus, assignee: { name: string } | null | undefined) => string {
  const { t } = useTranslation()
  return (status, assignee) => (status === 'assigned' && assignee ? t('demands.step.assignedTo', { name: assignee.name }) : t(`demands.status.${status}`))
}
