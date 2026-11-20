import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm, type Control, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { KeyRound, Mail, RefreshCw, Save, Send } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { formatDateTime } from '@/core/utils/format'
import { emailPatch, emailSettingsSchema, type EmailSettingsForm, type EmailSettingsView, type OutboxItem, type OutboxStatus } from '@/domain/email'
import {
  AppBadge,
  AppButton,
  AppCard,
  AppConfirmDialog,
  AppDataTable,
  AppEmptyState,
  AppErrorState,
  AppSkeleton,
  AppSwitch,
  AppTabs,
  AppTextField,
  notify,
  useDataTableState,
  type DataTableColumn,
} from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useRepositories } from '@/presentation/common/repositories-context'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { PLATFORM_INFO_QUERY_KEY } from '@/presentation/common/use-platform'
import { useSession } from '@/features/auth/session'
import { ALL_TOKENS_KEY, useTokenColumns } from '@/features/account/use-token-columns'
import type { ApiToken } from '@/domain/api-tokens'
import { WebhooksTab } from './WebhooksTab'

const EMAIL_KEY = ['integrations', 'email'] as const
const OUTBOX_KEY = ['integrations', 'email', 'outbox'] as const

/** Campos da API -> campos do formulário (erros de validação vindos do servidor). */
const API_FIELDS: Record<string, FieldPath<EmailSettingsForm>> = {
  enabled: 'enabled',
  host: 'host',
  port: 'port',
  username: 'username',
  password: 'password',
  tls: 'tls',
  sender_name: 'senderName',
  sender_address: 'senderAddress',
  app_url: 'appUrl',
}

/** Configurações → Integrações (integrations.manage): e-mail (SMTP, teste e fila), webhooks e tokens de API de todos. */
export function IntegrationsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState('email')
  return (
    <>
      <PageHeader title={t('integrations.title')} />
      <AppTabs
        aria-label={t('integrations.title')}
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'email', label: t('integrations.tabs.email'), content: <EmailTab /> },
          { value: 'webhooks', label: t('integrations.tabs.webhooks'), content: <WebhooksTab /> },
          { value: 'tokens', label: t('integrations.tabs.tokens'), content: <AllTokensTab /> },
        ]}
      />
    </>
  )
}

function EmailTab() {
  const { email } = useRepositories()
  const settings = useQuery({ queryKey: EMAIL_KEY, queryFn: () => email.getSettings() })
  if (settings.isPending) return <AppSkeleton className="mt-4 h-96 rounded-xl" />
  if (settings.isError) return <AppErrorState onRetry={() => void settings.refetch()} />
  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <SmtpCard view={settings.data} />
      <div className="flex min-w-0 flex-col gap-4">
        <TestCard enabled={settings.data.values.enabled} />
        <OutboxCard />
      </div>
    </div>
  )
}

