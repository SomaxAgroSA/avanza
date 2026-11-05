import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronRight, ClipboardList, Gauge, Target } from 'lucide-react'
import type { Project } from '@/domain/projects'
import { AppCard, AppEmptyState, AppErrorState, AppSkeleton, AppTabs } from '@/presentation/components'
import { DueDate, TaskCode, TaskStatusBadge } from '@/features/tasks/task-visuals'
import { UrgencyLight } from '@/features/tasks/TaskUrgency'
import { TaskPreviewDrawer } from '@/features/tasks/TaskPreviewDrawer'
import { coverHeroStyle } from './project-theme'
import { ProjectAvatar } from './project-visuals'
import { useProjectBrief } from './charter/queries'
import { ProjectCharterPanel } from './charter/ProjectCharterPanel'

/**
 * Vista do Responsável TI (regras de negócio §24): só o nome do projeto, para que ele existe e
 * o que precisamos dele — as tarefas atribuídas e os itens da ficha sob a responsabilidade dele.
 */
export function ProjectBriefPage({ project }: { project: Project }) {
  const { t } = useTranslation()
  const brief = useProjectBrief(project.id)
  const [openId, setOpenId] = useState<string | null>(null)
  // o perfil pode liberar a ficha completa (regras §26), só para leitura
  const seesCharter = project.capabilities.sections.includes('charter')

  const needs = (
    <>
      {brief.isPending ? (
        <div className="flex flex-col gap-4">
          <AppSkeleton className="h-28 rounded-xl" />
          <AppSkeleton className="h-64 rounded-xl" />
        </div>
      ) : brief.isError ? (
        <AppErrorState onRetry={() => void brief.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <AppCard title={t('brief.aboutTitle')} description={t('brief.aboutDescription')}>
            <div className="flex gap-3">
              <Target className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <p className="text-sm whitespace-pre-line text-fg">{brief.data.objective || t('brief.noObjective')}</p>
            </div>
          </AppCard>

          <AppCard title={t('brief.needsTitle')} description={t('brief.needsDescription', { count: brief.data.tasks.length })}>
            {brief.data.tasks.length === 0 ? (
              <AppEmptyState icon={<ClipboardList />} title={t('brief.noTasksTitle')} description={t('brief.noTasksDescription')} />
            ) : (
              <ul className="-mx-2 flex flex-col">
                {brief.data.tasks.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() => setOpenId(task.id)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <TaskCode task={task} />
                          {task.urgency && <UrgencyLight urgency={task.urgency} />}
                        </span>
                        <span className="mt-0.5 block text-sm font-medium text-fg">{task.title}</span>
                      </div>
                      <span className="hidden text-xs sm:block">{task.dueDate ? <DueDate task={task} /> : <span className="text-subtle">{t('brief.noDueDate')}</span>}</span>
                      <TaskStatusBadge status={task.status} />
                      <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </AppCard>

          {brief.data.items.length > 0 && (
            <AppCard title={t('brief.itemsTitle')} description={t('brief.itemsDescription')}>
              <ul className="flex flex-col gap-3">
                {brief.data.items.map((item) => (
                  <li key={item.id} className="flex gap-3">
                    <Gauge className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg">
                        {item.title}
                        {item.target !== null && <span className="ml-2 font-normal text-muted">{t('brief.target', { value: item.target, unit: item.unit })}</span>}
                      </p>
                      {item.description && <p className="mt-0.5 text-xs text-muted">{item.description}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </AppCard>
          )}
        </div>
      )}

    </>
  )

  return (
    <>
      <Link to="/projects" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> {t('projects.backToList')}
      </Link>

      <section className="mb-4 overflow-hidden rounded-2xl text-on-cover shadow-card" style={coverHeroStyle(project.cover)}>
        <div className="flex items-center gap-4 px-5 py-4">
          <ProjectAvatar icon={project.icon} cover={project.cover} size="lg" className="size-12 shrink-0 ring-2 ring-on-cover/40 [&_svg]:size-6" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{project.name}</h1>
            <p className="mt-1 text-sm text-on-cover/85">{t('brief.subtitle')}</p>
          </div>
        </div>
      </section>

      {seesCharter ? (
        <AppTabs
          actionsSlot
          aria-label={project.name}
          tabs={[
            { value: 'needs', label: t('brief.needsTitle'), content: needs },
            { value: 'charter', label: t('projects.tabs.charter'), content: <ProjectCharterPanel project={project} /> },
          ]}
        />
      ) : (
        needs
      )}

      <TaskPreviewDrawer taskId={openId} onOpenChange={(open) => !open && setOpenId(null)} />
    </>
  )
}
