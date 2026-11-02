import { useState } from 'react'
import { beforeAll, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { renderWithProviders } from '@/test/utils'
import { AppSelect } from './AppSelect'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

function Grouped() {
  const [value, setValue] = useState('none')
  return (
    <AppSelect
      label="Elemento"
      searchable
      value={value}
      onValueChange={setValue}
      options={[
        { value: 'none', label: 'Nenhum' },
        { value: 'a', label: 'Kickoff', group: '1.0 Iniciação' },
        { value: 'b', label: 'Cronograma', group: '1.0 Iniciação' },
        { value: 'c', label: 'Plano v6', group: '2.0 Planejamento' },
      ]}
    />
  )
}

describe('AppSelect com busca (design system)', () => {
  it('mostra cabeçalhos de grupo, filtra pelo nome ou pelo grupo e escolhe', async () => {
    renderWithProviders(<Grouped />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Elemento' }))
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByText('1.0 Iniciação')).toBeInTheDocument()
    expect(within(listbox).getByText('2.0 Planejamento')).toBeInTheDocument()
    expect(within(listbox).getAllByRole('option')).toHaveLength(4)

    const search = screen.getByRole('searchbox', { name: 'Buscar' })
    await userEvent.type(search, 'planejamento')
    expect(within(listbox).getAllByRole('option')).toHaveLength(1)
    await userEvent.clear(search)
    await userEvent.type(search, 'crono')
    expect(within(listbox).queryByText('2.0 Planejamento')).not.toBeInTheDocument()
    await userEvent.click(within(listbox).getByRole('button', { name: 'Cronograma' }))
    expect(screen.getByRole('combobox', { name: 'Elemento' })).toHaveTextContent('Cronograma')
  })
})
