import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { AttachmentRepository, CommentRepository, TaskRepository } from '@/domain/repositories'
import type { TaskComment, TaskDetail } from '@/domain/tasks'
import { notify } from '@/presentation/components'
import { fakeRepositories, renderWithProviders } from '@/test/utils'
import { TaskChecklist } from './TaskChecklist'
import { TaskComments } from './TaskComments'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const task: TaskDetail = {
  id: 'k1',
  code: 'CRM-1',
  number: 1,
  title: 'Manual',
  project: { id: 'p1', key: 'CRM', name: 'CRM' },
  type: null,
  status: null,
  priority: null,
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
  checklistProgress: { done: 1, total: 2 },
  commentCount: 1,
  attachmentCount: 0,
  subtaskProgress: { done: 0, total: 0 },
  blocked: false,
  inReport: true,
  sprint: null,
  description: '',
  customValues: {},
  checklist: [
    { id: 'c1', text: 'Escrever', done: true },
    { id: 'c2', text: 'Revisar', done: false },
  ],
  fields: [],
  parent: null, forkedFrom: null, capabilities: { edit: true, delete: false, assign: true, comment: true, link: true, fork: true },
}

const people = [
  { id: 'u1', name: 'Carla Mendes', email: 'c@x.com', avatarUrl: null },
  { id: 'u2', name: 'Mário Souza', email: 'm@x.com', avatarUrl: null },
]

function comment(overrides: Partial<TaskComment>): TaskComment {
  return {
    id: 'm1',
    taskId: 'k1',
    author: people[1] ?? null,
    content: 'Pode revisar, @[Carla Mendes](u1)?',
    mentions: [],
    attachments: [],
    deleted: false,
    createdAt: new Date('2026-09-28T10:00:00Z'),
    editedAt: null,
    capabilities: { edit: true, delete: true },
    ...overrides,
  }
}

function renderComments(overrides: Partial<CommentRepository> = {}, detail: TaskDetail = task) {
  const create = vi.fn<CommentRepository['create']>(() => Promise.resolve(comment({ id: 'm2' })))
  const update = vi.fn<CommentRepository['update']>(() => Promise.resolve(comment({})))
  const upload = vi.fn<AttachmentRepository['upload']>(() => Promise.resolve([]))
  const repositories = fakeRepositories({
    comments: { list: () => Promise.resolve([comment({})]), mentionCandidates: () => Promise.resolve(people), create, update, ...overrides },
    attachments: { upload },
  })
  renderWithProviders(<TaskComments task={detail} />, repositories)
  return { create, update, upload }
}

