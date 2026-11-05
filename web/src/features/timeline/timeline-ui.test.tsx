import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { TaskSummary } from '@/domain/tasks'
import type { Timeline } from '@/domain/timeline'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { ProjectTimelinePage } from './TimelinePage'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const utc = (day: string) => new Date(`${day}T00:00:00.000Z`)

function task(id: string, title: string, extra: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id,
    code: `CRM-${id}`,
    number: Number(id),
    title,
    project: { id: 'p1', key: 'CRM', name: 'CRM' },
    type: null,
    status: { id: 's1', key: 'TODO', name: 'A fazer', color: 'blue', category: 'todo' },
    priority: null,
    sprint: null,
    creator: null,
    assignee: null,
    reporter: null,
    parentTaskId: null,
    startDate: null,
    dueDate: null,
    estimatedHours: null,
    actualHours: null,
    startedAt: null,
    completedAt: null,
    createdAt: null,
    updatedAt: null,
    tags: [],
    checklistProgress: { done: 0, total: 0 },
    commentCount: 0,
    attachmentCount: 0,
    subtaskProgress: { done: 0, total: 0 },
    blocked: false,
    inReport: true,
    itVisible: false,
    urgency: null,
    area: null,
    ...extra,
  }
}

function timeline(overrides: Partial<Timeline> = {}): Timeline {
  return {
    project: { id: 'p1', key: 'CRM', name: 'CRM', startDate: null, dueDate: null, archived: false },
    capabilities: { edit: true, manageMilestones: true },
    tasks: [task('1', 'Desenho', { startDate: utc('2026-10-05'), dueDate: utc('2026-10-09') }), task('2', 'Manual', { estimatedHours: 16 })],
    dependencies: [],
    milestones: [{ id: 'm1', projectId: 'p1', name: 'Go-live', description: '', dueDate: '2026-10-30', state: 'pending', createdAt: null, updatedAt: null }],
    sprints: [],
    truncated: false,
    ...overrides,
  }
}

function setup(data: Timeline = timeline()) {
  const update = vi.fn((id: string) => Promise.resolve({ ...data.tasks.find((t) => t.id === id) } as never))
  const updateMilestone = vi.fn(() => Promise.resolve(data.milestones[0] as never))
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser(['tasks.view', 'tasks.edit', 'projects.view']) },
    timeline: { get: () => Promise.resolve(data) },
    tasks: { update },
    milestones: { update: updateMilestone },
    projects: { listMembers: () => Promise.resolve([]), list: () => Promise.resolve({ items: [], page: 1, perPage: 100, total: 0, totalPages: 0 }) },
  })
  renderRoutes([{ path: '/projects/:projectId/timeline', element: <ProjectTimelinePage /> }], { repositories, initialPath: '/projects/p1/timeline' })
  return { update, updateMilestone }
}

describe('Timeline', () => {
  it('mostra barras das tarefas com datas e a lista "Sem datas"', async () => {
    setup()
    const bar = await screen.findByRole('button', { name: /CRM-1 · Desenho, 5 de out\. a 9 de out\./ })
    expect(bar).toHaveAttribute('aria-describedby')
    const unscheduled = screen.getByRole('region', { name: /Sem datas/ })
    expect(within(unscheduled).getByText('Manual')).toBeInTheDocument()
    expect(screen.getByText(/1 tarefa na linha do tempo · 1 sem datas/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Marco Go-live/ })).toBeInTheDocument()
  })

  it('setas do teclado movem a barra e gravam depois da pausa; Shift muda só o prazo', async () => {
    const { update } = setup()
    const bar = await screen.findByRole('button', { name: /CRM-1 · Desenho/ })
    bar.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    await waitFor(() => expect(update).toHaveBeenCalledWith('1', { startDate: '2026-10-07', dueDate: '2026-10-11' }), { timeout: 3000 })
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}')
    await waitFor(() => expect(update).toHaveBeenLastCalledWith('1', { startDate: '2026-10-05', dueDate: '2026-10-08' }), { timeout: 3000 })
  })

  it('"Datas" define início e prazo da tarefa sem datas (duração pela estimativa)', async () => {
    const { update } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Definir datas de CRM-2' }))
    const dialog = await screen.findByRole('dialog', { name: 'Datas de CRM-2' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    const [, dates] = update.mock.calls[0] as unknown as [string, { startDate: string; dueDate: string }]
    // 16 h estimadas = 2 dias
    expect((new Date(dates.dueDate).getTime() - new Date(dates.startDate).getTime()) / 86400000).toBe(1)
  })

  it('leitor: somente leitura, sem mover nem gerenciar marcos', async () => {
    const { update } = setup(timeline({ capabilities: { edit: false, manageMilestones: false } }))
    const bar = await screen.findByRole('button', { name: /CRM-1 · Desenho/ })
    expect(screen.getByText('Somente leitura')).toBeInTheDocument()
    expect(bar).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('button', { name: 'Novo marco' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Definir datas/ })).not.toBeInTheDocument()
    bar.focus()
    await userEvent.keyboard('{ArrowRight}')
    await new Promise((r) => setTimeout(r, 900))
    expect(update).not.toHaveBeenCalled()
  })

  it('gestor abre o marco pelo losango e edita', async () => {
    const { updateMilestone } = setup()
    await userEvent.click(await screen.findByRole('button', { name: /Marco Go-live/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Editar marco' })
    const name = within(dialog).getByLabelText(/^Nome/)
    await userEvent.clear(name)
    await userEvent.type(name, 'Go-live Brasil')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(updateMilestone).toHaveBeenCalledWith('m1', { name: 'Go-live Brasil', dueDate: '2026-10-30', description: '', state: 'pending' }))
  })
})
