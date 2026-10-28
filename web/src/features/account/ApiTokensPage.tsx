import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Copy, KeyRound, Plus } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { API_TOKEN_EXPIRY_DAYS, claudeMcpCommand, curlExample, type ApiToken, type ApiTokenExpiry, type CreatedApiToken } from '@/domain/api-tokens'
import { useTokenColumns } from './use-token-columns'
import {
  AppButton,
  AppConfirmDialog,
  AppDataTable,
  AppDialog,
  AppEmptyState,
  AppErrorState,
  AppIconButton,
  AppSelect,
  AppTextField,
  notify,
  useDataTableState,
} from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useRepositories } from '@/presentation/common/repositories-context'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useCan } from '@/features/auth/session'

const MINE_KEY = ['api-tokens', 'mine'] as const

/** Minha conta → Tokens de API: criar (o valor aparece uma vez), ver o uso e revogar. */
export function ApiTokensPage() {
  const { t } = useTranslation()
  const { apiTokens } = useRepositories()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const canCreate = useCan('api_tokens.create')
  const table = useDataTableState('api-tokens-mine', { sort: null })
  const list = useQuery({ queryKey: MINE_KEY, queryFn: () => apiTokens.listMine() })
  const columns = useTokenColumns(false)
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)
  const revoke = useMutation({
    mutationFn: (token: ApiToken) => apiTokens.revoke(token.id),
    onSuccess: (token) => {
      setRevoking(null)
      void queryClient.invalidateQueries({ queryKey: MINE_KEY })
      notify.success(t('apiTokens.revoked', { name: token.name }))
    },
    onError: (error) => notify.error(errorMessage(error)),
  })

  return (
    <>
      <PageHeader
        title={t('apiTokens.title')}
        description={t('apiTokens.description')}
        actions={
          <>
            <AppButton asChild variant="ghost" leftIcon={<ArrowLeft />}>
              <Link to="/account">{t('apiTokens.backToAccount')}</Link>
            </AppButton>
            {canCreate && (
              <AppButton leftIcon={<Plus />} onClick={() => setCreating(true)}>
                {t('apiTokens.create')}
              </AppButton>
            )}
          </>
        }
      />
      {list.isError ? (
        <AppErrorState onRetry={() => void list.refetch()} />
      ) : (
        <AppDataTable
          caption={t('apiTokens.title')}
          columns={columns}
          data={list.data ?? []}
          total={list.data?.length ?? 0}
          loading={list.isPending}
          getRowId={(row) => row.id}
          table={table}
          paginated={false}
          searchable={false}
          actions={{ onDelete: (row) => setRevoking(row), canDelete: (row) => row.state === 'active', deleteLabel: (row) => t('apiTokens.revokeNamed', { name: row.name }) }}
          emptyState={<AppEmptyState compact icon={<KeyRound />} title={t('apiTokens.empty')} description={canCreate ? t('apiTokens.emptyHint') : t('apiTokens.noPermission')} />}
        />
      )}
      <CreateTokenDialog open={creating} onOpenChange={setCreating} onCreated={() => void queryClient.invalidateQueries({ queryKey: MINE_KEY })} />
      <AppConfirmDialog
        open={!!revoking}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t('apiTokens.revokeTitle', { name: revoking?.name ?? '' })}
        description={t('apiTokens.revokeDescription')}
        confirmLabel={t('apiTokens.revoke')}
        tone="danger"
        loading={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking)}
      />
    </>
  )
}

function CreateTokenDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const { apiTokens } = useRepositories()
  const errorMessage = useErrorMessage()
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState<ApiTokenExpiry>(90)
  const [nameError, setNameError] = useState<string | undefined>()
  const [created, setCreated] = useState<CreatedApiToken | null>(null)

  const create = useMutation({
    mutationFn: () => apiTokens.create(name.trim(), expiry),
    onSuccess: (token) => {
      setCreated(token)
      onCreated()
    },
    onError: (error) => {
      if (isAppError(error) && error.code === 'VALIDATION_ERROR' && error.fieldErrors().name) {
        setNameError(error.fieldErrors().name)
        return
      }
      notify.error(errorMessage(error))
    },
  })

  function close(next: boolean) {
    if (next) return
    onOpenChange(false)
    // limpa só ao fechar: o valor do token não fica guardado em lugar nenhum da tela
    setName('')
    setExpiry(90)
    setNameError(undefined)
    setCreated(null)
  }

  function submit() {
    if (!name.trim()) {
      setNameError('required')
      return
    }
    create.mutate()
  }

  const copy = (text: string) => void navigator.clipboard?.writeText(text).then(() => notify.success(t('common.copied')))

  return (
    <AppDialog
      open={open}
      onOpenChange={close}
      size="lg"
      closeOnOutsideClick={false}
      title={created ? t('apiTokens.createdTitle') : t('apiTokens.createTitle')}
      description={created ? t('apiTokens.createdDescription') : t('apiTokens.createDescription')}
      footer={
        created ? (
          <AppButton onClick={() => close(false)}>{t('apiTokens.done')}</AppButton>
        ) : (
          <>
            <AppButton variant="secondary" onClick={() => close(false)} disabled={create.isPending}>
              {t('common.cancel')}
            </AppButton>
            <AppButton onClick={submit} loading={create.isPending}>
              {t('apiTokens.create')}
            </AppButton>
          </>
        )
      }
    >
      {created ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-end gap-2">
            <AppTextField label={t('apiTokens.value')} readOnly value={created.token} className="font-mono" fieldClassName="min-w-0 flex-1" onFocus={(event) => event.target.select()} />
            <AppIconButton label={t('apiTokens.copy')} icon={<Copy />} variant="secondary" onClick={() => copy(created.token)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-fg">{t('apiTokens.example')}</p>
            <code className="block overflow-x-auto whitespace-pre rounded-md bg-surface-2 px-3 py-2 text-xs">{curlExample(window.location.origin, created.token)}</code>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-fg">{t('apiTokens.claude')}</p>
            <div className="flex items-start gap-2">
              <code className="block min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-md bg-surface-2 px-3 py-2 text-xs">{claudeMcpCommand(window.location.origin, created.token)}</code>
              <AppIconButton label={t('apiTokens.copyClaude')} icon={<Copy />} variant="secondary" onClick={() => copy(claudeMcpCommand(window.location.origin, created.token))} />
            </div>
            <p className="text-xs text-muted">{t('apiTokens.claudeHint')}</p>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          noValidate
          className="grid gap-4 sm:grid-cols-2"
        >
          <AppTextField
            label={t('apiTokens.name')}
            required
            maxLength={80}
            value={name}
            hint={t('apiTokens.nameHint')}
            error={nameError}
            onChange={(event) => {
              setName(event.target.value)
              setNameError(undefined)
            }}
          />
          <AppSelect
            label={t('apiTokens.expires')}
            value={String(expiry)}
            onValueChange={(value) => setExpiry(Number(value) as ApiTokenExpiry)}
            options={API_TOKEN_EXPIRY_DAYS.map((days) => ({ value: String(days), label: days === 0 ? t('apiTokens.noExpiry') : t('apiTokens.days', { count: days }) }))}
            hint={expiry === 0 ? t('apiTokens.noExpiryHint') : undefined}
          />
        </form>
      )}
    </AppDialog>
  )
}
