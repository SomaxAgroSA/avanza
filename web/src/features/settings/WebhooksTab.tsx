import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Copy, History, Plus, RefreshCw, RotateCcw, Send, Webhook as WebhookIcon } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { formatDateTime } from '@/core/utils/format'
import { eventSummary, groupsOf, isSelected, toggleEvent, toggleGroup, type CreatedWebhook, type Webhook, type WebhookDelivery, type WebhookInput } from '@/domain/webhooks'
import {
  AppBadge,
  AppButton,
  AppCheckbox,
  AppConfirmDialog,
  AppDataTable,
  AppDialog,
  AppDrawer,
  AppEmptyState,
  AppErrorState,
  AppIconButton,
  AppSkeleton,
  AppSwitch,
  AppTextField,
  notify,
  useDataTableState,
  type DataTableColumn,
} from '@/presentation/components'
import { useRepositories } from '@/presentation/common/repositories-context'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useCopy } from '@/presentation/common/use-copy'

const LIST_KEY = ['webhooks'] as const
const CATALOG_KEY = ['webhooks', 'catalog'] as const

/** Integrações → Webhooks (integrations.manage). */
export function WebhooksTab() {
  const { t, i18n } = useTranslation()
  const { webhooks } = useRepositories()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const table = useDataTableState('webhooks', { sort: null })
  const list = useQuery({ queryKey: LIST_KEY, queryFn: () => webhooks.list() })
  const catalog = useQuery({ queryKey: CATALOG_KEY, queryFn: () => webhooks.catalog(), staleTime: Infinity })
  const [editing, setEditing] = useState<Webhook | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Webhook | null>(null)
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null)
  const [viewing, setViewing] = useState<Webhook | null>(null)
  const refresh = () => void queryClient.invalidateQueries({ queryKey: LIST_KEY })

  const remove = useMutation({
    mutationFn: (w: Webhook) => webhooks.remove(w.id),
    onSuccess: () => {
      setDeleting(null)
      refresh()
      notify.success(t('webhooks.deleted'))
    },
    onError: (error) => notify.error(errorMessage(error)),
  })
  const test = useMutation({
    mutationFn: (w: Webhook) => webhooks.test(w.id),
    onSuccess: (delivery) => {
      refresh()
      if (delivery.status === 'success') notify.success(t('webhooks.testOk', { status: delivery.responseStatus ?? '' }))
      else notify.error(t('webhooks.testFailed', { reason: delivery.error ?? '' }))
    },
    onError: (error) => notify.error(errorMessage(error)),
  })
  const rotate = useMutation({
    mutationFn: (w: Webhook) => webhooks.rotateSecret(w.id).then((r) => ({ name: w.name, value: r.secret })),
    onSuccess: setSecret,
    onError: (error) => notify.error(errorMessage(error)),
  })

  const events = useMemo(() => catalog.data?.events ?? [], [catalog.data])
  const columns = useMemo<DataTableColumn<Webhook>[]>(
    () => [
      { id: 'name', header: t('webhooks.columns.name'), cell: (w) => <span className="font-medium text-fg">{w.name}</span> },
      { id: 'url', header: t('webhooks.columns.url'), cell: (w) => <span className="block max-w-72 truncate font-mono text-xs" title={w.url}>{w.url}</span> },
      {
        id: 'events',
        header: t('webhooks.columns.events'),
        cell: (w) => t('webhooks.eventsCount', { count: eventSummary(w.events, events).count }),
      },
      {
        id: 'status',
        header: t('webhooks.columns.status'),
        cell: (w) => (
          <span className="flex flex-col gap-0.5">
            <AppBadge tone={w.active ? 'success' : 'neutral'}>{w.active ? t('webhooks.active') : t('webhooks.inactive')}</AppBadge>
            {w.consecutiveFailures > 0 && <span className="text-xs text-danger">{t('webhooks.failures', { count: w.consecutiveFailures })}</span>}
          </span>
        ),
      },
      {
        id: 'last',
        header: t('webhooks.columns.lastDelivery'),
        cell: (w) => (w.lastDeliveryAt ? `${formatDateTime(w.lastDeliveryAt, i18n.language)} · ${w.lastStatus || t('webhooks.noResponse')}` : t('webhooks.never')),
      },
    ],
    [t, i18n.language, events],
  )

  if (list.isError) return <AppErrorState onRetry={() => void list.refetch()} />

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted">{t('webhooks.description')}</p>
        <AppButton leftIcon={<Plus />} onClick={() => setEditing('new')} disabled={!catalog.data}>
          {t('webhooks.create')}
        </AppButton>
      </div>
      <AppDataTable
        caption={t('integrations.tabs.webhooks')}
        columns={columns}
        data={list.data ?? []}
        total={list.data?.length ?? 0}
        loading={list.isPending}
        getRowId={(w) => w.id}
        table={table}
        paginated={false}
        searchable={false}
        actions={{
          onView: (w) => setViewing(w),
          onEdit: (w) => setEditing(w),
          onDelete: (w) => setDeleting(w),
          more: (w) => [
            { key: 'test', label: t('webhooks.test'), icon: <Send />, onSelect: () => test.mutate(w) },
            { key: 'rotate', label: t('webhooks.rotateSecret'), icon: <RotateCcw />, onSelect: () => rotate.mutate(w) },
          ],
        }}
        emptyState={<AppEmptyState compact icon={<WebhookIcon />} title={t('webhooks.empty')} description={t('webhooks.emptyHint')} />}
      />
      {editing && catalog.data && (
        <WebhookDialog
          webhook={editing === 'new' ? null : editing}
          catalog={catalog.data.events}
          onClose={() => setEditing(null)}
          onSaved={(created) => {
            setEditing(null)
            refresh()
            if (created) setSecret({ name: created.name, value: created.secret })
          }}
        />
      )}
      {secret && <SecretDialog name={secret.name} secret={secret.value} onClose={() => setSecret(null)} />}
      {viewing && <DeliveriesDrawer webhook={viewing} onClose={() => setViewing(null)} />}
      <AppConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('webhooks.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('webhooks.deleteDescription')}
        confirmLabel={t('common.delete')}
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  )
}

