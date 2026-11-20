import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, Paperclip, Pencil, Trash2 } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { formatDateTime, formatRelative } from '@/core/utils/format'
import { acceptAttribute, type Attachment } from '@/domain/attachments'
import { mentionsToDisplay, mentionsToStorage, type MentionPerson, type TaskComment, type TaskDetail } from '@/domain/tasks'
import {
  AppAvatar,
  AppButton,
  AppConfirmDialog,
  AppEmptyState,
  AppIconButton,
  AppMarkdown,
  AppMentionTextarea,
  AppSkeleton,
  notify,
} from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { AttachmentGallery, FilesToSend, PendingUploads } from './AttachmentViews'
import { useAttachmentMutations, useCommentMutations, useMentionCandidates, useTaskComments } from './queries'
import { DeleteAttachmentDialog } from './TaskAttachments'
import { useAttachmentUploader } from './use-attachment-uploader'
import { usePendingFiles } from './use-pending-files'

/** Evento do histórico intercalado com os comentários (linha do tempo da demanda interna, §45). */
export interface TimelineEvent {
  id: string
  at: Date | null
  node: ReactNode
}

/**
 * Comentários da tarefa com menções (@) e anexos — qualquer pessoa com acesso ao projeto comenta.
 * Com `events` (linha do tempo da demanda, §45): os eventos do histórico entram entre os comentários,
 * do mais antigo ao mais novo, e o campo de comentar fica no fim.
 */
