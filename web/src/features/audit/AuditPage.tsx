import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { formatDateTime, formatRelative } from '@/core/utils/format'
import type { AuditEntry } from '@/domain/entities'
import {
  AppAvatar,
  AppBadge,
  AppDataTable,
  AppDrawer,
  useDataTableState,
  type DataTableColumn,
} from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useRoles } from '@/features/settings/queries'
import { useAuditLogs } from './queries'
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, actionLabel, describeChanges, entityTypeLabel } from './audit-format'

const EMPTY: AuditEntry[] = []

function actionTone(action: string) {
  if (action.endsWith('failed') || action.endsWith('deleted') || action.endsWith('disabled')) return 'danger' as const
  if (action.endsWith('created') || action.endsWith('enabled')) return 'success' as const
  if (action.startsWith('auth.')) return 'info' as const
  return 'neutral' as const
}

/** Histórico de auditoria (somente leitura). Permissão: audit.view. */
export function AuditPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const table = useDataTableState('audit', { perPage: 50 })
  const logs = useAuditLogs({ page: table.state.page, perPage: table.state.perPage, filters: table.state.filters })
  const roles = useRoles()
  const [viewing, setViewing] = useState<AuditEntry | null>(null)

  const roleNames = useMemo(() => new Map((roles.data ?? []).map((r) => [r.id, r.name])), [roles.data])
  const resolve = (field: string, value: string) => (field === 'role_id' ? roleNames.get(value) : undefined)

  const columns = useMemo<DataTableColumn<AuditEntry>[]>(
    () => [
      {
        id: 'created_at',
        header: t('audit.columns.when'),
        hideable: false,
        size: 190,
        cell: (entry) => (
          <time className="text-muted" dateTime={entry.createdAt?.toISOString()} title={formatRelative(entry.createdAt, locale)}>
            {formatDateTime(entry.createdAt, locale)}
          </time>
        ),
      },
      {
        id: 'action',
        header: t('audit.columns.action'),
        size: 220,
        cell: (entry) => <AppBadge tone={actionTone(entry.action)}>{actionLabel(t, entry.action)}</AppBadge>,
        filter: { label: t('audit.columns.action'), options: AUDIT_ACTIONS.map((a) => ({ value: a, label: actionLabel(t, a) })) },
      },
      {
        id: 'entity_type',
        header: t('audit.columns.entity'),
        size: 200,
        cell: (entry) => (
          <span className="text-muted">
            {entityTypeLabel(t, entry.entityType)} <span className="font-mono text-xs text-subtle">{entry.entityId}</span>
          </span>
        ),
        filter: {
          label: t('audit.columns.entity'),
          options: AUDIT_ENTITY_TYPES.map((type) => ({ value: type, label: entityTypeLabel(t, type) })),
        },
      },
      {
        id: 'user',
        header: t('audit.columns.user'),
        size: 220,
        cell: (entry) =>
          entry.user ? (
            <div className="flex min-w-0 items-center gap-2">
              <AppAvatar name={entry.user.name ?? '?'} size="xs" />
              <span className="truncate">{entry.user.name ?? entry.user.id}</span>
            </div>
          ) : (
            <span className="text-subtle">{t('audit.system')}</span>
          ),
      },
      { id: 'ip', header: t('audit.columns.ip'), size: 130, cell: (entry) => <span className="font-mono text-xs text-muted">{entry.ip || '—'}</span> },
    ],
    [t, locale],
  )

  return (
    <>
      <PageHeader title={t('audit.title')} />
      <AppDataTable
        tableId="audit"
        caption={t('audit.title')}
        columns={columns}
        data={logs.data?.items ?? EMPTY}
        total={logs.data?.total ?? 0}
        getRowId={(entry) => entry.id}
        table={table}
        searchable={false}
        loading={logs.isPending}
        fetching={logs.isFetching}
        error={logs.isError ? { correlationId: isAppError(logs.error) ? logs.error.correlationId : undefined } : null}
        onRetry={() => void logs.refetch()}
        actions={{ onView: setViewing }}
      />
      <AuditDetailsDrawer entry={viewing} onOpenChange={(open) => !open && setViewing(null)} resolve={resolve} />
    </>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="break-all text-sm font-medium text-fg sm:text-right">{children}</dd>
    </div>
  )
}

function AuditDetailsDrawer({
  entry,
  onOpenChange,
  resolve,
}: {
  entry: AuditEntry | null
  onOpenChange: (open: boolean) => void
  resolve: (field: string, value: string) => string | undefined
}) {
  const { t, i18n } = useTranslation()
  const changes = entry ? describeChanges(t, entry, resolve) : []
  return (
    <AppDrawer open={!!entry} onOpenChange={onOpenChange} title={entry ? actionLabel(t, entry.action) : ''} description={t('audit.detailsDescription')}>
      {entry && (
        <div className="flex flex-col gap-6">
          <dl className="divide-y divide-border rounded-lg border border-border px-4">
            <Row label={t('audit.columns.when')}>{formatDateTime(entry.createdAt, i18n.language)}</Row>
            <Row label={t('audit.columns.user')}>{entry.user ? `${entry.user.name ?? ''} ${entry.user.email ? `(${entry.user.email})` : ''}` : t('audit.system')}</Row>
            <Row label={t('audit.columns.entity')}>
              {entityTypeLabel(t, entry.entityType)} · <span className="font-mono text-xs">{entry.entityId}</span>
            </Row>
            <Row label={t('audit.columns.ip')}>{entry.ip || '—'}</Row>
            <Row label={t('audit.correlationId')}>
              <span className="font-mono text-xs">{entry.correlationId || '—'}</span>
            </Row>
          </dl>
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">{t('audit.changes')}</h3>
            {changes.length === 0 ? (
              <p className="text-sm text-muted">{t('audit.noChanges')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-subtle">
                    <th className="pb-1 font-medium">{t('audit.field')}</th>
                    <th className="pb-1 font-medium">{t('audit.before')}</th>
                    <th className="w-4" aria-hidden />
                    <th className="pb-1 font-medium">{t('audit.after')}</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((change) => (
                    <tr key={change.field} className="border-t border-border align-top">
                      <td className="py-2 pr-3 font-medium text-muted">{change.label}</td>
                      <td className="py-2 pr-2 text-subtle">{change.before || '—'}</td>
                      <td className="py-2 text-subtle">
                        <ArrowRight className="size-3.5" aria-hidden />
                      </td>
                      <td className="py-2 pl-2 text-fg">{change.after || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </AppDrawer>
  )
}
