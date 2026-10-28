import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { valueIssue, type FieldValue } from '@/domain/task-config'
import { AppButton, AppDialog, AppSkeleton, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useProjectMembers, useProjects } from '@/features/projects/queries'
import { CustomFieldInput } from '@/features/task-config/CustomFieldInput'
import { useFieldOptionCreator } from '@/features/task-config/use-field-option-creator'
import { useTask, useTaskAttachments, useTaskMutations } from './queries'
import { missingForStatus, PROJECT_OPTIONS_QUERY } from './required-fields'
import { useFieldAttachmentUpload } from './use-attachment-uploader'

export interface RequiredFieldsRequest {
  taskId: string
  code: string
  status: { id: string; name: string }
  fieldNames: string[]
  /** Refaz a mudança de status depois de salvar os valores (ex.: mover o card para a coluna). */
  retry: () => Promise<unknown>
}

/**
 * "Preencha para mover": quando o status de destino exige campos (diretriz §9), mostra só os que
 * faltam; salvar grava os valores e refaz a mudança de status.
 */
export function RequiredFieldsDialog({ request, onClose }: { request: RequiredFieldsRequest | null; onClose: () => void }) {
  if (!request) return null
  return <RequiredFieldsForm key={`${request.taskId}:${request.status.id}`} request={request} onClose={onClose} />
}

function RequiredFieldsForm({ request, onClose }: { request: RequiredFieldsRequest; onClose: () => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const task = useTask(request.taskId)
  const members = useProjectMembers(task.data?.project?.id)
  const attachments = useTaskAttachments(request.taskId)
  const { update } = useTaskMutations()
  const [values, setValues] = useState<Record<string, FieldValue>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)

  const links = useMemo(() => (task.data?.fields ?? []).filter((link) => request.fieldNames.includes(link.field.name)), [task.data, request.fieldNames])
  // tudo o que um campo exigido pode pedir precisa estar à mão aqui: sem isso a tarefa não sai do lugar
  const projects = useProjects(PROJECT_OPTIONS_QUERY, links.some((link) => link.field.type === 'project'))
  const uploadToField = useFieldAttachmentUpload(request.taskId)
  const createOption = useFieldOptionCreator()
  const references = useMemo(
    () => ({
      people: (members.data ?? []).filter((m) => m.user.status === 'active').map((m) => ({ id: m.user.id, name: m.user.name })),
      projects: (projects.data?.items ?? []).map((p) => ({ id: p.id, key: p.key, name: p.name })),
      attachments: (attachments.data ?? []).map((a) => ({ id: a.id, name: a.name, kind: a.kind, url: a.url })),
      uploadFiles: uploadToField,
      createOption,
    }),
    [members.data, projects.data, attachments.data, uploadToField, createOption],
  )
  const valueOf = (name: string) => (name in values ? values[name] : task.data?.customValues[name])

  async function submit() {
    const found: Record<string, string> = {}
    links.forEach((link) => {
      const issue = valueIssue(link.field, valueOf(link.field.name), true)
      if (issue) found[link.field.name] = issue
    })
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setPending(true)
    try {
      await update.mutateAsync({ id: request.taskId, data: { customValues: values } })
      await request.retry()
      notify.success(t('tasks.requiredFor.done', { code: request.code, status: request.status.name }))
      onClose()
    } catch (error) {
      // o servidor ainda pode exigir outro campo (ex.: configuração mudou): mostra onde
      const missing = missingForStatus(error)
      if (missing) setErrors(Object.fromEntries(missing.fieldNames.map((name) => [name, 'required'])))
      notify.error(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <AppDialog
      open
      onOpenChange={(open) => !open && !pending && onClose()}
      size="lg"
      closeOnOutsideClick={false}
      title={t('tasks.requiredFor.title', { status: request.status.name })}
      description={t('tasks.requiredFor.description', { code: request.code, status: request.status.name })}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={() => void submit()} loading={pending} disabled={task.isPending}>
            {t('tasks.requiredFor.submit')}
          </AppButton>
        </>
      }
    >
      {task.isPending ? (
        <AppSkeleton className="h-32" />
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {links.map((link) => (
            <CustomFieldInput
              key={link.field.id}
              field={link.field}
              required
              value={valueOf(link.field.name)}
              error={errors[link.field.name]}
              references={references}
              onChange={(value) => {
                setValues((v) => ({ ...v, [link.field.name]: value }))
                setErrors(({ [link.field.name]: _removed, ...rest }) => rest)
              }}
            />
          ))}
        </form>
      )}
    </AppDialog>
  )
}
