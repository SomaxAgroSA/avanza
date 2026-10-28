import { useState } from 'react'
import { Link } from 'react-router'
import { Popover } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import { Bell, CheckCheck } from 'lucide-react'
import { AppButton, AppEmptyState, AppSkeleton } from '@/presentation/components'
import { NotificationItem } from './NotificationItem'
import { useNotificationMutations, useRecentNotifications, useUnreadCount } from './queries'

/** Sino da barra superior: contador de não lidas e as notificações mais recentes. */
export function NotificationBell() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const unread = useUnreadCount()
  const recent = useRecentNotifications(open)
  const { markAllRead } = useNotificationMutations()
  const count = unread.data ?? 0
  const items = recent.data?.items ?? []

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={count > 0 ? t('notifications.bellWithCount', { count }) : t('notifications.bell')}
          className="relative inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Bell className="size-[18px]" aria-hidden />
          {count > 0 && (
            <span aria-hidden className="absolute right-1 top-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-danger-fg">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 flex max-h-[min(32rem,80dvh)] w-[min(24rem,calc(100vw-1.5rem))] flex-col rounded-xl border border-border bg-surface shadow-float animate-scale-in focus:outline-none"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-fg">{t('notifications.title')}</h2>
            <AppButton variant="ghost" size="sm" leftIcon={<CheckCheck />} disabled={count === 0} loading={markAllRead.isPending} onClick={() => markAllRead.mutate()}>
              {t('notifications.markAllRead')}
            </AppButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {recent.isPending ? (
              <AppSkeleton className="m-2 h-24" />
            ) : items.length === 0 ? (
              <AppEmptyState compact icon={<Bell />} title={t('notifications.empty')} description={t('notifications.emptyHint')} />
            ) : (
              <ul className="flex flex-col gap-0.5">
                {items.map((notification) => (
                  <li key={notification.id}>
                    <NotificationItem notification={notification} onOpen={() => setOpen(false)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-border p-2 text-center">
            <Link to="/notifications" onClick={() => setOpen(false)} className="text-sm font-medium text-primary-text hover:underline">
              {t('notifications.seeAll')}
            </Link>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
