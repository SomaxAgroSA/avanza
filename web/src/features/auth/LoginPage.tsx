import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Info, Lock, Mail } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { loginSchema, type LoginInput } from '@/domain/validation'
import { AppButton, AppCheckbox, AppTextField } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { usePlatformInfo } from '@/presentation/common/use-platform'
import { AuthLayout } from './AuthLayout'
import { ContactAdminNotice } from './ContactAdminNotice'
import { safeRedirect, useLogin } from './session'
import { useSessionStore } from './session-store'

export function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const login = useLogin()
  const errorMessage = useErrorMessage()
  const endReason = useSessionStore((s) => s.endReason)
  const platform = usePlatformInfo()
  const [showContactAdmin, setShowContactAdmin] = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    control,
    setFocus,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', remember: false },
  })

  useEffect(() => {
    setFocus('email')
  }, [setFocus])

  useEffect(() => {
    document.title = `${t('auth.title')} · ${platform.name}`
  }, [t, platform.name])

  const onSubmit = handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: () => navigate(safeRedirect(params.get('next')), { replace: true }),
      onError: () => setValue('password', ''),
    }),
  )

  const serverError = login.error
  const fieldErrors = isAppError(serverError) ? serverError.fieldErrors() : {}

  return (
    <AuthLayout title={t('auth.title')} subtitle={t('auth.subtitle')}>
      {endReason && !serverError && (
        <div role="status" className="mt-6 flex gap-2.5 rounded-lg border border-primary-border bg-primary-soft px-3.5 py-3 text-sm text-primary-soft-fg">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{endReason === 'expired' ? t('auth.sessionExpired') : t('auth.signedOut')}</span>
        </div>
      )}
      {serverError && (
        <div role="alert" className="mt-6 flex gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger-soft-fg">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {isAppError(serverError) && serverError.code === 'ACCOUNT_LOCKED'
              ? t('auth.lockedFor', { minutes: Math.max(1, Math.ceil(Number(serverError.details.retry_after_seconds ?? 60) / 60)) })
              : errorMessage(serverError)}
          </span>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4">
        <AppTextField
          label={t('auth.email')}
          type="email"
          autoComplete="username"
          inputMode="email"
          leftIcon={<Mail />}
          required
          error={errors.email?.message ?? fieldErrors.email}
          {...register('email')}
        />
        <AppTextField
          label={t('auth.password')}
          type="password"
          autoComplete="current-password"
          leftIcon={<Lock />}
          revealable
          required
          error={errors.password?.message ?? fieldErrors.password}
          {...register('password')}
        />
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Controller
              control={control}
              name="remember"
              render={({ field }) => (
                <AppCheckbox checked={field.value} onCheckedChange={field.onChange} label={t('auth.remember')} />
              )}
            />
            {platform.passwordReset ? (
              <AppButton asChild variant="link" className="h-auto px-0">
                <Link to="/forgot-password">{t('auth.forgotPassword')}</Link>
              </AppButton>
            ) : (
              // sem envio de e-mail não há link a pedir: o aviso orienta a falar com o administrador
              <AppButton
                variant="link"
                className="h-auto px-0"
                aria-expanded={showContactAdmin}
                aria-controls="login-contact-admin"
                onClick={() => setShowContactAdmin((open) => !open)}
              >
                {t('auth.forgotPassword')}
              </AppButton>
            )}
          </div>
          <div id="login-contact-admin" aria-live="polite">
            {showContactAdmin && !platform.passwordReset && <ContactAdminNotice className="mt-3" />}
          </div>
        </div>
        <AppButton type="submit" size="lg" block loading={login.isPending}>
          {t('auth.submit')}
        </AppButton>
      </form>
      <p className="mt-6 text-center text-xs text-subtle">{t('auth.securityNote')}</p>
    </AuthLayout>
  )
}
