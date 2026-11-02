import { beforeAll, describe, expect, it } from 'vitest'
import i18n from '@/core/i18n'
import { buildProjectReport, defaultReportOptions, type ReportOptions } from '@/domain/project-report'
import type { TaskSummary } from '@/domain/tasks'
import type { Milestone } from '@/domain/timeline'
import { renderReportDocument } from './report-document'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

const tasks = [
  {
    id: 't1',
    number: 1,
    code: 'GCS-1',
    title: 'Publicar <Campo Demostrativo>',
    status: { id: 's', key: 'DONE', name: 'Concluido', color: 'green', category: 'done' },
    assignee: { id: 'u', name: 'Douglas Martins', email: '', avatarUrl: null },
    startDate: day('2026-10-01'),
    dueDate: day('2026-10-05'),
    inReport: true,
    urgency: null,
    area: null,
  },
  { id: 't2', number: 2, code: 'GCS-2', title: 'Tarea interna', status: null, assignee: null, startDate: day('2026-10-02'), dueDate: null, inReport: false },
] as TaskSummary[]

const milestones: Milestone[] = [
  { id: 'm', projectId: 'p', name: 'TI entrega la base', description: '', dueDate: '2026-10-27', state: 'pending', createdAt: null, updatedAt: null },
]

function render(patch: Partial<ReportOptions> = {}) {
  const options = { ...defaultReportOptions('2026-10-29'), ...patch }
  const report = buildProjectReport({ projectStart: '2026-09-22', tasks, milestones, journal: [], plan: null, options })
  return renderReportDocument(report, options, {
    t: (key, values) => i18n.t(key, values),
    locale: 'es',
    project: { key: 'GCS', name: 'Gestión Comercial' },
    platformName: 'Avanza',
    iconUrl: 'http://localhost/brand/favicon-64.png',
    origin: 'http://localhost',
  })
}

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

describe('report-document', () => {
  it('monta a capa, os indicadores e as seções na ordem, só com as tarefas do informe', () => {
    const html = render()
    expect(html).toContain('<title>GCS - Línea de tiempo del proyecto - 2026-10-29</title>')
    expect(html).toContain('Proyecto GCS · Gestión Comercial')
    expect(html).toContain('38 días')
    expect(html).toContain('1. Resumen')
    expect(html).toContain('6. Próximos pasos')
    expect(html).toContain('GCS-1')
    expect(html).not.toContain('GCS-2')
    expect(html).toContain('TI entrega la base')
    expect(html).toContain('<svg viewBox')
  })

  it('escapa o texto vindo dos dados e das opções', () => {
    const html = render({ title: '<script>alert(1)</script>', notes: 'Riesgo "alto" & <b>' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('Publicar &lt;Campo Demostrativo&gt;')
    expect(html).toContain('Riesgo &quot;alto&quot; &amp; &lt;b&gt;')
  })

  it('seções desligadas saem e a numeração acompanha', () => {
    const html = render({ sections: { summary: false, phases: false, milestones: true, chronology: false, tasks: true, next: false } })
    expect(html).toContain('1. Hitos')
    expect(html).toContain('2. Tareas')
    expect(html).not.toContain('Resumen</h2>')
    expect(html).not.toContain('Próximos pasos')
  })
})
