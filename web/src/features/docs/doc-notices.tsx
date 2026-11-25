import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bell, Eye, EyeOff } from 'lucide-react'
import { formatDateTime, formatRelative } from '@/core/utils/format'
import { DOC_NOTICE_NOTE_MAX } from '@/domain/docs'
import { AppAvatar, AppButton, AppDialog, AppMultiSelect, AppSkeleton, AppTextarea, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useNoticeCandidates, useNotifyPage, usePageNotices } from './queries'

/**
 * Janela "Avisar sobre esta página" (§47): quem edita escolhe quem deve olhar a página (só aparecem as
 * pessoas que a leem) e escreve, se quiser, o que olhar. O responsável de Desenvolvimento do projeto do
 * espaço vem marcado. A pessoa recebe no sino e por e-mail, com o link para a página.
 */
export function NotifyPageDialog({
  open,
  onOpenChange,
  page,
  projectName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  page: { id: string; title: string }
  projectName: string | null
}) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const candidates = useNoticeCandidates(page.id, open)
  const send = useNotifyPage()
  const [selected, setSelected] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  const people = useMemo(() => candidates.data ?? [], [candidates.data])
  const suggested = people.find((person) => person.suggested) ?? null
  // até a pessoa mexer na lista, o responsável de Desenvolvimento vem marcado
  const chosen = touched ? selected : suggested ? [suggested.id] : []

  const change = (next: boolean) => {
    if (!next) {
      setSelected([])
      setNote('')
      setTouched(false)
    }
    onOpenChange(next)
  }

  const options = useMemo(() => people.map((person) => ({ value: person.id, label: person.name, prefix: <AppAvatar name={person.name} src={person.avatarUrl} size="xs" /> })), [people])

  const submit = () =>
    send.mutate(
      { pageId: page.id, userIds: chosen, note: note.trim() },
      {
        onSuccess: () => {
          const names = people.filter((person) => chosen.includes(person.id)).map((person) => person.name)
          notify.success(t('docs.notices.sent', { count: names.length, names: names.join(', ') }))
          change(false)
        },
        onError: (error) => notify.error(errorMessage(error)),
      },
    )

  return (
    <AppDialog
      open={open}
      onOpenChange={change}
      size="md"
      title={t('docs.notices.dialogTitle')}
      description={projectName ? t('docs.notices.dialogDescription', { page: page.title, project: projectName }) : page.title}
      footer={
        <>
          <AppButton variant="ghost" onClick={() => change(false)} disabled={send.isPending}>
            {t('docs.notices.notNow')}
          </AppButton>
          <AppButton leftIcon={<Bell />} onClick={submit} disabled={chosen.length === 0} loading={send.isPending}>
            {t('docs.notices.send')}
          </AppButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {candidates.isPending ? (
          <AppSkeleton className="h-10" />
        ) : (
          <AppMultiSelect
            label={t('docs.notices.who')}
            value={chosen}
            onValueChange={(value) => {
              setTouched(true)
              setSelected(value)
            }}
            options={options}
            placeholder={t('docs.notices.addPerson')}
            hint={
              people.length === 0
                ? t('docs.notices.nobody')
                : suggested && chosen.includes(suggested.id)
                  ? t('docs.notices.suggestedHint', { name: suggested.name })
                  : t('docs.notices.onlyReaders')
            }
          />
        )}
        <AppTextarea
          label={
            <>
              {t('docs.notices.note')} <span className="font-normal text-muted">{t('docs.notices.optional')}</span>
            </>
          }
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={DOC_NOTICE_NOTE_MAX}
          rows={3}
          placeholder={t('docs.notices.notePlaceholder')}
        />
        <p className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
          <Bell aria-hidden className="size-3.5 shrink-0" />
          {t('docs.notices.howItArrives')}
        </p>
      </div>
    </AppDialog>
  )
}

/**
 * Linha "Avisada a" no topo da página (só para quem edita): cada pessoa avisada e se já abriu a página
 * (com a data) ou ainda não.
 */
export function PageNoticesLine({ pageId }: { pageId: string }) {
  const { t, i18n } = useTranslation()
  const notices = usePageNotices(pageId, true)
  const list = notices.data ?? []
  if (list.length === 0) return null
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted" data-testid="page-notices">
      <span className="flex items-center gap-1.5">
        <Bell aria-hidden className="size-3.5" />
        {t('docs.notices.notified')}
      </span>
      {list.map((notice) => (
        <span
          key={notice.id}
          className="inline-flex items-center gap-1.5"
          title={t('docs.notices.sentAt', { who: notice.actor?.name ?? t('audit.system'), when: formatDateTime(notice.createdAt, i18n.language) })}
        >
          <AppAvatar name={notice.user.name} src={notice.user.avatarUrl} size="xs" />
          <span className="text-fg">{notice.user.name}</span>
          {notice.openedAt ? (
            <span className="inline-flex items-center gap-1 text-primary-text" title={formatDateTime(notice.openedAt, i18n.language)}>
              <Eye aria-hidden className="size-3.5" />
              {t('docs.notices.opened', { when: formatRelative(notice.openedAt, i18n.language) })}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-subtle">
              <EyeOff aria-hidden className="size-3.5" />
              {t('docs.notices.notOpened')}
            </span>
          )}
        </span>
      ))}
    </p>
  )
}
