import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { BookOpen, Check, Clock, FileText, MoreHorizontal, Plus, SearchX } from 'lucide-react'
import { formatRelative } from '@/core/utils/format'
import { countSpacesByModule, groupSpacesByModule, orderedModules, resolveModuleFilter, type DocModule, type DocSpace, type DocSpaceGroup, type ModuleFilter } from '@/domain/docs'
import { AppButton, AppDropdown, AppEmptyState, AppErrorState, AppSearch, AppSkeleton, notify, type AppDropdownItem } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useCan } from '@/features/auth/session'
import { optionColor } from '@/features/task-config/config-theme'
import { pagePath } from './docs-paths'
import { Highlighted, ModuleSwatch, SpaceAvatar, SpaceVisibilityBadge } from './docs-visuals'
import { ModuleList } from './ModuleList'
import { useDocModules, useDocRecent, useDocSearch, useDocSpaces, useSpaceMutations } from './queries'
import { SpaceFormDialog } from './SpaceFormDialog'

/**
 * `/docs`: espaços que a pessoa lê organizados por módulo (§43; `?module=` guarda o filtro, então o
 * "voltar" do navegador volta a ele), busca em toda a documentação e páginas atualizadas.
 */
export function DocsHomePage() {
  const { t } = useTranslation()
  const canManage = useCan('docs.manage')
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const modules = useDocModules()
  const searching = query.trim().length >= 2
  const filter = resolveModuleFilter(params.get('module'), modules.data ?? [])
  const selectModule = (next: ModuleFilter) => setParams(next === 'all' ? {} : { module: next })

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
      {searching ? (
        <SearchResults query={query.trim()} />
      ) : (
        <Overview canManage={canManage} onCreate={() => setCreating(true)} modules={modules.data ?? []} modulesPending={modules.isPending} filter={filter} onSelectModule={selectModule} />
      )}
      {/* com um módulo escolhido, o espaço novo já nasce nele */}
      <SpaceFormDialog open={creating} onOpenChange={setCreating} defaultModuleId={filter !== 'all' && filter !== 'none' ? filter : undefined} />
    </>
  )
}

interface OverviewProps {
  canManage: boolean
  onCreate: () => void
  modules: DocModule[]
  /** Enquanto os módulos carregam, os cartões esperam (não aparecem num grupo e pulam para outro). */
  modulesPending: boolean
  filter: ModuleFilter
  onSelectModule: (filter: ModuleFilter) => void
}

function Overview({ canManage, onCreate, modules, modulesPending, filter, onSelectModule }: OverviewProps) {
  const { t } = useTranslation()
  const spaces = useDocSpaces()
  const list = spaces.data ?? []
  const groups = groupSpacesByModule(list, modules, filter)
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <ModuleList modules={modules} counts={countSpacesByModule(list, modules)} selected={filter} onSelect={onSelectModule} canManage={canManage} />
      <div className="grid min-w-0 items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="docs-spaces-title" className="min-w-0">
          <h2 id="docs-spaces-title" className="sr-only">
            {t('docs.spaces')}
          </h2>
          {spaces.isPending || modulesPending ? (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,17rem),1fr))]">
              {Array.from({ length: 6 }, (_, i) => (
                <AppSkeleton key={i} className="h-36 rounded-xl" />
              ))}
            </div>
          ) : spaces.isError ? (
            <AppErrorState onRetry={() => void spaces.refetch()} />
          ) : list.length === 0 ? (
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
            <div className="space-y-7">
              {groups.map((group) => (
                <SpaceGroup key={group.module?.id ?? 'none'} group={group} modules={modules} canManage={canManage} />
              ))}
            </div>
          )}
        </section>
        <RecentPages />
      </div>
    </div>
  )
}

/** Um módulo (ou "Sem módulo"): faixa da cor, nome, quantidade e os cartões. */
function SpaceGroup({ group, modules, canManage }: { group: DocSpaceGroup; modules: DocModule[]; canManage: boolean }) {
  const { t } = useTranslation()
  const name = group.module ? group.module.name : t('docs.modules.none')
  const headingId = `docs-group-${group.module?.id ?? 'none'}`
  return (
    <section aria-labelledby={headingId}>
      <div className="mb-3 flex items-center gap-2.5">
        <span aria-hidden className={`h-[18px] w-1 shrink-0 rounded-full ${group.module ? '' : 'bg-border-strong'}`} style={group.module ? { backgroundColor: optionColor(group.module.color) } : undefined} />
        <h3 id={headingId} className="truncate text-base font-semibold text-fg">
          {name}
        </h3>
        <span className="shrink-0 text-xs text-subtle">{t('docs.modules.spaces', { count: group.spaces.length })}</span>
      </div>
      {group.spaces.length === 0 ? (
        <p className="text-sm text-muted">{canManage ? t('docs.modules.emptyModule') : t('docs.modules.emptyModuleReader')}</p>
      ) : (
        <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,17rem),1fr))]">
          {group.spaces.map((space) => (
            <li key={space.id} className="relative">
              <SpaceCard space={space} withMenu={space.capabilities.manage && modules.length > 0} />
              {space.capabilities.manage && modules.length > 0 && <SpaceMenu space={space} modules={modules} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** "Criado em dd/mm/aaaa" no formato do idioma. */
function createdOn(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}

function SpaceCard({ space, withMenu }: { space: DocSpace; withMenu: boolean }) {
  const { t, i18n } = useTranslation()
  return (
    <Link
      to={`/docs/${encodeURIComponent(space.key)}`}
      className="group flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-card transition-colors hover:border-primary/40 hover:bg-surface-2/40"
    >
      <div className={`flex items-start gap-3 ${withMenu ? 'pr-8' : ''}`}>
        <SpaceAvatar icon={space.icon} color={space.color} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-fg group-hover:text-primary-text">{space.name}</p>
          {space.createdAt && <p className="text-xs text-subtle">{t('docs.modules.createdOn', { date: createdOn(space.createdAt, i18n.language) })}</p>}
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

/** "⋯" do cartão (quem configura o espaço): mover para outro módulo ou para "Sem módulo". */
function SpaceMenu({ space, modules }: { space: DocSpace; modules: DocModule[] }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { update } = useSpaceMutations()
  const current = space.module?.id ?? null
  const move = (target: DocModule | null) => {
    if ((target?.id ?? null) === current) return
    update.mutate(
      { id: space.id, input: { moduleId: target?.id ?? '' } },
      {
        onSuccess: () => notify.success(target ? t('docs.modules.movedTo', { space: space.name, module: target.name }) : t('docs.modules.movedToNone', { space: space.name })),
        onError: (error) => notify.error(errorMessage(error)),
      },
    )
  }
  const option = (key: string, label: string, color: DocModule['color'] | null, target: DocModule | null): AppDropdownItem => ({
    key,
    label: (
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <ModuleSwatch color={color} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {(target?.id ?? null) === current && <Check aria-hidden className="text-primary-text" />}
      </span>
    ),
    onSelect: () => move(target),
  })
  return (
    <AppDropdown
      trigger={
        <button
          type="button"
          aria-label={t('docs.modules.spaceActions', { name: space.name })}
          className="absolute right-2.5 top-2.5 flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg [&_svg]:size-4"
        >
          <MoreHorizontal aria-hidden />
        </button>
      }
      items={[
        { type: 'label', key: 'title', label: t('docs.modules.moveTo') },
        ...orderedModules(modules).map((m) => option(m.id, m.name, m.color, m)),
        { type: 'separator', key: 's' },
        option('none', t('docs.modules.none'), null, null),
      ]}
    />
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