function SmtpCard({ view }: { view: EmailSettingsView }) {
  const { t } = useTranslation()
  const { email } = useRepositories()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const defaults = useMemo<EmailSettingsForm>(() => ({ ...view.values, password: '' }), [view.values])
  const { register, handleSubmit, reset, setError, control, formState } = useForm<EmailSettingsForm>({ resolver: zodResolver(emailSettingsSchema), defaultValues: defaults })
  useEffect(() => reset(defaults), [defaults, reset])

  const onSaved = (next: EmailSettingsView) => {
    queryClient.setQueryData(EMAIL_KEY, next)
    void queryClient.invalidateQueries({ queryKey: PLATFORM_INFO_QUERY_KEY })
  }
  const save = useMutation({
    mutationFn: (values: EmailSettingsForm) => email.updateSettings(emailPatch(view.values, values)),
    onSuccess: (next) => {
      onSaved(next)
      notify.success(t('integrations.email.saved'))
    },
    onError: (error) => {
      if (isAppError(error) && error.code === 'VALIDATION_ERROR') {
        Object.entries(error.fieldErrors()).forEach(([field, code]) => {
          const target = API_FIELDS[field]
          if (target) setError(target, { message: code })
        })
        return
      }
      notify.error(errorMessage(error))
    },
  })
  const removePassword = useMutation({
    mutationFn: () => email.updateSettings({ password: null }),
    onSuccess: (next) => {
      onSaved(next)
      notify.success(t('integrations.email.passwordRemoved'))
    },
    onError: (error) => notify.error(errorMessage(error)),
  })

  return (
    <AppCard
      title={t('integrations.email.smtpTitle')}
      description={t('integrations.email.smtpDescription')}
      actions={
        <AppButton type="submit" form="email-settings-form" leftIcon={<Save />} loading={save.isPending}>
          {t('common.save')}
        </AppButton>
      }
    >
      <form id="email-settings-form" onSubmit={handleSubmit((values) => save.mutate(values))} noValidate className="flex flex-col gap-4">
        <Controller
          control={control}
          name="enabled"
          render={({ field }) => (
            <AppSwitch checked={field.value} onCheckedChange={field.onChange} label={t('integrations.email.enabled')} description={t('integrations.email.enabledHint')} />
          )}
        />
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <AppTextField label={t('integrations.email.host')} placeholder="smtp.empresa.com" error={formState.errors.host?.message} {...register('host')} />
          <PortField control={control} label={t('integrations.email.port')} />
        </div>
        <Controller
          control={control}
          name="tls"
          render={({ field }) => <AppSwitch checked={field.value} onCheckedChange={field.onChange} label={t('integrations.email.tls')} description={t('integrations.email.tlsHint')} />}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <AppTextField label={t('integrations.email.username')} autoComplete="off" error={formState.errors.username?.message} {...register('username')} />
          <div className="flex flex-col gap-1.5">
            <AppTextField
              label={t('integrations.email.password')}
              type="password"
              revealable
              autoComplete="new-password"
              placeholder={view.hasPassword ? t('integrations.email.passwordSaved') : undefined}
              hint={view.hasPassword ? t('integrations.email.passwordKeep') : undefined}
              error={formState.errors.password?.message}
              {...register('password')}
            />
            {view.hasPassword && (
              <AppButton type="button" variant="link" size="sm" className="self-start" loading={removePassword.isPending} onClick={() => removePassword.mutate()}>
                {t('integrations.email.removePassword')}
              </AppButton>
            )}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <AppTextField label={t('integrations.email.senderName')} error={formState.errors.senderName?.message} {...register('senderName')} />
          <AppTextField label={t('integrations.email.senderAddress')} type="email" placeholder="kamban@empresa.com" error={formState.errors.senderAddress?.message} {...register('senderAddress')} />
        </div>
        <AppTextField
          label={t('integrations.email.appUrl')}
          placeholder="https://kamban.empresa.com"
          hint={t('integrations.email.appUrlHint')}
          error={formState.errors.appUrl?.message}
          {...register('appUrl')}
        />
      </form>
    </AppCard>
  )
}

/** Porta (inteiro) com teclado numérico, sem o seletor nativo. */
function PortField({ control, label }: { control: Control<EmailSettingsForm>; label: string }) {
  return (
    <Controller
      control={control}
      name="port"
      render={({ field, fieldState }) => (
        <AppTextField
          label={label}
          inputMode="numeric"
          error={fieldState.error?.message}
          value={Number.isFinite(field.value) ? String(field.value) : ''}
          onChange={(event) => {
            const digits = event.target.value.replace(/[^0-9]/g, '').slice(0, 5)
            field.onChange(digits === '' ? Number.NaN : Number(digits))
          }}
          onBlur={field.onBlur}
          ref={field.ref}
        />
      )}
    />
  )
}

