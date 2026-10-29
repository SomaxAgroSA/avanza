import { useTranslation } from 'react-i18next'
import { AlertTriangle, CalendarX, FolderKanban, HeartPulse, PackageCheck, TrendingUp } from 'lucide-react'
import { totalDeliveries, type ExecutiveDashboard } from '@/domain/executive'
import type { HealthLevel } from '@/domain/plan-management'
import { AppStatCard } from '@/presentation/components'

const DOT: Record<Exclude<HealthLevel, 'none'>, string> = { ok: 'bg-success', attention: 'bg-warning', critical: 'bg-danger' }

/** ① Resumo: os números que a diretoria olha primeiro. */
export function SummarySection({ summary }: { summary: ExecutiveDashboard['summary'] }) {
  const { t } = useTranslation()
  const late = summary.overdue.tasks + summary.overdue.planItems
  return (
    <section aria-labelledby="executive-summary" className="flex flex-col gap-3 print:break-inside-avoid">
      <h2 id="executive-summary" className="text-base font-semibold text-fg">
        {t('executive.summary.title')}
      </h2>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 2xl:grid-cols-6">
        <AppStatCard label={t('executive.summary.activeProjects')} value={summary.activeProjects} icon={<FolderKanban />} hint={t('executive.summary.activeHint')} />
        <AppStatCard
          label={t('executive.summary.health')}
          icon={<HeartPulse />}
          value={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base font-medium">
              {(['ok', 'attention', 'critical'] as const).map((level) => (
                <span key={level} className="inline-flex items-center gap-1.5">
                  <span aria-hidden className={`size-2.5 rounded-full ${DOT[level]}`} />
                  <span className="tabular-nums">{summary.health[level]}</span>
                  <span className="text-sm font-normal text-muted">{t(`executive.summary.${level}`)}</span>
                </span>
              ))}
            </span>
          }
          hint={summary.health.none ? t('executive.summary.none', { count: summary.health.none }) : t('executive.summary.healthHint')}
        />
        <AppStatCard
          label={t('executive.summary.progress')}
          value={summary.progress === null ? '—' : `${summary.progress}%`}
          icon={<TrendingUp />}
          hint={t('executive.summary.progressHint')}
        />
        <AppStatCard
          label={t('executive.summary.deliveries')}
          value={totalDeliveries(summary.deliveries)}
          icon={<PackageCheck />}
          tone="success"
          hint={t('executive.summary.deliveriesHint', { tasks: summary.deliveries.tasks, items: summary.deliveries.planItems, milestones: summary.deliveries.milestones })}
        />
        <AppStatCard
          label={t('executive.summary.overdue')}
          value={late}
          icon={<CalendarX />}
          tone={late ? 'danger' : 'default'}
          hint={t('executive.summary.overdueHint', { tasks: summary.overdue.tasks, items: summary.overdue.planItems })}
        />
        <AppStatCard
          label={t('executive.summary.openIssues')}
          value={summary.openIssues}
          icon={<AlertTriangle />}
          tone={summary.openIssues ? 'warning' : 'default'}
          hint={summary.criticalBugs ? t('executive.summary.criticalBugs', { count: summary.criticalBugs }) : t('executive.summary.noCriticalBugs')}
        />
      </div>
    </section>
  )
}
