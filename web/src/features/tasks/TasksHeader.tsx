import { useState } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { AppButton, AppNavTabs } from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useCan } from '@/features/auth/session'
import { useDemandBadge } from '@/features/demands/queries'
import { TaskFormDialog, type TaskKindChoice } from './TaskFormDialog'

/**
 * Cabeçalho do módulo Tarefas (§44/§45): título, os dois botões pequenos "＋ Tarefa de projeto" e
 * "＋ Demanda interna" (com `tasks.create`; cada um abre só o seu formulário) e as visões Lista · Demandas (com o número de demandas
 * recebidas ainda sem atribuir). `?new=1` (paleta de comandos) abre o formulário de tarefa de projeto;
 * `?new=demand`, o de demanda.
 */
export function TasksHeader({ description }: { description: string }) {
  const { t } = useTranslation()
  const canCreate = useCan('tasks.create')
  const { pathname } = useLocation()
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState<TaskKindChoice | null>(null)
  const fromUrl = params.get('new')
  const urlKind: TaskKindChoice | null = canCreate && fromUrl ? (fromUrl === 'demand' ? 'demand' : 'project') : null
  const kind = creating ?? urlKind
  const unassigned = useDemandBadge()
  const onDemands = pathname.startsWith('/tasks/demands')

  return (
    <>
      <PageHeader
        title={t('tasks.title')}
        description={description}
        actions={
          canCreate && (
            <>
              <AppButton size="sm" leftIcon={<Plus />} onClick={() => setCreating('project')}>
                {t('demands.newProjectTask')}
              </AppButton>
              <AppButton size="sm" leftIcon={<Plus />} onClick={() => setCreating('demand')}>
                {t('demands.newDemand')}
              </AppButton>
            </>
          )
        }
      />
      <AppNavTabs
        aria-label={t('taskList.viewLabel')}
        variant="pill"
        className="mb-4"
        items={[
          { key: 'list', to: '/tasks', label: t('taskList.viewList'), active: !onDemands },
          {
            key: 'demands',
            to: '/tasks/demands',
            active: onDemands,
            label: (
              <>
                {t('taskList.viewDemands')}
                {unassigned > 0 && (
                  <span className="rounded-full bg-primary px-1.5 text-xs font-semibold tabular-nums text-primary-fg" title={t('demands.badge', { count: unassigned })}>
                    {unassigned}
                  </span>
                )}
              </>
            ),
          },
        ]}
      />
      <TaskFormDialog
        open={!!kind}
        initialKind={kind ?? 'project'}
        onOpenChange={(open) => {
          if (open) return
          setCreating(null)
          if (params.has('new')) {
            const next = new URLSearchParams(params)
            next.delete('new')
            setParams(next, { replace: true })
          }
        }}
      />
    </>
  )
}
