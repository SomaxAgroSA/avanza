import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bell, CheckCheck } from 'lucide-react'
import { AppButton, AppEmptyState, AppErrorState, AppSkeleton, AppTabs } from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { NotificationItem } from './NotificationItem'
import { useNotificationMutations, useNotificationPages, useUnreadCount } from './queries'

export function NotificationsPage() {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const unread = useUnreadCount()
  const { markAllRead } = useNotificationMutations()
  useDocumentTitle(t('notifications.title'))

  return (
    <>
      <PageHeader
        title={t('notifications.title')}
        actions={
          <AppButton variant="secondary" leftIcon={<CheckCheck />} disabled={(unread.data ?? 0) === 0} loading={markAllRead.isPending} onClick={() => markAllRead.mutate()}>
            {t('notifications.markAllRead')}
          </AppButton>
        }
      />
      <AppTabs
        aria-label={t('notifications.title')}
        value={filter}
        onValueChange={(value) => setFilter(value === 'unread' ? 'unread' : 'all')}
        tabs={[
          { value: 'all', label: t('notifications.filters.all'), content: <NotificationList unreadOnly={false} /> },
          { value: 'unread', label: t('notifications.filters.unread', { count: unread.data ?? 0 }), content: <NotificationList unreadOnly /> },
        ]}
      />
    </>
  )
}

function NotificationList({ unreadOnly }: { unreadOnly: boolean }) {
  const { t } = useTranslation()
  const pages = useNotificationPages(unreadOnly)
  if (pages.isPending) return <AppSkeleton className="h-48" />
  if (pages.isError) return <AppErrorState onRetry={() => void pages.refetch()} />
  const items = pages.data.pages.flatMap((page) => page.items)
  if (items.length === 0) {
    return <AppEmptyState icon={<Bell />} title={unreadOnly ? t('notifications.emptyUnread') : t('notifications.empty')} description={t('notifications.emptyHint')} />
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-0.5 rounded-xl border border-border bg-surface p-1.5">
        {items.map((notification) => (
          <li key={notification.id}>
            <NotificationItem notification={notification} />
          </li>
        ))}
      </ul>
      {pages.hasNextPage && (
        <div className="flex justify-center">
          <AppButton variant="secondary" loading={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
            {t('notifications.loadMore')}
          </AppButton>
        </div>
      )}
    </div>
  )
}
