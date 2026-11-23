import { useTranslation } from 'react-i18next'
import { CircleCheckBig, CircleDashed, ClipboardCheck, FolderKanban, Inbox, PlayCircle, UserCheck, type LucideIcon } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { formatShortDateTime } from '@/core/utils/format'
import type { DemandStatus } from '@/domain/demands'
import type { PaletteColor } from '@/domain/task-config'
import { LookupBadge } from '@/features/workflow/workflow-visuals'

/** Cor e ícone de cada passo (paleta das opções, como os status): o mesmo em listas, caixas e página. */
const DEMAND_STATUS_LOOK: Record<DemandStatus, { color: PaletteColor; icon: LucideIcon }> = {
  unassigned: { color: 'violet', icon: Inbox },
  assigned: { color: 'blue', icon: UserCheck },
  in_progress: { color: 'green', icon: PlayCircle },
  to_validate: { color: 'amber', icon: ClipboardCheck },
  done: { color: 'gray', icon: CircleCheckBig },
}

/**
 * Selo do passo da demanda (Sem atribuir, Atribuída, Em andamento, Para validar, Concluída). `executor`: para quem
 * executa, "Para validar" aparece como "Em validação" (a ação é de quem pediu).
 */
export function DemandStatusBadge({ status, className, executor = false }: { status: DemandStatus; className?: string; executor?: boolean }) {
  const { t } = useTranslation()
  const look = DEMAND_STATUS_LOOK[status]
  const name = executor && status === 'to_validate' ? t('demands.status.inValidation') : t(`demands.status.${status}`)
  return <LookupBadge item={{ name, color: look.color }} icon={look.icon} className={className} />
}

/** Chip "Demanda interna" (no lugar do projeto). */
export function DemandChip({ className }: { className?: string }) {
  const { t } = useTranslation()
  return <LookupBadge item={{ name: t('demands.chip'), color: 'violet' }} icon={CircleDashed} className={cn('font-semibold', className)} />
}

/** Chip com o nome do projeto (tarefa de projeto com quem recebe e distribui, nas caixas de demandas). */
export function ProjectChip({ name, className }: { name: string; className?: string }) {
  return <LookupBadge item={{ name, color: 'gray' }} icon={FolderKanban} className={className} />
}

/** Data e hora curtas do prazo (ou da abertura). */
export function DemandDateTime({ date, className }: { date: Date | null; className?: string }) {
  const { i18n } = useTranslation()
  if (!date) return <span className={cn('text-subtle', className)}>—</span>
  return (
    <time className={className} dateTime={date.toISOString()}>
      {formatShortDateTime(date, i18n.language)}
    </time>
  )
}
