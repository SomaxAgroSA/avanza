import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Images, Plus, Search, Shapes, Trash2 } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { iconLabel, MAX_ICON_IMPORT, usageTotal, type LibraryIcon } from '@/domain/icons'
import {
  AppButton,
  AppConfirmDialog,
  AppDialog,
  AppEmptyState,
  AppErrorState,
  AppIcon,
  AppIconButton,
  AppSkeleton,
  AppTextField,
  notify,
} from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useIconGallery, useIconLibrary, useIconMutations } from './queries'

const NO_BUILTINS = {}
/** Quantos ícones da galeria aparecem por vez (cada um carrega sozinho). */
const PAGE = 120

/** Configurações → Ícones: a biblioteca da plataforma e a galeria para importar (regras §25). */
export function IconLibraryPage() {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const library = useIconLibrary()
  const { remove } = useIconMutations()
  const [gallery, setGallery] = useState(false)
  const [removing, setRemoving] = useState<LibraryIcon | null>(null)
  useDocumentTitle(t('icons.title'))

  return (
    <>
      <PageHeader
        title={t('icons.title')}
        description={t('icons.description')}
        actions={
          <AppButton leftIcon={<Plus />} onClick={() => setGallery(true)}>
            {t('icons.import')}
          </AppButton>
        }
      />
      {library.isPending ? (
        <AppSkeleton className="h-40 rounded-xl" />
      ) : library.isError ? (
        <AppErrorState onRetry={() => void library.refetch()} />
      ) : library.data.length === 0 ? (
        <AppEmptyState
          icon={<Shapes />}
          title={t('icons.empty')}
          description={t('icons.emptyHint')}
          action={
            <AppButton leftIcon={<Images />} onClick={() => setGallery(true)}>
              {t('icons.import')}
            </AppButton>
          }
        />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
          {library.data.map((icon) => {
            const inUse = usageTotal(icon.usage) > 0
            return (
              <li key={icon.name} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-card">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg">
                  <AppIcon name={icon.name} builtins={NO_BUILTINS} fallback={Shapes} className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm text-fg">{icon.name}</p>
                  <p className="truncate text-xs text-muted">{inUse ? usageText(t, icon) : t('icons.unused')}</p>
                </div>
                <AppIconButton
                  size="sm"
                  variant="danger"
                  label={inUse ? t('icons.inUseHint', { name: icon.name }) : t('icons.removeOf', { name: icon.name })}
                  icon={<Trash2 />}
                  disabled={inUse}
                  onClick={() => setRemoving(icon)}
                />
              </li>
            )
          })}
        </ul>
      )}

      <IconGalleryDialog open={gallery} onOpenChange={setGallery} imported={library.data ?? []} />
      <AppConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('icons.removeTitle', { name: removing?.name ?? '' })}
        description={t('icons.removeDescription')}
        confirmLabel={t('common.delete')}
        loading={remove.isPending}
        onConfirm={() =>
          removing &&
          remove.mutate(removing.name, {
            onSuccess: () => {
              notify.success(t('icons.removed', { name: removing.name }))
              setRemoving(null)
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
    </>
  )
}

function usageText(t: ReturnType<typeof useTranslation>['t'], icon: LibraryIcon): string {
  const parts = [
    icon.usage.projects ? t('icons.usage.projects', { count: icon.usage.projects }) : null,
    icon.usage.taskTypes ? t('icons.usage.taskTypes', { count: icon.usage.taskTypes }) : null,
    icon.usage.docSpaces ? t('icons.usage.docSpaces', { count: icon.usage.docSpaces }) : null,
  ].filter(Boolean)
  return t('icons.inUse', { where: parts.join(', ') })
}

/** Galeria (Lucide, ~1.700 ícones): busca pelo nome em inglês, marca vários e importa de uma vez. */
function IconGalleryDialog({ open, onOpenChange, imported }: { open: boolean; onOpenChange: (open: boolean) => void; imported: LibraryIcon[] }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const gallery = useIconGallery(open)
  const { importIcons } = useIconMutations()
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState<string[]>([])
  const [openedFor, setOpenedFor] = useState(false)
  // reinicia a cada abertura (ajuste durante a renderização, sem efeito)
  if (open !== openedFor) {
    setOpenedFor(open)
    if (open) {
      setSearch('')
      setLimit(PAGE)
      setSelected([])
    }
  }

  const already = useMemo(() => new Set(imported.map((icon) => icon.name)), [imported])
  const matches = useMemo(() => {
    const query = search.trim().toLowerCase().replace(/\s+/g, '-')
    return (gallery.data ?? []).filter((name) => !query || name.includes(query))
  }, [gallery.data, search])

  function toggle(name: string) {
    if (selected.includes(name)) return setSelected(selected.filter((n) => n !== name))
    if (selected.length >= MAX_ICON_IMPORT) return notify.info(t('icons.maxSelection', { count: MAX_ICON_IMPORT }))
    setSelected([...selected, name])
  }

  function submit() {
    importIcons.mutate(selected, {
      onSuccess: () => {
        notify.success(t('icons.imported', { count: selected.length }))
        onOpenChange(false)
      },
      onError: (error) => notify.error(errorMessage(error)),
    })
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      size="2xl"
      title={t('icons.galleryTitle')}
      description={t('icons.galleryDescription')}
      footer={
        <>
          <span className="mr-auto text-sm text-muted">{t('icons.selected', { count: selected.length })}</span>
          <AppButton variant="secondary" onClick={() => onOpenChange(false)} disabled={importIcons.isPending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} disabled={selected.length === 0} loading={importIcons.isPending}>
            {t('icons.importSelected', { count: selected.length })}
          </AppButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <AppTextField
          aria-label={t('icons.search')}
          placeholder={t('icons.searchPlaceholder')}
          leftIcon={<Search />}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setLimit(PAGE)
          }}
        />
        {gallery.isPending ? (
          <AppSkeleton className="h-64 rounded-xl" />
        ) : gallery.isError ? (
          <AppErrorState onRetry={() => void gallery.refetch()} />
        ) : matches.length === 0 ? (
          <AppEmptyState compact icon={<Search />} title={t('icons.noResults')} />
        ) : (
          <>
            <p className="text-xs text-muted">{t('icons.found', { count: matches.length })}</p>
            <div role="group" aria-label={t('icons.galleryTitle')} className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
              {matches.slice(0, limit).map((name) => {
                const done = already.has(name)
                const on = selected.includes(name)
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={done || on}
                    disabled={done}
                    title={done ? t('icons.alreadyImported', { name }) : name}
                    aria-label={done ? t('icons.alreadyImported', { name }) : iconLabel(name)}
                    onClick={() => toggle(name)}
                    className={cn(
                      'relative flex flex-col items-center gap-1.5 rounded-lg border p-2 text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:cursor-default disabled:opacity-60',
                      on ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-border',
                    )}
                  >
                    {(done || on) && <Check aria-hidden className="absolute right-1 top-1 size-3.5" />}
                    <AppIcon name={name} builtins={NO_BUILTINS} fallback={Shapes} className="size-5" aria-hidden />
                    <span className="w-full truncate text-center text-[11px]">{name}</span>
                  </button>
                )
              })}
            </div>
            {matches.length > limit && (
              <AppButton variant="ghost" className="self-center" onClick={() => setLimit(limit + PAGE)}>
                {t('icons.showMore', { count: Math.min(PAGE, matches.length - limit) })}
              </AppButton>
            )}
          </>
        )}
      </div>
    </AppDialog>
  )
}
