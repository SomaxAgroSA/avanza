import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Controller, useForm, useWatch, type Control, type FieldPath, type UseFormRegisterReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Eraser, History, KeyRound, Save, ShieldAlert, Trash2, Type } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import {
  BRANDING_SLOTS,
  DEFAULT_BRANDING,
  acceptFor,
  brandingFileIssue,
  changedSettings,
  isShorterRetention,
  platformSettingsSchema,
  type BrandingSlot,
  type PlatformInfo,
  type PlatformSettings,
  type PlatformSettingsValues,
} from '@/domain/platform'
import { AppButton, AppCard, AppConfirmDialog, AppErrorState, AppFileDrop, AppSelect, AppSkeleton, AppSwitch, AppTextField, notify } from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useRepositories } from '@/presentation/common/repositories-context'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { PLATFORM_INFO_QUERY_KEY, usePlatformInfo } from '@/presentation/common/use-platform'
import { PASSWORD_POLICY_QUERY_KEY } from '@/features/auth/use-password-policy'

const SETTINGS_QUERY_KEY = ['platform', 'settings'] as const
const FORM_ID = 'platform-settings-form'

/** Campos da API -> campos do formulário (erros de validação vindos do servidor). */
const API_FIELDS: Record<string, keyof PlatformSettingsValues> = {
  audit_retention_months: 'auditRetentionMonths',
  lockout_threshold: 'lockoutThreshold',
  lockout_base_minutes: 'lockoutBaseMinutes',
  lockout_max_minutes: 'lockoutMaxMinutes',
  password_min_length: 'passwordMinLength',
  password_require_mixed_case: 'passwordRequireMixedCase',
  password_require_symbol: 'passwordRequireSymbol',
  platform_name: 'platformName',
}

const SLOT_URL: Record<BrandingSlot, keyof PlatformInfo> = { logo_light: 'logoLightUrl', logo_dark: 'logoDarkUrl', favicon: 'faviconUrl' }

/** Configurações → Geral (platform.manage): identidade, senha, bloqueio de login e retenção do histórico. */
export function GeneralSettingsPage() {
  const { t } = useTranslation()
  const { platform } = useRepositories()
  const settings = useQuery({ queryKey: SETTINGS_QUERY_KEY, queryFn: () => platform.getSettings() })

  return (
    <>
      <PageHeader
        title={t('platform.title')}
        actions={
          settings.data && (
            <AppButton type="submit" form={FORM_ID} leftIcon={<Save />}>
              {t('platform.save')}
            </AppButton>
          )
        }
      />
      {settings.isPending ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <AppSkeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : settings.isError ? (
        <AppErrorState onRetry={() => void settings.refetch()} />
      ) : (
        <SettingsForm settings={settings.data} />
      )}
    </>
  )
}

