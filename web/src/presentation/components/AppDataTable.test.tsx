import { useEffect } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import { fakeRepositories, makeCurrentUser, renderWithProviders } from '@/test/utils'
import { AppDataTable, type DataTableColumn, type DataTableRowActions } from './AppDataTable'
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
      tableId="test-table"
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
        tableId="plain-table"
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

  it('sem busca nem filtros: a barra só com "Colunas" (para dar nome às colunas); sem moldura própria', () => {
    const { container } = renderWithProviders(<Plain />)
    expect(screen.getByRole('table', { name: 'Embutida' })).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Colunas'])
    expect(container.querySelector('.shadow-card')).toBeNull()
  })
})

describe('AppDataTable — clique na linha', () => {
  function Clickable({ onRowClick }: { onRowClick: (row: Row) => void }) {
    const api = useDataTableState('click-table', { sort: null })
    return (
      <AppDataTable
        tableId="click-table"
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
  const filterColumns: DataTableColumn<Row>[] = [
    { id: 'name', header: 'Nome', hideable: false, cell: (r) => r.name },
    ...['status', 'type', 'owner', 'tag'].map((id) => ({
      id,
      header: id,
      cell: () => '',
      filter: { label: `Filtro ${id}`, options: [{ value: 'a', label: `Opção ${id}` }] },
    })),
  ]

  function Filters({ defaults }: { defaults?: Record<string, string> }) {
    const api = useDataTableState('filters-table', { sort: null, filters: defaults })
    useEffect(() => {
      handle.api = api
    })
    return <AppDataTable tableId="filters-table" caption="Filtros" columns={filterColumns} data={rows} total={rows.length} getRowId={(r) => r.id} table={api} paginated={false} toolbarActions={<button type="button">Nova</button>} />
  }

  it('todos os filtros à vista na barra, sem "Mais filtros"; filtro ativo mostra "Nome: valor"', async () => {
    renderWithProviders(<Filters />)
    expect(screen.getAllByRole('combobox').map((c) => c.getAttribute('aria-label'))).toEqual(['Filtro status', 'Filtro type', 'Filtro owner', 'Filtro tag'])
    expect(screen.queryByRole('button', { name: /Mais filtros/ })).not.toBeInTheDocument()
    // a ação principal fica na mesma barra
    expect(screen.getByRole('button', { name: 'Nova' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Filtro status' })).toHaveTextContent(/^Filtro status$/)
    act(() => handle.api!.setFilter('status', 'a'))
    expect(screen.getByRole('combobox', { name: 'Filtro status' })).toHaveTextContent('Filtro status: Opção status')
  })

  it('§37: filtro em botões liga e desliga vários valores (unidos por vírgula), sem quantidades', async () => {
    const buttonColumns: DataTableColumn<Row>[] = [
      { id: 'name', header: 'Nome', hideable: false, cell: (r) => r.name },
      {
        id: 'status',
        header: 'Status',
        cell: () => '',
        filter: { label: 'Status', options: [{ value: 'a', label: 'Aberto' }, { value: 'b', label: 'Fechado' }] },
      },
      {
        id: 'priority',
        header: 'Prioridade',
        cell: () => '',
        filter: {
          label: 'Prioridade',
          variant: 'buttons',
          options: [
            { value: 'high', label: 'Alta' },
            { value: 'critical', label: 'Crítica' },
          ],
        },
      },
    ]
    function Buttons() {
      const api = useDataTableState('buttons-table', { sort: null })
      useEffect(() => {
        handle.api = api
      })
      return <AppDataTable tableId="buttons-table" caption="Botões" columns={buttonColumns} data={rows} total={rows.length} getRowId={(r) => r.id} table={api} paginated={false} />
    }
    renderWithProviders(<Buttons />)
    const group = screen.getByRole('group', { name: 'Prioridade' })
    const alta = within(group).getByRole('button', { name: 'Alta' })
    expect(alta).toHaveAttribute('aria-pressed', 'false')
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Alta', 'Crítica'])
    // o seletor compacto do mesmo filtro fica escondido até a barra apertar (AppToolbar < 1250px); os botões somem nessa hora
    const compact = screen.getByRole('combobox', { name: 'Prioridade' })
    expect(compact.parentElement).toHaveClass('hidden', '@max-[1250px]:flex')
    expect(compact).toHaveTextContent(/^Prioridade: todas$/)
    expect(group).toHaveClass('@max-[1250px]:hidden')
    await userEvent.click(alta)
    await userEvent.click(within(group).getByRole('button', { name: 'Crítica' }))
    expect(handle.api!.state.filters).toEqual({ priority: 'high,critical' })
    expect(compact).toHaveTextContent(/^Prioridade: Alta \+1$/)
    expect(within(group).getByRole('button', { name: 'Alta' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(group).getByRole('button', { name: 'Alta' }))
    expect(handle.api!.state.filters).toEqual({ priority: 'critical' })
    await userEvent.click(within(group).getByRole('button', { name: 'Crítica' }))
    expect(handle.api!.state.filters).toEqual({})
    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Todos', 'Aberto', 'Fechado'])
    await userEvent.click(screen.getByRole('option', { name: 'Aberto' }))
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent(/^Status: Aberto$/)
  })

  it('filtro em botões compacto: o seletor escolhe um valor só e "Todos" tira o filtro; a barra nunca quebra', async () => {
    const columns: DataTableColumn<Row>[] = [
      { id: 'name', header: 'Nome', hideable: false, cell: (r) => r.name },
      {
        id: 'urgency',
        header: 'Urgência',
        cell: () => '',
        filter: {
          label: 'Urgência',
          variant: 'buttons',
          options: [
            { value: 'low', label: 'Baixa' },
            { value: 'high', label: 'Alta' },
          ],
        },
      },
    ]
    function Compact() {
      const api = useDataTableState('compact-table', { sort: null })
      useEffect(() => {
        handle.api = api
      })
      return <AppDataTable caption="Compacto" columns={columns} data={rows} total={rows.length} getRowId={(r) => r.id} table={api} paginated={false} />
    }
    renderWithProviders(<Compact />)
    const compact = screen.getByRole('combobox', { name: 'Urgência' })
    await userEvent.click(compact)
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Todos', 'Baixa', 'Alta'])
    await userEvent.click(screen.getByRole('option', { name: 'Alta' }))
    expect(handle.api!.state.filters).toEqual({ urgency: 'high' })
    expect(within(screen.getByRole('group', { name: 'Urgência' })).getByRole('button', { name: 'Alta' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(compact)
    await userEvent.click(await screen.findByRole('option', { name: 'Todos' }))
    expect(handle.api!.state.filters).toEqual({})
    // a linha da barra: um contêiner que mede a si mesmo e uma linha que não quebra
    const row = compact.closest('[data-toolbar]')!
    expect(row).toHaveClass('flex-nowrap')
    expect(row).not.toHaveClass('flex-wrap')
    expect(row.parentElement).toHaveClass('@container')
  })

  it('"Limpar (n)" ao lado das ações, com quantos filtros estão ativos; volta ao padrão da tabela e, sem filtro, guarda o lugar escondido', async () => {
    renderWithProviders(<Filters defaults={{ status: 'a' }} />)
    // o padrão sozinho não conta como filtro ativo: o botão fica no lugar, invisível e fora do teclado
    expect(screen.queryByRole('button', { name: /^Limpar/ })).not.toBeInTheDocument()
    const hidden = screen.getByText('Limpar (0)').closest('button')!
    expect(hidden).toHaveClass('invisible')
    expect(hidden).toHaveAttribute('tabindex', '-1')
    act(() => handle.api!.setFilter('owner', 'a'))
    act(() => handle.api!.setFilter('tag', 'a'))
    const clear = screen.getByRole('button', { name: 'Limpar 2 filtros' })
    expect(clear).toHaveTextContent('Limpar (2)')
    expect(clear).not.toHaveClass('invisible')
    // junto de "Colunas" e da ação principal
    expect(clear.parentElement).toContainElement(screen.getByRole('button', { name: 'Nova' }))
    act(() => handle.api!.setFilter('tag', undefined))
    expect(screen.getByRole('button', { name: 'Limpar 1 filtro' })).toHaveTextContent('Limpar (1)')
    await userEvent.click(screen.getByRole('button', { name: 'Limpar 1 filtro' }))
    expect(handle.api!.state.filters).toEqual({ status: 'a' })
  })
})

describe('AppDataTable — Colunas e ações', () => {
  function ActionsHarness({ onDelete = () => {} }: { onDelete?: (r: Row) => void }) {
    const api = useDataTableState('actions-table')
    useEffect(() => {
      handle.api = api
    })
    return (
      <AppDataTable
        tableId="actions-table"
        caption="Tabela com ações"
        columns={columns}
        data={rows}
        total={rows.length}
        getRowId={(r) => r.id}
        table={api}
        configurableActions
        actions={{ onView: () => {}, onEdit: () => {}, onDelete, more: () => [{ key: 'open', label: 'Abrir página', onSelect: () => {} }] }}
      />
    )
  }

  it('"Colunas e ações" escolhe as ações de cada linha (padrão: sem Excluir, que fica no ···); a escolha é guardada', async () => {
    const onDelete = vi.fn()
    renderWithProviders(<ActionsHarness onDelete={onDelete} />)
    expect(screen.getAllByRole('button', { name: 'Visualizar' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
    // Excluir oculto: continua no menu ···
    await userEvent.click(screen.getAllByRole('button', { name: 'Mais ações' })[0]!)
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Excluir' }))
    expect(onDelete).toHaveBeenCalledWith(rows[0])

    await userEvent.click(screen.getByRole('button', { name: 'Colunas e ações' }))
    const menu = await screen.findByRole('dialog', { name: 'Colunas e ações' })
    expect(within(menu).getByText('Ações em cada linha')).toBeInTheDocument()
    expect(within(menu).getByRole('checkbox', { name: 'Excluir' })).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(within(menu).getByRole('checkbox', { name: 'Visualizar' }))
    await userEvent.click(within(menu).getByRole('checkbox', { name: 'Excluir' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: 'Visualizar' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Excluir' })).toHaveLength(2)
    expect(JSON.parse(window.localStorage.getItem('kamban.table.actions-table') ?? '{}').rowActions).toEqual({ view: false, edit: true, delete: true, more: true })
  })

  it('sem nenhuma ação marcada, a coluna Ações some', async () => {
    window.localStorage.setItem('kamban.table.actions-table', JSON.stringify({ rowActions: { view: false, edit: false, delete: false, more: false } }))
    renderWithProviders(<ActionsHarness />)
    expect(screen.queryByRole('columnheader', { name: 'Ações' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mais ações' })).not.toBeInTheDocument()
    expect(screen.getByText('Alfa')).toBeInTheDocument()
  })

  it('filtro com rótulo do padrão: parado mostra "Status: Abertas"', () => {
    function Harness2() {
      const api = useDataTableState('all-label')
      return (
        <AppDataTable
          tableId="all-label"
          caption="Rótulo padrão"
          columns={[{ id: 'status', header: 'Status', cell: (r: Row) => r.status, filter: { label: 'Status', allLabel: 'Abertas', options: [{ value: 'x', label: 'Concluído' }] } }]}
          data={rows}
          total={rows.length}
          getRowId={(r) => r.id}
          table={api}
        />
      )
    }
    renderWithProviders(<Harness2 />)
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Status: Abertas')
  })
})

describe('AppDataTable — nomes das colunas (§44)', () => {
  const nameColumns: DataTableColumn<Row>[] = [
    { id: 'name', header: 'Nome', hideable: false, sortable: true, cell: (r) => r.name },
    { id: 'status', header: 'Status', sortable: true, cell: (r) => r.status, filter: { label: 'Status', options: [{ value: 'active', label: 'Ativo' }] } },
  ]

  function NamesHarness({ actions }: { actions?: DataTableRowActions<Row> }) {
    const api = useDataTableState('names-table')
    return <AppDataTable tableId="names" caption="Nomes" columns={nameColumns} data={rows} total={rows.length} getRowId={(r) => r.id} table={api} actions={actions} />
  }

  const openMenu = async (name = 'Colunas') => {
    await userEvent.click(screen.getByRole('button', { name }))
    return screen.findByRole('dialog', { name })
  }
  const header = (name: string) => screen.getByRole('columnheader', { name: new RegExp(`^${name}( |$)`) })

  it('o nome da coluna se edita no menu: Enter grava, o cabeçalho (e o filtro de mesmo nome) muda e fica guardado por tabela', async () => {
    renderWithProviders(<NamesHarness />)
    const menu = await openMenu()
    // a primeira coluna não se oculta, mas o nome dela se edita
    expect(within(menu).getByRole('checkbox', { name: 'Mostrar Nome' })).toBeDisabled()
    expect(within(menu).getByRole('checkbox', { name: 'Mostrar Status' })).toBeEnabled()
    const input = within(menu).getByRole('textbox', { name: 'Nome da coluna Status' })
    await userEvent.clear(input)
    await userEvent.type(input, '  Situação {Enter}')
    expect(header('Situação')).toBeInTheDocument()
    expect(within(header('Situação')).getByRole('button', { name: 'Situação' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Situação' })).toBeInTheDocument()
    expect(within(menu).getByRole('checkbox', { name: 'Mostrar Situação' })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('kamban.table.names.labels') ?? '{}')).toEqual({ status: 'Situação' })
    // sem a caixa "para todos" para quem não tem platform.manage
    expect(within(menu).queryByRole('checkbox', { name: 'Usar estes nomes para todos' })).not.toBeInTheDocument()
  })

  it('sair do campo também grava; vazio volta ao nome do sistema; Esc desfaz; "Restaurar nomes" volta todos', async () => {
    window.localStorage.setItem('kamban.table.names.labels', JSON.stringify({ name: 'Registro' }))
    renderWithProviders(<NamesHarness />)
    expect(header('Registro')).toBeInTheDocument()
    const menu = await openMenu()
    const status = within(menu).getByRole('textbox', { name: 'Nome da coluna Status' })
    await userEvent.clear(status)
    await userEvent.type(status, 'Fase')
    await userEvent.tab()
    expect(header('Fase')).toBeInTheDocument()

    await userEvent.clear(status)
    await userEvent.type(status, 'Outro{Escape}')
    expect(header('Fase')).toBeInTheDocument()

    const name = within(await openMenu()).getByRole('textbox', { name: 'Nome da coluna Nome' })
    await userEvent.clear(name)
    await userEvent.keyboard('{Enter}')
    expect(header('Nome')).toBeInTheDocument()
    expect(name).toHaveValue('Nome')

    await userEvent.click(within(screen.getByRole('dialog', { name: 'Colunas' })).getByRole('button', { name: 'Restaurar nomes' }))
    expect(header('Status')).toBeInTheDocument()
    expect(window.localStorage.getItem('kamban.table.names.labels')).toBe('{}')
    expect(within(screen.getByRole('dialog', { name: 'Colunas' })).getByRole('button', { name: 'Restaurar nomes' })).toBeDisabled()
  })

  it('o nome definido para todos vale para quem não deu outro; o da pessoa vem antes', async () => {
    const repositories = fakeRepositories({ platform: { getTableColumnLabels: () => Promise.resolve({ names: { status: 'Etapa', name: 'Item' } }) } })
    window.localStorage.setItem('kamban.table.names.labels', JSON.stringify({ name: 'Meu item' }))
    renderWithProviders(<NamesHarness />, repositories)
    await waitFor(() => expect(header('Etapa')).toBeInTheDocument())
    expect(header('Meu item')).toBeInTheDocument()
    // apagar o próprio nome volta ao de todos
    const input = within(await openMenu()).getByRole('textbox', { name: 'Nome da coluna Nome' })
    await userEvent.clear(input)
    await userEvent.keyboard('{Enter}')
    expect(header('Item')).toBeInTheDocument()
  })

  it('platform.manage: "Usar estes nomes para todos" grava os nomes à vista para todos; com a caixa marcada, cada nome vai para todos', async () => {
    const update = vi.fn((tableId: string, labels: Record<string, string>) => Promise.resolve({ [tableId]: labels }))
    const repositories = fakeRepositories({
      auth: { me: () => Promise.resolve(makeCurrentUser(['platform.manage'])) },
      platform: { getTableColumnLabels: () => Promise.resolve({ names: { name: 'Item' } }), updateTableColumnLabels: update },
    })
    window.localStorage.setItem('kamban.table.names.labels', JSON.stringify({ status: 'Etapa' }))
    renderWithProviders(<NamesHarness />, repositories)
    const menu = await openMenu()
    const forAll = await within(menu).findByRole('checkbox', { name: 'Usar estes nomes para todos' })
    await waitFor(() => expect(header('Item')).toBeInTheDocument())
    await userEvent.click(forAll)
    expect(update).toHaveBeenLastCalledWith('names', { name: 'Item', status: 'Etapa' })
    // deixam de ser só da pessoa
    expect(window.localStorage.getItem('kamban.table.names.labels')).toBe('{}')

    const input = within(menu).getByRole('textbox', { name: 'Nome da coluna Status' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Fase{Enter}')
    expect(update).toHaveBeenLastCalledWith('names', { name: 'Item', status: 'Fase' })
    expect(header('Fase')).toBeInTheDocument()

    await userEvent.click(within(menu).getByRole('button', { name: 'Restaurar nomes' }))
    expect(update).toHaveBeenLastCalledWith('names', {})
    expect(header('Status')).toBeInTheDocument()
  })

  it('servidor recusa o nome para todos: o cabeçalho volta', async () => {
    const repositories = fakeRepositories({
      auth: { me: () => Promise.resolve(makeCurrentUser(['platform.manage'])) },
      platform: { updateTableColumnLabels: () => Promise.reject(new Error('falhou')) },
    })
    renderWithProviders(<NamesHarness />, repositories)
    const menu = await openMenu()
    await userEvent.click(await within(menu).findByRole('checkbox', { name: 'Usar estes nomes para todos' }))
    const input = within(menu).getByRole('textbox', { name: 'Nome da coluna Status' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Fase{Enter}')
    await waitFor(() => expect(header('Status')).toBeInTheDocument())
  })

  it('tabela sem outras ações no "⋯" (hideMore): Excluir desligado aparece no "⋯", com o nome da tela no menu', async () => {
    const onDelete = vi.fn()
    renderWithProviders(<NamesHarness actions={{ onEdit: () => {}, onDelete, deleteLabel: () => 'Desativar', deleteName: 'Desativar', hideMore: true }} />)
    expect(screen.queryByRole('button', { name: 'Desativar' })).not.toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Mais ações' })[0]!)
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Desativar' }))
    expect(onDelete).toHaveBeenCalledWith(rows[0])

    const menu = await openMenu('Colunas e ações')
    expect(within(menu).queryByRole('checkbox', { name: 'Mais (···)' })).not.toBeInTheDocument()
    await userEvent.click(within(menu).getByRole('checkbox', { name: 'Desativar' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.getAllByRole('button', { name: 'Desativar' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Mais ações' })).not.toBeInTheDocument()
  })
})
