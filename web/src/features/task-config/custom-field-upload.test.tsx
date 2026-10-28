import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { renderWithProviders } from '@/test/utils'
import type { CustomField } from '@/domain/task-config'
import { CustomFieldInput } from './CustomFieldInput'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const field = (type: 'file' | 'image') =>
  ({ id: 'f9', name: 'evidencias', label: 'Evidências', type, description: '', config: {}, options: [] }) as unknown as CustomField

describe('campo de arquivo/imagem com envio direto', () => {
  it('sem anexos na tarefa, envia o arquivo pelo próprio campo e já o seleciona', async () => {
    const uploadFiles = vi.fn(async () => ['a9'])
    const onChange = vi.fn()
    const { container } = renderWithProviders(
      <CustomFieldInput field={field('file')} value={['a1']} onChange={onChange} required references={{ attachments: [], uploadFiles }} />,
    )
    const button = screen.getByRole('button', { name: 'Enviar arquivo' })
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    await userEvent.click(button)
    expect(click).toHaveBeenCalled()
    const file = new File(['%PDF-1.4'], 'ata.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(['a1', 'a9']))
    expect(uploadFiles).toHaveBeenCalledWith([file], 'evidencias')
  })

  it('campo de imagem aceita só imagens no seletor; sem envio disponível, não mostra o botão', () => {
    const { container, unmount } = renderWithProviders(
      <CustomFieldInput field={field('image')} value={[]} onChange={() => {}} references={{ attachments: [], uploadFiles: async () => [] }} />,
    )
    expect(screen.getByRole('button', { name: 'Enviar imagem' })).toBeInTheDocument()
    expect(container.querySelector('input[type=file]')).toHaveAttribute('accept', 'image/*')
    unmount()
    renderWithProviders(<CustomFieldInput field={field('file')} value={[]} onChange={() => {}} references={{ attachments: [] }} />)
    expect(screen.queryByRole('button', { name: 'Enviar arquivo' })).not.toBeInTheDocument()
  })
})
