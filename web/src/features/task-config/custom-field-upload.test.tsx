import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { renderWithProviders } from '@/test/utils'
import type { CustomField, FieldValue } from '@/domain/task-config'
import { CustomFieldInput, type HeldFieldFiles } from './CustomFieldInput'
import type { FieldOptionCreator } from './use-field-option-creator'

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
    expect(uploadFiles).toHaveBeenCalledWith([file], 'evidencias', false)
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

  it('na criação: os arquivos escolhidos ficam listados no campo (cada um sai pelo X) e nada é enviado ainda', async () => {
    const add = vi.fn()
    function Held() {
      const [files, setFiles] = useState<Record<string, File[]>>({})
      const held: HeldFieldFiles = {
        files,
        add: (name, chosen, imagesOnly) => {
          add(name, chosen, imagesOnly)
          setFiles((current) => ({ ...current, [name]: [...(current[name] ?? []), ...chosen] }))
        },
        remove: (name, index) => setFiles((current) => ({ ...current, [name]: (current[name] ?? []).filter((_, i) => i !== index) })),
      }
      return <CustomFieldInput field={field('image')} value={undefined} onChange={() => {}} required references={{ heldFiles: held }} />
    }
    const { container } = renderWithProviders(<Held />)
    expect(screen.getByText('Enviados logo depois de criar a tarefa.')).toBeInTheDocument()
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    const prints = [new File(['png'], 'tela-1.png', { type: 'image/png' }), new File(['png'], 'tela-2.png', { type: 'image/png' })]
    await userEvent.upload(input, prints)
    expect(add).toHaveBeenCalledWith('evidencias', prints, true)
    expect(await screen.findByText('tela-1.png')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remover tela-1.png' }))
    expect(screen.queryByText('tela-1.png')).not.toBeInTheDocument()
    expect(screen.getByText('tela-2.png')).toBeInTheDocument()
  })
})

describe('campo de seleção com "Adicionar opção"', () => {
  const sistemas = (config: CustomField['config']) =>
    ({
      id: 'f3',
      name: 'sistemas',
      label: 'Sistemas',
      type: 'multiselect',
      description: '',
      config,
      options: [{ id: 'o1', label: 'ERP', color: 'blue', order: 0, isActive: true }],
    }) as unknown as CustomField

  function Field({ config, createOption }: { config: CustomField['config']; createOption?: FieldOptionCreator }) {
    const [value, setValue] = useState<FieldValue>([])
    const [current, setCurrent] = useState(sistemas(config))
    const create: FieldOptionCreator | undefined =
      createOption &&
      (async (f, label) => {
        const option = await createOption(f, label)
        if (option) setCurrent((c) => ({ ...c, options: [...c.options, option] }))
        return option
      })
    return <CustomFieldInput field={current} value={value} onChange={setValue} references={{ createOption: create }} />
  }

  it('campo que permite: cria a opção pela busca e já a seleciona', async () => {
    const createOption = vi.fn<FieldOptionCreator>(async () => ({ id: 'o9', label: 'CRM', color: 'indigo', order: 1, isActive: true }))
    renderWithProviders(<Field config={{ allow_create_options: true }} createOption={createOption} />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Sistemas' }))
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Buscar' }), 'CRM')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar “CRM”' }))
    expect(createOption).toHaveBeenCalledWith(expect.objectContaining({ id: 'f3', label: 'Sistemas' }), 'CRM')
    await waitFor(() => expect(within(screen.getByRole('listbox')).getByRole('option', { name: 'CRM' })).toHaveAttribute('aria-selected', 'true'))
  })

  it('sem a configuração ligada (ou sem quem crie), não oferece "Adicionar"', async () => {
    const createOption = vi.fn<FieldOptionCreator>()
    const { unmount } = renderWithProviders(<Field config={{}} createOption={createOption} />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Sistemas' }))
    expect(await screen.findByRole('option', { name: 'ERP' })).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    unmount()
    renderWithProviders(<Field config={{ allow_create_options: true }} />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Sistemas' }))
    expect(await screen.findByRole('option', { name: 'ERP' })).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })
})
