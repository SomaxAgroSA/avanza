import { useEffect, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ArrowLeft, KeyRound } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { DEFAULT_PASSWORD_POLICY, type PasswordPolicy } from '@/domain/platform'
import { resetPasswordSchemaFor, type ResetPasswordInput } from '@/domain/validation'
import { AppButton, AppSkeleton, AppTextField, notify } from '@/presentation/components'
import { useRepositories } from '@/presentation/common/repositories-context'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { usePlatformInfo } from '@/presentation/common/use-platform'
import { usePasswordHint } from './use-password-policy'
import { AuthLayout } from './AuthLayout'

/**
 * Nova senha pelo link do e-mail: redefinição ("Esqueci minha senha") ou convite (criar a senha).
 * O link vale uma vez; vencido ou usado leva a pedir outro.
 */
export function ResetPasswordPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const { auth } = useRepositories()
  const platform = usePlatformInfo()
  const check = useQuery({ queryKey: ['auth', 'reset-token', token], queryFn: () => auth.checkResetToken(token), enabled: !!token, retry: false, staleTime: Infinity })
  const invite = check.data?.purpose === 'invite'
  const title = invite ? t('auth.reset.inviteTitle') : t('auth.reset.title')

  useEffect(() => {
    document.title = `${title} · ${platform.name}`
  }, [title, platform.name])

  if (token && check.isPending) {
    return (
      <AuthLayout title={title}>
        <AppSkeleton className="mt-6 h-40 rounded-lg" />
      </AuthLayout>
    )
  }
  if (!token || !check.data?.valid) {
    const state = check.data?.state ?? 'invalid'
    return (
      <AuthLayout title={t('auth.reset.invalidTitle')}>
        <div role="alert" className="mt-6 flex gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger-soft-fg">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t(`auth.reset.states.${state === 'valid' ? 'invalid' : state}`)}</span>
        </div>
        <div className="mt-6 flex flex-col gap-3">
          {platform.passwordReset && (
            <AppButton asChild block>
              <Link to="/forgot-password">{t('auth.reset.requestNew')}</Link>
            </AppButton>
          )}
          <BackToLogin />
        </div>
      </AuthLayout>
    )
  }
  return (
    <AuthLayout title={title} subtitle={check.data.name ? t('auth.reset.hello', { name: check.data.name }) : undefined}>
      <NewPasswordForm token={token} invite={invite} policy={check.data.policy ?? DEFAULT_PASSWORD_POLICY} />
    </AuthLayout>
  )
}

function BackToLogin() {
  const { t } = useTranslation()
  return (
    <p className="text-center text-sm">
      <Link to="/login" className="inline-flex items-center gap-1.5 rounded font-medium text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-ring">
        <ArrowLeft className="size-4" aria-hidden />
        {t('auth.backToLogin')}
      </Link>
    </p>
  )
}

function NewPasswordForm({ token, invite, policy }: { token: string; invite: boolean; policy: PasswordPolicy }) {
  const { t } = useTranslation()
  const { auth } = useRepositories()
  const navigate = useNavigate()
  const errorMessage = useErrorMessage()
  const hint = usePasswordHint(policy)
  const schema = useMemo(() => resetPasswordSchemaFor(policy), [policy])
  const { register, handleSubmit, setError, setFocus, formState } = useForm<ResetPasswordInput>({ resolver: zodResolver(schema), defaultValues: { password: '', confirmPassword: '' } })
  useEffect(() => setFocus('password'), [setFocus])

  const confirm = useMutation({
    mutationFn: (values: ResetPasswordInput) => auth.confirmPasswordReset(token, values.password),
    onSuccess: () => {
      notify.success(invite ? t('auth.reset.created') : t('auth.reset.changed'))
      navigate('/login', { replace: true })
    },
    onError: (error) => {
      if (isAppError(error) && error.code === 'VALIDATION_ERROR' && error.fieldErrors().password) {
        setError('password', { message: error.fieldErrors().password })
        return
      }
      notify.error(errorMessage(error))
    },
  })

  return (
    <form onSubmit={handleSubmit((values) => confirm.mutate(values))} noValidate className="mt-6 flex flex-col gap-4">
      <AppTextField
        label={t('auth.reset.password')}
        type="password"
        revealable
        required
        autoComplete="new-password"
        hint={hint}
        error={formState.errors.password?.message}
        {...register('password')}
      />
      <AppTextField
        label={t('account.confirmPassword')}
        type="password"
        revealable
        required
        autoComplete="new-password"
        error={formState.errors.confirmPassword?.message}
        {...register('confirmPassword')}
      />
      <AppButton type="submit" size="lg" block leftIcon={<KeyRound />} loading={confirm.isPending}>
        {invite ? t('auth.reset.createSubmit') : t('auth.reset.submit')}
      </AppButton>
      <BackToLogin />
    </form>
  )
}
