import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AppNavTabs } from './AppNavTabs'

function setup(variant: 'line' | 'pill') {
  const Tabs = () => (
    <AppNavTabs
      aria-label="Projeto"
      variant={variant}
      items={[
        { key: 'a', to: '/a', label: 'Visão geral', active: true },
        { key: 'b', to: '/b', label: 'Membros', active: false },
      ]}
    />
  )
  const router = createMemoryRouter(
    [
      { path: '/a', element: <Tabs /> },
      { path: '/b', element: <Tabs /> },
    ],
    { initialEntries: ['/a'] },
  )
  render(<RouterProvider router={router} />)
  return router
}

describe('AppNavTabs', () => {
  it.each(['line', 'pill'] as const)('abas são links com a aberta marcada (%s); clicar navega', async (variant) => {
    const router = setup(variant)
    const nav = screen.getByRole('navigation', { name: 'Projeto' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Visão geral' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Membros' })).not.toHaveAttribute('aria-current')
    await userEvent.click(screen.getByRole('link', { name: 'Membros' }))
    expect(router.state.location.pathname).toBe('/b')
  })
})
