import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ADD_FIELD_OPTION_PERMISSIONS, MAX_OPTION_LABEL, type CustomField, type FieldOption } from '@/domain/task-config'
import { notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useCanAny } from '@/features/auth/session'
import { useAddFieldOption } from './queries'

export type FieldOptionCreator = (field: Pick<CustomField, 'id' | 'label' | 'options'>, label: string) => Promise<FieldOption | null>

/**
 * "Adicionar opção" dos campos de seleção no formulário da tarefa (referência `createOption` do
 * CustomFieldInput): cria pela API, avisa o resultado e devolve a opção (null quando não deu).
 * Sem permissão para isso (settings.manage, tasks.create ou tasks.edit), devolve undefined.
 */
export function useFieldOptionCreator(): FieldOptionCreator | undefined {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const allowed = useCanAny(ADD_FIELD_OPTION_PERMISSIONS)
  const { mutateAsync } = useAddFieldOption()
  const create = useCallback<FieldOptionCreator>(
    async (field, label) => {
      const text = label.trim()
      if (text.length > MAX_OPTION_LABEL) {
        notify.error(t('validation.too_long'))
        return null
      }
      try {
        const option = await mutateAsync({ fieldId: field.id, label: text })
        // nova (ou reativada): avisa; a mesma opção que já estava na lista só é escolhida
        if (!field.options.some((o) => o.id === option.id && o.isActive)) notify.success(t('fields.optionAdded', { name: option.label, field: field.label }))
        return option
      } catch (error) {
        notify.error(errorMessage(error))
        return null
      }
    },
    [mutateAsync, t, errorMessage],
  )
  return allowed ? create : undefined
}
