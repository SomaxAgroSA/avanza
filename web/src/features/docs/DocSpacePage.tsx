import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { BookX, ListTree, PanelLeftClose, PanelLeftOpen, Plus, Settings, Trash2 } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { isAppError } from '@/core/errors/app-error'
import { safeStorage } from '@/core/storage/safe-storage'
import type { DocMoveTarget, DocSpace, DocSpaceDetail, DocTreePage } from '@/domain/docs'
import { AppButton, AppConfirmDialog, AppDrawer, AppDropdown, AppEmptyState, AppErrorState, AppIconButton, AppSkeleton, AppTooltip, notify } from '@/presentation/components'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { useMediaQuery } from '@/presentation/common/use-media-query'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { DocPageView } from './DocPageView'
import { editPath, pagePath, spacePath } from './docs-paths'
import { SpaceAvatar, SpaceVisibilityBadge } from './docs-visuals'
import { MovePageDialog } from './MovePageDialog'
import { PageTree } from './PageTree'
import { useDocSpace, usePageMutations, useSpaceMutations } from './queries'
import { SpaceFormDialog } from './SpaceFormDialog'

/** `/docs/:spaceKey` (página inicial) e `/docs/:spaceKey/:pageId`. */
export function DocSpacePage() {
  const { t } = useTranslation()
  const { spaceKey = '', pageId } = useParams()
  const space = useDocSpace(spaceKey)
  useDocumentTitle(space.data?.space.name ?? t('docs.title'))

  if (space.isPending) {
    return (
      <div className="space-y-4">
        <AppSkeleton className="h-4 w-1/3" />
        <AppSkeleton className="h-10 w-2/3" />
        <AppSkeleton className="h-64" />
      </div>
    )
  }
  if (space.isError) {
    if (isAppError(space.error) && space.error.code === 'DOC_SPACE_NOT_FOUND') {
      return (
        <AppEmptyState
          icon={<BookX />}
          title={t('docs.space.notFound')}
          description={t('docs.space.notFoundHint')}
          action={
            <AppButton asChild variant="secondary">
              <Link to="/docs">{t('docs.backToDocs')}</Link>
            </AppButton>
          }
        />
      )
    }
    return <AppErrorState onRetry={() => void space.refetch()} />
  }
  return <SpaceLayout detail={space.data} currentId={pageId ?? space.data.space.homePageId} />
}

const PANEL_KEY = 'kamban.docs.panel'

/**
 * No desktop, o espaço (configurações, "Nova página" e árvore) é uma coluna fixa de altura total,
 * separada da página, que se oculta e reaparece pelo botão (a escolha fica lembrada). No celular,
 * a mesma coluna abre como painel lateral pelo botão "Páginas do espaço".
 */
