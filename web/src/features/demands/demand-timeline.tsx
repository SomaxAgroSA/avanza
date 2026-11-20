import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { formatNumber, formatShortDateTime } from '@/core/utils/format'
import type { AuditEntry } from '@/domain/entities'
import { AppAvatar, AppMarkdown } from '@/presentation/components'
import { actionLabel, describeChanges } from '@/features/audit/audit-format'
import type { TimelineEvent } from '@/features/tasks/TaskComments'

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** Comentários aparecem como eles mesmos na linha do tempo; o registro do histórico deles não se repete. */
const SKIPPED = ['comment.added', 'comment.edited', 'comment.deleted']

/**
 * Frase do evento da demanda (§45) a partir do histórico: abriu para…, atribuiu a… · prazo · horas, passou
 * a…, começou, concluiu, validou, devolveu; edições com os campos mudados. `note` = comentário obrigatório.
 */
export function demandEventText(t: TFunction, entry: AuditEntry, locale: string): { text: string; note: string } {
  const value = entry.newValue ?? {}
  const note = text(value.note)
  const details = () => {
    const parts: string[] = []
    const due = text(value.due_at)
    if (due) parts.push(t('demands.events.deadline', { date: formatShortDateTime(new Date(due), locale) }))
    if (typeof value.estimated_hours === 'number' && value.estimated_hours > 0) parts.push(t('demands.events.estimate', { hours: formatNumber(value.estimated_hours, locale) }))
    return parts.length ? ` · ${parts.join(' · ')}` : ''
  }
  switch (entry.action) {
    case 'task.created':
      return { text: t('demands.events.opened', { owner: text(value.demand_owner) }), note: '' }
    case 'task.demand_assigned':
      return { text: t('demands.events.assigned', { name: text(value.assignee) }) + details(), note }
    case 'task.demand_reassigned':
      return { text: t('demands.events.reassigned', { name: text(value.assignee) }) + details(), note }
    case 'task.demand_passed':
      return { text: t('demands.events.passed', { name: text(value.assignee) }), note }
    case 'task.demand_started':
      return { text: t('demands.events.started'), note }
    case 'task.demand_concluded':
      return { text: t('demands.events.concluded'), note }
    case 'task.demand_validated':
      return { text: t('demands.events.validated'), note }
    case 'task.demand_returned':
      return { text: t('demands.events.returned'), note }
    case 'task.updated': {
      const fields = describeChanges(t, entry).map((change) => change.label)
      return { text: t('demands.events.edited', { fields: fields.join(', ') }), note: '' }
    }
    case 'attachment.added':
      return { text: t('demands.events.attached', { name: text(value.attachments) }), note: '' }
    default:
      return { text: actionLabel(t, entry.action).toLowerCase(), note }
  }
}

/** Eventos do histórico como itens da linha do tempo (entre os comentários). */
export function useDemandEvents(entries: readonly AuditEntry[]): TimelineEvent[] {
  const { t, i18n } = useTranslation()
  return entries
    // anexos de comentário já aparecem no próprio comentário
    .filter((entry) => !SKIPPED.includes(entry.action) && !(entry.action === 'attachment.added' && entry.newValue?.comment))
    .map((entry) => {
      const actor = entry.user?.name ?? t('audit.system')
      const event = demandEventText(t, entry, i18n.language)
      return {
        id: entry.id,
        at: entry.createdAt,
        node: (
          <article className="flex gap-3" data-testid="demand-event">
            <AppAvatar name={actor} size="sm" />
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-xs text-muted">
                <time dateTime={entry.createdAt?.toISOString()}>{formatShortDateTime(entry.createdAt, i18n.language)}</time>
              </p>
              <p className="text-sm text-fg">
                <span className="font-semibold">{actor}</span> {event.text}
              </p>
              {event.note && (
                <div className="mt-1.5 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                  <AppMarkdown text={event.note} />
                </div>
              )}
            </div>
          </article>
        ),
      }
    })
}
