import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/core/utils/cn'

export interface AppFormFieldProps {
  label?: ReactNode
  /** Código de erro (validation.*) ou mensagem já traduzida. */
  error?: string | undefined
  hint?: ReactNode
  required?: boolean
  className?: string
  /** `labelId`: id do rótulo (quando há), para compor o nome acessível com o valor (ex.: resumo da seleção). */
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean; labelId: string | undefined }) => ReactNode
}

/**
 * Estrutura padrão de campo: rótulo, indicador de obrigatório, dica e erro acessíveis.
 * Todos os inputs do design system usam este wrapper.
 */
export function AppFormField({ label, error, hint, required, className, children }: AppFormFieldProps) {
  const { t } = useTranslation()
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  const message = error ? t(`validation.${error}`, { defaultValue: error }) : null

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label id={`${id}-label`} htmlFor={id} className="text-sm font-medium text-fg">
          {label}
          {required && (
            <span className="ml-0.5 text-danger" aria-hidden>
              *
            </span>
          )}
          {required && <span className="sr-only"> ({t('common.required')})</span>}
        </label>
      )}
      {children({ id, describedBy, invalid: !!error, labelId: label ? `${id}-label` : undefined })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {message && (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {message}
        </p>
      )}
    </div>
  )
}