function SettingsForm({ settings }: { settings: PlatformSettings }) {
  const { t } = useTranslation()
  const { platform } = useRepositories()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const schema = useMemo(() => platformSettingsSchema(settings.limits), [settings.limits])
  const form = useForm<PlatformSettingsValues>({ resolver: zodResolver(schema), defaultValues: settings.values })
  const { register, handleSubmit, reset, setError, control, formState } = form
  const [pending, setPending] = useState<{ patch: Partial<PlatformSettingsValues>; count: number } | null>(null)

  useEffect(() => reset(settings.values), [settings.values, reset])

  const save = useMutation({
    mutationFn: (patch: Partial<PlatformSettingsValues>) => platform.updateSettings(patch),
    onSuccess: (next) => {
      queryClient.setQueryData(SETTINGS_QUERY_KEY, next)
      void queryClient.invalidateQueries({ queryKey: PLATFORM_INFO_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: PASSWORD_POLICY_QUERY_KEY })
      setPending(null)
      notify.success(t('platform.saved'))
    },
    onError: (error) => {
      setPending(null)
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

  const preview = useMutation({
    mutationFn: (months: number) => platform.previewRetention(months),
    onError: (error) => notify.error(errorMessage(error)),
  })

  const onSubmit = handleSubmit(async (values) => {
    const patch = changedSettings(settings.values, values)
    if (Object.keys(patch).length === 0) {
      notify.info(t('platform.nothingChanged'))
      return
    }
    // encurtar a retenção pede confirmação com quantos registros sairão na próxima limpeza
    if (patch.auditRetentionMonths !== undefined && isShorterRetention(settings.values.auditRetentionMonths, patch.auditRetentionMonths)) {
      const { auditToDelete } = await preview.mutateAsync(patch.auditRetentionMonths)
      if (auditToDelete > 0) {
        setPending({ patch, count: auditToDelete })
        return
      }
    }
    save.mutate(patch)
  })

  return (
    <form id={FORM_ID} onSubmit={onSubmit} noValidate className="grid gap-4 xl:grid-cols-2">
      <IdentityCard settings={settings} register={register('platformName')} error={formState.errors.platformName?.message} max={settings.limits.platformNameMax} />
      <PasswordCard settings={settings} control={control} />
      <LoginCard settings={settings} control={control} />
      <RetentionCard settings={settings} control={control} />
      <AppConfirmDialog
        open={!!pending}
        onOpenChange={(open) => !open && setPending(null)}
        title={t('platform.retention.confirmTitle')}
        description={t('platform.retention.confirmDescription', { count: pending?.count ?? 0 })}
        confirmLabel={t('platform.retention.confirm')}
        loading={save.isPending}
        onConfirm={() => pending && save.mutate(pending.patch)}
      />
    </form>
  )
}

// ---------------------------------------------------------------- identidade

function IdentityCard({
  settings,
  register,
  error,
  max,
}: {
  settings: PlatformSettings
  register: UseFormRegisterReturn<'platformName'>
  error: string | undefined
  max: number
}) {
  const { t } = useTranslation()
  return (
    <AppCard title={<CardTitle icon={<Type />} text={t('platform.identity.title')} />} description={t('platform.identity.description')} className="xl:col-span-2">
      <div className="flex flex-col gap-5">
        <AppTextField label={t('platform.identity.name')} required maxLength={max} hint={t('platform.identity.nameHint')} error={error} className="max-w-md" {...register} />
        <div className="grid gap-4 md:grid-cols-3">
          {BRANDING_SLOTS.map((slot) => (
            <BrandingSlotTile key={slot} slot={slot} file={settings.branding[slot]} />
          ))}
        </div>
      </div>
    </AppCard>
  )
}

function BrandingSlotTile({ slot, file }: { slot: BrandingSlot; file: PlatformSettings['branding'][BrandingSlot] }) {
  const { t } = useTranslation()
  const { platform } = useRepositories()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const info = usePlatformInfo()
  const url = info[SLOT_URL[slot]] as string | null

  // o cache compartilha a estrutura: `values` iguais mantêm a referência e o formulário não reinicia
  const onDone = (next: PlatformSettings) => {
    queryClient.setQueryData(SETTINGS_QUERY_KEY, next)
    void queryClient.invalidateQueries({ queryKey: PLATFORM_INFO_QUERY_KEY })
  }
  const upload = useMutation({
    mutationFn: (selected: File) => platform.uploadBranding(slot, selected),
    onSuccess: (next) => {
      onDone(next)
      notify.success(t('platform.identity.uploaded'))
    },
    onError: (error) => notify.error(errorMessage(error)),
  })
  const remove = useMutation({
    mutationFn: () => platform.removeBranding(slot),
    onSuccess: (next) => {
      onDone(next)
      notify.success(t('platform.identity.removed'))
    },
    onError: (error) => notify.error(errorMessage(error)),
  })

  function take(files: File[]) {
    const selected = files[0]
    if (!selected) return
    const issue = brandingFileIssue(slot, selected)
    if (issue) {
      notify.error(t(`validation.${issue}`))
      return
    }
    upload.mutate(selected)
  }

  // o logo escuro aparece sobre fundo escuro; o claro e o ícone, sobre o fundo da tela
  const dark = slot === 'logo_dark'
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg">{t(`platform.identity.slots.${slot}`)}</p>
          <p className="text-xs text-muted">{t(`platform.identity.slotHints.${slot}`)}</p>
        </div>
        {file && (
          <AppButton type="button" size="sm" variant="ghost" leftIcon={<Trash2 />} loading={remove.isPending} onClick={() => remove.mutate()}>
            {t('platform.identity.remove')}
          </AppButton>
        )}
      </div>
      <div className={dark ? 'flex h-20 items-center justify-center rounded-md bg-brand-gradient' : 'flex h-20 items-center justify-center rounded-md bg-surface-2'}>
        <img
          src={url ?? DEFAULT_BRANDING[slot]}
          alt={t('platform.identity.previewAlt', { slot: t(`platform.identity.slots.${slot}`) })}
          className={slot === 'favicon' ? 'size-8 object-contain' : 'max-h-14 max-w-[80%] object-contain'}
        />
      </div>
      <p className="truncate text-xs text-muted">{file ? `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB` : t('platform.identity.usingDefault')}</p>
      <AppFileDrop multiple={false} accept={acceptFor(slot)} disabled={upload.isPending} onFiles={take} hint={t(slot === 'favicon' ? 'platform.identity.faviconTypes' : 'platform.identity.logoTypes')} className="py-3" />
    </div>
  )
}

// ---------------------------------------------------------------- senha, login e retenção

function CardTitle({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span className="flex items-center gap-2 [&>svg]:size-4 [&>svg]:text-muted">
      {icon}
      {text}
    </span>
  )
}

/** Campo inteiro com teclado numérico (sem o seletor nativo do navegador). */
function NumberField({ control, name, label, hint }: { control: Control<PlatformSettingsValues>; name: FieldPath<PlatformSettingsValues>; label: string; hint?: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <AppTextField
          label={label}
          inputMode="numeric"
          hint={hint}
          error={fieldState.error?.message}
          value={Number.isFinite(field.value as number) ? String(field.value) : ''}
          onChange={(event) => {
            const digits = event.target.value.replace(/[^0-9]/g, '').slice(0, 4)
            field.onChange(digits === '' ? Number.NaN : Number(digits))
          }}
          onBlur={field.onBlur}
          ref={field.ref}
        />
      )}
    />
  )
}

