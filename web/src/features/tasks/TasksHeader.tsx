import { useState, type ReactNode } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { AppButton, AppNavTabs } from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useCan } from '@/features/auth/session'
import { useDemandBadge } from '@/features/demands/queries'
import { TaskFormDialog, type TaskKindChoice } from './TaskFormDialog'

/**
 * Cabeçalho do módulo Tarefas (§44/§45): título (sem texto de ajuda), os dois botões pequenos "＋ Tarefa de
 * projeto" e "＋ Demanda interna" (com `tasks.create`; cada um abre só o seu formulário) e, numa linha só, as
 * visões Lista · Caixa de entrada (antes "Demandas", mesmo endereço `/tasks/demands`; com o número do que espera
 * por mim: recebidas sem atribuir, atribuídas a mim abertas e pedidas por mim para validar), os controles da visão
 * (`children`: escopo e Com/Sem projeto; as caixas das Demandas) e, à direita, `end` (ex.: "Colunas e ações").
 * `?new=1` (paleta de comandos) abre o formulário de tarefa de projeto; `?new=demand`, o de demanda.
 */
export function TasksHeader({ children, end }: { children?: ReactNode; end?: ReactNode }) {
  const { t } = useTranslation()
  const canCreate = useCan('tasks.create')
  const { pathname } = useLocation()
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState<TaskKindChoice | null>(null)
  const fromUrl = params.get('new')
  const urlKind: TaskKindChoice | null = canCreate && fromUrl ? (fromUrl === 'demand' ? 'demand' : 'project') : null
  const kind = creating ?? urlKind
  const pending = useDemandBadge()
  const onDemands = pathname.startsWith('/tasks/demands')

  return (
    <>
      <PageHeader
        title={t('tasks.title')}
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
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <AppNavTabs
          aria-label={t('taskList.viewLabel')}
          variant="pill"
          items={[
            { key: 'list', to: '/tasks', label: t('taskList.viewList'), active: !onDemands },
            {
              key: 'demands',
              to: '/tasks/demands',
              active: onDemands,
              label: (
                <>
                  {t('taskList.viewDemands')}
                  {pending > 0 && (
                    <span className="rounded-full bg-primary px-1.5 text-xs font-semibold tabular-nums text-primary-fg" title={t('demands.badge', { count: pending })}>
                      {pending}
                    </span>
                  )}
                </>
              ),
            },
          ]}
        />
        {children}
        {end && <div className="ml-auto flex items-center gap-2">{end}</div>}
      </div>
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
