import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { AppError } from '@/core/errors/app-error'
import type { CustomField } from '@/domain/task-config'
import type { TaskDetail } from '@/domain/tasks'
import type { TaskStatus } from '@/domain/workflow'
import { fakeRepositories, renderRoutes } from '@/test/utils'
import { TaskQuickFields } from './TaskQuickFields'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const status = (id: string, name: string, order: number) =>
  ({ id, key: name.toUpperCase(), name, description: '', color: 'gray', order, isActive: true, isDefault: order === 0, category: 'todo', allowedNext: [], createdAt: null, updatedAt: null }) as TaskStatus
const STATUSES = [status('s-backlog', 'Backlog', 0), status('s-analise', 'Análise', 1)]
const parecer = { id: 'f1', name: 'parecer', label: 'Parecer do analista', type: 'textarea', description: '', config: {}, options: [], defaultValue: null } as unknown as CustomField

const task = {
  id: 't1',
  code: 'CRM-7',
  title: 'Integração',
  project: { id: 'p1', key: 'CRM', name: 'CRM' },
  status: { id: 's-backlog', key: 'BACKLOG', name: 'Backlog', color: 'gray', category: 'backlog' },
  priority: null,
  assignee: null,
  capabilities: { edit: true, delete: false, assign: true, link: true, fork: true, comment: true },
  fields: [{ field: parecer, order: 0, required: false, visible: true, showOnCard: false, requiredStatusIds: ['s-analise'] }],
  customValues: {},
} as unknown as TaskDetail

describe('obrigatório por status — preencher para mover', () => {
  it('troca de status que exige campos abre o preenchimento, salva e aplica a troca', async () => {
    const missing = new AppError({ code: 'VALIDATION_ERROR', message: 'invalid', status: 400, details: { fields: { 'custom_values.parecer': 'required' }, status: { id: 's-analise', name: 'Análise' } } })
    const update = vi
      .fn()
      .mockRejectedValueOnce(missing)
      .mockResolvedValue({ ...task, status: { ...task.status, id: 's-analise', name: 'Análise' } })
    renderRoutes([{ path: '/tasks/t1', element: <TaskQuickFields task={task} /> }], {
      repositories: fakeRepositories({
        tasks: { get: () => Promise.resolve(task), update },
        statuses: { list: () => Promise.resolve(STATUSES) },
        projects: { listMembers: () => Promise.resolve([]) },
      }),
      initialPath: '/tasks/t1',
    })

    await userEvent.click(await screen.findByRole('combobox', { name: 'Status' }))
    await userEvent.click(await screen.findByRole('option', { name: /Análise/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Preencha para mover para "Análise"' })
    expect(dialog).toHaveTextContent('CRM-7 precisa destes campos no status "Análise".')
    // sem preencher, não envia
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar e mover' }))
    expect(within(dialog).getByText(i18n.t('validation.required'))).toBeInTheDocument()

    await userEvent.type(within(dialog).getByLabelText(/Parecer do analista/), 'Viável')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar e mover' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(3))
    expect(update).toHaveBeenNthCalledWith(1, 't1', { statusId: 's-analise' })
    expect(update).toHaveBeenNthCalledWith(2, 't1', { customValues: { parecer: 'Viável' } })
    expect(update).toHaveBeenNthCalledWith(3, 't1', { statusId: 's-analise' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('arquivo e projeto exigidos no status: o pop-up envia o arquivo pelo campo e lista os projetos', async () => {
    const evidencias = { id: 'f9', name: 'evidencias', label: 'Evidências', type: 'file', description: '', config: {}, options: [], defaultValue: null } as unknown as CustomField
    const relacionado = { id: 'f7', name: 'projeto_relacionado', label: 'Projeto relacionado', type: 'project', description: '', config: {}, options: [], defaultValue: null } as unknown as CustomField
    const withFiles = {
      ...task,
      fields: [
        { field: evidencias, order: 0, required: false, visible: true, showOnCard: false, requiredStatusIds: ['s-analise'] },
        { field: relacionado, order: 1, required: false, visible: true, showOnCard: false, requiredStatusIds: ['s-analise'] },
      ],
    } as unknown as TaskDetail
    const missing = new AppError({
      code: 'VALIDATION_ERROR',
      message: 'invalid',
      status: 400,
      details: { fields: { 'custom_values.evidencias': 'required', 'custom_values.projeto_relacionado': 'required' }, status: { id: 's-analise', name: 'Análise' } },
    })
    const update = vi.fn().mockRejectedValueOnce(missing).mockResolvedValue(withFiles)
    const upload = vi.fn(async () => [{ id: 'a9', name: 'ata.pdf', kind: 'document', url: '/api/v1/attachments/a9/file' }])
    const { container } = renderRoutes([{ path: '/tasks/t1', element: <TaskQuickFields task={withFiles} /> }], {
      repositories: fakeRepositories({
        tasks: { get: () => Promise.resolve(withFiles), update },
        statuses: { list: () => Promise.resolve(STATUSES) },
        projects: {
          listMembers: () => Promise.resolve([]),
          list: () => Promise.resolve({ items: [{ id: 'p2', key: 'ERP', name: 'ERP' }], meta: { page: 1, perPage: 100, total: 1, totalPages: 1 } }),
        },
        attachments: { list: () => Promise.resolve([]), upload },
      } as never),
      initialPath: '/tasks/t1',
    })

    await userEvent.click(await screen.findByRole('combobox', { name: 'Status' }))
    await userEvent.click(await screen.findByRole('option', { name: /Análise/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Preencha para mover para "Análise"' })

    // o arquivo vai pelo próprio campo (sem passar pela aba Anexos)
    expect(within(dialog).getByRole('button', { name: 'Enviar arquivo' })).toBeInTheDocument()
    const input = container.ownerDocument.querySelector('input[type=file]') as HTMLInputElement
    const file = new File(['%PDF-1.4'], 'ata.pdf', { type: 'application/pdf' })
    await userEvent.upload(input, file)
    await waitFor(() => expect(upload).toHaveBeenCalledWith('t1', file, { field: 'evidencias', commentId: undefined }))

    // o campo de projeto tem opções
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Projeto relacionado/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'ERP · ERP' }))

    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar e mover' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('t1', { customValues: { evidencias: ['a9'], projeto_relacionado: 'p2' } }))
  })
})
