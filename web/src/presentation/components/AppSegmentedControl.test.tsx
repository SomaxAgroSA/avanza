import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppSegmentedControl } from './AppSegmentedControl'

const options = [
  { value: 'all', label: 'Desde o início' },
  { value: 'year', label: 'Este ano' },
  { value: 'month', label: 'Este mês' },
]

describe('AppSegmentedControl', () => {
  it('grupo de opções exclusivas: marca a escolhida e troca com clique', async () => {
    const onValueChange = vi.fn()
    render(<AppSegmentedControl label="Período" value="all" onValueChange={onValueChange} options={options} />)
    expect(screen.getByRole('radiogroup', { name: 'Período' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Desde o início' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('radio', { name: 'Este ano' }))
    expect(onValueChange).toHaveBeenCalledWith('year')
  })

  it('teclado: só a opção escolhida entra no Tab; as setas andam e escolhem (circular)', async () => {
    const onValueChange = vi.fn()
    render(<AppSegmentedControl label="Período" value="all" onValueChange={onValueChange} options={options} />)
    expect(screen.getByRole('radio', { name: 'Este ano' })).toHaveAttribute('tabindex', '-1')
    await userEvent.tab()
    expect(screen.getByRole('radio', { name: 'Desde o início' })).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(onValueChange).toHaveBeenLastCalledWith('month')
    expect(screen.getByRole('radio', { name: 'Este mês' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onValueChange).toHaveBeenLastCalledWith('all')
  })
})
