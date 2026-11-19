import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { isAppError } from '@/core/errors/app-error'
import { MODULE_NAME_MAX, type DocModule } from '@/domain/docs'
import type { OptionColor } from '@/domain/task-config'
import { AppButton, AppDialog, AppTextField, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { ColorPicker } from '@/features/task-config/config-visuals'
import { useModuleMutations } from './queries'

export interface ModuleFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Ausente = criação. */
  module?: DocModule | null
  /** Depois de criar (a tela passa a filtrar pelo módulo novo). */
  onCreated?: (module: DocModule) => void
}

/** Criar ou editar um módulo da documentação: só nome e cor (paleta fixa, sem cor livre). */
export function ModuleFormDialog({ open, onOpenChange, module, onCreated }: ModuleFormDialogProps) {
  const { t } = useTranslation()
  const mutations = useModuleMutations()
  const pending = mutations.create.isPending || mutations.update.isPending
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={module ? t('docs.modules.editTitle') : t('docs.modules.createTitle')}
      description={t('docs.modules.formDescription')}
      footer={
        <>
          <AppButton variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" form="doc-module-form" loading={pending}>
            {module ? t('common.save') : t('docs.modules.create')}
          </AppButton>
        </>
      }
    >
      {/* remontado a cada abertura: o formulário começa com os dados do módulo (ou vazio) */}
      {open && <ModuleForm key={module?.id ?? 'new'} module={module ?? null} mutations={mutations} onDone={() => onOpenChange(false)} onCreated={onCreated} />}
    </AppDialog>
  )
}

interface ModuleFormProps {
  module: DocModule | null
  mutations: ReturnType<typeof useModuleMutations>
  onDone: () => void
  onCreated: ((module: DocModule) => void) | undefined
}

function ModuleForm({ module, mutations, onDone, onCreated }: ModuleFormProps) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { create, update } = mutations
  const [name, setName] = useState(module?.name ?? '')
  const [color, setColor] = useState<OptionColor>(module?.color ?? 'blue')
  const [error, setError] = useState<string | undefined>()

  const onError = (err: unknown) => {
    if (isAppError(err) && err.code === 'DOC_MODULE_NAME_IN_USE') return setError('module_name_in_use')
    if (isAppError(err) && err.code === 'VALIDATION_ERROR') return setError(err.fieldErrors().name ?? 'required')
    notify.error(errorMessage(err))
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = name.trim()
    if (!value) return setError('required')
    if (module) {
      update.mutate(
        { id: module.id, input: { name: value, color } },
        {
          onSuccess: () => {
            notify.success(t('docs.modules.updated'))
            onDone()
          },
          onError,
        },
      )
      return
    }
    create.mutate(
      { name: value, color },
      {
        onSuccess: (created) => {
          notify.success(t('docs.modules.created', { name: created.name }))
          onDone()
          onCreated?.(created)
        },
        onError,
      },
    )
  }

  return (
    <form id="doc-module-form" onSubmit={submit} noValidate className="flex flex-col gap-5">
      <AppTextField
        label={t('docs.modules.name')}
        required
        autoComplete="off"
        maxLength={MODULE_NAME_MAX}
        placeholder={t('docs.modules.namePlaceholder')}
        value={name}
        error={error}
        onChange={(event) => {
          setName(event.target.value)
          setError(undefined)
        }}
      />
      <ColorPicker label={t('docs.modules.color')} value={color} onChange={setColor} custom={false} />
    </form>
  )
}
