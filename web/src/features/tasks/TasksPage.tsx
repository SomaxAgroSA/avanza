import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { scopeCountFilters, type TaskScope } from '@/domain/tasks'
import { AppButton, AppSegmentedControl } from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { useCan } from '@/features/auth/session'
import { useTasksList } from './queries'
import { TaskFormDialog } from './TaskFormDialog'
import { TasksTable } from './TasksTable'

/** Só o total: a contagem pede uma linha (o número vem em `meta.total`). */
const countQuery = (scope: TaskScope) => ({ page: 1, perPage: 1, sort: null, search: '', filters: scopeCountFilters(scope) })

/**
 * Lista de tarefas do menu (§44; `tasks.list`): "Minhas tarefas" (padrão a cada entrada) ou "Ver todas" — as
 * dos projetos a que a pessoa tem acesso —, cada uma com quantas abertas há. Só as abertas, a menos que o
 * Status diga outra coisa.
 */
export function TasksPage() {
  const { t } = useTranslation()
  const canCreate = useCan('tasks.create')
  const [creating, setCreating] = useState(false)
  // sem guardar no navegador: toda entrada abre em "Minhas tarefas"
  const [scope, setScope] = useState<TaskScope>('mine')
  const mineTotal = useTasksList(countQuery('mine')).data?.total
  const allTotal = useTasksList(countQuery('all')).data?.total
  // vindo da command palette: /tasks?new=1 abre o formulário; /tasks?search=… já busca
  const [params, setParams] = useSearchParams()
  const creatingFromUrl = canCreate && params.get('new') === '1'
  const search = params.get('search')
  useDocumentTitle(t('tasks.title'))

  const label = (text: string, total: number | undefined) => (
    <>
      {text}
      {total !== undefined && <span className="rounded-full bg-surface-2 px-1.5 text-xs font-semibold tabular-nums text-muted">{total}</span>}
    </>
  )

  return (
    <>
      <PageHeader
        title={t('tasks.title')}
        description={t('taskList.subtitle')}
        actions={
          canCreate && (
            <AppButton leftIcon={<Plus />} onClick={() => setCreating(true)}>
              {t('tasks.create')}
            </AppButton>
          )
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <AppSegmentedControl<TaskScope>
          label={t('taskList.scopeLabel')}
          value={scope}
          onValueChange={setScope}
          options={[
            { value: 'mine', label: label(t('taskList.mine'), mineTotal) },
            { value: 'all', label: label(t('taskList.all'), allTotal) },
          ]}
        />
        <span className="text-xs text-muted">{t('taskList.openOnly')}</span>
      </div>
      <TasksTable tableId="task-list" scope={scope} search={search} onSearchApplied={() => setParams({}, { replace: true })} />
      <TaskFormDialog
        open={creating || creatingFromUrl}
        onOpenChange={(open) => {
          setCreating(open)
          if (!open && params.has('new')) setParams({}, { replace: true })
        }}
      />
    </>
  )
}
