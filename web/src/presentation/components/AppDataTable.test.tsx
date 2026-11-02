import { useEffect } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { renderWithProviders } from '@/test/utils'
import { AppDataTable, type DataTableColumn } from './AppDataTable'
import { useDataTableState, type DataTableStateApi } from './data-table/use-data-table-state'

interface Row {
  id: string
  name: string
  status: string
}

const rows: Row[] = [
  { id: '1', name: 'Alfa', status: 'active' },
  { id: '2', name: 'Beta', status: 'disabled' },
]

const columns: DataTableColumn<Row>[] = [
  { id: 'name', header: 'Nome', sortable: true, cell: (r) => r.name },
  {
    id: 'status',
    header: 'Status',
    cell: (r) => r.status,
    filter: { label: 'Status', options: [{ value: 'active', label: 'Ativo' }] },
  },
]

/** Acesso ao estado da tabela a partir dos testes. */
const handle: { api: DataTableStateApi | null } = { api: null }

function Harness(props: { data?: Row[]; loading?: boolean; error?: boolean; onView?: (r: Row) => void; onEdit?: (r: Row) => void; onOpen?: (r: Row) => void }) {
  const api = useDataTableState('test-table')
  useEffect(() => {
    handle.api = api
  })
  return (
    <AppDataTable
      caption="Tabela de teste"
      columns={columns}
      data={props.data ?? rows}
      total={(props.data ?? rows).length}
      getRowId={(r) => r.id}
      table={api}
      loading={props.loading}
      error={props.error ? { correlationId: 'corr-1' } : null}
      onRetry={() => {}}
      actions={{ onView: props.onView ?? (() => {}), onOpen: props.onOpen, onEdit: props.onEdit ?? (() => {}), canEdit: (r) => r.id === '1' }}
    />
  )
}

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

beforeEach(() => {
  window.localStorage.clear()
})

describe('AppDataTable', () => {
  it('renderiza linhas, contador total e ações padrão', () => {
    renderWithProviders(<Harness />)
    const table = screen.getByRole('table', { name: 'Tabela de teste' })
    expect(within(table).getByText('Alfa')).toBeInTheDocument()
    expect(screen.getByText('1–2 de 2')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Visualizar' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Mais ações' })).toHaveLength(2)
  })

  it('desabilita "Editar" quando a linha não permite', () => {
    renderWithProviders(<Harness />)
    const [editAlfa, editBeta] = screen.getAllByRole('button', { name: 'Editar' })
    expect(editAlfa).toBeEnabled()
    expect(editBeta).toBeDisabled()
  })

  it('clique na linha abre "Visualizar"', async () => {
    const onView = vi.fn()
    renderWithProviders(<Harness onView={onView} />)
    await userEvent.click(screen.getByText('Beta'))
    expect(onView).toHaveBeenCalledWith(rows[1])
  })

  it('com "abrir": clique simples visualiza (depois de um instante); duplo clique abre a página, sem visualizar', async () => {
    const onView = vi.fn()
    const onOpen = vi.fn()
    renderWithProviders(<Harness onView={onView} onOpen={onOpen} />)
    await userEvent.dblClick(screen.getByText('Beta'))
    expect(onOpen).toHaveBeenCalledWith(rows[1])
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(onView).not.toHaveBeenCalled()
    await userEvent.click(screen.getByText('Alfa'))
    await waitFor(() => expect(onView).toHaveBeenCalledWith(rows[0]))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('ordenação alterna asc/desc e é persistida', async () => {
    renderWithProviders(<Harness />)
    const header = screen.getByRole('button', { name: /Nome/ })
    await userEvent.click(header)
    expect(handle.api!.state.sort).toEqual({ id: 'name', direction: 'asc' })
    expect(screen.getByRole('columnheader', { name: /Nome/ })).toHaveAttribute('aria-sort', 'ascending')
    await userEvent.click(header)
    expect(handle.api!.state.sort).toEqual({ id: 'name', direction: 'desc' })
    expect(JSON.parse(window.localStorage.getItem('kamban.table.test-table') ?? '{}').sort).toEqual({ id: 'name', direction: 'desc' })
  })

  it('busca com debounce volta para a página 1 e mantém o estado salvo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderWithProviders(<Harness />)
    act(() => handle.api!.setPage(3))
    await userEvent.type(screen.getByRole('searchbox'), 'alf')
    expect(handle.api!.state.search).toBe('')
    act(() => {
      vi.advanceTimersByTime(350)
    })
    expect(handle.api!.state.search).toBe('alf')
    expect(handle.api!.state.page).toBe(1)
    expect(JSON.parse(window.localStorage.getItem('kamban.table.test-table') ?? '{}').search).toBe('alf')
    vi.useRealTimers()
  })

  it('mostra estado vazio com opção de limpar filtros', async () => {
    renderWithProviders(<Harness data={[]} />)
    act(() => handle.api!.setFilter('status', 'active'))
    expect(await screen.findByText('Nenhum resultado para os filtros')).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Limpar filtros' })[0]!)
    expect(handle.api!.state.filters).toEqual({})
  })

  it('mostra estado de erro com referência para suporte', () => {
    renderWithProviders(<Harness error />)
    expect(screen.getByRole('alert')).toHaveTextContent('corr-1')
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
  })

  it('mostra skeleton durante o primeiro carregamento', () => {
    const { container } = renderWithProviders(<Harness data={[]} loading />)
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
  })
})

