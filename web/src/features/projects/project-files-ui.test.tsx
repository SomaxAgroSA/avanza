import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { ProjectFile } from '@/domain/attachments'
import type { Project } from '@/domain/projects'
import type { ProjectFileRepository } from '@/domain/repositories'
import { fakeRepositories, renderWithProviders } from '@/test/utils'
import { ProjectFilesPanel } from './ProjectFilesPanel'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

function file(overrides: Partial<ProjectFile>): ProjectFile {
  return {
    id: 'f1',
    projectId: 'p1',
    name: 'contrato.pdf',
    mime: 'application/pdf',
    kind: 'document',
    size: 1536,
    uploadedBy: { id: 'u1', name: 'Mário', email: 'm@x.com', avatarUrl: null },
    createdAt: new Date('2026-10-28T10:00:00Z'),
    url: '/api/v1/project-files/f1/file',
    capabilities: { delete: true },
    ...overrides,
  }
}

const list = [file({}), file({ id: 'f2', name: 'logo.png', mime: 'image/png', kind: 'image', url: '/api/v1/project-files/f2/file' })]

function project(uploadFiles: boolean): Project {
  return { id: 'p1', capabilities: { edit: false, manageMembers: false, archive: false, delete: false, transfer: false, uploadFiles } } as Project
}

function setup(canUpload = true, overrides: Partial<ProjectFileRepository> = {}) {
  const upload = vi.fn<ProjectFileRepository['upload']>(() => Promise.resolve([file({ id: 'f9' })]))
  const remove = vi.fn<ProjectFileRepository['remove']>(() => Promise.resolve())
  renderWithProviders(<ProjectFilesPanel project={project(canUpload)} />, fakeRepositories({ projectFiles: { list: () => Promise.resolve(list), upload, remove, ...overrides } }))
  return { upload, remove }
}

describe('ProjectFilesPanel', () => {
  it('lista imagens e documentos do projeto com download protegido', async () => {
    setup()
    expect(await screen.findByText('Imagens (1)')).toBeInTheDocument()
    expect(screen.getByText('Documentos (1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Baixar contrato.pdf' })).toHaveAttribute('href', '/api/v1/project-files/f1/file?download=1')
  })

  it('envia um arquivo por vez ao projeto e recusa no navegador o tipo proibido', async () => {
    const { upload } = setup()
    await screen.findByText('Imagens (1)')
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    const pdf = new File(['%PDF-1.4'], 'ata.pdf', { type: 'application/pdf' })
    const exe = new File(['MZ'], 'setup.exe', { type: 'application/octet-stream' })
    fireEvent.change(input, { target: { files: [pdf, exe] } })
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    expect(upload.mock.calls[0]?.[0]).toBe('p1')
    expect(upload.mock.calls[0]?.[1].name).toBe('ata.pdf')
    expect(await screen.findByText(/Tipo de arquivo não permitido/)).toBeInTheDocument()
  })

  it('sem permissão de enviar: só a lista, sem área de envio', async () => {
    setup(false)
    await screen.findByText('Imagens (1)')
    expect(document.querySelector('input[type=file]')).toBeNull()
  })

  it('vazio: convida a enviar (ou avisa que aparecem aqui, para quem só vê)', async () => {
    setup(true, { list: () => Promise.resolve([]) })
    expect(await screen.findByText('Nenhum arquivo no projeto')).toBeInTheDocument()
    expect(screen.getByText('Arraste arquivos para cá ou clique para escolher.')).toBeInTheDocument()
  })

  it('excluir pede confirmação', async () => {
    const { remove } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Excluir contrato.pdf' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Excluir o arquivo "contrato.pdf"?')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('f1'))
  })
})