/** Campos da API -> campos do formulário. */
const FIELD_KEYS = ['name', 'url', 'events', 'active'] as const

function WebhookDialog({ webhook, catalog, onClose, onSaved }: { webhook: Webhook | null; catalog: string[]; onClose: () => void; onSaved: (created: CreatedWebhook | null) => void }) {
  const { t } = useTranslation()
  const { webhooks } = useRepositories()
  const errorMessage = useErrorMessage()
  const [form, setForm] = useState<WebhookInput>({ name: webhook?.name ?? '', url: webhook?.url ?? '', events: webhook?.events ?? [], active: webhook?.active ?? true })
  const [errors, setErrors] = useState<Partial<Record<(typeof FIELD_KEYS)[number], string>>>({})
  const groups = useMemo(() => groupsOf(catalog), [catalog])
  const set = <K extends keyof WebhookInput>(key: K, value: WebhookInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const save = useMutation({
    mutationFn: async (): Promise<CreatedWebhook | null> => {
      const input = { ...form, name: form.name.trim(), url: form.url.trim() }
      if (webhook) {
        await webhooks.update(webhook.id, input)
        return null
      }
      return webhooks.create(input)
    },
    onSuccess: (created) => {
      notify.success(webhook ? t('webhooks.updated') : t('webhooks.created'))
      onSaved(created)
    },
    onError: (error) => {
      if (isAppError(error) && error.code === 'VALIDATION_ERROR') {
        const fields = error.fieldErrors()
        setErrors(Object.fromEntries(FIELD_KEYS.filter((k) => fields[k]).map((k) => [k, fields[k]])))
        return
      }
      notify.error(errorMessage(error))
    },
  })

  function submit() {
    const next: typeof errors = {}
    if (!form.name.trim()) next.name = 'required'
    if (!form.url.trim()) next.url = 'required'
    if (form.events.length === 0) next.events = 'required'
    setErrors(next)
    if (Object.keys(next).length === 0) save.mutate()
  }

  return (
    <AppDialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="xl"
      closeOnOutsideClick={false}
      title={webhook ? t('webhooks.editTitle') : t('webhooks.createTitle')}
      description={t('webhooks.formDescription')}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} loading={save.isPending}>
            {webhook ? t('common.save') : t('webhooks.create')}
          </AppButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <AppTextField label={t('webhooks.fields.name')} required maxLength={80} value={form.name} error={errors.name} onChange={(e) => set('name', e.target.value)} />
          <AppTextField
            label={t('webhooks.fields.url')}
            required
            placeholder="https://hooks.empresa.com/kamban"
            value={form.url}
            hint={t('webhooks.fields.urlHint')}
            error={errors.url}
            onChange={(e) => set('url', e.target.value)}
          />
        </div>
        <AppSwitch checked={form.active} onCheckedChange={(on) => set('active', on)} label={t('webhooks.fields.active')} />
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium text-fg">{t('webhooks.fields.events')}</legend>
          {errors.events && (
            <p role="alert" className="text-sm text-danger">
              {t(`validation.${errors.events}`)}
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {groups.map(({ group, events }) => {
              const all = form.events.includes(`${group}.*`)
              return (
                <div key={group} className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
                  <AppCheckbox
                    checked={all ? true : events.some((e) => isSelected(form.events, e)) ? 'indeterminate' : false}
                    onCheckedChange={(on) => set('events', toggleGroup(form.events, group, on))}
                    label={<span className="font-medium">{t('webhooks.groupAll', { group: t(`webhooks.groups.${group}`) })}</span>}
                  />
                  <div className="ml-6 flex flex-col gap-1">
                    {events.map((event) => (
                      <AppCheckbox
                        key={event}
                        checked={isSelected(form.events, event)}
                        onCheckedChange={(on) => set('events', toggleEvent(form.events, event, on, catalog))}
                        label={
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            <span>{t(`audit.actions.${event}`, { defaultValue: event })}</span>
                            <code className="text-xs text-subtle">{event}</code>
                          </span>
                        }
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </fieldset>
      </div>
    </AppDialog>
  )
}

function SecretDialog({ name, secret, onClose }: { name: string; secret: string; onClose: () => void }) {
  const { t } = useTranslation()
  const copyText = useCopy()
  const copy = () => void copyText(secret)
  return (
    <AppDialog open onOpenChange={(open) => !open && onClose()} size="lg" closeOnOutsideClick={false} title={t('webhooks.secretTitle', { name })} description={t('webhooks.secretDescription')} footer={<AppButton onClick={onClose}>{t('apiTokens.done')}</AppButton>}>
      <div className="flex flex-col gap-4">
        <div className="flex items-end gap-2">
          <AppTextField label={t('webhooks.secret')} readOnly value={secret} className="font-mono" fieldClassName="min-w-0 flex-1" onFocus={(event) => event.target.select()} />
          <AppIconButton label={t('webhooks.copySecret')} icon={<Copy />} variant="secondary" onClick={copy} />
        </div>
        <div className="flex flex-col gap-1.5 text-sm text-muted">
          <p className="font-medium text-fg">{t('webhooks.verifyTitle')}</p>
          <p>{t('webhooks.verifyText')}</p>
          <code className="block overflow-x-auto whitespace-pre rounded-md bg-surface-2 px-3 py-2 text-xs text-fg">{'hex(HMAC_SHA256(segredo, X-Kamban-Timestamp + "." + corpo)) == X-Kamban-Signature sem "sha256="'}</code>
        </div>
      </div>
    </AppDialog>
  )
}

const DELIVERY_TONE = { pending: 'neutral', success: 'success', failed: 'danger' } as const

function DeliveriesDrawer({ webhook, onClose }: { webhook: Webhook; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const { webhooks } = useRepositories()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const key = ['webhooks', webhook.id, 'deliveries']
  const list = useQuery({ queryKey: key, queryFn: () => webhooks.deliveries(webhook.id) })
  const redeliver = useMutation({
    mutationFn: (d: WebhookDelivery) => webhooks.redeliver(d.id),
    onSuccess: (d) => {
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: LIST_KEY })
      if (d.status === 'success') notify.success(t('webhooks.redelivered'))
      else notify.error(t('webhooks.testFailed', { reason: d.error ?? '' }))
    },
    onError: (error) => notify.error(errorMessage(error)),
  })
  return (
    <AppDrawer
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={t('webhooks.deliveriesTitle', { name: webhook.name })}
      description={t('webhooks.deliveriesDescription')}
      headerActions={<AppIconButton label={t('common.refresh')} icon={<RefreshCw />} onClick={() => void list.refetch()} />}
    >
      {list.isPending ? (
        <AppSkeleton className="h-40 rounded-lg" />
      ) : list.isError ? (
        <AppErrorState onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <AppEmptyState compact icon={<History />} title={t('webhooks.noDeliveries')} />
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t('webhooks.deliveriesTitle', { name: webhook.name })}>
          {list.data.map((d) => (
            <li key={d.id} className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <AppBadge tone={DELIVERY_TONE[d.status]}>{t(`webhooks.deliveryStatus.${d.status}`)}</AppBadge>
                  <code className="text-xs">{d.event}</code>
                </span>
                <AppButton size="sm" variant="secondary" leftIcon={<RotateCcw />} loading={redeliver.isPending && redeliver.variables?.id === d.id} onClick={() => redeliver.mutate(d)}>
                  {t('webhooks.redeliver')}
                </AppButton>
              </div>
              <p className="text-xs text-muted">
                {t('webhooks.deliveryLine', {
                  date: formatDateTime(d.deliveredAt ?? d.createdAt, i18n.language),
                  status: d.responseStatus ?? t('webhooks.noResponse'),
                  attempts: d.attempts,
                  ms: d.durationMs ?? 0,
                })}
              </p>
              {d.error && d.status !== 'success' && <p className="break-all text-xs text-danger">{d.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </AppDrawer>
  )
}
