import { useState } from 'react'
import { beforeAll, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { renderWithProviders } from '@/test/utils'
import { AppMultiSelect } from './AppMultiSelect'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const OPTIONS = [
  { value: 'p1', label: 'CRM · Novo CRM' },
  { value: 'p2', label: 'LOG · Logística' },
  { value: 'p3', label: 'APP · App do produtor' },
]

function Summary({ initial = [] as string[] }) {
  const [value, setValue] = useState<string[]>(initial)
  return (
    <AppMultiSelect
      label="Projetos"
      display="summary"
      allOptionLabel="Todos os projetos"
      summary={(count) => `${count} projetos selecionados`}
      value={value}
      onValueChange={setValue}
      options={OPTIONS}
    />
  )
}

describe('AppMultiSelect — resumo', () => {
  it('campo como um select comum: nada → "todos", um → o nome, vários → o resumo (sem chips)', async () => {
    renderWithProviders(<Summary />)
    const field = screen.getByRole('combobox', { name: 'Projetos Todos os projetos' })
    expect(within(field).queryByRole('button')).not.toBeInTheDocument()

    await userEvent.click(field)
    const list = await screen.findByRole('listbox')
    const options = within(list).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Todos os projetos', 'CRM · Novo CRM', 'LOG · Logística', 'APP · App do produtor'])
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(within(options[1]!).getByRole('button'))
    expect(screen.getByRole('combobox', { name: 'Projetos CRM · Novo CRM' })).toBeInTheDocument()
    expect(within(list).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'false')

    await userEvent.click(within(within(list).getAllByRole('option')[2]!).getByRole('button'))
    expect(screen.getByRole('combobox', { name: 'Projetos 2 projetos selecionados' })).toBeInTheDocument()
  })

  it('"todos" limpa a seleção; desmarcar na lista tira o item', async () => {
    renderWithProviders(<Summary initial={['p1', 'p2', 'p3']} />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Projetos 3 projetos selecionados' }))
    const list = await screen.findByRole('listbox')
    await userEvent.click(within(within(list).getByRole('option', { name: 'LOG · Logística' })).getByRole('button'))
    expect(screen.getByRole('combobox', { name: 'Projetos 2 projetos selecionados' })).toBeInTheDocument()
    await userEvent.click(within(within(list).getByRole('option', { name: 'Todos os projetos' })).getByRole('button'))
    expect(screen.getByRole('combobox', { name: 'Projetos Todos os projetos' })).toBeInTheDocument()
    expect(within(list).getByRole('option', { name: 'Todos os projetos' })).toHaveAttribute('aria-selected', 'true')
  })

  it('teclado: as setas descem do "todos" para os projetos e Enter marca', async () => {
    renderWithProviders(<Summary />)
    screen.getByRole('combobox').focus()
    await userEvent.keyboard('{Enter}')
    const list = await screen.findByRole('listbox')
    const all = within(within(list).getByRole('option', { name: 'Todos os projetos' })).getByRole('button')
    all.focus()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(screen.getByRole('combobox', { name: 'Projetos CRM · Novo CRM' })).toBeInTheDocument()
  })

  it('o modo padrão continua com chips removíveis', () => {
    renderWithProviders(<AppMultiSelect label="Tags" value={['p1']} onValueChange={() => {}} options={OPTIONS} />)
    expect(screen.getByRole('button', { name: 'Remover CRM · Novo CRM' })).toBeInTheDocument()
  })
})
