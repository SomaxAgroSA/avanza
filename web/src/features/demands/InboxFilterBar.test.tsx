import { useState } from 'react'
import { beforeAll, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { NO_INBOX_FILTERS, type InboxFilters } from '@/domain/demands'
import { InboxFilterBar } from './InboxFilterBar'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

function Bar({ initial = NO_INBOX_FILTERS }: { initial?: InboxFilters }) {
  const [filters, setFilters] = useState(initial)
  return (
    <InboxFilterBar
      filters={filters}
      onChange={setFilters}
      projects={[{ value: 'p1', label: 'Finanças' }]}
      priorities={[
        { value: 'a', label: 'Alta' },
        { value: 'm', label: 'Média' },
      ]}
    />
  )
}

describe('Filtros da Caixa de entrada — padrão da grade (ajuste 25/11)', () => {
  it('parado mostra só o nome; ativo mostra "Nome: valor" em verde suave; Limpar só com filtro ativo', async () => {
    render(<Bar />)
    const bar = screen.getByRole('group', { name: 'Filtros da Bandeja' })
    // a mesma busca da grade (caixa branca com borda) e os botões com borda, sem a cápsula cinza
    expect(within(bar).getByRole('searchbox', { name: 'Buscar' })).toBeInTheDocument()
    expect(bar).not.toHaveClass('bg-surface-2')
    const priority = within(bar).getByRole('button', { name: 'Prioridade' })
    expect(priority).toHaveTextContent(/^Prioridade$/)
    expect(priority).not.toHaveClass('bg-primary-soft')
    expect(within(bar).getByRole('button', { name: 'Projeto' })).toHaveTextContent(/^Projeto$/)
    expect(within(bar).queryByRole('button', { name: 'Limpar' })).toBeNull()

    // vários valores: o menu fica aberto; o botão mostra o primeiro e "+N"
    await userEvent.click(priority)
    await userEvent.click(await screen.findByRole('button', { name: 'Alta', pressed: false }))
    expect(priority).toHaveTextContent(/^Prioridade:\s*Alta$/)
    expect(priority).toHaveClass('bg-primary-soft')
    await userEvent.click(screen.getByRole('button', { name: 'Média', pressed: false }))
    expect(priority).toHaveTextContent(/^Prioridade:\s*Alta \+1$/)
    expect(within(bar).getByRole('button', { name: 'Limpar' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    // um valor só (Projeto): escolher fecha o menu
    const project = within(bar).getByRole('button', { name: 'Projeto' })
    await userEvent.click(project)
    await userEvent.click(await screen.findByRole('button', { name: 'Finanças', pressed: false }))
    expect(project).toHaveTextContent(/^Projeto:\s*Finanças$/)
    expect(screen.queryByRole('dialog', { name: 'Projeto' })).toBeNull()

    // Limpar tira todos e some
    await userEvent.click(within(bar).getByRole('button', { name: 'Limpar' }))
    expect(priority).toHaveTextContent(/^Prioridade$/)
    expect(project).toHaveTextContent(/^Projeto$/)
    expect(within(bar).queryByRole('button', { name: 'Limpar' })).toBeNull()
  })

  it('texto na busca já conta como filtro ativo (Limpar aparece) e o ✕ apaga a busca', async () => {
    render(<Bar />)
    const bar = screen.getByRole('group', { name: 'Filtros da Bandeja' })
    await userEvent.type(within(bar).getByRole('searchbox', { name: 'Buscar' }), 'dre')
    expect(within(bar).getByRole('button', { name: 'Limpar' })).toBeInTheDocument()
    await userEvent.click(within(bar).getByRole('button', { name: 'Limpar busca' }))
    expect(within(bar).getByRole('searchbox', { name: 'Buscar' })).toHaveValue('')
    expect(within(bar).queryByRole('button', { name: 'Limpar' })).toBeNull()
  })
})
