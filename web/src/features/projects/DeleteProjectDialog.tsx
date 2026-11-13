import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { cn } from '@/core/utils/cn'
import type { ProjectRemoveOptions } from '@/domain/repositories'
import { AppButton, AppConfirmDialog, AppDialog, AppSelect, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useCan } from '@/features/auth/session'
import { useDocSpaces } from '@/features/docs/queries'
import { ProjectAvatar } from './project-visuals'
import { useProjectLifecycle, useProjects } from './queries'

type DocsAction = NonNullable<ProjectRemoveOptions['docs']>
type SpaceRef = { id: string; key: string; name: string; pageCount?: number | null }
const ACTIONS: DocsAction[] = ['move', 'general', 'delete']
const PROJECT_QUERY = { view: 'all' as const, page: 1, perPage: 100, sort: { id: 'name', direction: 'asc' as const }, search: '', filters: {} }

/**
 * Excluir projeto (já arquivado). Sem documentação, a confirmação de sempre. Com espaços de documentação
 * vinculados, pergunta o que fazer com eles — e o padrão é **mover** para outro projeto: apagar a
 * documentação junto passa a ser uma escolha explícita (antes ela saía sem aviso).
 */
export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
  onDeleted,
}: {
  project: { id: string; key: string; name: string } | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { remove } = useProjectLifecycle()
  const canDocs = useCan('docs.view')
  const spaces = useDocSpaces(open && canDocs)
  // o servidor também avisa (PROJECT_HAS_DOCS) — vale para quem não enxerga os espaços na lista
  const [serverSpaces, setServerSpaces] = useState<SpaceRef[] | null>(null)
  const [action, setAction] = useState<DocsAction>('move')
  const [target, setTarget] = useState('')
  // ao fechar, volta ao começo (a tela que abre o diálogo também o recria por projeto, com `key`)
  const change = (next: boolean) => {
    if (!next) {
      setServerSpaces(null)
      setAction('move')
      setTarget('')
    }
    onOpenChange(next)
  }

  const linked: SpaceRef[] = serverSpaces ?? (project ? (spaces.data ?? []).filter((space) => space.project?.id === project.id) : [])
  const hasDocs = linked.length > 0
  const projects = useProjects(PROJECT_QUERY, open && hasDocs)
  const targets = (projects.data?.items ?? []).filter((p) => p.id !== project?.id && !p.archivedAt && p.capabilities.edit)

  const submit = () => {
    if (!project) return
    const options: ProjectRemoveOptions | undefined = hasDocs ? { docs: action, ...(action === 'move' ? { docsProjectId: target } : {}) } : undefined
    remove.mutate(
      { id: project.id, options },
      {
        onSuccess: () => {
          notify.success(t('projects.deleted', { key: project.key }))
          onDeleted()
        },
        onError: (error) => {
          if (isAppError(error) && error.code === 'PROJECT_HAS_DOCS' && Array.isArray(error.details.spaces)) return setServerSpaces(error.details.spaces as SpaceRef[])
          notify.error(errorMessage(error))
        },
      },
    )
  }

  if (!hasDocs) {
    return (
      <AppConfirmDialog
        open={open}
        onOpenChange={change}
        title={t('projects.deleteTitle', { name: project?.name ?? '' })}
        description={t('projects.deleteDescription')}
        confirmLabel={t('common.delete')}
        loading={remove.isPending}
        onConfirm={submit}
      />
    )
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={change}
      size="md"
      title={t('projects.deleteTitle', { name: project?.name ?? '' })}
      description={t('projects.deleteDocs.intro', { count: linked.length })}
      footer={
        <>
          <AppButton variant="secondary" onClick={() => change(false)} disabled={remove.isPending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton variant="danger" onClick={submit} loading={remove.isPending} disabled={action === 'move' && !target}>
            {t('projects.deleteProject')}
          </AppButton>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="delete-project-docs">
        <ul className="flex flex-col gap-2">
          {linked.map((space) => (
            <li key={space.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm">
              <BookOpen aria-hidden className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate font-medium text-fg">
                <span className="font-mono text-xs text-muted">{space.key}</span> · {space.name}
              </span>
              {typeof space.pageCount === 'number' && <span className="shrink-0 text-xs text-muted">{t('docs.space.pages', { count: space.pageCount })}</span>}
            </li>
          ))}
        </ul>
        <div role="radiogroup" aria-label={t('projects.deleteDocs.question')} className="flex flex-col gap-2">
          {ACTIONS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={action === value}
              onClick={() => setAction(value)}
              data-testid={`delete-docs-${value}`}
              className={cn(
                'flex items-start gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-primary/40',
                action === value && (value === 'delete' ? 'border-danger bg-danger-soft/40' : 'border-primary bg-primary-soft/40'),
              )}
            >
              <span className={cn('mt-0.5 size-4 shrink-0 rounded-full border-2 border-border-strong', action === value && (value === 'delete' ? 'border-[5px] border-danger' : 'border-[5px] border-primary'))} aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-fg">{t(`projects.deleteDocs.${value}`)}</span>
                <span className="block text-xs text-muted">{t(`projects.deleteDocs.${value}Hint`)}</span>
              </span>
            </button>
          ))}
        </div>
        {action === 'move' && (
          <AppSelect
            label={t('projects.deleteDocs.target')}
            value={target || undefined}
            onValueChange={setTarget}
            searchable
            placeholder={t('projects.deleteDocs.targetPlaceholder')}
            options={targets.map((p) => ({ value: p.id, label: `${p.key} · ${p.name}`, textValue: `${p.key} · ${p.name}`, prefix: <ProjectAvatar icon={p.icon} cover={p.cover} size="sm" className="size-5 rounded [&_svg]:size-3" /> }))}
          />
        )}
        <p className="rounded-lg border border-info-soft-fg/25 bg-info-soft px-3 py-2 text-xs text-info-soft-fg">{t('projects.deleteDocs.archivedHint')}</p>
      </div>
    </AppDialog>
  )
}
