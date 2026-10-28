import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { renderWithProviders } from '@/test/utils'
import { AppMultiSelect } from './AppMultiSelect'
import { AppSelect } from './AppSelect'
import type { CreateOptionHandler } from './option-picker'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const OPTIONS = [
  { value: 'o1', label: 'Crítica' },
  { value: 'o2', label: 'Média' },
]

/** Seleção múltipla controlada: a opção criada entra na lista, como faz o cache das consultas. */
function Multi({ onCreate }: { onCreate: CreateOptionHandler }) {
  const [value, setValue] = useState<string[]>(['o2'])
  const [options, setOptions] = useState(OPTIONS)
  return (
    <AppMultiSelect
      label="Severidade"
      value={value}
      onValueChange={setValue}
      options={options}
      onCreateOption={async (label) => {
        const created = await onCreate(label)
        if (created) setOptions((list) => [...list, { value: created, label }])
        return created
      }}
    />
  )
}

function Single({ onCreate, onChange }: { onCreate?: CreateOptionHandler; onChange?: (value: string) => void }) {
  const [value, setValue] = useState<string | undefined>(undefined)
  const [options, setOptions] = useState(OPTIONS)
  return (
    <AppSelect
      label="Canal"
      placeholder="Selecione"
      value={value}
      onValueChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
      options={options}
      onCreateOption={
        onCreate &&
        (async (label) => {
          const created = await onCreate(label)
          if (created) setOptions((list) => [...list, { value: created, label }])
          return created
        })
      }
    />
  )
}

describe('seleção com "Adicionar opção" (design system)', () => {
  it('múltipla: busca sem opção igual mostra "Adicionar"; opção igual (maiúsculas e acentos à parte) não', async () => {
    const onCreate = vi.fn<CreateOptionHandler>(async () => 'o9')
    renderWithProviders(<Multi onCreate={onCreate} />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Severidade' }))
    const search = await screen.findByRole('searchbox', { name: 'Buscar' })
    expect(search).toHaveFocus()

    await userEvent.type(search, 'CRITICA')
    const listbox = screen.getByRole('listbox')
    expect(within(listbox).getByRole('option', { name: 'Crítica' })).toBeInTheDocument()
    expect(within(listbox).queryByRole('button', { name: /Adicionar/ })).not.toBeInTheDocument()

    await userEvent.clear(search)
    await userEvent.type(search, '  Bloqueante ')
    await userEvent.click(within(listbox).getByRole('button', { name: 'Adicionar “Bloqueante”' }))
    expect(onCreate).toHaveBeenCalledWith('Bloqueante')
    // a nova entra selecionada, junto com a que já estava
    await waitFor(() => expect(within(listbox).getByRole('option', { name: 'Bloqueante' })).toHaveAttribute('aria-selected', 'true'))
    expect(within(listbox).getByRole('option', { name: 'Média' })).toHaveAttribute('aria-selected', 'true')
    expect(search).toHaveValue('')
  })

  it('múltipla, pelo teclado: Enter cria; falha (null) mantém o texto e não seleciona; setas andam pela lista', async () => {
    const onCreate = vi.fn<CreateOptionHandler>().mockResolvedValueOnce(null).mockResolvedValueOnce('o9')
    renderWithProviders(<Multi onCreate={onCreate} />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Severidade' }))
    const search = await screen.findByRole('searchbox', { name: 'Buscar' })
    await userEvent.type(search, 'Nova{Enter}')
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    expect(search).toHaveValue('Nova')
    expect(screen.getByRole('button', { name: 'Adicionar “Nova”' })).toBeEnabled()

    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: 'Adicionar “Nova”' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('option', { name: 'Nova' })).toHaveAttribute('aria-selected', 'true'))
    expect(onCreate).toHaveBeenLastCalledWith('Nova')
  })

  it('única: com criação, a lista tem busca; criar escolhe a nova e fecha', async () => {
    const onCreate = vi.fn<CreateOptionHandler>(async () => 'o9')
    const onChange = vi.fn()
    renderWithProviders(<Single onCreate={onCreate} onChange={onChange} />)
    const trigger = screen.getByRole('combobox', { name: 'Canal' })
    expect(trigger).toHaveTextContent('Selecione')
    await userEvent.click(trigger)
    // Enter com o texto igual a uma opção escolhe a opção (não cria)
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Buscar' }), 'media{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('o2')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())

    await userEvent.click(trigger)
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Buscar' }), 'Telefone{Enter}')
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('o9'))
    expect(onCreate).toHaveBeenCalledWith('Telefone')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(trigger).toHaveTextContent('Telefone')
  })

  it('única sem criação continua o Select comum (sem busca)', async () => {
    renderWithProviders(<Single />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Canal' }))
    expect(await screen.findByRole('option', { name: 'Crítica' })).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })
})
