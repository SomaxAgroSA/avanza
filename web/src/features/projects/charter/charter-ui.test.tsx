import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { CharterItem, ProjectCharter, ResultItem } from '@/domain/charter'
import type { Project } from '@/domain/projects'
import { fakeRepositories, makeCurrentUser, renderWithProviders } from '@/test/utils'
import { ProjectCharterPanel } from './ProjectCharterPanel'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

const project = { id: 'p1', key: 'GCS', name: 'Gestión Comercial', archivedAt: null } as unknown as Project
const owner = { id: 'u1', name: 'Ana Souza', email: 'ana@kamban.test', avatarUrl: null }
const base = { projectId: 'p1', description: '', position: 1, owner: null, createdAt: null, updatedAt: null }

const result: ResultItem = {
  ...base,
  id: 'r1',
  kind: 'result',
  title: 'Reclamos en plazo',
  owner,
  unit: '%',
  baseline: 40,
  target: 90,
  current: 68,
  startDate: '2026-10-01',
  dueDate: '2026-11-30',
  frequency: 'monthly',
  measuredAt: '2026-10-20',
  situation: 'late',
  percent: 56,
  stale: true,
}

const items: CharterItem[] = [
  { ...base, id: 'o1', kind: 'objective', title: 'Digitalizar reclamos', state: 'auto', effectiveState: 'at_risk', linkIds: ['f1', 'r1'] },
  { ...base, id: 'f1', kind: 'feature', title: 'Reclamos', state: 'auto', effectiveState: 'in_progress', taskIds: ['t1', 't2'], tasks: [], progress: { done: 1, total: 2 } },
  { ...base, id: 's1', kind: 'scope_in', title: 'Portal web' },
  { ...base, id: 's2', kind: 'scope_out', title: 'App móvil' },
  result,
]

function charter(overrides: Partial<ProjectCharter> = {}): ProjectCharter {
  return {
    projectId: 'p1',
    objective: 'Centralizar la gestión comercial',
    updatedAt: new Date(),
    updatedBy: owner,
    capabilities: { edit: true },
    completeness: { sections: { objectives: true, features: true, scope: true, results: true }, done: 4, total: 4, percent: 100 },
    summary: { featuresTotal: 1, featuresDelivered: 0, tasksTotal: 2, tasksDone: 1, resultsTotal: 1, resultsOnTrack: 0, resultsLate: 1, resultsStale: 1 },
    items,
    ...overrides,
  }
}

function setup(data: ProjectCharter = charter()) {
  const createItem = vi.fn(() => Promise.resolve(items[2] as never))
  const addMeasurement = vi.fn(() => Promise.resolve(result as never))
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser(['projects.view', 'tasks.view']) },
    charter: { get: () => Promise.resolve(data), createItem, addMeasurement },
    projects: { listMembers: () => Promise.resolve([]) },
    timeline: { get: () => Promise.resolve({ tasks: [] } as never) },
  })
  renderWithProviders(<ProjectCharterPanel project={project} />, repositories)
  return { createItem, addMeasurement }
}

describe('Ficha del proyecto', () => {
  it('funcionalidad retrasada: estado "Retrasada" (calculado por una tarea vencida) y el objetivo en riesgo', async () => {
    const late = items.map((item) => (item.kind === 'feature' ? { ...item, effectiveState: 'late' as const } : item))
    setup(charter({ items: late }))
    expect(await screen.findByText('Retrasada')).toBeInTheDocument()
    expect(screen.getByText('En riesgo')).toBeInTheDocument()
  })

  it('muestra el resumen y las cuatro secciones con el avance calculado', async () => {
    setup()
    expect(await screen.findByText('Centralizar la gestión comercial')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('Digitalizar reclamos')).toBeInTheDocument()
    expect(screen.getByText('En riesgo')).toBeInTheDocument()
    expect(screen.getByText('1 de 2 hechas')).toBeInTheDocument()
    expect(screen.getByText('Portal web')).toBeInTheDocument()
    expect(screen.getByText('App móvil')).toBeInTheDocument()
    const results = screen.getByRole('table', { name: 'Resultados esperados' })
    expect(within(results).getByText('68 %')).toBeInTheDocument()
    expect(within(results).getByText('Atrasado')).toBeInTheDocument()
    expect(within(results).getByText('Sin medir')).toBeInTheDocument()
  })

  it('ficha vacía: cada sección explica qué cargar y el gestor agrega un ítem', async () => {
    const empty = charter({
      objective: '',
      items: [],
      completeness: { sections: { objectives: false, features: false, scope: false, results: false }, done: 0, total: 4, percent: 0 },
      summary: { featuresTotal: 0, featuresDelivered: 0, tasksTotal: 0, tasksDone: 0, resultsTotal: 0, resultsOnTrack: 0, resultsLate: 0, resultsStale: 0 },
    })
    const { createItem } = setup(empty)
    expect(await screen.findByText('Todavía no hay objetivos')).toBeInTheDocument()
    expect(screen.getByText('Todavía no hay resultados esperados')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Agregar al alcance' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo ítem de alcance' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Título/ }), 'Portal web')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(createItem).toHaveBeenCalledWith('p1', { kind: 'scope_in', title: 'Portal web', description: '' }))
  })

  it('el responsable registra una medición del resultado', async () => {
    const { addMeasurement } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar medición de “Reclamos en plazo”' }))
    const dialog = await screen.findByRole('dialog', { name: 'Registrar medición' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Valor/ }), '72,5')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Comentario' }), 'Reporte del CRM')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(addMeasurement).toHaveBeenCalledOnce())
    const [id, input] = addMeasurement.mock.calls[0] as unknown as [string, { value: number; note: string }]
    expect([id, input.value, input.note]).toEqual(['r1', 72.5, 'Reporte del CRM'])
  })

  it('quien solo ve: sin botones de edición', async () => {
    setup(charter({ capabilities: { edit: false }, items: items.map((i) => (i.kind === 'result' ? { ...i, owner: null } : i)) }))
    expect(await screen.findByText('Centralizar la gestión comercial')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar objetivo general' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agregar funcionalidad' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Registrar medición/ })).not.toBeInTheDocument()
  })
})
