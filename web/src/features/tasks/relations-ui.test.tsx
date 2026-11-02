import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { AppError } from '@/core/errors/app-error'
import type { RelationRepository, TaskRepository } from '@/domain/repositories'
import type { TaskRelations } from '@/domain/relations'
import type { TaskDetail, TaskSummary } from '@/domain/tasks'
import { notify } from '@/presentation/components'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { TaskDetailPage } from './TaskDetailPage'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})
beforeEach(() => {
  vi.restoreAllMocks()
})

function summary(id: string, title: string, extra: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id,
    code: `CRM-${id}`,
    number: Number(id),
    title,
    project: { id: 'p1', key: 'CRM', name: 'CRM' },
    type: { id: 't1', key: 'BUG', name: 'Bug', icon: 'bug', color: 'red' },
    status: { id: 's1', key: 'TODO', name: 'A fazer', color: 'gray', category: 'todo' },
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
    urgency: null,
    area: null,
    ...extra,
  }
}

const detail: TaskDetail = {
  ...summary('1', 'Checkout novo', { blocked: true, subtaskProgress: { done: 1, total: 2 } }),
  description: '',
  customValues: {},
  checklist: [],
  fields: [],
  parent: null,
  forkedFrom: { id: '9', code: 'CRM-9', title: 'Checkout antigo' },
  capabilities: { edit: true, delete: false, assign: true, comment: true, link: true, fork: true },
}

const done = { id: 's2', key: 'DONE', name: 'Concluído', color: 'green' as const, category: 'done' as const }

const relations: TaskRelations = {
  parent: null,
  children: [summary('2', 'Tela de pagamento'), summary('3', 'Cupom', { status: done })],
  subtaskProgress: { done: 1, total: 2 },
  forkedFrom: summary('9', 'Checkout antigo'),
  forks: [],
  relations: [
    { id: 'r1', type: 'blocked_by', task: summary('5', 'Gateway Pix'), createdBy: null, createdAt: null, capabilities: { delete: true } },
    { id: 'r2', type: 'relates', task: summary('6', 'Relatório'), createdBy: null, createdAt: null, capabilities: { delete: true } },
  ],
  capabilities: { link: true, fork: true, createSubtask: true, edit: true },
}

function setup({ rels = relations, relationRepo = {}, taskRepo = {} }: { rels?: TaskRelations; relationRepo?: Partial<RelationRepository>; taskRepo?: Partial<TaskRepository> } = {}) {
  const repositories = fakeRepositories({
    auth: { me: async () => makeCurrentUser(['tasks.view', 'tasks.create', 'tasks.edit', 'tasks.link', 'tasks.fork', 'projects.view']) },
    tasks: {
      get: () => Promise.resolve(detail),
      history: () => Promise.resolve({ items: [], page: 1, perPage: 20, total: 0, totalPages: 0 }),
      list: () => Promise.resolve({ items: [summary('1', 'Checkout novo'), summary('7', 'Login social')], page: 1, perPage: 8, total: 2, totalPages: 1 }),
      ...taskRepo,
    },
    relations: { list: () => Promise.resolve(rels), ...relationRepo },
    projects: { list: () => Promise.resolve({ items: [], page: 1, perPage: 100, total: 0, totalPages: 0 }) },
  })
  return renderRoutes(
    [
      { path: '/tasks/:taskId', element: <TaskDetailPage /> },
      { path: '/tasks/:taskId/*', element: <TaskDetailPage /> },
    ],
    { repositories, initialPath: '/tasks/1?tab=relations' },
  )
}

describe('Relações na página da tarefa', () => {
  it('mostra subtarefas com progresso, relações agrupadas, origem do fork e contagem na aba', async () => {
    setup()
    expect(await screen.findByText('Tela de pagamento')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Relações (5)' })).toBeInTheDocument()
    expect(screen.getAllByText('1 de 2 subtarefas concluídas').length).toBeGreaterThan(0)
    expect(within(screen.getByRole('region', { name: 'Bloqueada por' })).getByText('Gateway Pix')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Relacionada a' })).getByText('Relatório')).toBeInTheDocument()
    // cabeçalho: origem do fork e indicador de bloqueio
    expect(screen.getByRole('link', { name: 'CRM-9' })).toBeInTheDocument()
    expect(screen.getAllByText('Bloqueada').length).toBeGreaterThan(0)
  })

  it('cria subtarefa rápida no mesmo projeto e tipo; desfaz relação', async () => {
    const create = vi.fn<TaskRepository['create']>(() => Promise.resolve({ ...detail, id: '8', code: 'CRM-8' }))
    const remove = vi.fn<RelationRepository['remove']>(() => Promise.resolve())
    setup({ taskRepo: { create }, relationRepo: { remove } })
    await userEvent.type(await screen.findByRole('textbox', { name: 'Nova subtarefa' }), 'Validar CPF')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ projectId: 'p1', taskTypeId: 't1', title: 'Validar CPF', parentTaskId: '1' }))

    await userEvent.click(screen.getByRole('button', { name: 'Desfazer relação com CRM-5' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('r1'))
  })

  it('adicionar relação: escolhe o tipo, busca e seleciona a tarefa (ciclo vira mensagem)', async () => {
    const create = vi
      .fn<RelationRepository['create']>()
      .mockRejectedValueOnce(new AppError({ code: 'RELATION_CYCLE', message: 'x', status: 409 }))
      .mockResolvedValueOnce(relations.relations[0] as never)
    const error = vi.spyOn(notify, 'error')
    setup({ relationRepo: { create } })
    await userEvent.click(await screen.findByRole('button', { name: 'Adicionar relação' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'CRM-1…' }))
    await userEvent.click(await screen.findByRole('option', { name: 'bloqueia…' }))
    // a própria tarefa não aparece na busca
    expect(within(dialog).queryByRole('option', { name: /Checkout novo/ })).not.toBeInTheDocument()
    await userEvent.click(await within(dialog).findByRole('option', { name: /Login social/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Adicionar relação' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith('1', { type: 'blocks', targetId: '7' }))
    await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining('ciclo')))
  })

  it('"tem como subtarefa…" transforma a tarefa escolhida em filha desta', async () => {
    const update = vi.fn<TaskRepository['update']>(() => Promise.resolve(detail))
    setup({ taskRepo: { update } })
    await userEvent.click(await screen.findByRole('button', { name: 'Vincular existente' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('combobox', { name: 'CRM-1…' })).toHaveTextContent('tem como subtarefa…')
    await userEvent.click(await within(dialog).findByRole('option', { name: /Login social/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Adicionar relação' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('7', { parentTaskId: '1' }))
  })

  it('fork: cópia padrão marcada, envia as escolhas e abre a nova tarefa', async () => {
    const fork = vi.fn<RelationRepository['fork']>(() => Promise.resolve({ ...detail, id: '10', code: 'CRM-10' }))
    const { router } = setup({ relationRepo: { fork } })
    await userEvent.click(await screen.findByRole('button', { name: 'Fork' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('checkbox', { name: 'Descrição' })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'Anexos (arquivos copiados)' })).not.toBeChecked()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Anexos (arquivos copiados)' }))
    await userEvent.clear(within(dialog).getByLabelText(/^Título/))
    await userEvent.type(within(dialog).getByLabelText(/^Título/), 'Checkout v2')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar fork' }))
    await waitFor(() =>
      expect(fork).toHaveBeenCalledWith('1', {
        title: 'Checkout v2',
        projectId: 'p1',
        copy: { description: true, tags: true, customValues: true, checklist: true, attachments: true, relations: false },
      }),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks/10'))
  })
})
