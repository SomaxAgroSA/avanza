import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { orderedModules, type DocModule, type ModuleFilter } from '@/domain/docs'
import { AppConfirmDialog, AppDropdown, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { ModuleSwatch } from './docs-visuals'
import { ModuleFormDialog } from './ModuleFormDialog'
import { useModuleMutations } from './queries'

export interface ModuleListProps {
  modules: DocModule[]
  counts: { all: number; none: number; byModule: Record<string, number> }
  selected: ModuleFilter
  onSelect: (filter: ModuleFilter) => void
  /** `docs.manage`: criar, editar, reordenar e excluir módulos. */
  canManage: boolean
}

/**
 * Coluna "Módulos" da tela inicial da Documentação: Todos, cada módulo (cor + quantos espaços a pessoa
 * vê), "Sem módulo" (só quando há) e, para quem gerencia, "Novo módulo" e o "⋯" de cada módulo.
 * No celular vira uma faixa rolável acima dos espaços.
 */
export function ModuleList({ modules, counts, selected, onSelect, canManage }: ModuleListProps) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const mutations = useModuleMutations()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<DocModule | null>(null)
  const [deleting, setDeleting] = useState<DocModule | null>(null)
  const ordered = orderedModules(modules)

  const moveTo = (module: DocModule, position: number) =>
    mutations.update.mutate({ id: module.id, input: { position } }, { onError: (error) => notify.error(errorMessage(error)) })
  const remove = () => {
    if (!deleting) return
    const target = deleting
    mutations.remove.mutate(target.id, {
      onSuccess: () => {
        notify.success(t('docs.modules.deleted', { name: target.name }))
        setDeleting(null)
        if (selected === target.id) onSelect('all')
      },
      onError: (error) => notify.error(errorMessage(error)),
    })
  }

  return (
    <section aria-labelledby="docs-modules-title" className="min-w-0 rounded-xl border border-border bg-surface p-2 shadow-card lg:sticky lg:top-4">
      <h2 id="docs-modules-title" className="px-2 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-subtle">
        {t('docs.modules.title')}
      </h2>
      <nav aria-label={t('docs.modules.filterLabel')}>
        <ul className="-mx-0.5 flex gap-1 overflow-x-auto px-0.5 pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          <li className="shrink-0">
            <FilterButton active={selected === 'all'} label={t('docs.modules.all')} count={counts.all} onClick={() => onSelect('all')} swatch={<ModuleSwatch color={null} className="bg-fg" />} />
          </li>
          {ordered.map((module, index) => (
            <li key={module.id} className="group relative shrink-0">
              <FilterButton
                active={selected === module.id}
                label={module.name}
                count={counts.byModule[module.id] ?? 0}
                onClick={() => onSelect(module.id)}
                swatch={<ModuleSwatch color={module.color} />}
                withActions={canManage}
              />
              {canManage && (
                <AppDropdown
                  trigger={
                    <button
                      type="button"
                      aria-label={t('docs.modules.actions', { name: module.name })}
                      className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted opacity-100 transition-opacity hover:bg-surface-3 hover:text-fg focus-visible:opacity-100 data-[state=open]:opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 [&_svg]:size-4"
                    >
                      <MoreHorizontal aria-hidden />
                    </button>
                  }
                  items={[
                    { key: 'edit', label: t('docs.modules.edit'), icon: <Pencil />, onSelect: () => setEditing(module) },
                    ...(index > 0 ? [{ key: 'up', label: t('docs.modules.moveUp'), icon: <ArrowUp />, onSelect: () => moveTo(module, index - 1) }] : []),
                    ...(index < ordered.length - 1 ? [{ key: 'down', label: t('docs.modules.moveDown'), icon: <ArrowDown />, onSelect: () => moveTo(module, index + 1) }] : []),
                    { type: 'separator' as const, key: 's' },
                    { key: 'delete', label: t('docs.modules.delete'), icon: <Trash2 />, tone: 'danger' as const, onSelect: () => setDeleting(module) },
                  ]}
                />
              )}
            </li>
          ))}
          {counts.none > 0 && (
            <li className="shrink-0">
              <FilterButton active={selected === 'none'} label={t('docs.modules.none')} count={counts.none} onClick={() => onSelect('none')} swatch={<ModuleSwatch color={null} />} />
            </li>
          )}
          {canManage && (
            <li className="shrink-0 lg:mt-1.5">
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex h-9 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-dashed border-border-strong px-3 text-sm font-semibold text-primary-text transition-colors hover:border-primary hover:bg-primary-soft [&_svg]:size-4"
              >
                <Plus aria-hidden />
                {t('docs.modules.new')}
              </button>
            </li>
          )}
        </ul>
      </nav>

      <ModuleFormDialog open={creating} onOpenChange={setCreating} onCreated={(module) => onSelect(module.id)} />
      <ModuleFormDialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)} module={editing} />
      <AppConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('docs.modules.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('docs.modules.deleteHint', { count: deleting ? (counts.byModule[deleting.id] ?? 0) : 0 })}
        confirmLabel={t('docs.modules.delete')}
        loading={mutations.remove.isPending}
        onConfirm={remove}
      />
    </section>
  )
}

function FilterButton({ active, label, count, onClick, swatch, withActions }: { active: boolean; label: string; count: number; onClick: () => void; swatch: ReactNode; withActions?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 text-left text-sm transition-colors',
        active ? 'bg-primary-soft font-semibold text-primary-text' : 'font-medium text-fg hover:bg-surface-2',
        withActions && 'pr-9 lg:pr-2.5',
      )}
    >
      {swatch}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={cn('text-xs tabular-nums', active ? 'text-primary-text' : 'text-subtle', withActions && 'lg:group-hover:invisible lg:group-focus-within:invisible')}>{count}</span>
    </button>
  )
}