export function TaskComments({ task, events }: { task: TaskDetail; events?: TimelineEvent[] }) {
  const { t } = useTranslation()
  const comments = useTaskComments(task.id)
  const candidates = useMentionCandidates(task.id, task.capabilities.comment)
  const [deleting, setDeleting] = useState<TaskComment | null>(null)
  const [deletingFile, setDeletingFile] = useState<Attachment | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const { remove } = useCommentMutations(task.id)
  const attachmentMutations = useAttachmentMutations(task.id)
  const errorMessage = useErrorMessage()
  const people: MentionPerson[] = (candidates.data ?? []).map((u) => ({ id: u.id, name: u.name }))

  const editor = task.capabilities.comment ? (
    <CommentEditor taskId={task.id} people={people} />
  ) : (
    <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">{t('comments.readOnly')}</p>
  )
  const renderComment = (comment: TaskComment) =>
    editingId === comment.id ? (
      <CommentEditor taskId={task.id} people={people} comment={comment} onDone={() => setEditingId(null)} />
    ) : (
      <CommentItem comment={comment} onEdit={() => setEditingId(comment.id)} onDelete={() => setDeleting(comment)} onDeleteAttachment={setDeletingFile} />
    )
  // linha do tempo: comentários e eventos juntos, do mais antigo ao mais novo
  const timeline = events
    ? [
        ...(comments.data ?? []).map((comment) => ({ key: `c:${comment.id}`, at: comment.createdAt, node: renderComment(comment) })),
        ...events.map((event) => ({ key: `e:${event.id}`, at: event.at, node: event.node })),
      ].sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))
    : null

  return (
    <div className="flex flex-col gap-5">
      {!timeline && editor}

      {comments.isPending ? (
        <AppSkeleton className="h-24" />
      ) : timeline ? (
        timeline.length > 0 && (
          <ol className="flex flex-col gap-4" aria-label={t('comments.title')}>
            {timeline.map((item) => (
              <li key={item.key}>{item.node}</li>
            ))}
          </ol>
        )
      ) : (comments.data ?? []).length === 0 ? (
        <AppEmptyState compact icon={<MessageSquare />} title={t('comments.empty')} description={t('comments.emptyHint')} />
      ) : (
        <ol className="flex flex-col gap-4" aria-label={t('comments.title')}>
          {[...(comments.data ?? [])].reverse().map((comment) => (
            <li key={comment.id}>{renderComment(comment)}</li>
          ))}
        </ol>
      )}
      {timeline && editor}

      <AppConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('comments.deleteTitle')}
        description={t('comments.deleteDescription')}
        confirmLabel={t('common.delete')}
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              notify.success(t('comments.deleted'))
              setDeleting(null)
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
      <DeleteAttachmentDialog
        attachment={deletingFile}
        loading={attachmentMutations.remove.isPending}
        onCancel={() => setDeletingFile(null)}
        onConfirm={(attachment) =>
          attachmentMutations.remove.mutate(attachment.id, {
            onSuccess: () => {
              notify.success(t('attachments.deleted', { name: attachment.name }))
              setDeletingFile(null)
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
    </div>
  )
}

function CommentItem({
  comment,
  onEdit,
  onDelete,
  onDeleteAttachment,
}: {
  comment: TaskComment
  onEdit: () => void
  onDelete: () => void
  onDeleteAttachment: (attachment: Attachment) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const name = comment.author?.name ?? t('audit.system')
  return (
    <article className="flex gap-3">
      <AppAvatar name={name} src={comment.author?.avatarUrl} size="sm" />
      <div className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 py-3">
        <header className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <span className="text-sm font-medium text-fg">{name}</span>
          <time dateTime={comment.createdAt?.toISOString()} title={formatDateTime(comment.createdAt, locale)}>
            {formatRelative(comment.createdAt, locale)}
          </time>
          {comment.editedAt && !comment.deleted && <span title={formatDateTime(comment.editedAt, locale)}>· {t('comments.edited')}</span>}
          {!comment.deleted && (comment.capabilities.edit || comment.capabilities.delete) && (
            <span className="ml-auto flex gap-1">
              {comment.capabilities.edit && <AppIconButton size="sm" label={t('comments.edit')} icon={<Pencil />} onClick={onEdit} />}
              {comment.capabilities.delete && <AppIconButton size="sm" variant="danger" label={t('comments.delete')} icon={<Trash2 />} onClick={onDelete} />}
            </span>
          )}
        </header>
        {comment.deleted ? <p className="text-sm text-subtle italic">{t('comments.removed')}</p> : <AppMarkdown text={comment.content} />}
        {comment.attachments.length > 0 && (
          <div className="mt-3">
            <AttachmentGallery attachments={comment.attachments} compact onDelete={onDeleteAttachment} />
          </div>
        )}
      </div>
    </article>
  )
}

/**
 * Novo comentário ou edição (o editor mostra "@Nome"; o texto salvo leva `@[Nome](id)`).
 * Imagens coladas (Ctrl+V), soltas no campo ou escolhidas são enviadas depois que o comentário é
 * salvo, já ligadas a ele.
 */
function CommentEditor({ taskId, people, comment, onDone }: { taskId: string; people: MentionPerson[]; comment?: TaskComment; onDone?: () => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { create, update } = useCommentMutations(taskId)
  const uploader = useAttachmentUploader(taskId)
  const fileInput = useRef<HTMLInputElement>(null)
  const initial = comment ? mentionsToDisplay(comment.content) : { text: '', people: [] }
  const [text, setText] = useState(initial.text)
  const [mentioned, setMentioned] = useState<MentionPerson[]>(initial.people)
  const pendingFiles = usePendingFiles()
  const files = pendingFiles.files
  const [error, setError] = useState<string | undefined>()
  const [sending, setSending] = useState(false)
  const pending = create.isPending || update.isPending || sending

  async function submit() {
    if (!text.trim()) return setError('required')
    const content = mentionsToStorage(text.trim(), mentioned)
    setSending(true)
    try {
      const saved = comment ? await update.mutateAsync({ id: comment.id, content }) : await create.mutateAsync(content)
      if (files.length > 0) await uploader.send(files, { commentId: saved.id })
      pendingFiles.clear()
      if (comment) onDone?.()
      else {
        setText('')
        setMentioned([])
        setError(undefined)
      }
    } catch (err) {
      if (isAppError(err) && err.code === 'VALIDATION_ERROR') setError(err.fieldErrors().content ?? 'invalid_value')
      else notify.error(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <AppMentionTextarea
        label={comment ? t('comments.editLabel') : t('comments.newLabel')}
        value={text}
        error={error}
        placeholder={t('comments.placeholder')}
        maxLength={10000}
        focusOnMount={!!comment}
        people={people}
        onValueChange={(value) => {
          setText(value)
          setError(undefined)
        }}
        onMention={(person) => setMentioned((list) => (list.some((p) => p.id === person.id) ? list : [...list, person]))}
        onSubmit={() => void submit()}
        onFiles={pendingFiles.add}
      />
      <FilesToSend files={files} label={t('comments.filesToSend')} onRemove={pendingFiles.remove} />
      <PendingUploads items={uploader.pending} onDismiss={uploader.dismiss} />
      <div className="flex items-center justify-between gap-2">
        <AppButton variant="ghost" size="sm" leftIcon={<Paperclip />} onClick={() => fileInput.current?.click()} disabled={pending}>
          {t('comments.attach')}
        </AppButton>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          accept={acceptAttribute()}
          onChange={(event) => {
            pendingFiles.add(event.target.files)
            event.target.value = ''
          }}
        />
        <div className="flex gap-2">
          {comment && (
            <AppButton variant="ghost" size="sm" onClick={onDone} disabled={pending}>
              {t('common.cancel')}
            </AppButton>
          )}
          <AppButton size="sm" onClick={() => void submit()} loading={pending}>
            {comment ? t('common.save') : t('comments.submit')}
          </AppButton>
        </div>
      </div>
    </div>
  )
}
