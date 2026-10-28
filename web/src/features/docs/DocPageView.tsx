import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { FilePlus2, FileText, FolderInput, History, Link2, MoreHorizontal, PenLine, Pencil, Trash2 } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { formatDateTime, formatRelative } from '@/core/utils/format'
import { docOutline, MAX_DOC_DEPTH, type DocPage, type DocSpaceDetail, type DocTreePage } from '@/domain/docs'
import { AppBreadcrumb, AppButton, AppDropdown, AppEmptyState, AppErrorState, AppIconButton, AppSkeleton, type AppDropdownItem } from '@/presentation/components'
import { useCopy } from '@/presentation/common/use-copy'
import { AppRichTextView, scrollToHeading } from '@/presentation/components/rich-text'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { editPath, pagePath } from './docs-paths'
import { DraftBadge } from './docs-visuals'
import { useDocPage } from './queries'
import { VersionsDrawer } from './VersionsDrawer'

export interface DocPageViewProps {
  pageId: string
  detail: DocSpaceDetail
  /** Botão que abre o painel do espaço (árvore e configurações). */
  panelButton: ReactNode
  onCreateChild: (parentId: string) => void
  onRequestMove: (page: DocTreePage) => void
  onRequestDelete: (page: DocTreePage) => void
}

/** Leitura da página: trilha, título, quem publicou, conteúdo, "Nesta página" e subpáginas. */
export function DocPageView({ pageId, detail, panelButton, onCreateChild, onRequestMove, onRequestDelete }: DocPageViewProps) {
  const { t } = useTranslation()
  const page = useDocPage(pageId)
  if (page.isPending) {
    return (
      <div className="min-w-0 space-y-4">
        <AppSkeleton className="h-4 w-1/3" />
        <AppSkeleton className="h-9 w-2/3" />
        <AppSkeleton className="h-72" />
      </div>
    )
  }
  if (page.isError) {
    if (isAppError(page.error) && page.error.code === 'DOC_PAGE_NOT_FOUND') return <AppEmptyState icon={<FileText />} title={t('docs.page.notFound')} description={t('docs.page.notFoundHint')} />
    return <AppErrorState onRetry={() => void page.refetch()} />
  }
  return <PageContent page={page.data} detail={detail} panelButton={panelButton} onCreateChild={onCreateChild} onRequestMove={onRequestMove} onRequestDelete={onRequestDelete} />
}