describe('AppDataTable — embutida', () => {
  function Plain() {
    const api = useDataTableState('plain-table', { sort: null })
    return (
      <AppDataTable
        caption="Embutida"
        columns={[{ id: 'name', header: 'Nome', hideable: false, cell: (r: Row) => r.name }]}
        data={rows}
        total={rows.length}
        getRowId={(r) => r.id}
        table={api}
        searchable={false}
        paginated={false}
        bordered={false}
      />
    )
  }

  it('sem busca, filtros nem colunas para escolher: sem barra de ferramentas; sem moldura própria', () => {
    const { container } = renderWithProviders(<Plain />)
    expect(screen.getByRole('table', { name: 'Embutida' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(container.querySelector('.shadow-card')).toBeNull()
    expect(container.firstElementChild?.childElementCount).toBe(1)
  })
})

describe('AppDataTable — clique na linha', () => {
  function Clickable({ onRowClick }: { onRowClick: (row: Row) => void }) {
    const api = useDataTableState('click-table', { sort: null })
    return (
      <AppDataTable
        caption="Clicável"
        columns={[{ id: 'name', header: 'Nome', hideable: false, cell: (r: Row) => <a href={`#${r.id}`}>{r.name}</a> }, { id: 'status', header: 'Status', hideable: false, cell: (r: Row) => r.status }]}
        data={rows}
        total={rows.length}
        getRowId={(r) => r.id}
        table={api}
        searchable={false}
        paginated={false}
        onRowClick={onRowClick}
      />
    )
  }

  it('a linha inteira abre o registro; o link da linha segue com o próprio clique', async () => {
    const onRowClick = vi.fn()
    renderWithProviders(<Clickable onRowClick={onRowClick} />)
    await userEvent.click(screen.getByText('disabled'))
    expect(onRowClick).toHaveBeenCalledWith(rows[1])
    await userEvent.click(screen.getByRole('link', { name: 'Alfa' }))
    expect(onRowClick).toHaveBeenCalledTimes(1)
  })
})

describe('AppDataTable — barra de filtros', () => {
  const filterColumns = (primary: string[]): DataTableColumn<Row>[] => [
    { id: 'name', header: 'Nome', hideable: false, cell: (r) => r.name },
    ...['status', 'type', 'owner', 'tag'].map((id) => ({
      id,
      header: id,
      cell: () => '',
      filter: { label: `Filtro ${id}`, primary: primary.includes(id) || undefined, options: [{ value: 'a', label: `Opção ${id}` }] },
    })),
  ]

  function Filters({ primary = [], defaults }: { primary?: string[]; defaults?: Record<string, string> }) {
    const api = useDataTableState('filters-table', { sort: null, filters: defaults })
    useEffect(() => {
      handle.api = api
    })
    return <AppDataTable caption="Filtros" columns={filterColumns(primary)} data={rows} total={rows.length} getRowId={(r) => r.id} table={api} paginated={false} toolbarActions={<button type="button">Nova</button>} />
  }

  it('à vista só os filtros principais; o resto em "Mais filtros", com o ativo como ficha removível', async () => {
    renderWithProviders(<Filters primary={['status', 'owner']} />)
    expect(screen.getByRole('combobox', { name: 'Filtro status' })).toHaveTextContent('Filtro status')
    expect(screen.getByRole('combobox', { name: 'Filtro owner' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Filtro type' })).not.toBeInTheDocument()
    // a ação principal fica na mesma barra
    expect(screen.getByRole('button', { name: 'Nova' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Mais filtros' }))
    await userEvent.click(await screen.findByRole('combobox', { name: 'Filtro type' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Opção type' }))
    expect(handle.api!.state.filters).toEqual({ type: 'a' })
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Mais filtros (1 ativos)' })).toBeInTheDocument()
    const chips = screen.getByRole('list', { name: 'Filtros ativos' })
    await userEvent.click(within(chips).getByRole('button', { name: 'Remover filtro Filtro type: Opção type' }))
    expect(handle.api!.state.filters).toEqual({})
  })

  it('sem nenhum principal: os 3 primeiros à vista; filtro ativo mostra "Nome: valor"', async () => {
    renderWithProviders(<Filters />)
    expect(screen.getAllByRole('combobox').map((c) => c.getAttribute('aria-label'))).toEqual(['Filtro status', 'Filtro type', 'Filtro owner'])
    act(() => handle.api!.setFilter('status', 'a'))
    expect(screen.getByRole('combobox', { name: 'Filtro status' })).toHaveTextContent('Filtro status: Opção status')
  })

  it('"Limpar filtros" volta ao padrão da tabela; o padrão sozinho não conta como filtro ativo', async () => {
    renderWithProviders(<Filters defaults={{ status: 'a' }} />)
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).not.toBeInTheDocument()
    act(() => handle.api!.setFilter('owner', 'a'))
    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(handle.api!.state.filters).toEqual({ status: 'a' })
  })
})
