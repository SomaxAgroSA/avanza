import { useEffect } from 'react'
import { Link } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { ArrowLeft, MailCheck, Mail } from 'lucide-react'
import { AppButton, AppTextField, notify } from '@/presentation/components'
import { useRepositories } from '@/presentation/common/repositories-context'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { usePlatformInfoState } from '@/presentation/common/use-platform'
import { AuthLayout } from './AuthLayout'
import { ContactAdminNotice } from './ContactAdminNotice'

const schema = z.object({ email: z.string().trim().min(1, 'required').max(254, 'too_long').email('invalid_email') })
type Input = z.infer<typeof schema>

/**
 * "Esqueci minha senha": pede o link por e-mail (a resposta é a mesma exista ou não a conta).
 * Sem envio de e-mail configurado, orienta a falar com o administrador em vez de pedir o link.
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const { auth } = useRepositories()
  const errorMessage = useErrorMessage()
  const { info: platform, loaded } = usePlatformInfoState()
  const emailOff = loaded && !platform.passwordReset
  const { register, handleSubmit, setFocus, formState } = useForm<Input>({ resolver: zodResolver(schema), defaultValues: { email: '' } })
  const request = useMutation({
    mutationFn: (values: Input) => auth.requestPasswordReset(values.email),
    onError: (error) => notify.error(errorMessage(error)),
  })

  useEffect(() => {
    document.title = `${t('auth.forgot.title')} · ${platform.name}`
  }, [t, platform.name])
  useEffect(() => setFocus('email'), [setFocus])

  return (
    <AuthLayout title={t('auth.forgot.title')} subtitle={request.isSuccess || emailOff ? undefined : t('auth.forgot.subtitle')}>
      {emailOff ? (
        <div role="status" className="mt-6">
          <ContactAdminNotice />
        </div>
      ) : request.isSuccess ? (
        <div role="status" className="mt-6 flex gap-3 rounded-lg border border-border bg-success-soft px-4 py-3 text-sm text-success-soft-fg">
          <MailCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>{t('auth.forgot.sent', { email: request.variables.email })}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit((values) => request.mutate(values))} noValidate className="mt-6 flex flex-col gap-4">
          <AppTextField
            label={t('auth.email')}
            type="email"
            autoComplete="username"
            inputMode="email"
            leftIcon={<Mail />}
            required
            error={formState.errors.email?.message}
            {...register('email')}
          />
          <AppButton type="submit" size="lg" block loading={request.isPending}>
            {t('auth.forgot.submit')}
          </AppButton>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="inline-flex items-center gap-1.5 rounded font-medium text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-ring">
          <ArrowLeft className="size-4" aria-hidden />
          {t('auth.backToLogin')}
        </Link>
      </p>
    </AuthLayout>
  )
}
