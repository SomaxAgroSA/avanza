import { useTranslation } from 'react-i18next'
import { AppEmailChips } from '@/presentation/components'
import { MAX_COPY_EMAILS } from './use-recent-copy-emails'

/**
 * "Com cópia" na abertura da tarefa ou da demanda (ajuste 24/11, aprovado em demonstração): um ou mais e-mails
 * que recebem o aviso da tarefa nova, uma vez só (ex.: a caixa do suporte, que abre o chamado no sistema dela).
 * Fica logo abaixo do responsável e só existe na criação.
 */
export function CopyEmailsField({ value, onChange, error, recent, disabled }: { value: string[]; onChange: (next: string[]) => void; error?: string | undefined; recent: string[]; disabled?: boolean }) {
  const { t } = useTranslation()
  return (
    <AppEmailChips
      label={t('tasks.copy.label')}
      value={value}
      onChange={onChange}
      max={MAX_COPY_EMAILS}
      placeholder={t('tasks.copy.placeholder')}
      error={error}
      suggestions={recent}
      suggestionsLabel={t('tasks.copy.recent')}
      removeLabel={(email) => t('tasks.copy.remove', { email })}
      disabled={disabled}
    />
  )
}
