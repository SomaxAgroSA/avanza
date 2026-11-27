import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppMarkdown } from './AppMarkdown'

describe('AppMarkdown', () => {
  it('formata negrito, itálico, código e listas', () => {
    const { container } = render(<AppMarkdown text={'Texto **forte** e *leve* com `code`\n\n- um\n- dois\n\n1. primeiro'} />)
    expect(screen.getByText('forte').tagName).toBe('STRONG')
    expect(screen.getByText('leve').tagName).toBe('EM')
    expect(screen.getByText('code').tagName).toBe('CODE')
    expect(container.querySelectorAll('ul li')).toHaveLength(2)
    expect(container.querySelectorAll('ol li')).toHaveLength(1)
  })

  it('links só com http(s); nunca HTML cru', () => {
    const { container } = render(<AppMarkdown text={'[site](https://kamban.dev) [mal](javascript:alert(1)) <img src=x onerror=alert(1)>'} />)
    const link = screen.getByRole('link', { name: 'site' })
    expect(link).toHaveAttribute('href', 'https://kamban.dev')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.queryByRole('link', { name: 'mal' })).not.toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('menções viram destaque com o nome', () => {
    render(<AppMarkdown text="Oi @[Carla Mendes](u7), veja" />)
    expect(screen.getByText('@Carla Mendes')).toBeInTheDocument()
  })
})

describe('AppMarkdown — formato do editor (§53)', () => {
  it('títulos, sublinhado, destaque, citação, separador e bloco de código', () => {
    const { container } = render(<AppMarkdown text={'## Passos\n\n<u>sub</u> e ==marca==\n\n> citado\n\n---\n\n```\nnpm test\n```'} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Passos' })).toBeInTheDocument()
    expect(screen.getByText('sub').tagName).toBe('U')
    expect(screen.getByText('marca').tagName).toBe('MARK')
    expect(container.querySelector('blockquote')).toHaveTextContent('citado')
    expect(container.querySelector('hr')).not.toBeNull()
    expect(container.querySelector('pre code')).toHaveTextContent('npm test')
  })

  it('lista de verificação só de leitura e tabela', () => {
    render(<AppMarkdown text={'- [x] feito\n- [ ] falta\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'} />)
    const [done, todo] = screen.getAllByRole('checkbox')
    expect(done).toBeChecked()
    expect(done).toBeDisabled()
    expect(todo).not.toBeChecked()
    expect(screen.getByRole('table')).toHaveTextContent('AB12')
  })

  it('imagem só dos anexos da tarefa; de fora vira link', () => {
    render(<AppMarkdown text={'![print](/api/v1/attachments/abc123def456ghi/file)\n\n![fora](https://exemplo.com/x.png)'} />)
    expect(screen.getByRole('img', { name: 'print' })).toHaveAttribute('src', '/api/v1/attachments/abc123def456ghi/file')
    expect(screen.queryByRole('img', { name: 'fora' })).toBeNull()
    expect(screen.getByRole('link', { name: 'fora' })).toHaveAttribute('href', 'https://exemplo.com/x.png')
  })

  it('texto antigo: nova linha simples continua quebra de linha; "#" sem espaço não é título', () => {
    const { container } = render(<AppMarkdown text={'linha 1\nlinha 2\n#1 da fila'} />)
    expect(container.querySelectorAll('p')).toHaveLength(1)
    expect(container.querySelectorAll('br')).toHaveLength(2)
    expect(screen.queryByRole('heading')).toBeNull()
  })
})