function PasswordCard({ settings, control }: { settings: PlatformSettings; control: Control<PlatformSettingsValues> }) {
  const { t } = useTranslation()
  const range = settings.limits.passwordMinLength
  return (
    <AppCard title={<CardTitle icon={<KeyRound />} text={t('platform.password.title')} />} description={t('platform.password.description')}>
      <div className="flex flex-col gap-4">
        <div className="max-w-xs">
          <NumberField control={control} name="passwordMinLength" label={t('platform.password.minLength')} hint={t('platform.range', { min: range.min, max: range.max })} />
        </div>
        <p className="text-sm text-muted">{t('platform.password.lettersNumbers')}</p>
        <Controller
          control={control}
          name="passwordRequireMixedCase"
          render={({ field }) => <AppSwitch checked={field.value} onCheckedChange={field.onChange} label={t('platform.password.mixedCase')} />}
        />
        <Controller
          control={control}
          name="passwordRequireSymbol"
          render={({ field }) => <AppSwitch checked={field.value} onCheckedChange={field.onChange} label={t('platform.password.symbol')} />}
        />
        <p className="text-xs text-subtle">{t('platform.password.appliesTo')}</p>
      </div>
    </AppCard>
  )
}

function LoginCard({ settings, control }: { settings: PlatformSettings; control: Control<PlatformSettingsValues> }) {
  const { t } = useTranslation()
  const [threshold, base, max] = useWatch({ control, name: ['lockoutThreshold', 'lockoutBaseMinutes', 'lockoutMaxMinutes'] })
  const limits = settings.limits
  const summary =
    Number.isFinite(threshold) && Number.isFinite(base) && Number.isFinite(max) ? t('platform.login.summary', { count: threshold, base, max }) : null
  return (
    <AppCard title={<CardTitle icon={<ShieldAlert />} text={t('platform.login.title')} />} description={t('platform.login.description')}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField control={control} name="lockoutThreshold" label={t('platform.login.threshold')} hint={t('platform.range', { min: limits.lockoutThreshold.min, max: limits.lockoutThreshold.max })} />
          <NumberField control={control} name="lockoutBaseMinutes" label={t('platform.login.baseMinutes')} hint={t('platform.range', { min: limits.lockoutBaseMinutes.min, max: limits.lockoutBaseMinutes.max })} />
          <NumberField control={control} name="lockoutMaxMinutes" label={t('platform.login.maxMinutes')} hint={t('platform.range', { min: limits.lockoutMaxMinutes.min, max: limits.lockoutMaxMinutes.max })} />
        </div>
        {summary && <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">{summary}</p>}
      </div>
    </AppCard>
  )
}

function RetentionCard({ settings, control }: { settings: PlatformSettings; control: Control<PlatformSettingsValues> }) {
  const { t } = useTranslation()
  const { platform } = useRepositories()
  const errorMessage = useErrorMessage()
  const [confirming, setConfirming] = useState(false)
  const run = useMutation({
    mutationFn: () => platform.runRetention(),
    onSuccess: (result) => {
      setConfirming(false)
      notify.success(t('platform.retention.ran', { count: result.removed }))
    },
    onError: (error) => {
      setConfirming(false)
      notify.error(errorMessage(error))
    },
  })
  const options = settings.retentionOptions.map((months) => ({
    value: String(months),
    label: months === 0 ? t('platform.retention.forever') : t('platform.retention.months', { count: months }),
  }))
  const saved = settings.values.auditRetentionMonths

  return (
    <AppCard
      title={<CardTitle icon={<History />} text={t('platform.retention.title')} />}
      description={t('platform.retention.description')}
      className="xl:col-span-2"
      actions={
        <AppButton type="button" variant="secondary" size="sm" leftIcon={<Eraser />} disabled={saved === 0} onClick={() => setConfirming(true)}>
          {t('platform.retention.runNow')}
        </AppButton>
      }
    >
      <div className="flex flex-col gap-3">
        <Controller
          control={control}
          name="auditRetentionMonths"
          render={({ field, fieldState }) => (
            <AppSelect
              label={t('platform.retention.keep')}
              value={String(field.value)}
              onValueChange={(value) => field.onChange(Number(value))}
              options={options}
              error={fieldState.error?.message}
              hint={t('platform.retention.hint')}
              className="max-w-xs"
            />
          )}
        />
      </div>
      <AppConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('platform.retention.runTitle')}
        description={t('platform.retention.runDescription', { count: saved })}
        confirmLabel={t('platform.retention.runNow')}
        loading={run.isPending}
        onConfirm={() => run.mutate()}
      />
    </AppCard>
  )
}

