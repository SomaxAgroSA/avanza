import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { FileDown, ListChecks, RotateCcw } from 'lucide-react'
import { formatDayValue, today } from '@/core/utils/calendar'
import { readJson, writeJson } from '@/core/storage/safe-storage'
import { projectPath } from '@/domain/project-routes'
import type { Project } from '@/domain/projects'
import { DEFAULT_BRANDING } from '@/domain/platform'
import { buildProjectReport, defaultReportOptions, REPORT_SECTIONS, type ReportOptions } from '@/domain/project-report'
import {
  AppButton,
  AppCard,
  AppCheckbox,
  AppDatePicker,
  AppErrorState,
  AppSelect,
  AppSkeleton,
  AppTextarea,
  AppTextField,
} from '@/presentation/components'
import { useDebouncedValue } from '@/presentation/common/use-debounced-value'
import { usePlatformInfo } from '@/presentation/common/use-platform'
import { useCan } from '@/features/auth/session'
import { usePlan, usePlanJournal } from '@/features/plan/queries'
import { useTimeline } from '@/features/timeline/queries'
import { useProjectOutlet } from '../project-context'
import { renderReportDocument } from './report-document'

const NO_PHASES = 'none'
/** Largura da prévia (A4 + margens); em telas menores, a página é reduzida. */
const PAGE_WIDTH = 860

type StoredOptions = Omit<ReportOptions, 'cutoff'>
const storageKey = (projectId: string) => `kamban.project-report.${projectId}`

/** Aba Informe da página do projeto (`/projects/:projectId/report`); escolher as tarefas leva à Lista. */
export function ProjectReportTab() {
  const { project } = useProjectOutlet()
  const navigate = useNavigate()
  return <ProjectReportPanel project={project} onChooseTasks={() => void navigate(projectPath(project.id, 'list'))} />
}