function SpaceLayout({ detail, currentId }: { detail: DocSpaceDetail; currentId: string | null }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const errorMessage = useErrorMessage()
  const { space, pages, capabilities } = detail
  const mutations = usePageMutations(space.key)
  const spaceMutations = useSpaceMutations()
  const desktop = useMediaQuery('(min-width: 1024px)')
  const [docked, setDocked] = useState(() => safeStorage.get(PANEL_KEY) !== 'hidden')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingSpace, setEditingSpace] = useState(false)
  const [deletingSpace, setDeletingSpace] = useState(false)
  const [moving, setMoving] = useState<DocTreePage | null>(null)
  const [deleting, setDeleting] = useState<DocTreePage | null>(null)

  const setPanel = (open: boolean) => {
    setDocked(open)
    safeStorage.set(PANEL_KEY, open ? 'shown' : 'hidden')
  }
  // ações que abrem outro diálogo fecham o painel do celular antes (um diálogo por vez)
  const fromDrawer =
    <T,>(action: (value: T) => void) =>
    (value: T) => {
      setDrawerOpen(false)
      action(value)
    }

  const createPage = (parentId: string | null) =>
    mutations.create.mutate(
      { spaceId: space.id, title: t('docs.page.untitled'), parentId },
      {
        onSuccess: (page) => void navigate(editPath(space.key, page.id)),
        onError: (error) => notify.error(errorMessage(error)),
      },
    )
  const move = (id: string, target: DocMoveTarget) =>
    mutations.move.mutate(
      { id, target },
      {
        onSuccess: () => {
          notify.success(t('docs.page.moved'))
          setMoving(null)
        },
        onError: (error) => notify.error(errorMessage(error)),
      },
    )
  const subtreeOf = (id: string): string[] => [id, ...pages.filter((p) => p.parentId === id).flatMap((p) => subtreeOf(p.id))]
  const deleteHint = (count: number) => (count === 0 ? t('docs.page.deleteHintAlone') : t('docs.page.deleteHint', { count }))
  const removePage = () => {
    if (!deleting) return
    const target = deleting
    const removed = subtreeOf(target.id)
    mutations.remove.mutate(target.id, {
      onSuccess: (count) => {
        notify.success(t('docs.page.deleted', { count }))
        setDeleting(null)
        // estava lendo a página excluída (ou uma subpágina dela): volta para a mãe
        if (currentId && removed.includes(currentId)) void navigate(target.parentId ? pagePath(space.key, target.parentId) : spacePath(space.key))
      },
      onError: (error) => notify.error(errorMessage(error)),
    })
  }
  const removeSpace = () =>
    spaceMutations.remove.mutate(space.id, {
      onSuccess: () => {
        notify.success(t('docs.space.deleted', { name: space.name }))
        void navigate('/docs')
      },
      onError: (error) => notify.error(errorMessage(error)),
    })

  const settings = capabilities.manage && (
    <AppDropdown
      trigger={<AppIconButton size="sm" label={t('docs.space.settings')} icon={<Settings />} />}
      items={[
        { key: 'edit', label: t('docs.space.configure'), icon: <Settings />, onSelect: () => fromDrawer(setEditingSpace)(true) },
        { key: 'delete', label: t('docs.space.delete'), icon: <Trash2 />, tone: 'danger', onSelect: () => fromDrawer(setDeletingSpace)(true) },
      ]}
    />
  )
  const body = (
    <PanelBody
      space={space}
      pages={pages}
      currentId={currentId}
      canEdit={capabilities.edit}
      creating={mutations.create.isPending}
      onCreate={() => createPage(null)}
      onNavigate={() => setDrawerOpen(false)}
      onAddChild={(parentId) => createPage(parentId)}
      onMove={move}
      onRequestMove={fromDrawer(setMoving)}
      onRequestDelete={fromDrawer(setDeleting)}
      extra={desktop ? null : settings}
    />
  )
  // no celular não há coluna: o painel abre por este botão no topo da página
  const panelButton = desktop ? null : (
    <AppButton variant="secondary" leftIcon={<PanelLeftOpen />} onClick={() => setDrawerOpen(true)}>
      {t('docs.tree.open')}
    </AppButton>
  )

  return (
    // sai do respiro do <main>: a coluna encosta na lateral e ocupa a altura toda
    <div className="-mx-4 -my-6 flex min-h-[calc(100dvh-3.5rem)] sm:-mx-6 lg:-mx-8 2xl:-mx-10">
      {desktop && (
        // coluna do espaço: expandida ou recolhida em faixa de ícones — o botão de alternar fica sempre no rodapé
        <aside
          aria-label={t('docs.tree.panel', { name: space.name })}
          className={cn('sticky top-0 flex h-[calc(100dvh-3.5rem)] shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200', docked ? 'w-72 2xl:w-80' : 'w-14')}
        >
          {docked ? (
            <>
              <div className="flex items-start gap-2.5 border-b border-border px-4 py-3.5">
                <SpaceAvatar icon={space.icon} color={space.color} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <Link to={spacePath(space.key)} className="block truncate text-sm font-semibold text-fg hover:text-primary-text">
                    {space.name}
                  </Link>
                  <p className="font-mono text-xs text-subtle">{space.key}</p>
                </div>
                {settings}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{body}</div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center gap-1.5 border-b border-transparent py-3.5">
              <AppTooltip content={t('docs.tree.expandPanel')} side="right">
                <button type="button" onClick={() => setPanel(true)} aria-label={`${t('docs.tree.expandPanel')}: ${space.name}`} className="rounded-md">
                  <SpaceAvatar icon={space.icon} color={space.color} size="sm" />
                </button>
              </AppTooltip>
              <AppIconButton label={t('docs.tree.open')} icon={<ListTree />} onClick={() => setPanel(true)} className="mt-2" />
              {capabilities.edit && <AppIconButton label={t('docs.page.new')} icon={<Plus />} onClick={() => createPage(null)} disabled={mutations.create.isPending} />}
            </div>
          )}
          <div className={cn('border-t border-border p-2', !docked && 'flex justify-center')}>
            <button
              type="button"
              onClick={() => setPanel(!docked)}
              aria-expanded={docked}
              aria-label={docked ? undefined : t('docs.tree.expandPanel')}
              title={docked ? undefined : t('docs.tree.expandPanel')}
              className={cn(
                'flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg',
                docked ? 'w-full' : 'w-9 justify-center px-0',
              )}
            >
              {docked ? <PanelLeftClose aria-hidden className="size-[18px]" /> : <PanelLeftOpen aria-hidden className="size-[18px]" />}
              {docked && <span>{t('docs.tree.collapsePanel')}</span>}
            </button>
          </div>
        </aside>
      )}

      <div className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 2xl:px-10">
        {currentId ? (
          <DocPageView key={currentId} pageId={currentId} detail={detail} panelButton={panelButton} onCreateChild={createPage} onRequestMove={setMoving} onRequestDelete={setDeleting} />
        ) : (
          <AppEmptyState icon={<BookX />} title={t('docs.page.notFound')} action={panelButton} />
        )}
      </div>

      {!desktop && (
        <AppDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          side="left"
          title={
            <span className="flex min-w-0 items-center gap-2.5">
              <SpaceAvatar icon={space.icon} color={space.color} size="sm" />
              <span className="truncate">{space.name}</span>
            </span>
          }
          description={t('docs.tree.panelHint')}
        >
          {body}
        </AppDrawer>
      )}

      <MovePageDialog page={moving} pages={pages} onOpenChange={(open) => !open && setMoving(null)} onMove={move} pending={mutations.move.isPending} />
      <AppConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('docs.page.deleteTitle', { title: deleting?.title ?? '' })}
        description={deleting ? deleteHint(subtreeOf(deleting.id).length - 1) : undefined}
        confirmLabel={t('common.delete')}
        loading={mutations.remove.isPending}
        onConfirm={removePage}
      />
      <SpaceFormDialog open={editingSpace} onOpenChange={setEditingSpace} space={space} />
      <AppConfirmDialog
        open={deletingSpace}
        onOpenChange={setDeletingSpace}
        title={t('docs.space.deleteTitle', { name: space.name })}
        description={t('docs.space.deleteHint', { count: pages.length })}
        confirmLabel={t('docs.space.delete')}
        loading={spaceMutations.remove.isPending}
        onConfirm={removeSpace}
      />
    </div>
  )
}

