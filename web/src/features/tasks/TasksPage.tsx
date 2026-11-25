import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { readJson, writeJson } from '@/core/storage/safe-storage'
import { initialTaskScope, scopeCountFilters, type TaskScope } from '@/domain/tasks'
import { AppSegmentedControl } from '@/presentation/components'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { useCan, useSession } from '@/features/auth/session'
import { useTasksList } from './queries'
import { TasksHeader } from './TasksHeader'
import { TasksTable } from './TasksTable'
import { useTaskViews } from './use-task-views'

/** Só o total: a contagem pede uma linha (o número vem em `meta.total`). */
const countQuery = (scope: TaskScope) => ({ page: 1, perPage: 1, sort: null, search: '', filters: scopeCountFilters(scope, 'all') })

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
 * ou recebeu, §45) ou "Ver todas" — cada escopo com quantas abertas há —, na mesma linha das visões; embaixo, a
 * busca e os filtros. A Lista mostra sempre as tarefas com e sem projeto (ajuste 25/11: saiu o "Todas · Com
 * projeto · Sem projeto"; para ver só as demandas internas, o filtro Projeto). Sem textos de ajuda: só as
 * abertas, a menos que o Status diga outra coisa (o Status parado mostra "Abertas").
 */
export function TasksPage() {
  const { t } = useTranslation()
  // vindo da command palette: /tasks?search=… já busca; ?scope=all busca em todas
  const [params, setParams] = useSearchParams()
  const search = params.get('search')
  const urlScope = params.get('scope')
  const [chosenScope, setScope] = useTaskListScope(urlScope === 'all' || urlScope === 'mine' ? urlScope : null)
  // "O que aparece" do perfil (§48): só "Minhas tarefas" ou só "Ver todas"; sem a Lista, a Caixa de entrada
  const { views, inbox } = useTaskViews()
  const onlyMine = views.tasksList === 'mine'
  const onlyAll = views.tasksList === 'all'
  const scope: TaskScope = onlyMine ? 'mine' : onlyAll ? 'all' : chosenScope
  const mineTotal = useTasksList(countQuery('mine'), undefined, !onlyAll).data?.total
  const allTotal = useTasksList(countQuery('all'), undefined, !onlyMine).data?.total
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
  if (views.tasksList === 'hidden') {
    // "＋ Tarefa" pela paleta (/tasks?new=1) continua abrindo o formulário, agora na Caixa de entrada
    const extra = params.has('new') ? `${inbox.includes('?') ? '&' : '?'}new=1` : ''
    return <Navigate to={inbox + extra} replace />
  }

  const label = (text: string, total: number | undefined) => (
    <>
      {text}
      {/* numa linha apertada (< 960px) os números somem */}
      {total !== undefined && <span className="rounded-full bg-surface-2 px-1.5 text-xs font-semibold tabular-nums text-muted @max-[960px]:hidden">{total}</span>}
    </>
  )

  return (
    <>
      <TasksHeader>
        {onlyMine || onlyAll ? (
          // um alcance só (§48): sem botões, o nome com o número
          <h2 className="inline-flex shrink-0 items-baseline gap-1.5 px-1 text-sm font-bold text-fg" data-testid="task-scope-title">
            {label(t(onlyMine ? 'taskList.mine' : 'taskList.all'), onlyMine ? mineTotal : allTotal)}
          </h2>
        ) : (
          <AppSegmentedControl<TaskScope>
            className="shrink-0"
            label={t('taskList.scopeLabel')}
            value={scope}
            onValueChange={setScope}
            options={[
              { value: 'mine', label: label(t('taskList.mine'), mineTotal) },
              { value: 'all', label: label(t('taskList.all'), allTotal) },
            ]}
          />
        )}
      </TasksHeader>
      <TasksTable
        tableId="task-list"
        scope={scope}
        kind="all"
        search={search}
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
