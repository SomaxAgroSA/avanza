import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AppAnimatedNumber } from './AppAnimatedNumber'

function mockMotion(reduced: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({ matches: reduced && query.includes('reduce'), media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AppAnimatedNumber', () => {
  it('conta de 0 até o valor e, quando o valor muda, anima do anterior até o novo', async () => {
    mockMotion(false)
    const { rerender } = render(<AppAnimatedNumber value={148} duration={120} />)
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(await screen.findByText('148')).toBeInTheDocument()
    rerender(<AppAnimatedNumber value={20} duration={120} />)
    expect(screen.getByText('148')).toBeInTheDocument()
    expect(await screen.findByText('20')).toBeInTheDocument()
  })

  it('com "reduzir movimento" mostra o valor final na hora, já formatado', () => {
    mockMotion(true)
    render(<AppAnimatedNumber value={37} format={(n) => `${Math.round(n)}%`} />)
    expect(screen.getByText('37%')).toBeInTheDocument()
  })

  it('na impressão termina a contagem antes de imprimir', async () => {
    mockMotion(false)
    render(<AppAnimatedNumber value={9} duration={60_000} />)
    window.dispatchEvent(new Event('beforeprint'))
    await waitFor(() => expect(screen.getByText('9')).toBeInTheDocument())
  })
})
