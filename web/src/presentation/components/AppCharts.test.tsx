import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { AppBarList, AppDonut, AppMeter, AppMetric, AppSparkline, AppStackedBar, AppTrendChart } from './AppCharts'

describe('AppBarList', () => {
  it('uma linha por item com o valor formatado; o detalhe fica numa linha própria sob o rótulo', () => {
    render(
      <AppBarList
        label="Recursos"
        items={[
          { key: 'a', label: 'Gerente de Projetos', detail: '2 pendentes · 24 h', value: 4 },
          { key: 'b', label: 'Cliente', value: 3 },
        ]}
        formatValue={(v) => `${v} elementos`}
      />,
    )
    const rows = within(screen.getByRole('list', { name: 'Recursos' })).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(screen.getByText('Gerente de Projetos').parentElement).toContainElement(screen.getByText('2 pendentes · 24 h'))
    expect(screen.getByText('Gerente de Projetos')).not.toContainElement(screen.getByText('2 pendentes · 24 h'))
    expect(within(rows[1]!).getByText('3 elementos')).toBeInTheDocument()
  })

  it('sem valores mostra o vazio', () => {
    render(<AppBarList label="Recursos" items={[{ key: 'a', label: 'X', value: 0 }]} empty="Nada ainda" />)
    expect(screen.getByText('Nada ainda')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})

describe('AppDonut', () => {
  it('descreve as fatias no nome acessível, ignora as vazias e mostra o centro', () => {
    render(
      <AppDonut
        label="Saúde"
        segments={[
          { key: 'ok', label: 'Em dia', value: 3, tone: 'success' },
          { key: 'critical', label: 'Crítico', value: 1, tone: 'danger' },
          { key: 'none', label: 'Sem quadro', value: 0, tone: 'neutral' },
        ]}
      >
        <span>4</span>
      </AppDonut>,
    )
    const figure = screen.getByRole('img', { name: 'Saúde: Em dia 3, Crítico 1' })
    expect(figure.querySelectorAll('[data-segment]')).toHaveLength(2)
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('sem valores desenha só o trilho', () => {
    render(<AppDonut label="Saúde" segments={[{ key: 'ok', label: 'Em dia', value: 0, tone: 'success' }]} />)
    expect(screen.getByRole('img', { name: 'Saúde' }).querySelectorAll('[data-segment]')).toHaveLength(0)
  })
})

describe('AppStackedBar', () => {
  it('uma faixa por parte com valor e a legenda com os números (a cor nunca sozinha)', () => {
    render(
      <AppStackedBar
        label="Tarefas por etapa"
        segments={[
          { key: 'a', label: 'Backlog', value: 4, tone: 'neutral' },
          { key: 'b', label: 'Em andamento', value: 0, tone: 'accent' },
          { key: 'c', label: 'Concluída', value: 12, tone: 'primary' },
        ]}
        formatValue={(v) => `${v} tarefas`}
      />,
    )
    expect(screen.getByRole('img', { name: 'Tarefas por etapa: Backlog 4 tarefas, Em andamento 0 tarefas, Concluída 12 tarefas' }).querySelectorAll('[data-segment]')).toHaveLength(2)
    const legend = within(screen.getByRole('list', { name: 'Tarefas por etapa' })).getAllByRole('listitem')
    expect(legend).toHaveLength(3)
    expect(legend[2]).toHaveTextContent('Concluída12 tarefas')
  })
})

describe('AppSparkline', () => {
  it('linha da série com nome acessível; com menos de dois pontos não desenha', () => {
    const { container, rerender } = render(<AppSparkline label="Entregas por mês" values={[1, 4, 2]} />)
    expect(screen.getByRole('img', { name: 'Entregas por mês' })).toBeInTheDocument()
    expect(container.querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(3)
    rerender(<AppSparkline label="Entregas por mês" values={[3]} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

describe('AppMetric', () => {
  it('rótulo, valor no tom pedido e o apoio', () => {
    render(<AppMetric label="Atrasos" value={7} tone="danger" hint="4 tarefas · 3 elementos" />)
    expect(screen.getByText('7')).toHaveClass('text-danger')
    expect(screen.getByText('Atrasos')).toBeInTheDocument()
    expect(screen.getByText('4 tarefas · 3 elementos')).toBeInTheDocument()
  })
})

describe('AppTrendChart', () => {
  it('empilhado: as duas séries na mesma coluna e a tabela acessível com os valores', () => {
    const { container } = render(
      <AppTrendChart
        stacked
        title="Entregas"
        seriesA="Tarefas"
        seriesB="Elementos"
        points={[
          { key: '1', label: 'set', a: 3, b: 1 },
          { key: '2', label: 'out', a: 0, b: 2 },
        ]}
      />,
    )
    expect(container.querySelectorAll('[data-stack]')).toHaveLength(2)
    const table = screen.getByRole('table', { name: 'Entregas' })
    expect(within(table).getAllByRole('row')).toHaveLength(3)
  })
})

describe('AppMeter', () => {
  it('barra de progresso acessível, limitada a 0–100', () => {
    render(<AppMeter label="Progresso do CRM" value={140} />)
    const bar = screen.getByRole('progressbar', { name: 'Progresso do CRM' })
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(bar.firstElementChild).toHaveStyle({ width: '100%' })
  })
})
