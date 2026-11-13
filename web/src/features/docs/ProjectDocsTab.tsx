import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { BookOpen, ExternalLink, FileText, Home, Plus } from 'lucide-react'
import { formatRelative } from '@/core/utils/format'
import { buildDocTree, flattenDocTree, type DocSpace } from '@/domain/docs'
import { AppButton, AppEmptyState, AppErrorState, AppSkeleton, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useCan } from '@/features/auth/session'
import { useProjectOutlet } from '@/features/projects/project-context'
import { editPath, pagePath, spacePath, taskPath } from './docs-paths'
import { DraftBadge, SpaceAvatar, SpaceVisibilityBadge } from './docs-visuals'
import { useDocSpace, useDocSpaces, usePageMutations } from './queries'
import { SpaceFormDialog } from './SpaceFormDialog'

/**
 * Aba Documentação do projeto: os espaços vinculados ao projeto, cada um com a árvore de páginas e as
 * tarefas vinculadas a cada página. Sem espaço, quem administra a documentação cria um já vinculado.
 */
export function ProjectDocsTab() {
  const { t } = useTranslation()
  const { project } = useProjectOutlet()
  const canManage = useCan('docs.manage')
  const spaces = useDocSpaces()
  const [creating, setCreating] = useState(false)

  if (spaces.isPending) return <AppSkeleton className="h-48" />
  if (spaces.isError) return <AppErrorState onRetry={() => void spaces.refetch()} />
  const mine = spaces.data.filter((space) => space.project?.id === project.id)

  return (
    <div className="flex flex-col gap-4" data-testid="project-docs">
      {mine.length === 0 ? (
        <AppEmptyState
          icon={<BookOpen />}
          title={t('docs.project.emptyTitle')}
          description={canManage ? t('docs.project.emptyManager') : t('docs.project.emptyReader')}
          action={
            canManage && (
              <AppButton leftIcon={<Plus />} onClick={() => setCreating(true)}>
                {t('docs.space.create')}
              </AppButton>
            )
          }
        />
      ) : (
        mine.map((space) => <ProjectSpace key={space.id} space={space} />)
      )}
      {canManage && <SpaceFormDialog open={creating} onOpenChange={setCreating} defaultProjectId={project.id} />}
    </div>
  )
}

function ProjectSpace({ space }: { space: DocSpace }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const errorMessage = useErrorMessage()
  const detail = useDocSpace(space.key)
  const mutations = usePageMutations(space.key)
  const canEdit = space.capabilities.edit
  const rows = detail.data ? flattenDocTree(buildDocTree(detail.data.pages), new Set()) : []

  const createPage = () =>
    mutations.create.mutate(
      { spaceId: space.id, title: t('docs.page.untitled'), parentId: null },
      { onSuccess: (page) => void navigate(editPath(space.key, page.id)), onError: (error) => notify.error(errorMessage(error)) },
    )

  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-xs" aria-labelledby={`space-${space.id}`}>
      <header className="flex flex-wrap items-center gap-3">
        <SpaceAvatar icon={space.icon} color={space.color} />
        <div className="min-w-0 flex-1">
          <h2 id={`space-${space.id}`} className="truncate font-semibold text-fg">
            <span className="font-mono text-sm text-muted">{space.key}</span> · {space.name}
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            <SpaceVisibilityBadge space={space} />
            {t('docs.space.pages', { count: space.pageCount ?? 0 })}
          </p>
        </div>
        <AppButton size="sm" variant="secondary" leftIcon={<ExternalLink />} onClick={() => void navigate(spacePath(space.key))}>
          {t('docs.project.openSpace')}
        </AppButton>
        {canEdit && (
          <AppButton size="sm" leftIcon={<Plus />} onClick={createPage} loading={mutations.create.isPending}>
            {t('docs.page.new')}
          </AppButton>
        )}
      </header>
      {detail.isPending ? (
        <AppSkeleton className="mt-3 h-24" />
      ) : detail.isError ? (
        <AppErrorState onRetry={() => void detail.refetch()} />
      ) : (
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {rows.map((page) => (
            <li key={page.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" style={{ paddingLeft: `${(page.depth - 1) * 1.25}rem` }}>
              {page.isHome ? <Home aria-hidden className="size-4 shrink-0 text-subtle" /> : <FileText aria-hidden className="size-4 shrink-0 text-subtle" />}
              <Link to={pagePath(space.key, page.id)} className="min-w-0 flex-1 truncate text-fg hover:text-primary-text hover:underline">
                {page.title}
              </Link>
              <DraftBadge status={page.status} hasDraft={page.hasDraft} />
              {page.tasks.map((task) => (
                <Link
                  key={task.id}
                  to={taskPath(task.id)}
                  title={task.title}
                  className="shrink-0 rounded-full border border-primary/25 bg-primary-soft px-2 py-0.5 font-mono text-xs text-primary-soft-fg hover:underline"
                >
                  {task.code}
                </Link>
              ))}
              <span className="shrink-0 text-xs text-subtle">{formatRelative(page.updatedAt, i18n.language)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