interface PanelBodyProps {
  space: DocSpace
  pages: DocTreePage[]
  currentId: string | null
  canEdit: boolean
  creating: boolean
  onCreate: () => void
  onNavigate: () => void
  onAddChild: (parentId: string) => void
  onMove: (id: string, target: DocMoveTarget) => void
  onRequestMove: (page: DocTreePage) => void
  onRequestDelete: (page: DocTreePage) => void
  /** Ações extras ao lado de "Nova página" (no celular, as configurações do espaço). */
  extra?: ReactNode
}

/** Conteúdo da coluna/painel: quem lê, "Nova página" e a árvore. */
function PanelBody({ space, pages, currentId, canEdit, creating, onCreate, onNavigate, onAddChild, onMove, onRequestMove, onRequestDelete, extra }: PanelBodyProps) {
  const { t } = useTranslation()
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
        <SpaceVisibilityBadge space={space} />
        <span className="flex items-center gap-1">
          {canEdit && (
            <AppButton variant="soft" size="sm" leftIcon={<Plus />} loading={creating} onClick={onCreate}>
              {t('docs.page.new')}
            </AppButton>
          )}
          {extra}
        </span>
      </div>
      <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-subtle">{t('docs.tree.title')}</p>
      <nav aria-label={t('docs.tree.label')}>
        <PageTree
          spaceKey={space.key}
          pages={pages}
          currentId={currentId}
          canEdit={canEdit}
          onNavigate={onNavigate}
          onAddChild={onAddChild}
          onMove={onMove}
          onRequestMove={onRequestMove}
          onRequestDelete={onRequestDelete}
        />
      </nav>
    </>
  )
}