function PageContent({ page, detail, panelButton, onCreateChild, onRequestMove, onRequestDelete }: Omit<DocPageViewProps, 'pageId'> & { page: DocPage }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const contentRef = useRef<HTMLDivElement>(null)
  const [versionsOpen, setVersionsOpen] = useState(false)
  useDocumentTitle(page.title)
  const outline = useMemo(() => docOutline(page.content), [page.content])
  const treePage = detail.pages.find((p) => p.id === page.id)
  const depth = page.ancestors.length + 1
  const canEdit = page.capabilities.edit

  const copy = useCopy()
  const copyLink = () => void copy(`${window.location.origin}${pagePath(page.space.key, page.id)}`)
  const moreItems: AppDropdownItem[] = [
    ...(canEdit && depth < MAX_DOC_DEPTH ? [{ key: 'child', label: t('docs.page.addChild'), icon: <FilePlus2 />, onSelect: () => onCreateChild(page.id) }] : []),
    { key: 'link', label: t('docs.page.copyLink'), icon: <Link2 />, onSelect: copyLink },
    ...(page.version > 0 ? [{ key: 'versions', label: t('docs.versions.title'), icon: <History />, onSelect: () => setVersionsOpen(true) }] : []),
    ...(canEdit && treePage && !page.isHome
      ? [
          { key: 'move', label: t('docs.page.move'), icon: <FolderInput />, onSelect: () => onRequestMove(treePage) },
          { type: 'separator' as const, key: 's' },
          { key: 'delete', label: t('common.delete'), icon: <Trash2 />, tone: 'danger' as const, onSelect: () => onRequestDelete(treePage) },
        ]
      : []),
  ]

  return (
    <article className="min-w-0" aria-labelledby="doc-page-title">
      <div className="mb-3">
        <AppBreadcrumb
          items={[
            { label: t('docs.title'), to: '/docs' },
            { label: detail.space.name, to: `/docs/${encodeURIComponent(detail.space.key)}` },
            ...page.ancestors.map((a) => ({ label: a.title, to: pagePath(page.space.key, a.id) })),
            { label: page.title },
          ]}
        />
      </div>
      <header className="mb-6 flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 id="doc-page-title" className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">
            {page.title}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <DraftBadge status={page.status} hasDraft={!!page.draft} />
            {page.version > 0 ? (
              <span title={formatDateTime(page.publishedAt, i18n.language)}>
                {t('docs.page.publishedMeta', { version: page.version, who: page.publishedBy?.name ?? t('audit.system'), when: formatRelative(page.publishedAt, i18n.language) })}
              </span>
            ) : (
              <span>{t('docs.page.neverPublished')}</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {panelButton}
          {canEdit && (
            <AppButton leftIcon={<Pencil />} onClick={() => void navigate(editPath(page.space.key, page.id))}>
              {page.draft ? t('docs.page.continueEditing') : t('common.edit')}
            </AppButton>
          )}
          {page.version > 0 && (
            <AppButton variant="secondary" leftIcon={<History />} onClick={() => setVersionsOpen(true)} className="max-sm:hidden">
              {t('docs.versions.short')}
            </AppButton>
          )}
          <AppDropdown trigger={<AppIconButton variant="secondary" label={t('common.more')} icon={<MoreHorizontal />} />} items={moreItems} />
        </div>
      </header>

      {page.draft && canEdit && (
        <div role="note" className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-info-soft-fg/25 bg-info-soft px-4 py-3 text-sm text-info-soft-fg">
          <PenLine aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {t('docs.page.pendingNote', { who: page.draft.by?.name ?? t('audit.system'), when: formatRelative(page.draft.at, i18n.language) })}
          </span>
          <AppButton size="sm" variant="secondary" onClick={() => void navigate(editPath(page.space.key, page.id))}>
            {t('docs.page.continueEditing')}
          </AppButton>
        </div>
      )}

      <div className="grid items-start gap-8 2xl:grid-cols-[minmax(0,1fr)_15rem]">
        <div ref={contentRef} className="min-w-0">
          {page.content && page.version > 0 ? (
            <AppRichTextView content={page.content} onNavigate={(href) => void navigate(href)} />
          ) : (
            <AppEmptyState
              icon={<FileText />}
              title={t('docs.page.emptyTitle')}
              description={canEdit ? t('docs.page.emptyEditor') : t('docs.page.emptyReader')}
              action={
                canEdit && (
                  <AppButton leftIcon={<Pencil />} onClick={() => void navigate(editPath(page.space.key, page.id))}>
                    {t('common.edit')}
                  </AppButton>
                )
              }
            />
          )}
          {page.children.length > 0 && (
            <section aria-labelledby="doc-children-title" className="mt-10 border-t border-border pt-5">
              <h2 id="doc-children-title" className="mb-3 text-sm font-semibold text-muted">
                {t('docs.page.children', { count: page.children.length })}
              </h2>
              <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr))]">
                {page.children.map((child) => (
                  <li key={child.id}>
                    <Link
                      to={pagePath(page.space.key, child.id)}
                      className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg transition-colors hover:border-primary/40 hover:bg-surface-2/50"
                    >
                      <FileText aria-hidden className="size-4 shrink-0 text-subtle" />
                      <span className="truncate">{child.title}</span>
                      {child.status === 'draft' && <span className="ml-auto shrink-0 text-xs text-subtle">{t('docs.page.draftBadge')}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        {outline.length > 1 && (
          <nav aria-label={t('docs.page.outline')} className="sticky top-0 hidden max-h-[calc(100dvh-8rem)] overflow-y-auto 2xl:block">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">{t('docs.page.outline')}</p>
            <ol className="space-y-1 border-l border-border text-sm">
              {outline.map((item) => (
                <li key={item.index} style={{ paddingLeft: `${(item.level - 1) * 0.75 + 0.75}rem` }}>
                  <button type="button" onClick={() => scrollToHeading(contentRef.current, item.index)} className="text-left text-muted hover:text-primary-text">
                    {item.text || t('richText.toc.untitled')}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}
      </div>

      {page.version > 0 && <VersionsDrawer page={page} open={versionsOpen} onOpenChange={setVersionsOpen} />}
    </article>
  )
}
