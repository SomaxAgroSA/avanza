import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, Paperclip, Pencil, Reply, Trash2 } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { formatDateTime, formatRelative } from '@/core/utils/format'
import { acceptAttribute } from '@/domain/attachments'
import { formatNumber, formatSchedule, type Plan, type PlanItem } from '@/domain/plan'
import { PANEL_TABS, updateUploadIssue, type PanelTab, type PlanFile, type PlanUpdate } from '@/domain/plan-updates'
import { dependenciesOf, groupTitle } from '@/domain/plan-view'
import { isProgressFromTasks, linkedTasks } from '@/domain/plan-tasks'
import { mentionsToDisplay, mentionsToStorage, type MentionPerson } from '@/domain/tasks'
import { AppAvatar, AppButton, AppConfirmDialog, AppDrawer, AppEmptyState, AppIconButton, AppMarkdown, AppMentionTextarea, AppSkeleton, AppTabs, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { AuditTimeline } from '@/features/audit/AuditTimeline'
import { AttachmentGallery, FilesToSend } from '@/features/tasks/AttachmentViews'
import { DeleteAttachmentDialog } from '@/features/tasks/TaskAttachments'
import { compressImage } from '@/features/tasks/image-compress'
import { usePendingFiles } from '@/features/tasks/use-pending-files'
import { ProgressBar, ResourceChip, SchedulePill, StatusBlock, TasksProgressNote } from './cells'
import { ItemTasks } from './ItemTasks'
import { useItemHistory, useItemMentionPeople, useItemPanelMutations, useItemUpdates } from './queries'

/**
 * Painel lateral do elemento (GP-3): atualizações (conversa com respostas e @menções que notificam,
 * com imagens e arquivos colados ou anexados nelas), histórico e detalhes — sem sair do quadro. O endereço guarda o elemento aberto
 * (`?item=`), então as notificações abrem direto aqui.
 */
export function ItemPanel({ plan, itemId, tab, onTab, onClose }: { plan: Plan; itemId: string | null; tab: PanelTab; onTab: (tab: PanelTab) => void; onClose: () => void }) {
  const item = itemId ? plan.items.find((i) => i.id === itemId) : undefined
  if (!item) return null
  return <Panel key={item.id} plan={plan} item={item} tab={tab} onTab={onTab} onClose={onClose} />
}

function Panel({ plan, item, tab, onTab, onClose }: { plan: Plan; item: PlanItem; tab: PanelTab; onTab: (tab: PanelTab) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const group = plan.groups.find((g) => g.id === item.groupId)
  const parent = item.parentId ? plan.items.find((i) => i.id === item.parentId) : undefined
  const where = [group ? groupTitle(group) : null, parent ? t('plan.panel.subitemOf', { name: parent.name }) : null].filter(Boolean).join(' · ')
  const label = (key: PanelTab, count?: number) => (count ? `${t(`plan.panel.tabs.${key}`)} (${count})` : t(`plan.panel.tabs.${key}`))
  return (
    <AppDrawer open onOpenChange={(open) => !open && onClose()} size="lg" title={item.name} description={where}>
      <AppTabs
        aria-label={t('plan.panel.title', { name: item.name })}
        value={tab}
        onValueChange={(value) => onTab(PANEL_TABS.find((x) => x === value) ?? 'updates')}
        tabs={[
          { value: 'updates', label: label('updates', item.updates), content: <UpdatesTab projectId={plan.project.id} item={item} /> },
          { value: 'tasks', label: label('tasks', linkedTasks(item).total), content: <ItemTasks plan={plan} item={item} /> },
          { value: 'history', label: label('history'), content: <HistoryTab projectId={plan.project.id} item={item} active={tab === 'history'} /> },
          { value: 'details', label: label('details'), content: <DetailsTab plan={plan} item={item} /> },
        ]}
      />
    </AppDrawer>
  )
}

/* ------------------------------------------------------------------ atualizações */

function UpdatesTab({ projectId, item }: { projectId: string; item: PlanItem }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const query = useItemUpdates(projectId, item.id)
  const canPost = query.data?.capabilities.post ?? false
  const people = useItemMentionPeople(projectId, item.id, canPost)
  const mutations = useItemPanelMutations(projectId, item.id)
  const [editing, setEditing] = useState<string | null>(null)
  const [replying, setReplying] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<PlanUpdate | null>(null)
  const [deletingFile, setDeletingFile] = useState<PlanFile | null>(null)
  const list: MentionPerson[] = (people.data ?? []).map((u) => ({ id: u.id, name: u.name }))

  /** Arquivos novos primeiro (com eles o texto pode ficar vazio), depois o texto. */
  async function saveEdit(update: PlanUpdate, content: string, files: File[]) {
    if (files.length > 0) await mutations.addFiles.mutateAsync({ updateId: update.id, files })
    if (content !== update.content) await mutations.editUpdate.mutateAsync({ id: update.id, content })
    setEditing(null)
  }

  const card = (update: PlanUpdate, reply: boolean): ReactNode =>
    editing === update.id ? (
      <div key={update.id} className="flex flex-col gap-2">
        <UpdateEditor
          people={list}
          initial={update.content}
          keepsFiles={update.files.length > 0}
          label={t('plan.panel.editLabel')}
          submitLabel={t('common.save')}
          onCancel={() => setEditing(null)}
          onSubmit={(content, files) => saveEdit(update, content, files)}
        />
        {update.files.length > 0 && <AttachmentGallery attachments={update.files} compact onDelete={setDeletingFile} />}
      </div>
    ) : (
      <UpdateCard key={update.id} update={update} reply={reply} onEdit={() => setEditing(update.id)} onDelete={() => setDeleting(update)} onReply={() => setReplying(update.id)} onDeleteFile={setDeletingFile} />
    )

  return (
    <div className="flex flex-col gap-5">
      {canPost ? (
        <UpdateEditor people={list} label={t('plan.panel.newLabel')} submitLabel={t('plan.panel.post')} onSubmit={(content, files) => mutations.createUpdate.mutateAsync({ content, files })} />
      ) : (
        query.data && <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">{t('plan.panel.readOnly')}</p>
      )}
      {query.isPending ? (
        <AppSkeleton className="h-24" />
      ) : (query.data?.updates ?? []).length === 0 ? (
        <AppEmptyState compact icon={<MessageSquare />} title={t('plan.panel.empty')} description={t('plan.panel.emptyHint')} />
      ) : (
        <ol className="flex flex-col gap-4" aria-label={t('plan.panel.tabs.updates')}>
          {(query.data?.updates ?? []).map((update) => (
            <li key={update.id} className="flex flex-col gap-2">
              {card(update, false)}
              {(update.replies.length > 0 || replying === update.id) && (
                <ol className="ml-10 flex flex-col gap-2 border-l-2 border-border pl-3" aria-label={t('plan.panel.repliesOf', { name: update.author?.name ?? '' })}>
                  {update.replies.map((r) => (
                    <li key={r.id}>{card(r, true)}</li>
                  ))}
                  {replying === update.id && (
                    <li>
                      <UpdateEditor
                        people={list}
                        label={t('plan.panel.replyLabel', { name: update.author?.name ?? '' })}
                        submitLabel={t('plan.panel.reply')}
                        focusOnMount
                        onCancel={() => setReplying(null)}
                        onSubmit={(content, files) => mutations.createUpdate.mutateAsync({ content, parentId: update.id, files }).then(() => setReplying(null))}
                      />
                    </li>
                  )}
                </ol>
              )}
            </li>
          ))}
        </ol>
      )}
      <AppConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('plan.panel.deleteTitle')}
        description={t('plan.panel.deleteDescription')}
        confirmLabel={t('common.delete')}
        loading={mutations.deleteUpdate.isPending}
        onConfirm={() =>
          deleting &&
          mutations.deleteUpdate.mutate(deleting.id, {
            onSuccess: () => {
              notify.success(t('plan.panel.deleted'))
              setDeleting(null)
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
      <DeleteAttachmentDialog
        attachment={deletingFile}
        description={t('plan.panel.deleteFileDescription')}
        loading={mutations.deleteFile.isPending}
        onCancel={() => setDeletingFile(null)}
        onConfirm={(file) =>
          mutations.deleteFile.mutate(file.id, {
            onSuccess: () => {
              notify.success(t('plan.panel.fileDeleted', { name: file.name }))
              setDeletingFile(null)
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
    </div>
  )
}

function UpdateCard({
  update,
  reply,
  onEdit,
  onDelete,
  onReply,
  onDeleteFile,
}: {
  update: PlanUpdate
  reply: boolean
  onEdit: () => void
  onDelete: () => void
  onReply: () => void
  onDeleteFile: (file: PlanFile) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const name = update.author?.name ?? t('audit.system')
  return (
    <article className="flex gap-3" aria-label={t('plan.panel.updateBy', { name })}>
      <span aria-hidden className="flex">
        <AppAvatar name={name} src={update.author?.avatarUrl} size={reply ? 'xs' : 'sm'} />
      </span>
      <div className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 py-3">
        <header className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <span className="text-sm font-medium text-fg">{name}</span>
          <time dateTime={update.createdAt?.toISOString()} title={formatDateTime(update.createdAt, locale)}>
            {formatRelative(update.createdAt, locale)}
          </time>
          {update.editedAt && !update.deleted && <span title={formatDateTime(update.editedAt, locale)}>· {t('comments.edited')}</span>}
          {!update.deleted && (update.capabilities.edit || update.capabilities.delete) && (
            <span className="ml-auto flex gap-1">
              {update.capabilities.edit && <AppIconButton size="sm" label={t('plan.panel.edit')} icon={<Pencil />} onClick={onEdit} />}
              {update.capabilities.delete && <AppIconButton size="sm" variant="danger" label={t('plan.panel.delete')} icon={<Trash2 />} onClick={onDelete} />}
            </span>
          )}
        </header>
        {update.deleted ? <p className="text-sm text-subtle italic">{t('plan.panel.removed')}</p> : update.content && <AppMarkdown text={update.content} />}
        {update.files.length > 0 && (
          <div className="mt-2">
            <AttachmentGallery attachments={update.files} compact onDelete={onDeleteFile} />
          </div>
        )}
        {update.capabilities.reply && (
          <AppButton variant="ghost" size="sm" leftIcon={<Reply />} className="mt-2 -ml-2" onClick={onReply}>
            {t('plan.panel.reply')}
          </AppButton>
        )}
      </div>
    </article>
  )
}

/**
 * Editor da atualização (mostra "@Nome"; grava `@[Nome](id)`). Ctrl/⌘+Enter publica. Imagens coladas
 * (Ctrl+V), soltas no campo ou anexadas seguem junto; com elas (ou se a atualização já tem arquivo,
 * `keepsFiles`) o texto pode ficar vazio. Fotos grandes são reduzidas antes do envio.
 */
function UpdateEditor({
  people,
  initial = '',
  keepsFiles = false,
  label,
  submitLabel,
  focusOnMount,
  onSubmit,
  onCancel,
}: {
  people: MentionPerson[]
  initial?: string
  keepsFiles?: boolean
  label: string
  submitLabel: string
  focusOnMount?: boolean
  onSubmit: (content: string, files: File[]) => Promise<unknown>
  onCancel?: () => void
}) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const attachments = usePendingFiles()
  const fileInput = useRef<HTMLInputElement>(null)
  const start = mentionsToDisplay(initial)
  const [text, setText] = useState(start.text)
  const [mentioned, setMentioned] = useState<MentionPerson[]>(start.people)
  const [error, setError] = useState<string | undefined>()
  const [pending, setPending] = useState(false)

  async function submit() {
    const chosen = attachments.files
    if (!text.trim() && chosen.length === 0 && !keepsFiles) return setError('required')
    setPending(true)
    try {
      const files = await Promise.all(chosen.map((file) => (file.type.startsWith('image/') ? compressImage(file) : file)))
      const issue = updateUploadIssue(files)
      if (issue) {
        notify.error(t(`validation.${issue}`))
        return
      }
      await onSubmit(mentionsToStorage(text.trim(), mentioned), files)
      attachments.clear()
      if (!initial) {
        setText('')
        setMentioned([])
      }
      setError(undefined)
    } catch (err) {
      const fields = isAppError(err) && err.code === 'VALIDATION_ERROR' ? err.fieldErrors() : null
      if (fields?.content) setError(fields.content)
      else if (fields?.files) notify.error(t(`validation.${fields.files}`, { defaultValue: errorMessage(err) }))
      else notify.error(errorMessage(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <AppMentionTextarea
        label={label}
        hint={t('plan.panel.hint')}
        value={text}
        error={error}
        placeholder={t('plan.panel.placeholder')}
        maxLength={10000}
        focusOnMount={focusOnMount || !!initial}
        people={people}
        onValueChange={(value) => {
          setText(value)
          setError(undefined)
        }}
        onMention={(person) => setMentioned((list) => (list.some((p) => p.id === person.id) ? list : [...list, person]))}
        onSubmit={() => void submit()}
        onFiles={attachments.add}
      />
      <FilesToSend files={attachments.files} label={t('plan.panel.filesToSend')} onRemove={attachments.remove} />
      <div className="flex items-center justify-between gap-2">
        <AppButton variant="ghost" size="sm" leftIcon={<Paperclip />} onClick={() => fileInput.current?.click()} disabled={pending}>
          {t('plan.panel.attach')}
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
            attachments.add(event.target.files)
            event.target.value = ''
          }}
        />
        <div className="flex gap-2">
          {onCancel && (
            <AppButton variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
              {t('common.cancel')}
            </AppButton>
          )}
          <AppButton size="sm" onClick={() => void submit()} loading={pending}>
            {submitLabel}
          </AppButton>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ histórico e detalhes */

function HistoryTab({ projectId, item, active }: { projectId: string; item: PlanItem; active: boolean }) {
  const history = useItemHistory(projectId, item.id, active)
  return history.isPending ? <AppSkeleton className="h-24" /> : <AuditTimeline entries={history.data?.items ?? []} />
}

function DetailsTab({ plan, item }: { plan: Plan; item: PlanItem }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const status = plan.statuses.find((s) => s.id === item.statusId) ?? null
  const group = plan.groups.find((g) => g.id === item.groupId)
  const resources = item.resourceIds.map((id) => plan.resources.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r)
  const deps = dependenciesOf(item.id, plan)
  const dash = <span className="text-subtle">—</span>
  const hours = (value: number | null) => (value === null ? dash : `${formatNumber(value, locale)} h`)
  const rows: Array<[string, ReactNode]> = [
    [t('plan.columns.status'), status ? <StatusBlock key="s" status={status} className="min-h-7 w-40 rounded-md text-xs" /> : dash],
    [t('plan.columns.schedule'), item.startDate || item.endDate ? <SchedulePill key="c" start={item.startDate} end={item.endDate} color={group?.color ?? 'blue'} /> : dash],
    ...(item.parentId
      ? ([
          [t('plan.columns.owner'), item.owner?.name ?? dash],
          [t('plan.columns.due'), formatSchedule(item.dueDate, item.dueDate, locale) ?? dash],
        ] as Array<[string, ReactNode]>)
      : ([[t('plan.columns.resources'), resources.length ? <span key="r" className="flex flex-wrap gap-1">{resources.map((r) => <ResourceChip key={r.id} resource={r} />)}</span> : dash]] as Array<[string, ReactNode]>)),
    [item.parentId ? t('plan.columns.work') : t('plan.columns.estimated'), hours(item.estimatedHours)],
    ...(item.parentId ? ([[t('plan.columns.actual'), hours(item.actualHours)]] as Array<[string, ReactNode]>) : []),
    [t('plan.columns.duration'), item.durationDays === null ? dash : t('plan.daysCount', { count: item.durationDays })],
    [
      t('plan.columns.progress'),
      // vindo das tarefas vinculadas: só leitura, com "pelas tarefas · 3/5"
      <span key="p" className="flex max-w-60 flex-col gap-1" title={t(`plan.progressSource.${item.progress.source}`)}>
        <ProgressBar value={item.progress.value} label={t('plan.progressOf', { name: item.name })} />
        {isProgressFromTasks(item) && <TasksProgressNote tasks={linkedTasks(item)} />}
      </span>,
    ],
    ...(!item.parentId
      ? ([
          [t('plan.panel.subitems'), String(item.subitems)],
          [t('plan.dependency.dependsOn'), deps.dependsOn.length ? deps.dependsOn.map((d) => d.item.name).join(', ') : dash],
          [t('plan.dependency.blocks'), deps.blocks.length ? deps.blocks.map((d) => d.item.name).join(', ') : dash],
        ] as Array<[string, ReactNode]>)
      : []),
  ]
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd className="min-w-0">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
