import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { AtSign, BellRing, CalendarClock, CircleDot, MessageSquare, Reply, UserCheck, type LucideIcon } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { formatDateTime, formatDay, formatRelative } from '@/core/utils/format'
import { notificationLink, type AppNotification, type NotificationType } from '@/domain/notifications'
import { AppAvatar } from '@/presentation/components'
import { useNotificationMutations } from './queries'

const ICONS: Record<NotificationType, LucideIcon> = {
  mention: AtSign,
  assigned: UserCheck,
  comment: MessageSquare,
  status_changed: CircleDot,
  due_soon: CalendarClock,
  overdue: BellRing,
  plan_mention: AtSign,
  plan_reply: Reply,
}

/** Linha de notificação: quem, o quê, em qual tarefa e quando. Clicar abre a tarefa e marca como lida. */
export function NotificationItem({ notification, onOpen }: { notification: AppNotification; onOpen?: () => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const navigate = useNavigate()
  const { markRead } = useNotificationMutations()
  const Icon = ICONS[notification.type]
  const actor = notification.actor?.name ?? t('notifications.system')

  const detail =
    notification.type === 'mention' || notification.type === 'comment' || notification.type === 'plan_mention' || notification.type === 'plan_reply'
      ? notification.data.comment
      : notification.type === 'status_changed'
        ? t('notifications.newStatus', { status: notification.data.status ?? '' })
        : notification.data.due_date
          ? t('notifications.dueOn', { date: formatDay(new Date(`${notification.data.due_date}T00:00:00Z`), locale) })
          : undefined

  function open() {
    if (!notification.read) markRead.mutate(notification.id)
    onOpen?.()
    const link = notificationLink(notification)
    if (link) void navigate(link)
  }

  return (
    <button
      type="button"
      onClick={open}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring',
        !notification.read && 'bg-primary-soft/40',
      )}
    >
      <span className="relative shrink-0">
        {notification.actor ? (
          <AppAvatar name={notification.actor.name} src={notification.actor.avatarUrl} size="sm" />
        ) : (
          <span className="flex size-7 items-center justify-center rounded-full bg-surface-2 text-muted">
            <Icon className="size-3.5" aria-hidden />
          </span>
        )}
        {notification.actor && (
          <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-surface text-primary-text ring-1 ring-border">
            <Icon className="size-2.5" aria-hidden />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-fg">
          {t(`notifications.types.${notification.type}`, { actor, code: notification.task?.code ?? '', name: notification.planItem?.name ?? '' })}
        </span>
        <span className="block truncate text-xs text-muted">{notification.task ? notification.task.title : t('notifications.planItemIn', { project: notification.planItem?.projectName ?? '' })}</span>
        {detail && <span className="mt-0.5 line-clamp-2 block text-xs text-subtle">{detail}</span>}
        <time className="mt-0.5 block text-[11px] text-subtle" dateTime={notification.createdAt?.toISOString()} title={formatDateTime(notification.createdAt, locale)}>
          {formatRelative(notification.createdAt, locale)}
        </time>
      </span>
      {!notification.read && (
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary">
          <span className="sr-only">{t('notifications.unread')}</span>
        </span>
      )}
    </button>
  )
}
