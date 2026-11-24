import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppEmailChips } from './AppEmailChips'

function Field({ initial = [], max, suggestions }: { initial?: string[]; max?: number; suggestions?: string[] }) {
  const [value, setValue] = useState<string[]>(initial)
  return (
    <>
      <AppEmailChips label="Com cópia" value={value} onChange={setValue} max={max} suggestions={suggestions} suggestionsLabel="Usados antes:" removeLabel={(email) => `Tirar ${email}`} />
      <output data-testid="value">{value.join('|')}</output>
    </>
  )
}
const value = () => screen.getByTestId('value').textContent

describe('AppEmailChips', () => {
  it('Enter, vírgula e sair do campo confirmam o endereço (sem espaços, em minúsculas, sem repetir)', async () => {
    render(<Field />)
    const input = screen.getByLabelText('Com cópia')
    await userEvent.type(input, ' Suporte@Empresa.com{Enter}')
    expect(value()).toBe('suporte@empresa.com')
    await userEvent.type(input, 'mesa@empresa.com,')
    await userEvent.type(input, 'suporte@empresa.com;')
    expect(value()).toBe('suporte@empresa.com|mesa@empresa.com')
    await userEvent.type(input, 'outra@empresa.com')
    await userEvent.tab()
    expect(value()).toBe('suporte@empresa.com|mesa@empresa.com|outra@empresa.com')
    expect(input).toHaveValue('')
  })

  it('o que não é e-mail fica no campo, com o aviso, e nada entra; corrigir tira o aviso', async () => {
    render(<Field />)
    const input = screen.getByLabelText('Com cópia')
    await userEvent.type(input, 'suporte{Enter}')
    expect(value()).toBe('')
    expect(input).toHaveValue('suporte')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await userEvent.type(input, '@empresa.com')
    expect(screen.queryByRole('alert')).toBeNull()
    await userEvent.keyboard('{Enter}')
    expect(value()).toBe('suporte@empresa.com')
  })

  it('tirar pelo ✕ e pelo Backspace com o campo vazio; colar vários de uma vez', async () => {
    render(<Field initial={['a@x.com', 'b@x.com']} />)
    await userEvent.click(screen.getByRole('button', { name: 'Tirar a@x.com' }))
    expect(value()).toBe('b@x.com')
    const input = screen.getByLabelText('Com cópia')
    await userEvent.click(input)
    await userEvent.keyboard('{Backspace}')
    expect(value()).toBe('')
    await userEvent.paste('c@x.com; d@x.com\ne@x.com')
    expect(value()).toBe('c@x.com|d@x.com|e@x.com')
  })

  it('os usados antes entram com um clique e somem da lista; no limite, o campo de digitar some', async () => {
    render(<Field max={2} suggestions={['suporte@empresa.com', 'mesa@empresa.com', 'outra@empresa.com']} />)
    expect(screen.getByText('Usados antes:')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '+ suporte@empresa.com' }))
    expect(value()).toBe('suporte@empresa.com')
    expect(screen.queryByRole('button', { name: '+ suporte@empresa.com' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '+ mesa@empresa.com' }))
    expect(value()).toBe('suporte@empresa.com|mesa@empresa.com')
    expect(screen.queryByLabelText('Com cópia')).toBeNull()
    expect(screen.queryByText('Usados antes:')).toBeNull()
  })
})