function TestCard({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation()
  const { email } = useRepositories()
  const { current } = useSession()
  const errorMessage = useErrorMessage()
  const test = useMutation({
    mutationFn: () => email.sendTest(),
    onSuccess: (result) => notify.success(t('integrations.email.testSent', { email: result.to })),
    onError: (error) => {
      const reason = isAppError(error) && error.code === 'EMAIL_SEND_FAILED' ? String(error.details.reason ?? '') : ''
      notify.error(reason ? t('integrations.email.testFailed', { reason }) : errorMessage(error))
    },
  })
  return (
    <AppCard title={t('integrations.email.testTitle')} description={t('integrations.email.testDescription', { email: current?.user.email ?? '' })}>
      <AppButton variant="secondary" leftIcon={<Send />} disabled={!enabled} loading={test.isPending} onClick={() => test.mutate()}>
        {t('integrations.email.testSend')}
      </AppButton>
      {!enabled && <p className="mt-2 text-xs text-subtle">{t('integrations.email.testDisabled')}</p>}
    </AppCard>
  )
}

const STATUS_TONE: Record<OutboxStatus, 'neutral' | 'success' | 'danger'> = { pending: 'neutral', sent: 'success', failed: 'danger' }

function OutboxCard() {
  const { t, i18n } = useTranslation()
  const { email } = useRepositories()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const table = useDataTableState('email-outbox', { sort: null })
  const outbox = useQuery({ queryKey: OUTBOX_KEY, queryFn: () => email.outbox() })
  const flush = useMutation({
    mutationFn: () => email.flush(),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: OUTBOX_KEY })
      if (result.skipped) notify.info(t('integrations.email.flushSkipped'))
      else if (result.busy) notify.info(t('integrations.email.flushBusy'))
      else notify.success(t('integrations.email.flushed', { sent: result.sent, failed: result.failed + result.retrying }))
    },
    onError: (error) => notify.error(errorMessage(error)),
  })
  const columns = useMemo<DataTableColumn<OutboxItem>[]>(
    () => [
      { id: 'to', header: t('integrations.email.outbox.to'), cell: (m) => <span className="block max-w-56 truncate">{m.to}</span> },
      { id: 'kind', header: t('integrations.email.outbox.kind'), cell: (m) => t(`integrations.email.kinds.${m.kind}`) },
      {
        id: 'status',
        header: t('integrations.email.outbox.status'),
        cell: (m) => (
          <span className="flex flex-col gap-0.5">
            <AppBadge tone={STATUS_TONE[m.status]}>{t(`integrations.email.statuses.${m.status}`)}</AppBadge>
            {m.lastError && m.status !== 'sent' && <span className="max-w-56 truncate text-xs text-muted" title={m.lastError}>{m.lastError}</span>}
          </span>
        ),
      },
      { id: 'created', header: t('integrations.email.outbox.created'), cell: (m) => formatDateTime(m.createdAt, i18n.language) },
    ],
    [t, i18n.language],
  )

  return (
    <AppCard
      title={t('integrations.email.outboxTitle')}
      description={t('integrations.email.outboxDescription')}
      actions={
        <AppButton variant="secondary" size="sm" leftIcon={<RefreshCw />} loading={flush.isPending} onClick={() => flush.mutate()}>
          {t('integrations.email.flush')}
        </AppButton>
      }
    >
      {outbox.isPending ? (
        <AppSkeleton className="h-32 rounded-lg" />
      ) : outbox.isError ? (
        <AppErrorState onRetry={() => void outbox.refetch()} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2" aria-label={t('integrations.email.outboxTitle')}>
            {(['pending', 'sent', 'failed'] as const).map((status) => (
              <AppBadge key={status} tone={STATUS_TONE[status]}>
                {t(`integrations.email.counts.${status}`, { count: outbox.data.counts[status] })}
              </AppBadge>
            ))}
          </div>
          <AppDataTable
            caption={t('integrations.email.outboxTitle')}
            columns={columns}
            data={outbox.data.recent}
            total={outbox.data.recent.length}
            getRowId={(m) => m.id}
            table={table}
            paginated={false}
            searchable={false}
            emptyState={<AppEmptyState compact icon={<Mail />} title={t('integrations.email.outboxEmpty')} />}
          />
        </div>
      )}
    </AppCard>
  )
}

/** Tokens de API de todas as pessoas: quem criou, uso e revogar (ex.: pessoa que saiu da empresa). */
function AllTokensTab() {
  const { t } = useTranslation()
  const { apiTokens } = useRepositories()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const table = useDataTableState('api-tokens-all', { sort: null })
  const columns = useTokenColumns(true)
  const list = useQuery({ queryKey: ALL_TOKENS_KEY, queryFn: () => apiTokens.listAll() })
  const [revoking, setRevoking] = useState<ApiToken | null>(null)
  const revoke = useMutation({
    mutationFn: (token: ApiToken) => apiTokens.revokeAny(token.id),
    onSuccess: (token) => {
      setRevoking(null)
      void queryClient.invalidateQueries({ queryKey: ALL_TOKENS_KEY })
      notify.success(t('apiTokens.revoked', { name: token.name }))
    },
    onError: (error) => notify.error(errorMessage(error)),
  })
  if (list.isError) return <AppErrorState onRetry={() => void list.refetch()} />
  return (
    <div className="mt-4 flex flex-col gap-3">
      <p className="text-sm text-muted">{t('integrations.tokens.description')}</p>
      <AppDataTable
        caption={t('integrations.tabs.tokens')}
        columns={columns}
        data={list.data ?? []}
        total={list.data?.length ?? 0}
        loading={list.isPending}
        getRowId={(row) => row.id}
        table={table}
        paginated={false}
        searchable={false}
        actions={{ onDelete: (row) => setRevoking(row), canDelete: (row) => row.state === 'active', deleteLabel: (row) => t('apiTokens.revokeNamed', { name: row.name }) }}
        emptyState={<AppEmptyState compact icon={<KeyRound />} title={t('integrations.tokens.empty')} />}
      />
      <AppConfirmDialog
        open={!!revoking}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t('apiTokens.revokeTitle', { name: revoking?.name ?? '' })}
        description={t('integrations.tokens.revokeDescription', { user: revoking?.user?.name ?? '' })}
        confirmLabel={t('apiTokens.revoke')}
        tone="danger"
        loading={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking)}
      />
    </div>
  )
}
