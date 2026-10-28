import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen } from 'lucide-react'
import { acceptAttribute, formatBytes, MAX_FILE_SIZE, type ProjectFile } from '@/domain/attachments'
import type { Project } from '@/domain/projects'
import { AppEmptyState, AppErrorState, AppFileDrop, AppSkeleton, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { AttachmentGallery, PendingUploads } from '@/features/tasks/AttachmentViews'
import { DeleteAttachmentDialog } from '@/features/tasks/TaskAttachments'
import { useFileUploader } from '@/features/tasks/use-attachment-uploader'
import { useProjectFileMutations, useProjectFiles } from './queries'

/**
 * Arquivos do projeto (regras de negócio §22): documentos e imagens fora das tarefas. Quem vê o projeto
 * vê e baixa; enviar depende de `capabilities.uploadFiles`; excluir, do arquivo (quem enviou ou o gestor).
 */
export function ProjectFilesPanel({ project }: { project: Project }) {
  const { t, i18n } = useTranslation()
  const errorMessage = useErrorMessage()
  const files = useProjectFiles(project.id)
  const { upload, remove } = useProjectFileMutations(project.id)
  const uploader = useFileUploader<never>((file) => upload.mutateAsync(file))
  const [deleting, setDeleting] = useState<ProjectFile | null>(null)
  const canUpload = project.capabilities.uploadFiles
  const list = files.data ?? []

  async function send(chosen: File[]) {
    const sent = await uploader.send(chosen)
    if (sent > 0) notify.success(t('projectFiles.uploaded', { count: sent }))
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">{t('projectFiles.description')}</p>
      {canUpload && (
        <AppFileDrop onFiles={(chosen) => void send(chosen)} accept={acceptAttribute()} hint={t('attachments.hint', { max: formatBytes(MAX_FILE_SIZE, i18n.language) })} />
      )}
      <PendingUploads items={uploader.pending} onDismiss={uploader.dismiss} />

      {files.isError ? (
        <AppErrorState onRetry={() => void files.refetch()} />
      ) : files.isPending ? (
        <AppSkeleton className="h-32" />
      ) : list.length === 0 ? (
        <AppEmptyState compact icon={<FolderOpen />} title={t('projectFiles.empty')} description={canUpload ? t('projectFiles.emptyHint') : t('projectFiles.emptyReadOnly')} />
      ) : (
        <AttachmentGallery attachments={list} onDelete={setDeleting} />
      )}

      <DeleteAttachmentDialog
        attachment={deleting}
        loading={remove.isPending}
        title={t('projectFiles.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('projectFiles.deleteDescription')}
        onCancel={() => setDeleting(null)}
        onConfirm={(file) =>
          remove.mutate(file.id, {
            onSuccess: () => {
              notify.success(t('projectFiles.deleted', { name: file.name }))
              setDeleting(null)
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
    </div>
  )
}
