import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowRight, BarChart3, CheckSquare, FolderKanban, KanbanSquare, KeyRound, ListTodo, ShieldCheck, Users } from 'lucide-react'
import { AppCard } from '@/presentation/components'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { usePlatformInfo } from '@/presentation/common/use-platform'
import { useResolvedTheme } from '@/presentation/common/use-theme'
import { logoFor } from '@/domain/platform'
import { useSession } from '@/features/auth/session'
import { can } from '@/domain/permissions'
import { MyProjectsCard } from '@/features/projects/MyProjectsCard'
import { DashboardIndicators } from '@/features/reports/DashboardIndicators'

function greetingKey(hour: number) {
  if (hour < 12) return 'dashboard.goodMorning'
  if (hour < 18) return 'dashboard.goodAfternoon'
  return 'dashboard.goodEvening'
}

/**
 * Dashboard inicial: indicadores reais (situação atual + últimos 30 dias, com o período
 * sempre visível — diretriz §24), meus projetos e acesso rápido.
 */
export function DashboardPage() {
  const { t } = useTranslation()
  const { current } = useSession()
  const firstName = current?.user.name.split(' ')[0] ?? ''
  const permissions = current?.permissions ?? []
  const logo = logoFor(usePlatformInfo(), useResolvedTheme())
  useDocumentTitle(t('nav.dashboard'))

  const shortcuts = [
    { to: '/planning', icon: ListTodo, label: t('nav.planning'), description: t('dashboard.shortcuts.planning'), allowed: can(permissions, 'tasks.view') },
    { to: '/kanban', icon: KanbanSquare, label: t('nav.kanban'), description: t('dashboard.shortcuts.kanban'), allowed: can(permissions, 'kanban.view') },
    { to: '/tasks', icon: CheckSquare, label: t('nav.tasks'), description: t('dashboard.shortcuts.tasks'), allowed: can(permissions, 'tasks.view') },
    { to: '/projects', icon: FolderKanban, label: t('nav.projects'), description: t('dashboard.shortcuts.projects'), allowed: can(permissions, 'projects.view') },
    { to: '/reports', icon: BarChart3, label: t('nav.reports'), description: t('dashboard.shortcuts.reports'), allowed: can(permissions, 'reports.view') },
    { to: '/users', icon: Users, label: t('nav.users'), description: t('dashboard.shortcuts.users'), allowed: can(permissions, 'users.view') },
    { to: '/settings/permissions', icon: ShieldCheck, label: t('nav.permissions'), description: t('dashboard.shortcuts.permissions'), allowed: can(permissions, 'permissions.manage') },
    { to: '/account/sessions', icon: KeyRound, label: t('account.sessions'), description: t('dashboard.shortcuts.sessions'), allowed: true },
  ].filter((s) => s.allowed)

  return (
    <>
      <div className="relative mb-6 overflow-hidden rounded-2xl border border-border bg-hero-gradient p-6 sm:p-8 sm:pr-44">
        <img src={logo} alt="" aria-hidden className="absolute right-8 top-1/2 hidden size-[120px] -translate-y-1/2 object-contain sm:block" />
        <p className="text-sm font-semibold text-primary-text">{current?.role?.name}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
          {t(greetingKey(new Date().getHours()), { name: firstName })}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">{t('dashboard.subtitle')}</p>
      </div>

      {/* duas colunas em telas largas: conteúdo à esquerda, acesso rápido à direita */}
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {can(permissions, 'reports.view') && <DashboardIndicators />}
          {can(permissions, 'projects.view') && <MyProjectsCard />}
        </div>

        <AppCard title={t('dashboard.quickAccess')} padded={false}>
          <ul className="flex flex-col p-2">
            {shortcuts.map((s) => (
              <li key={s.to}>
                <Link to={s.to} className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-2">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-fg">
                    <s.icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-fg">{s.label}</span>
                    <span className="block truncate text-xs text-muted">{s.description}</span>
                  </span>
                  <ArrowRight className="size-4 text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </AppCard>
      </div>
    </>
  )
}
