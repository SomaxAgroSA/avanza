import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ArrowLeft, Check, CloudUpload, Loader2, Send, Trash2 } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { formatDateTime } from '@/core/utils/format'
import type { DocDraft, DocPage, RichContent } from '@/domain/docs'
import { AppButton, AppConfirmDialog, AppEmptyState, AppErrorState, AppLoading, notify } from '@/presentation/components'
import { AppRichTextEditor, type RichTextUpload } from '@/presentation/components/rich-text'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useRepositories } from '@/presentation/common/repositories-context'
import { useSession } from '@/features/auth/session'
import { pagePath } from './docs-paths'
import { useDocDraft, useDocPage, usePageMutations, useSaveDraft } from './queries'

const AUTOSAVE_MS = 1200
const TITLE_MAX = 200

/** `/docs/:spaceKey/:pageId/edit`. */
export function DocPageEditorPage() {
  const { t } = useTranslation()
  const { spaceKey = '', pageId = '' } = useParams()
  const page = useDocPage(pageId)
  const canEdit = !!page.data?.capabilities.edit
  // o rascunho só é pedido para quem edita (quem só lê volta para a leitura)
  const draft = useDocDraft(pageId, canEdit)
  if (page.isPending) return <AppLoading label={t('docs.editor.loading')} />
  if (page.isError) {
    if (isAppError(page.error) && page.error.code === 'DOC_PAGE_NOT_FOUND') return <AppEmptyState title={t('docs.page.notFound')} description={t('docs.page.notFoundHint')} />
    return <AppErrorState onRetry={() => void page.refetch()} />
  }
  if (!canEdit) return <Navigate to={pagePath(spaceKey, pageId)} replace />
  if (draft.isPending) return <AppLoading label={t('docs.editor.loading')} />
  if (draft.isError) return <AppErrorState onRetry={() => void draft.refetch()} />
  return <PageEditor key={pageId} page={page.data} draft={draft.data} />
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

function PageEditor({ page, draft }: { page: DocPage; draft: DocDraft }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const errorMessage = useErrorMessage()
  const { docs } = useRepositories()
  const { current } = useSession()
  const saveDraft = useSaveDraft(page.id)
  const { publish, discard } = usePageMutations(page.space.key)
  const [title, setTitle] = useState(draft.title)
  const [state, setState] = useState<SaveState>('saved')
  const [savedAt, setSavedAt] = useState<Date | null>(draft.savedAt)
  const [hadDraft, setHadDraft] = useState(!!page.draft)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const titleRef = useRef(draft.title)
  const contentRef = useRef<RichContent>(draft.content)
  const changes = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const stateRef = useRef<SaveState>('saved')
  const flushRef = useRef<() => Promise<void>>(async () => undefined)
  // gravação em andamento: publicar/descartar esperam por ela (senão o rascunho reapareceria depois)
  const inflight = useRef<Promise<unknown> | null>(null)
  useDocumentTitle(t('docs.editor.documentTitle', { title: title || t('docs.page.untitled') }))

  const setSave = (next: SaveState) => {
    stateRef.current = next
    setState(next)
  }
  const body = useCallback(() => ({ title: titleRef.current.trim() || t('docs.page.untitled'), content: contentRef.current }), [t])

  /** Grava o rascunho agora (se houver algo novo); outra mudança durante a gravação agenda a próxima. */
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    if (stateRef.current !== 'dirty' && stateRef.current !== 'error') return
    const seq = changes.current
    setSave('saving')
    try {
      const request = saveDraft.mutateAsync(body())
      inflight.current = request
      const at = await request
      setSavedAt(at)
      setHadDraft(true)
      if (changes.current === seq) setSave('saved')
      else {
        setSave('dirty')
        timer.current = window.setTimeout(() => void flushRef.current(), AUTOSAVE_MS)
      }
    } catch (error) {
      setSave('error')
      notify.error(errorMessage(error))
    } finally {
      inflight.current = null
    }
  }, [body, errorMessage, saveDraft])
  useEffect(() => {
    flushRef.current = flush
  }, [flush])

  const changed = () => {
    changes.current += 1
    if (stateRef.current !== 'saving') setSave('dirty')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flushRef.current(), AUTOSAVE_MS)
  }

  // saiu com algo pendente (trocou de tela): grava em segundo plano; fechar a aba pede confirmação
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (stateRef.current === 'saved') return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
      window.clearTimeout(timer.current)
      if (stateRef.current === 'dirty' || stateRef.current === 'error') void docs.saveDraft(page.id, body()).catch(() => undefined)
    }
  }, [body, docs, page.id])

  const onUpload = async (files: File[]): Promise<RichTextUpload[]> => {
    try {
      return (await docs.uploadFiles(page.id, files)).map((file) => ({ url: file.url, name: file.name, kind: file.kind }))
    } catch (error) {
      notify.error(errorMessage(error))
      return []
    }
  }

  const exit = async () => {
    await flush()
    void navigate(pagePath(page.space.key, page.id))
  }
  const settle = async () => {
    window.clearTimeout(timer.current)
    await inflight.current?.catch(() => undefined)
  }
  const onPublish = async () => {
    await settle()
    publish.mutate(
      { id: page.id, ...body() },
      {
        onSuccess: (published) => {
          setSave('saved')
          notify.success(t('docs.editor.published', { version: published.version }))
          // na página publicada, a janela "Avisar" (§47) abre sozinha
          void navigate(pagePath(page.space.key, page.id), { state: { notify: true } })
        },
        onError: (error) => notify.error(errorMessage(error)),
      },
    )
  }
  const onDiscard = async () => {
    await settle()
    discard.mutate(page.id, {
      onSuccess: () => {
        setSave('saved')
        notify.success(t('docs.editor.discarded'))
        void navigate(pagePath(page.space.key, page.id))
      },
      onError: (error) => notify.error(errorMessage(error)),
    })
  }

  const otherAuthor = page.draft && draft.by && current && draft.by.id !== current.user.id ? draft.by.name : null
  // descartar só faz sentido numa página já publicada (a nunca publicada é o próprio rascunho)
  const canDiscard = page.status === 'published' && (hadDraft || state !== 'saved')

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <AppButton variant="ghost" leftIcon={<ArrowLeft />} onClick={() => void exit()}>
          {t('docs.editor.exit')}
        </AppButton>
        <Link to={`/docs/${encodeURIComponent(page.space.key)}`} className="truncate text-sm text-muted hover:text-fg max-sm:hidden">
          {page.space.name}
        </Link>
        <SaveStatus state={state} savedAt={savedAt} locale={i18n.language} />
        <div className="ml-auto flex items-center gap-2">
          {canDiscard && (
            <AppButton variant="ghost" leftIcon={<Trash2 />} onClick={() => setConfirmDiscard(true)} disabled={publish.isPending}>
              {t('docs.editor.discard')}
            </AppButton>
          )}
          <AppButton leftIcon={<Send />} loading={publish.isPending} onClick={() => void onPublish()}>
            {page.version > 0 ? t('docs.editor.publishUpdate') : t('docs.editor.publish')}
          </AppButton>
        </div>
      </div>

      {otherAuthor && (
        <div role="note" className="flex items-center gap-2 rounded-lg border border-warning-soft-fg/25 bg-warning-soft px-4 py-2.5 text-sm text-warning-soft-fg">
          <AlertCircle aria-hidden className="size-4 shrink-0" />
          {t('docs.editor.sharedDraft', { who: otherAuthor, when: formatDateTime(draft.savedAt, i18n.language) })}
        </div>
      )}

      <div className="min-w-0 rounded-xl border border-border bg-surface shadow-card">
        <input
          value={title}
          maxLength={TITLE_MAX}
          onChange={(event) => {
            setTitle(event.target.value)
            titleRef.current = event.target.value
            changed()
          }}
          placeholder={t('docs.page.untitled')}
          aria-label={t('docs.editor.titleLabel')}
          className="w-full rounded-t-xl bg-transparent px-4 pt-6 pb-2 text-2xl font-bold tracking-tight text-fg placeholder:text-subtle focus:outline-none sm:px-8 sm:text-3xl"
        />
        <AppRichTextEditor
          defaultValue={draft.content}
          label={t('docs.editor.contentLabel')}
          onChange={(value) => {
            contentRef.current = value
            changed()
          }}
          onUpload={onUpload}
        />
      </div>

      <AppConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t('docs.editor.discardTitle')}
        description={t('docs.editor.discardHint', { version: page.version })}
        confirmLabel={t('docs.editor.discard')}
        loading={discard.isPending}
        onConfirm={() => void onDiscard()}
      />
    </div>
  )
}

function SaveStatus({ state, savedAt, locale }: { state: SaveState; savedAt: Date | null; locale: string }) {
  const { t } = useTranslation()
  const time = savedAt ? savedAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : null
  const content = {
    saving: [<Loader2 key="i" aria-hidden className="size-3.5 animate-spin" />, t('docs.editor.saving')],
    dirty: [<CloudUpload key="i" aria-hidden className="size-3.5" />, t('docs.editor.unsaved')],
    error: [<AlertCircle key="i" aria-hidden className="size-3.5 text-danger" />, t('docs.editor.saveFailed')],
    saved: [<Check key="i" aria-hidden className="size-3.5 text-success" />, time ? t('docs.editor.savedAt', { time }) : t('docs.editor.noChanges')],
  }[state]
  return (
    <span role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs text-muted">
      {content}
    </span>
  )
}
