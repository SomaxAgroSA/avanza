import { useState, type ReactNode } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Inbox, List, Plus } from 'lucide-react'
import { AppButton, AppNavTabs, AppToolbar } from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useCan } from '@/features/auth/session'
import { useScreens } from '@/features/auth/use-screens'
import { useDemandBadge } from '@/features/demands/queries'
import { useTaskViews } from './use-task-views'
import { TaskFormDialog, type TaskKindChoice } from './TaskFormDialog'

/**
 * Cabeçalho do módulo Tarefas (§44/§45): só o título (sem texto de ajuda) e, numa linha só (AppToolbar: nunca
 * quebra nem troca as coisas de lugar), as visões Lista · Caixa de entrada (antes "Demandas", mesmo endereço
 * `/tasks/demands`; com o número do que espera por mim: recebidas sem atribuir, atribuídas a mim abertas e pedidas
 * por mim para validar), os controles da visão (`children`: escopo e Com/Sem projeto; as caixas da Caixa de entrada)
 * e, no fim da linha, os dois botões "＋ Tarefa de projeto" e "＋ Demanda interna" (com `tasks.create`; cada um abre
 * só o seu formulário; numa linha apertada viram "＋ Tarefa" e "＋ Demanda"). "Colunas e ações" fica na linha da
 * busca e dos filtros (a da tabela). `?new=1` (paleta de comandos) abre o formulário de tarefa de projeto;
 * `?new=demand`, o de demanda.
 */
export function TasksHeader({ children }: { children?: ReactNode }) {
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
  // Tarefas do perfil (ajustes 23 e 24/11): as abas Lista | Caixa de entrada só aparecem quando o perfil tem as
  // duas (com uma só, não há o que escolher); a aba Caixa de entrada abre na caixa do perfil
  const { views, boxes, inbox } = useTaskViews()
  const showTabs = views.tasksList !== 'hidden' && boxes.length > 0
  // botões de criar do perfil (§48): só a tela — a paleta de comandos (`?new=`) continua abrindo o formulário
  const screens = useScreens()
  const createProject = canCreate && screens.shows('tasks.create.project_task')
  const createDemand = canCreate && screens.shows('tasks.create.internal_demand')

  return (
    <>
      <PageHeader title={t('tasks.title')} />
      <AppToolbar className="mb-4">
        {showTabs && (
          <AppNavTabs
            aria-label={t('taskList.viewLabel')}
            variant="pill"
            dense
            className="shrink-0"
            items={[
              {
                key: 'list',
                to: '/tasks',
                icon: <List />,
                // passo 1 da linha da Caixa de entrada (InboxFilterBar): só o ícone; o nome fica para o leitor de tela
                label: <span className="[[data-compact~='1']_&]:sr-only">{t('taskList.viewList')}</span>,
                active: !onDemands,
              },
              {
                key: 'demands',
                to: inbox,
                icon: <Inbox />,
                active: onDemands,
                label: (
                  <>
                    {/* no celular o nome inteiro some da tela mas continua para o leitor de tela (a11y link-name) */}
                    <span className="@max-[1060px]:sr-only [[data-compact~='1']_&]:sr-only">{t('taskList.viewDemands')}</span>
                    <span aria-hidden className="hidden @max-[1060px]:inline [[data-compact~='1']_&]:hidden!">
                      {t('taskList.viewDemandsShort')}
                    </span>
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
        )}
        {children}
        {(createProject || createDemand) && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {createProject && <CreateButton full={t('demands.newProjectTask')} short={t('demands.newProjectTaskShort')} onClick={() => setCreating('project')} />}
            {createDemand && <CreateButton full={t('demands.newDemand')} short={t('demands.newDemandShort')} onClick={() => setCreating('demand')} />}
          </div>
        )}
      </AppToolbar>
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

/** "＋ Tarefa de projeto" que, numa linha apertada (< 1060px), vira "＋ Tarefa"; o nome inteiro fica no aria-label. */
function CreateButton({ full, short, onClick }: { full: string; short: string; onClick: () => void }) {
  return (
    <AppButton size="sm" leftIcon={<Plus />} aria-label={full} title={full} onClick={onClick}>
      {/* `data-compact~='1'`: a linha da Caixa de entrada não coube (InboxFilterBar) */}
      <span className="@max-[1060px]:hidden [[data-compact~='1']_&]:hidden">{full}</span>
      <span aria-hidden className="hidden @max-[1060px]:inline [[data-compact~='1']_&]:inline">
        {short}
      </span>
    </AppButton>
  )
}