/** Informe do projeto: escolhe o conteúdo, mostra a prévia e baixa o PDF (impressão do navegador). */
export function ProjectReportPanel({ project, onChooseTasks }: { project: Project; onChooseTasks?: () => void }) {
  const { t, i18n } = useTranslation()
  const platform = usePlatformInfo()
  const canViewPlan = useCan('plan.view')
  const timeline = useTimeline(project.id)
  const plan = usePlan(project.id, canViewPlan)
  const journal = usePlanJournal(project.id, canViewPlan)

  const [options, setOptions] = useState<ReportOptions>(() => {
    const stored = readJson<Partial<StoredOptions>>(storageKey(project.id), {})
    const base = defaultReportOptions(formatDayValue(today()))
    return { ...base, ...stored, sections: { ...base.sections, ...stored.sections } }
  })
  useEffect(() => {
    const { cutoff: _cutoff, ...stored } = options
    writeJson(storageKey(project.id), stored)
  }, [options, project.id])
  const set = (patch: Partial<ReportOptions>) => setOptions((current) => ({ ...current, ...patch }))

  // fases: o grupo escolhido; sem escolha, o primeiro grupo do quadro de gestão
  const groups = plan.data?.groups ?? []
  const phaseGroupId = options.phaseGroupId === NO_PHASES ? '' : options.phaseGroupId || groups.find((g) => !g.parentId)?.id || ''

  const debounced = useDebouncedValue(options, 400)
  const html = useMemo(() => {
    if (!timeline.data) return null
    const effective = { ...debounced, phaseGroupId: debounced.phaseGroupId === NO_PHASES ? '' : phaseGroupId }
    const report = buildProjectReport({
      projectStart: project.startDate ? project.startDate.toISOString().slice(0, 10) : null,
      tasks: timeline.data.tasks,
      milestones: timeline.data.milestones,
      journal: journal.data?.entries ?? [],
      plan: plan.data ?? null,
      options: effective,
    })
    return renderReportDocument(report, effective, {
      t: (key, values) => t(key, values),
      locale: i18n.language,
      project: { key: project.key, name: project.name },
      platformName: platform.name,
      iconUrl: new URL(platform.faviconUrl ?? DEFAULT_BRANDING.favicon, window.location.origin).href,
      origin: window.location.origin,
    })
  }, [debounced, phaseGroupId, timeline.data, journal.data, plan.data, project, platform, t, i18n.language])

  const tasks = timeline.data?.tasks ?? []
  const included = tasks.filter((task) => task.inReport).length

  const frame = useRef<HTMLIFrameElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [frameHeight, setFrameHeight] = useState(1200)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const element = box.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setScale(Math.min(1, (entry?.contentRect.width ?? PAGE_WIDTH) / PAGE_WIDTH)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  // a prévia cresce com o documento: só o <main> rola
  const measure = () => {
    const doc = frame.current?.contentDocument
    if (!doc) return
    setFrameHeight(doc.documentElement.scrollHeight)
    void doc.fonts?.ready.then(() => setFrameHeight(doc.documentElement.scrollHeight))
  }

  const sectionLabels = REPORT_SECTIONS.map((section) => ({ section, label: t(`projects.report.doc.sections.${section}`) }))

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
      <AppCard title={t('projects.report.optionsTitle')} description={t('projects.report.description')}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3 text-sm">
            <p className="text-fg">{t('projects.report.tasksIncluded', { count: included, total: tasks.length })}</p>
            {onChooseTasks && (
              <AppButton variant="secondary" size="sm" leftIcon={<ListChecks />} onClick={onChooseTasks}>
                {t('projects.report.chooseTasks')}
              </AppButton>
            )}
          </div>
          <AppTextField
            label={t('projects.report.fields.title')}
            placeholder={t('projects.report.doc.defaultTitle')}
            value={options.title}
            maxLength={120}
            onChange={(event) => set({ title: event.target.value })}
          />
          <AppTextarea
            label={t('projects.report.fields.subtitle')}
            placeholder={t('projects.report.doc.defaultSubtitle')}
            rows={2}
            maxLength={300}
            value={options.subtitle}
            onChange={(event) => set({ subtitle: event.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <AppDatePicker label={t('projects.report.fields.from')} value={options.from} max={options.to || undefined} clearable onValueChange={(from) => set({ from })} />
            <AppDatePicker label={t('projects.report.fields.to')} value={options.to} min={options.from || undefined} clearable onValueChange={(to) => set({ to })} />
          </div>
          <AppDatePicker
            label={t('projects.report.fields.cutoff')}
            hint={t('projects.report.fields.cutoffHint')}
            value={options.cutoff}
            onValueChange={(cutoff) => set({ cutoff: cutoff || formatDayValue(today()) })}
          />
          {canViewPlan && (
            <AppSelect
              label={t('projects.report.fields.phases')}
              hint={t('projects.report.fields.phasesHint')}
              value={options.phaseGroupId === NO_PHASES ? NO_PHASES : phaseGroupId || NO_PHASES}
              onValueChange={(value) => set({ phaseGroupId: value })}
              options={[
                { value: NO_PHASES, label: t('projects.report.fields.noPhases') },
                ...groups.map((g) => ({ value: g.id, label: g.number ? `${g.number} · ${g.name}` : g.name })),
              ]}
            />
          )}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-fg">{t('projects.report.fields.sections')}</legend>
            {sectionLabels.map(({ section, label }) => (
              <AppCheckbox
                key={section}
                label={label}
                checked={options.sections[section]}
                onCheckedChange={(checked) => set({ sections: { ...options.sections, [section]: checked } })}
              />
            ))}
          </fieldset>
          <AppTextarea
            label={t('projects.report.fields.summary')}
            hint={t('projects.report.fields.summaryHint')}
            rows={4}
            maxLength={3000}
            value={options.summary}
            onChange={(event) => set({ summary: event.target.value })}
          />
          <AppTextarea
            label={t('projects.report.fields.notes')}
            hint={t('projects.report.fields.notesHint')}
            rows={4}
            maxLength={3000}
            value={options.notes}
            onChange={(event) => set({ notes: event.target.value })}
          />
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <AppButton leftIcon={<FileDown />} disabled={!html} onClick={() => frame.current?.contentWindow?.print()}>
              {t('projects.report.download')}
            </AppButton>
            <p className="text-xs text-muted">{t('projects.report.printHint')}</p>
            <AppButton variant="ghost" size="sm" leftIcon={<RotateCcw />} onClick={() => setOptions(defaultReportOptions(formatDayValue(today())))}>
              {t('projects.report.reset')}
            </AppButton>
          </div>
        </div>
      </AppCard>

      <AppCard title={t('projects.report.preview')} padded={false} className="overflow-hidden">
        <div ref={box} className="bg-surface-2 p-3 sm:p-4">
          {timeline.isError ? (
            <AppErrorState onRetry={() => void timeline.refetch()} />
          ) : !html ? (
            <AppSkeleton className="h-[60vh]" />
          ) : (
            <div style={{ height: frameHeight * scale }} className="mx-auto overflow-hidden" aria-live="polite">
              <iframe
                ref={frame}
                title={t('projects.report.preview')}
                srcDoc={html}
                onLoad={measure}
                className="origin-top-left rounded-md border border-border shadow-card"
                style={{ width: PAGE_WIDTH, height: frameHeight, transform: `scale(${scale})` }}
              />
            </div>
          )}
        </div>
      </AppCard>
    </div>
  )
}
