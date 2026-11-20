import { useTranslation } from 'react-i18next'
import { isRequiredIn, type FieldValue, type OptionColor, type TaskTypeField, type TaskTypeIcon } from '@/domain/task-config'
import { AppSkeleton } from '@/presentation/components'
import { CustomFieldInput, type CustomFieldReferences } from '@/features/task-config/CustomFieldInput'
import { TaskTypeIconBadge } from '@/features/task-config/config-visuals'

export interface TaskTypeFieldsSectionProps {
  /** Tipo escolhido (título "Campos de <tipo>"). */
  type: { name: string; icon: TaskTypeIcon; color: OptionColor } | null
  /** Campos do tipo ainda carregando. */
  loading: boolean
  /** Campos visíveis do tipo. */
  fields: TaskTypeField[]
  /** Valores por nome técnico do campo. */
  values: Record<string, FieldValue>
  /** Erros por nome técnico (código validation.*). */
  errors: Record<string, string>
  /** Status considerado nos obrigatórios (sempre + exigidos nele). */
  statusId: string | null | undefined
  references: CustomFieldReferences
  onChange: (name: string, value: FieldValue) => void
}

/**
 * Campos do tipo no formulário (tarefa de projeto e demanda interna, §45): um quadro com o ícone e o nome
 * do tipo, os campos visíveis e a marca de obrigatório do status considerado.
 */
export function TaskTypeFieldsSection({ type, loading, fields, values, errors, statusId, references, onChange }: TaskTypeFieldsSectionProps) {
  const { t } = useTranslation()
  return (
    <section aria-labelledby="task-fields-title" className="flex flex-col gap-4 rounded-xl border border-border p-4">
      <h3 id="task-fields-title" className="flex items-center gap-2 text-sm font-semibold text-fg">
        {type && <TaskTypeIconBadge icon={type.icon} color={type.color} size="sm" />}
        {t('tasks.typeFields', { name: type?.name ?? '' })}
      </h3>
      {loading ? (
        <AppSkeleton className="h-24" />
      ) : fields.length === 0 ? (
        <p className="text-sm text-muted">{t('tasks.noTypeFields')}</p>
      ) : (
        fields.map((link) => (
          <CustomFieldInput
            key={link.field.id}
            field={link.field}
            required={isRequiredIn(link, statusId)}
            value={values[link.field.name]}
            error={errors[link.field.name]}
            references={references}
            onChange={(value) => onChange(link.field.name, value)}
          />
        ))
      )}
    </section>
  )
}
