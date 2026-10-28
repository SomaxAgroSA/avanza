import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { BookOpen, Clock, FileText, Plus, SearchX } from 'lucide-react'
import { formatRelative } from '@/core/utils/format'
import type { DocSpace } from '@/domain/docs'
import { AppButton, AppEmptyState, AppErrorState, AppSearch, AppSkeleton } from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useCan } from '@/features/auth/session'
import { pagePath } from './docs-paths'
import { Highlighted, SpaceAvatar, SpaceVisibilityBadge } from './docs-visuals'
import { useDocRecent, useDocSearch, useDocSpaces } from './queries'
import { SpaceFormDialog } from './SpaceFormDialog'

/** `/docs`: espaços que a pessoa lê, busca em toda a documentação e páginas atualizadas. */
export function DocsHomePage() {
  const { t } = useTranslation()
  const canManage = useCan('docs.manage')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const searching = query.trim().length >= 2

  return (
    <>
      <PageHeader
        title={t('docs.title')}
        description={t('docs.description')}
        actions={
          canManage && (
            <AppButton leftIcon={<Plus />} onClick={() => setCreating(true)}>
              {t('docs.space.new')}
            </AppButton>
          )
        }
      />
      <AppSearch value={query} onSearch={setQuery} placeholder={t('docs.search.placeholder')} aria-label={t('docs.search.label')} className="mb-6 w-full" />
      {searching ? <SearchResults query={query.trim()} /> : <Overview canManage={canManage} onCreate={() => setCreating(true)} />}
      <SpaceFormDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}

function Overview({ canManage, onCreate }: { canManage: boolean; onCreate: () => void }) {
  const { t } = useTranslation()
  const spaces = useDocSpaces()
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-labelledby="docs-spaces-title" className="min-w-0">
        <h2 id="docs-spaces-title" className="mb-3 text-sm font-semibold text-muted">
          {t('docs.spaces')}
        </h2>
        {spaces.isPending ? (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,17rem),1fr))]">
            {Array.from({ length: 6 }, (_, i) => (
              <AppSkeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        ) : spaces.isError ? (
          <AppErrorState onRetry={() => void spaces.refetch()} />
        ) : spaces.data.length === 0 ? (
          <AppEmptyState
            icon={<BookOpen />}
            title={t('docs.emptyTitle')}
            description={canManage ? t('docs.emptyHint') : t('docs.emptyReader')}
            action={
              canManage && (
                <AppButton leftIcon={<Plus />} onClick={onCreate}>
                  {t('docs.space.new')}
                </AppButton>
              )
            }
          />
        ) : (
          <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,17rem),1fr))]">
            {spaces.data.map((space) => (
              <li key={space.id}>
                <SpaceCard space={space} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <RecentPages />
    </div>
  )
}

function SpaceCard({ space }: { space: DocSpace }) {
  const { t } = useTranslation()
  return (
    <Link
      to={`/docs/${encodeURIComponent(space.key)}`}
      className="group flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-card transition-colors hover:border-primary/40 hover:bg-surface-2/40"
    >
      <div className="flex items-start gap-3">
        <SpaceAvatar icon={space.icon} color={space.color} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-fg group-hover:text-primary-text">{space.name}</p>
          <p className="font-mono text-xs text-subtle">{space.key}</p>
        </div>
      </div>
      <p className="line-clamp-2 min-h-10 text-sm text-muted">{space.description || t('docs.space.noDescription')}</p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-xs text-subtle">
        <span className="inline-flex items-center gap-1">
          <FileText aria-hidden className="size-3.5" />
          {t('docs.space.pages', { count: space.pageCount ?? 0 })}
        </span>
        <SpaceVisibilityBadge space={space} />
      </div>
    </Link>
  )
}

function RecentPages() {
  const { t, i18n } = useTranslation()
  const recent = useDocRecent()
  return (
    <section aria-labelledby="docs-recent-title" className="min-w-0 rounded-xl border border-border bg-surface p-4 shadow-card">
      <h2 id="docs-recent-title" className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
        <Clock aria-hidden className="size-4 text-subtle" />
        {t('docs.recent')}
      </h2>
      {recent.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <AppSkeleton key={i} className="h-10" />
          ))}
        </div>
      ) : recent.isError || recent.data.length === 0 ? (
        <p className="text-sm text-subtle">{t('docs.recentEmpty')}</p>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {recent.data.map((item) => (
            <li key={item.pageId}>
              <Link to={pagePath(item.space.key, item.pageId)} className="block rounded-md px-2 py-1.5 hover:bg-surface-2">
                <span className="block truncate text-sm font-medium text-fg">{item.title}</span>
                <span className="block truncate text-xs text-subtle">
                  {item.space.name} · {formatRelative(item.publishedAt, i18n.language)}
                  {item.publishedBy ? ` · ${item.publishedBy.name}` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SearchResults({ query }: { query: string }) {
  const { t, i18n } = useTranslation()
  const results = useDocSearch(query)
  if (results.isPending) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <AppSkeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    )
  }
  if (results.isError) return <AppErrorState onRetry={() => void results.refetch()} />
  if (results.data.length === 0) return <AppEmptyState icon={<SearchX />} title={t('docs.search.emptyTitle')} description={t('docs.search.emptyHint', { query })} />
  return (
    <section aria-label={t('docs.search.results', { count: results.data.length })}>
      <p role="status" className="mb-3 text-sm text-muted">
        {t('docs.search.results', { count: results.data.length })}
      </p>
      <ul className="space-y-3">
        {results.data.map((result) => (
          <li key={result.pageId}>
            <Link
              to={pagePath(result.space.key, result.pageId)}
              className="block rounded-xl border border-border bg-surface p-4 shadow-card transition-colors hover:border-primary/40"
            >
              <p className="font-semibold text-fg">
                <Highlighted text={result.title} query={query} />
              </p>
              <p className="mt-0.5 text-xs text-subtle">
                {result.space.name} · {formatRelative(result.publishedAt, i18n.language)}
              </p>
              {result.snippet && (
                <p className="mt-2 line-clamp-3 text-sm text-muted">
                  <Highlighted text={result.snippet} query={query} />
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
