import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { scopeCountFilters, type TaskKind, type TaskScope } from '@/domain/tasks'
import { AppSegmentedControl } from '@/presentation/components'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { useTasksList } from './queries'
import { TasksHeader } from './TasksHeader'
import { TasksTable } from './TasksTable'

/** Só o total: a contagem pede uma linha (o número vem em `meta.total`). */
const countQuery = (scope: TaskScope, kind: TaskKind) => ({ page: 1, perPage: 1, sort: null, search: '', filters: scopeCountFilters(scope, kind) })

/**
 * Lista de tarefas do menu (§44; `tasks.list`): "Minhas tarefas" (padrão a cada entrada; com as demandas
 * internas que a pessoa pediu ou recebeu, §45) ou "Ver todas", e Todas · Com projeto · Sem projeto — cada
 * escopo com quantas abertas há. Só as abertas, a menos que o Status diga outra coisa.
 */
export function TasksPage() {
  const { t } = useTranslation()
  // sem guardar no navegador: toda entrada abre em "Minhas tarefas" e "Todas"
  const [scope, setScope] = useState<TaskScope>('mine')
  const [kind, setKind] = useState<TaskKind>('all')
  const mineTotal = useTasksList(countQuery('mine', kind)).data?.total
  const allTotal = useTasksList(countQuery('all', kind)).data?.total
  // vindo da command palette: /tasks?search=… já busca
  const [params, setParams] = useSearchParams()
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
      <TasksHeader description={t('taskList.subtitle')} />
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
        <AppSegmentedControl<TaskKind>
          label={t('taskList.kindLabel')}
          value={kind}
          onValueChange={setKind}
          options={[
            { value: 'all', label: t('taskList.kindAll') },
            { value: 'project', label: t('taskList.kindProject') },
            { value: 'demand', label: t('taskList.kindDemand') },
          ]}
        />
        <span className="text-xs text-muted">{t('taskList.openOnly')}</span>
      </div>
      {scope === 'mine' && <p className="-mt-1 mb-3 text-xs text-muted">{t('taskList.mineHint')}</p>}
      <TasksTable
        tableId="task-list"
        scope={scope}
        kind={kind}
        search={search}
        onSearchApplied={() => {
          const next = new URLSearchParams(params)
          next.delete('search')
          setParams(next, { replace: true })
        }}
      />
    </>
  )
}
