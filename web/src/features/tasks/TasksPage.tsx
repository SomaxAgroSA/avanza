import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { readJson, writeJson } from '@/core/storage/safe-storage'
import { initialTaskScope, scopeCountFilters, type TaskKind, type TaskScope } from '@/domain/tasks'
import { AppSegmentedControl } from '@/presentation/components'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { useCan, useSession } from '@/features/auth/session'
import { useTasksList } from './queries'
import { TasksHeader } from './TasksHeader'
import { TasksTable } from './TasksTable'

/** Só o total: a contagem pede uma linha (o número vem em `meta.total`). */
const countQuery = (scope: TaskScope, kind: TaskKind) => ({ page: 1, perPage: 1, sort: null, search: '', filters: scopeCountFilters(scope, kind) })

/** Última escolha de escopo da pessoa (neste navegador). */
const scopeKey = (userId: string) => `avanza.taskList.scope.${userId}`

/**
 * Escopo da Lista (ajuste 20/11): a última escolha da pessoa ou, sem ela, "Ver todas" para quem vê todos os
 * projetos (`projects.view_all`) e "Minhas tarefas" para os demais. `?scope=all` (Ctrl K → Buscar tarefa) vale
 * só para aquela entrada.
 */
function useTaskListScope(fromUrl: TaskScope | null): [TaskScope, (scope: TaskScope) => void] {
  const userId = useSession().current?.user.id
  const seesAll = useCan('projects.view_all')
  const stored = useMemo(() => (userId ? readJson<unknown>(scopeKey(userId), null) : null), [userId])
  const [chosen, setChosen] = useState<TaskScope | null>(fromUrl)
  // Ctrl K com a Lista já aberta: o endereço novo também vale (ajuste durante a renderização, sem efeito)
  const [seenUrl, setSeenUrl] = useState(fromUrl)
  if (fromUrl !== seenUrl) {
    setSeenUrl(fromUrl)
    if (fromUrl) setChosen(fromUrl)
  }
  const choose = useCallback(
    (next: TaskScope) => {
      setChosen(next)
      if (userId) writeJson(scopeKey(userId), next)
    },
    [userId],
  )
  return [chosen ?? initialTaskScope(stored, seesAll), choose]
}

/**
 * Lista de tarefas do menu (§44; `tasks.list`): "Minhas tarefas" (com as demandas internas que a pessoa pediu
 * ou recebeu, §45) ou "Ver todas", e Todas · Com projeto · Sem projeto — cada escopo com quantas abertas há —,
 * na mesma linha das visões e de "Colunas e ações"; embaixo, a busca e os filtros. Sem textos de ajuda: só as
 * abertas, a menos que o Status diga outra coisa (o Status parado mostra "Abertas").
 */
export function TasksPage() {
  const { t } = useTranslation()
  // vindo da command palette: /tasks?search=… já busca; ?scope=all busca em todas
  const [params, setParams] = useSearchParams()
  const search = params.get('search')
  const urlScope = params.get('scope')
  const [scope, setScope] = useTaskListScope(urlScope === 'all' || urlScope === 'mine' ? urlScope : null)
  const [kind, setKind] = useState<TaskKind>('all')
  // "Colunas e ações" vai para a linha das visões
  const [tableActions, setTableActions] = useState<HTMLElement | null>(null)
  const mineTotal = useTasksList(countQuery('mine', kind)).data?.total
  const allTotal = useTasksList(countQuery('all', kind)).data?.total
  useEffect(() => {
    if (!urlScope) return
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('scope')
        return next
      },
      { replace: true },
    )
  }, [urlScope, setParams])
  useDocumentTitle(t('tasks.title'))

  const label = (text: string, total: number | undefined) => (
    <>
      {text}
      {total !== undefined && <span className="rounded-full bg-surface-2 px-1.5 text-xs font-semibold tabular-nums text-muted">{total}</span>}
    </>
  )

  return (
    <>
      <TasksHeader end={<div ref={setTableActions} className="flex items-center gap-2 empty:hidden" />}>
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
      </TasksHeader>
      <TasksTable
        tableId="task-list"
        scope={scope}
        kind={kind}
        search={search}
        actionsSlot={tableActions}
        onSearchApplied={() =>
          setParams(
            (prev) => {
              const next = new URLSearchParams(prev)
              next.delete('search')
              return next
            },
            { replace: true },
          )
        }
      />
    </>
  )
}
