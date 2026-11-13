import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { BookOpen, ExternalLink, FilePlus2, FileText, Home, Link2, Unlink } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { formatRelative } from '@/core/utils/format'
import { buildDocTree, flattenDocTree, type DocSpace } from '@/domain/docs'
import type { TaskDetail } from '@/domain/tasks'
import { AppButton, AppDialog, AppDropdown, AppEmptyState, AppErrorState, AppSearch, AppSkeleton, notify } from '@/presentation/components'
import { AppRichTextView } from '@/presentation/components/rich-text'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { projectPath } from '@/domain/project-routes'
import { editPath, pagePath } from '@/features/docs/docs-paths'
import { SpaceAvatar } from '@/features/docs/docs-visuals'
import { useDocLinkMutations, useDocPage, useDocSearch, useDocSpace, useDocSpaces, usePageMutations, useTaskDocs } from '@/features/docs/queries'

const TITLE_MAX = 200

/**
 * Aba Documentação da tarefa: à esquerda as páginas vinculadas, à direita a página escolhida, lida ali
 * mesmo (sem sair da tarefa). Dá para vincular uma página existente ou criar uma nova, já vinculada, no
 * espaço do projeto; "Abrir completa" só é preciso para editar.
 */
export function TaskDocsPanel({ task }: { task: TaskDetail }) {
  const { t, i18n } = useTranslation()
  const docs = useTaskDocs(task.id)
  const spaces = useDocSpaces()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const list = docs.data ?? []
  // a escolhida; sem escolha (ou se ela saiu da lista), a primeira
  const selected = list.find((page) => page.id === selectedId) ?? list[0] ?? null

  const projectSpaces = (spaces.data ?? []).filter((space) => space.project?.id === task.project?.id)
  const editableSpaces = projectSpaces.filter((space) => space.capabilities.edit)

  if (docs.isPending) return <AppSkeleton className="h-40" />
  if (docs.isError) return <AppErrorState onRetry={() => void docs.refetch()} />

  const actions = (
    <div className="flex flex-col gap-2">
      <AppButton size="sm" variant="secondary" leftIcon={<Link2 />} onClick={() => setLinking(true)}>
        {t('docs.links.linkPage')}
      </AppButton>
      <CreateFromTask task={task} spaces={editableSpaces} />
      {editableSpaces.length === 0 && task.project && (
        <p className="text-xs text-muted">
          {t('docs.links.noProjectSpace')}{' '}
          <Link to={projectPath(task.project.id, 'docs')} className="text-primary-text hover:underline">
            {t('docs.links.goToProjectDocs')}
          </Link>
        </p>
      )}
    </div>
  )

  return (
    <div data-testid="task-docs">
      {list.length === 0 ? (
        <AppEmptyState icon={<BookOpen />} title={t('docs.links.taskEmptyTitle')} description={t('docs.links.taskEmptyHint')} action={<div className="w-64">{actions}</div>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col gap-1.5" aria-label={t('docs.links.linkedPages')}>
              {list.map((page) => (
                <li key={page.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(page.id)}
                    aria-current={selected?.id === page.id}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm transition-colors hover:border-primary/40',
                      selected?.id === page.id && 'border-primary bg-primary-soft/40',
                    )}
                  >
                    {page.isHome ? <Home aria-hidden className="mt-0.5 size-4 shrink-0 text-subtle" /> : <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-subtle" />}
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-fg">{page.title}</span>
                      <span className="text-xs text-muted">{page.space.key}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {actions}
          </div>
          {selected && <PageReader key={selected.id} pageId={selected.id} spaceKey={selected.space.key} spaceName={selected.space.name} canUnlink={selected.canUnlink} taskId={task.id} locale={i18n.language} />}
        </div>
      )}
      <LinkPageDialog open={linking} onOpenChange={setLinking} task={task} spaces={projectSpaces} linkedIds={list.map((page) => page.id)} />
    </div>
  )
}

/** A página vinculada, lida dentro da tarefa. */
function PageReader({ pageId, spaceKey, spaceName, canUnlink, taskId, locale }: { pageId: string; spaceKey: string; spaceName: string; canUnlink: boolean; taskId: string; locale: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const errorMessage = useErrorMessage()
  const page = useDocPage(pageId)
  const { unlink } = useDocLinkMutations()
  return (
    <article className="min-w-0 rounded-xl border border-border bg-surface p-4" aria-labelledby="task-doc-title" data-testid="task-doc-reader">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          {spaceName}
          {page.data?.ancestors.map((a) => ` › ${a.title}`).join('')}
        </span>
        <AppButton size="sm" variant="ghost" leftIcon={<ExternalLink />} onClick={() => void navigate(pagePath(spaceKey, pageId))}>
          {t('docs.links.openFull')}
        </AppButton>
        {canUnlink && (
          <AppButton
            size="sm"
            variant="ghost"
            leftIcon={<Unlink />}
            loading={unlink.isPending}
            onClick={() => unlink.mutate({ pageId, taskId }, { onSuccess: () => notify.success(t('docs.links.pageUnlinked')), onError: (error) => notify.error(errorMessage(error)) })}
          >
            {t('docs.links.unlinkPage')}
          </AppButton>
        )}
      </div>
      {page.isPending ? (
        <AppSkeleton className="h-40" />
      ) : page.isError ? (
        <AppErrorState onRetry={() => void page.refetch()} />
      ) : (
        <>
          <h3 id="task-doc-title" className="text-xl font-bold tracking-tight text-fg">
            {page.data.title}
          </h3>
          {page.data.version > 0 && <p className="mb-4 mt-1 text-xs text-muted">{t('docs.page.publishedMeta', { version: page.data.version, who: page.data.publishedBy?.name ?? t('audit.system'), when: formatRelative(page.data.publishedAt, locale) })}</p>}
          {page.data.content && page.data.version > 0 ? (
            <AppRichTextView content={page.data.content} onNavigate={(href) => void navigate(href)} />
          ) : (
            <p className="text-sm text-muted">{t('docs.page.emptyReader')}</p>
          )}
        </>
      )}
    </article>
  )
}

/** Cria a página no espaço do projeto, com o código e o título da tarefa, já vinculada; abre o editor. */
function CreateFromTask({ task, spaces }: { task: TaskDetail; spaces: DocSpace[] }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const errorMessage = useErrorMessage()
  const first = spaces[0]
  const mutations = usePageMutations(first?.key ?? '')
  const { link } = useDocLinkMutations()
  if (!first) return null
  const create = (space: DocSpace) =>
    mutations.create.mutate(
      { spaceId: space.id, title: `${task.code} · ${task.title}`.slice(0, TITLE_MAX), parentId: space.homePageId },
      {
        onSuccess: (page) =>
          link.mutate(
            { pageId: page.id, taskIds: [task.id] },
            { onSuccess: () => void navigate(editPath(space.key, page.id)), onError: (error) => notify.error(errorMessage(error)) },
          ),
        onError: (error) => notify.error(errorMessage(error)),
      },
    )
  const pending = mutations.create.isPending || link.isPending
  if (spaces.length === 1)
    return (
      <AppButton size="sm" variant="secondary" leftIcon={<FilePlus2 />} loading={pending} onClick={() => create(first)}>
        {t('docs.links.createFromTask')}
      </AppButton>
    )
  return (
    <AppDropdown
      trigger={
        <AppButton size="sm" variant="secondary" leftIcon={<FilePlus2 />} loading={pending}>
          {t('docs.links.createFromTask')}
        </AppButton>
      }
      items={spaces.map((space) => ({ key: space.id, label: `${space.key} · ${space.name}`, onSelect: () => create(space) }))}
    />
  )
}

/** Escolher uma página para vincular: as páginas dos espaços do projeto, ou a busca em toda a documentação. */
function LinkPageDialog({ open, onOpenChange, task, spaces, linkedIds }: { open: boolean; onOpenChange: (open: boolean) => void; task: TaskDetail; spaces: DocSpace[]; linkedIds: string[] }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const [search, setSearch] = useState('')
  const results = useDocSearch(open ? search : '')
  const { link } = useDocLinkMutations()
  const change = (next: boolean) => {
    if (!next) setSearch('')
    onOpenChange(next)
  }
  const choose = (pageId: string) =>
    link.mutate(
      { pageId, taskIds: [task.id] },
      {
        onSuccess: () => {
          notify.success(t('docs.links.pageLinked'))
          change(false)
        },
        onError: (error) => notify.error(errorMessage(error)),
      },
    )
  const searching = search.trim().length >= 2
  return (
    <AppDialog open={open} onOpenChange={change} size="md" tall title={t('docs.links.linkPageTitle', { code: task.code })} description={t('docs.links.linkPageHint')}>
      <div className="flex flex-col gap-3">
        <AppSearch value={search} onSearch={setSearch} placeholder={t('docs.links.searchPages')} aria-label={t('docs.links.searchPages')} />
        {searching ? (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {(results.data ?? []).map((result) => (
              <PageOption key={result.pageId} title={result.title} detail={result.space.name} linked={linkedIds.includes(result.pageId)} onChoose={() => choose(result.pageId)} />
            ))}
            {results.data && results.data.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{t('docs.links.noPages')}</li>}
          </ul>
        ) : spaces.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted">{t('docs.links.searchOtherSpaces')}</p>
        ) : (
          spaces.map((space) => <SpaceOptions key={space.id} space={space} linkedIds={linkedIds} onChoose={choose} />)
        )}
      </div>
    </AppDialog>
  )
}

function SpaceOptions({ space, linkedIds, onChoose }: { space: DocSpace; linkedIds: string[]; onChoose: (pageId: string) => void }) {
  const detail = useDocSpace(space.key)
  const rows = detail.data ? flattenDocTree(buildDocTree(detail.data.pages.filter((page) => page.status === 'published')), new Set()) : []
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-fg">
        <SpaceAvatar icon={space.icon} color={space.color} size="sm" /> {space.key} · {space.name}
      </h3>
      {detail.isPending ? (
        <AppSkeleton className="h-16" />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {rows.map((page) => (
            <PageOption key={page.id} title={page.title} depth={page.depth} linked={linkedIds.includes(page.id)} onChoose={() => onChoose(page.id)} />
          ))}
        </ul>
      )}
    </section>
  )
}

function PageOption({ title, detail, depth = 1, linked, onChoose }: { title: string; detail?: string; depth?: number; linked: boolean; onChoose: () => void }) {
  const { t } = useTranslation()
  return (
    <li>
      <button
        type="button"
        disabled={linked}
        onClick={onChoose}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:cursor-default disabled:opacity-60"
        style={{ paddingLeft: `${0.75 + (depth - 1) * 1.25}rem` }}
      >
        <FileText aria-hidden className="size-4 shrink-0 text-subtle" />
        <span className="min-w-0 flex-1 truncate text-fg">{title}</span>
        {detail && <span className="shrink-0 text-xs text-muted">{detail}</span>}
        {linked && <span className="shrink-0 text-xs text-muted">{t('docs.links.alreadyLinked')}</span>}
      </button>
    </li>
  )
}
