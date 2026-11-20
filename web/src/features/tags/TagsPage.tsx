import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import type { OptionColor } from '@/domain/task-config'
import type { Tag } from '@/domain/tasks'
import {
  AppButton,
  AppConfirmDialog,
  AppDialog,
  AppEmptyState,
  AppErrorState,
  AppIconButton,
  AppSkeleton,
  AppTextField,
  notify,
} from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { ColorPicker } from '@/features/task-config/config-visuals'
import { useTagMutations, useTags } from './queries'
import { TagBadge } from './tag-visuals'

export function TagsPage() {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const tags = useTags()
  const { remove } = useTagMutations()
  const [editing, setEditing] = useState<Tag | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Tag | null>(null)
  useDocumentTitle(t('tags.title'))

  return (
    <>
      <PageHeader
        title={t('tags.title')}
        actions={
          <AppButton leftIcon={<Plus />} onClick={() => setCreating(true)}>
            {t('tags.create')}
          </AppButton>
        }
      />
      {tags.isPending ? (
        <AppSkeleton className="h-40 rounded-xl" />
      ) : tags.isError ? (
        <AppErrorState onRetry={() => void tags.refetch()} />
      ) : tags.data.length === 0 ? (
        <AppEmptyState icon={<Tags />} title={t('tags.empty')} description={t('tags.emptyHint')} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-card">
          {tags.data.map((tag) => (
            <li key={tag.id} className="flex items-center gap-3 px-4 py-2.5">
              <TagBadge tag={tag} className="text-xs" />
              <span className="ml-auto text-xs text-muted">{t('tags.taskCount', { count: tag.taskCount })}</span>
              <AppIconButton size="sm" label={t('tags.editOf', { name: tag.name })} icon={<Pencil />} onClick={() => setEditing(tag)} />
              <AppIconButton size="sm" variant="danger" label={t('tags.deleteOf', { name: tag.name })} icon={<Trash2 />} onClick={() => setDeleting(tag)} />
            </li>
          ))}
        </ul>
      )}

      <TagFormDialog
        open={creating || !!editing}
        tag={editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false)
            setEditing(null)
          }
        }}
      />
      <AppConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('tags.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('tags.deleteDescription', { count: deleting?.taskCount ?? 0 })}
        confirmLabel={t('common.delete')}
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              notify.success(t('tags.deleted', { name: deleting.name }))
              setDeleting(null)
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
    </>
  )
}

function TagFormDialog({ open, tag, onOpenChange }: { open: boolean; tag: Tag | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { create, update } = useTagMutations()
  const [name, setName] = useState('')
  const [color, setColor] = useState<OptionColor>('blue')
  const [error, setError] = useState<string | undefined>()
  const [openedFor, setOpenedFor] = useState<string | null>(null)

  // Reinicia ao abrir (ajuste durante a renderização, sem efeito).
  const signature = open ? (tag?.id ?? 'new') : null
  if (signature !== openedFor) {
    setOpenedFor(signature)
    if (signature) {
      setName(tag?.name ?? '')
      setColor(tag?.color ?? 'blue')
      setError(undefined)
    }
  }

  const pending = create.isPending || update.isPending

  function submit() {
    const trimmed = name.trim()
    if (!trimmed) return setError('required')
    const onError = (err: unknown) => {
      if (isAppError(err) && err.code === 'TAG_NAME_IN_USE') return setError('name_in_use')
      notify.error(errorMessage(err))
    }
    const onSuccess = () => {
      notify.success(t(tag ? 'tags.updated' : 'tags.created', { name: trimmed }))
      onOpenChange(false)
    }
    if (tag) update.mutate({ id: tag.id, data: { name: trimmed, color } }, { onSuccess, onError })
    else create.mutate({ name: trimmed, color }, { onSuccess, onError })
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(tag ? 'tags.editTitle' : 'tags.createTitle')}
      footer={
        <>
          <AppButton variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} loading={pending}>
            {t('common.save')}
          </AppButton>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="flex min-h-12 items-center rounded-xl border border-border p-3">
          <TagBadge tag={{ name: name.trim() || t('tags.namePlaceholder'), color }} className="text-xs" />
        </div>
        <AppTextField label={t('tags.name')} required autoComplete="off" maxLength={40} value={name} error={error} onChange={(event) => setName(event.target.value)} />
        <ColorPicker label={t('tags.color')} value={color} onChange={setColor} />
      </form>
    </AppDialog>
  )
}