describe('TaskComments', () => {
  it('mostra a menção destacada com o nome da pessoa', async () => {
    renderComments()
    expect(await screen.findByText('@Carla Mendes')).toBeInTheDocument()
    expect(screen.getByText('Mário Souza')).toBeInTheDocument()
  })

  it('comentar com @ envia a menção no formato salvo', async () => {
    const { create } = renderComments()
    const box = await screen.findByRole('combobox', { name: 'Novo comentário' })
    await userEvent.type(box, 'Olá @má')
    await userEvent.click(await screen.findByRole('option', { name: /Mário Souza/ }))
    await userEvent.type(box, 'veja o **manual**')
    await userEvent.click(screen.getByRole('button', { name: 'Comentar' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith('k1', 'Olá @[Mário Souza](u2) veja o **manual**'))
    await waitFor(() => expect(box).toHaveValue(''))
  })

  it('editar abre o texto com "@Nome" e salva mantendo a menção', async () => {
    const { update } = renderComments()
    await userEvent.click(await screen.findByRole('button', { name: 'Editar comentário' }))
    const box = screen.getByRole('combobox', { name: 'Editar comentário' })
    expect(box).toHaveValue('Pode revisar, @Carla Mendes?')
    await userEvent.type(box, ' Obrigado!')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('m1', 'Pode revisar, @[Carla Mendes](u1)? Obrigado!'))
  })

  it('comentário com arquivo: salva o comentário e envia o anexo ligado a ele; tipo proibido nem entra', async () => {
    const error = vi.spyOn(notify, 'error').mockImplementation(() => '')
    const { create, upload } = renderComments()
    const box = await screen.findByRole('combobox', { name: 'Novo comentário' })
    await userEvent.type(box, 'Segue o print')
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'print.png', { type: 'image/png' }), new File(['MZ'], 'setup.exe')] } })
    expect(within(screen.getByRole('list', { name: 'Arquivos que serão anexados' })).getByText('print.png')).toBeInTheDocument()
    expect(error).toHaveBeenCalledWith('setup.exe: Tipo de arquivo não permitido')
    await userEvent.click(screen.getByRole('button', { name: 'Comentar' }))
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith('k1', 'Segue o print')
    expect(upload.mock.calls[0]?.[1].name).toBe('print.png')
    expect(upload.mock.calls[0]?.[2]).toEqual({ commentId: 'm2' })
    error.mockRestore()
  })

  it('imagem colada (Ctrl+V) no comentário entra na lista com nome legível e segue ligada a ele', async () => {
    const { upload } = renderComments()
    const box = await screen.findByRole('combobox', { name: 'Novo comentário' })
    await userEvent.type(box, 'Veja o erro')
    fireEvent.paste(box, { clipboardData: { files: [new File(['x'], 'image.png', { type: 'image/png' })], getData: () => '' } })
    expect(within(screen.getByRole('list', { name: 'Arquivos que serão anexados' })).getByText(/^imagem-colada-\d{8}-\d{6}\.png$/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Comentar' }))
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    expect(upload.mock.calls[0]?.[1].name).toMatch(/^imagem-colada-/)
  })

  it('anexos do comentário aparecem nele, com miniatura da imagem', async () => {
    renderComments({
      list: () =>
        Promise.resolve([
          comment({
            attachments: [
              { id: 'f1', taskId: 'k1', commentId: 'm1', name: 'erro.png', mime: 'image/png', kind: 'image', size: 10, uploadedBy: null, createdAt: null, url: '/api/v1/attachments/f1/file', capabilities: { delete: true } },
            ],
          }),
        ]),
    })
    expect(await screen.findByRole('img', { name: 'erro.png' })).toHaveAttribute('src', '/api/v1/attachments/f1/file')
  })

  it('projeto arquivado: sem caixa de comentário', async () => {
    renderComments({}, { ...task, capabilities: { ...task.capabilities, comment: false } })
    expect(await screen.findByText('Projeto arquivado: comentários estão fechados.')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})

describe('TaskChecklist', () => {
  function renderChecklist(detail: TaskDetail = task) {
    const update = vi.fn<TaskRepository['update']>(() => Promise.resolve(detail))
    renderWithProviders(<TaskChecklist task={detail} />, fakeRepositories({ tasks: { update } }))
    return { update }
  }

  it('marcar e adicionar item salvam o checklist inteiro', async () => {
    const { update } = renderChecklist()
    expect(screen.getByRole('progressbar', { name: 'Progresso do checklist' })).toHaveAttribute('aria-valuenow', '1')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Revisar' }))
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith('k1', {
        checklist: [
          { id: 'c1', text: 'Escrever', done: true },
          { id: 'c2', text: 'Revisar', done: true },
        ],
      }),
    )
    await userEvent.type(screen.getByRole('textbox', { name: 'Novo item do checklist' }), 'Publicar{Enter}')
    await waitFor(() => expect(update.mock.lastCall?.[1].checklist?.at(-1)).toEqual({ text: 'Publicar', done: false }))
  })

  it('sem permissão de edição, os itens ficam só para leitura', () => {
    renderChecklist({ ...task, capabilities: { ...task.capabilities, edit: false } })
    const list = screen.getAllByRole('checkbox')
    list.forEach((box) => expect(box).toBeDisabled())
    expect(within(document.body).queryByRole('textbox', { name: 'Novo item do checklist' })).not.toBeInTheDocument()
  })
})
