import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Paperclip } from 'lucide-react'
import { acceptAttribute, formatBytes, MAX_FILE_SIZE, type Attachment, type FileItem } from '@/domain/attachments'
import type { TaskDetail } from '@/domain/tasks'
import { AppConfirmDialog, AppEmptyState, AppFileDrop, AppSkeleton, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { AttachmentGallery, PendingUploads } from './AttachmentViews'
import { useAttachmentMutations, useTaskAttachments } from './queries'
import { useAttachmentUploader } from './use-attachment-uploader'

/** Anexos e imagens da tarefa: envio (arrastar/soltar), galeria com visualizador e documentos. */
export function TaskAttachments({ task }: { task: TaskDetail }) {
  const { t, i18n } = useTranslation()
  const errorMessage = useErrorMessage()
  const attachments = useTaskAttachments(task.id)
  const { remove } = useAttachmentMutations(task.id)
  const uploader = useAttachmentUploader(task.id)
  const [deleting, setDeleting] = useState<Attachment | null>(null)
  const canUpload = task.capabilities.edit
  const list = attachments.data ?? []

  async function send(files: File[]) {
    const sent = await uploader.send(files)
    if (sent > 0) notify.success(t('attachments.uploaded', { count: sent }))
  }

  return (
    <div className="flex flex-col gap-5">
      {canUpload && (
        <AppFileDrop onFiles={(files) => void send(files)} accept={acceptAttribute()} hint={t('attachments.hint', { max: formatBytes(MAX_FILE_SIZE, i18n.language) })} />
      )}
      <PendingUploads items={uploader.pending} onDismiss={uploader.dismiss} />

      {attachments.isPending ? (
        <AppSkeleton className="h-32" />
      ) : list.length === 0 ? (
        <AppEmptyState compact icon={<Paperclip />} title={t('attachments.empty')} description={canUpload ? t('attachments.emptyHint') : undefined} />
      ) : (
        <AttachmentGallery attachments={list} onDelete={setDeleting} />
      )}

      <DeleteAttachmentDialog
        attachment={deleting}
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={(attachment) =>
          remove.mutate(attachment.id, {
            onSuccess: () => {
              notify.success(t('attachments.deleted', { name: attachment.name }))
              setDeleting(null)
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
    </div>
  )
}

export function DeleteAttachmentDialog<T extends FileItem>({
  attachment,
  loading,
  onCancel,
  onConfirm,
  title,
  description,
}: {
  attachment: T | null
  loading: boolean
  onCancel: () => void
  onConfirm: (attachment: T) => void
  /** Título e texto do aviso (padrão: os dos anexos da tarefa). */
  title?: string
  description?: string
}) {
  const { t } = useTranslation()
  return (
    <AppConfirmDialog
      open={!!attachment}
      onOpenChange={(open) => !open && onCancel()}
      title={title ?? t('attachments.deleteTitle', { name: attachment?.name ?? '' })}
      description={description ?? t('attachments.deleteDescription')}
      confirmLabel={t('common.delete')}
      loading={loading}
      onConfirm={() => attachment && onConfirm(attachment)}
    />
  )
}
