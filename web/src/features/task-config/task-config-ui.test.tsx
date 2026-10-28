import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { CustomFieldRepository } from '@/domain/repositories'
import type { CustomField, TaskTypeDetail } from '@/domain/task-config'
import type { TaskStatus } from '@/domain/workflow'
import { fakeRepositories, renderRoutes, typeTexts } from '@/test/utils'
import { CustomFieldFormDialog } from './CustomFieldFormDialog'
import { TaskTypeDetailPage } from './TaskTypeDetailPage'

/** Elemento na posição informada (falha se não existir). */
function nth<T>(list: T[], index: number): T {
  const item = list[index]
  if (item === undefined) throw new Error('item ' + index + ' ausente')
  return item
}

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

function makeField(overrides: Partial<CustomField> = {}): CustomField {
  return {
    id: 'f1',
    name: 'ambiente',
    label: 'Ambiente',
    type: 'text',
    description: '',
    config: { max_length: 255 },
    defaultValue: null,
    searchable: true,
    filterable: true,
    sortable: true,
    options: [],
    usedBy: [],
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

const severity = makeField({
  id: 'f2',
  name: 'severidade',
  label: 'Severidade',
  type: 'select',
  config: {},
  options: [
    { id: 'o1', label: 'Baixa', color: 'green', order: 0, isActive: true },
    { id: 'o2', label: 'Alta', color: 'red', order: 1, isActive: true },
  ],
})

const bugType: TaskTypeDetail = {
  id: 't1',
  key: 'BUG',
  name: 'Bug',
  translations: typeTexts('Bug'),
  description: '',
  icon: 'bug',
  color: 'red',
  order: 0,
  isActive: true,
  fieldCount: 2,
  createdAt: null,
  updatedAt: null,
  fields: [
    { field: makeField(), order: 0, required: false, visible: true, showOnCard: false, requiredStatusIds: [] },
    { field: severity, order: 1, required: true, visible: true, showOnCard: true, requiredStatusIds: [] },
  ],
}

const status = (id: string, name: string, order: number) =>
  ({ id, key: name.toUpperCase(), name, description: '', color: 'gray', order, isActive: true, isDefault: order === 0, category: 'todo', createdAt: null, updatedAt: null }) as TaskStatus
const STATUSES = [status('s-backlog', 'Backlog', 0), status('s-analise', 'Análise', 1)]

function renderTypePage(setFields = vi.fn().mockResolvedValue(bugType), type: TaskTypeDetail = bugType) {
  const repositories = fakeRepositories({ taskTypes: { get: () => Promise.resolve(type), setFields }, statuses: { list: () => Promise.resolve(STATUSES) } })
  renderRoutes([{ path: '/settings/task-types/:typeId', element: <TaskTypeDetailPage /> }], {
    repositories,
    initialPath: '/settings/task-types/t1',
  })
  return { setFields }
}

describe('TaskTypeDetailPage', () => {
  it('ocultar um campo obrigatório também o torna opcional e fora do card', async () => {
    const { setFields } = renderTypePage()
    const save = await screen.findByRole('button', { name: 'Salvar' })
    expect(save).toBeDisabled()

    const visible = screen.getAllByRole('switch', { name: 'Visível' })
    await userEvent.click(nth(visible, 1))

    expect(screen.getByText('Há alterações não salvas.')).toBeInTheDocument()
    expect(nth(screen.getAllByRole('switch', { name: 'Obrigatório' }), 1)).not.toBeChecked()
    expect(nth(screen.getAllByRole('switch', { name: 'No card' }), 1)).not.toBeChecked()
    expect(screen.getByText('1 campo oculto não aparece no formulário.')).toBeInTheDocument()

    await userEvent.click(save)
    await waitFor(() =>
      expect(setFields).toHaveBeenCalledWith('t1', [
        { fieldId: 'f1', required: false, visible: true, showOnCard: false, requiredStatusIds: [] },
        { fieldId: 'f2', required: false, visible: false, showOnCard: false, requiredStatusIds: [] },
      ]),
    )
  })

  it('obrigatório por status: escolhe os status do campo e a pré-visualização valida como no status', async () => {
    const { setFields } = renderTypePage()
    // o campo obrigatório sempre não mostra a escolha por status
    expect(await screen.findByText('Exigido em todos os status')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('combobox', { name: 'Obrigatório nos status' }))
    await userEvent.click(within(await screen.findByRole('option', { name: /Análise/ })).getByRole('button'))
    await userEvent.keyboard('{Escape}')

    // no Backlog o campo não é exigido; em Análise, sim
    await userEvent.click(screen.getByRole('button', { name: 'Testar validação' }))
    expect(screen.getAllByText(i18n.t('validation.required'))).toHaveLength(1)
    await userEvent.click(screen.getByRole('combobox', { name: 'Validar como no status' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Análise' }))
    await userEvent.click(screen.getByRole('button', { name: 'Testar validação' }))
    expect(screen.getAllByText(i18n.t('validation.required'))).toHaveLength(2)

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(setFields).toHaveBeenCalledWith('t1', [
        { fieldId: 'f1', required: false, visible: true, showOnCard: false, requiredStatusIds: ['s-analise'] },
        { fieldId: 'f2', required: true, visible: true, showOnCard: true, requiredStatusIds: [] },
      ]),
    )
  })

  it('descartar volta à configuração salva', async () => {
    renderTypePage()
    await userEvent.click(await screen.findByRole('button', { name: 'Remover Ambiente do tipo' }))
    expect(screen.queryByRole('button', { name: 'Remover Ambiente do tipo' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(screen.getByRole('button', { name: 'Remover Ambiente do tipo' })).toBeInTheDocument()
    expect(screen.queryByText('Há alterações não salvas.')).not.toBeInTheDocument()
  })

  it('a pré-visualização aponta campos obrigatórios vazios', async () => {
    renderTypePage()
    await userEvent.click(await screen.findByRole('button', { name: 'Testar validação' }))
    expect(screen.queryByText('Formulário válido')).not.toBeInTheDocument()
    expect(screen.getByText(i18n.t('validation.required'))).toBeInTheDocument()

    // tornando o campo opcional, a validação passa
    await userEvent.click(nth(screen.getAllByRole('switch', { name: 'Obrigatório' }), 1))
    await userEvent.click(screen.getByRole('button', { name: 'Testar validação' }))
    expect(screen.getByText('Formulário válido')).toBeInTheDocument()
  })

  it('a pré-visualização considera o valor padrão do campo', async () => {
    const withDefault: TaskTypeDetail = {
      ...bugType,
      fields: [{ field: { ...severity, defaultValue: 'o1' }, order: 0, required: true, visible: true, showOnCard: false, requiredStatusIds: [] }],
    }
    renderTypePage(undefined, withDefault)
    await userEvent.click(await screen.findByRole('button', { name: 'Testar validação' }))
    expect(screen.getByText('Formulário válido')).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('validation.required'))).not.toBeInTheDocument()
  })

  it('tipo sem campos mostra "Nenhum campo" na aba', async () => {
    renderTypePage(undefined, { ...bugType, fields: [] })
    expect(await screen.findByRole('tab', { name: 'Campos (0)' })).toBeInTheDocument()
    expect(screen.getByText('Nenhum campo configurado')).toBeInTheDocument()
  })
})

function renderFieldDrawer(field: CustomField | null, overrides: { create?: CustomFieldRepository['create']; update?: CustomFieldRepository['update'] } = {}) {
  const create = vi.fn<CustomFieldRepository['create']>(overrides.create ?? (() => Promise.resolve(makeField())))
  const update = vi.fn<CustomFieldRepository['update']>(overrides.update ?? (() => Promise.resolve(severity)))
  const repositories = fakeRepositories({ customFields: { create, update } })
  renderRoutes([{ path: '/', element: <CustomFieldFormDialog open field={field} onOpenChange={() => {}} /> }], { repositories, initialPath: '/' })
  return { create, update }
}

describe('CustomFieldFormDialog', () => {
  it('gera o nome técnico a partir do rótulo e cria o campo', async () => {
    const { create } = renderFieldDrawer(null)
    await userEvent.type(await screen.findByLabelText(/^Rótulo/), 'Versão do app')
    expect(screen.getByLabelText(/^Nome técnico/)).toHaveValue('versao_do_app')

    await userEvent.click(screen.getByRole('button', { name: 'Novo campo' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(nth(create.mock.calls, 0)[0]).toMatchObject({ label: 'Versão do app', name: 'versao_do_app', type: 'text' })
  })

  it('seleção única mantém apenas uma opção padrão', async () => {
    const { update } = renderFieldDrawer({ ...severity, defaultValue: 'o1' })
    const defaults = await screen.findAllByRole('checkbox', { name: 'Padrão' })
    expect(nth(defaults, 0)).toBeChecked()

    await userEvent.click(nth(defaults, 1))
    expect(nth(defaults, 0)).not.toBeChecked()
    expect(nth(defaults, 1)).toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    const options = nth(update.mock.calls, 0)[1].options as Array<{ id: string; isDefault: boolean }>
    expect(options.map((o) => [o.id, o.isDefault])).toEqual([
      ['o1', false],
      ['o2', true],
    ])
  })

  it('bloqueia opções sem nome ou repetidas', async () => {
    const { update } = renderFieldDrawer(severity)
    const labels = await screen.findAllByRole('textbox', { name: 'Nome da opção' })
    await userEvent.clear(nth(labels, 1))
    await userEvent.type(nth(labels, 1), 'baixa')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Há opções com o mesmo nome.')).toBeInTheDocument()

    await userEvent.clear(nth(labels, 1))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Todas as opções precisam de nome.')).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })

  it('"Permitir adicionar opções pela tarefa": liga na seleção e vai na configuração do campo', async () => {
    const { update } = renderFieldDrawer({ ...severity, config: { allow_create_options: true } })
    const toggle = await screen.findByRole('switch', { name: /Permitir adicionar opções pela tarefa/ })
    expect(toggle).toBeChecked()
    await userEvent.click(toggle)
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    expect(nth(update.mock.calls, 0)[1].config).toEqual({})

    update.mockClear()
    await userEvent.click(toggle)
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    expect(nth(update.mock.calls, 0)[1].config).toEqual({ allow_create_options: true })
  })

  it('campo sem opções não mostra "Permitir adicionar opções pela tarefa"', async () => {
    renderFieldDrawer(null)
    await screen.findByLabelText(/^Rótulo/)
    expect(screen.queryByRole('switch', { name: /Permitir adicionar opções pela tarefa/ })).not.toBeInTheDocument()
  })

  it('Enter numa opção cria a próxima logo abaixo, já com o cursor, sem enviar o formulário', async () => {
    const { update } = renderFieldDrawer(severity)
    const before = await screen.findAllByRole('textbox', { name: 'Nome da opção' })
    await userEvent.click(nth(before, 0))
    await userEvent.keyboard('{Enter}')

    const after = screen.getAllByRole('textbox', { name: 'Nome da opção' })
    expect(after).toHaveLength(before.length + 1)
    expect(nth(after, 1)).toHaveFocus()
    expect(nth(after, 1)).toHaveValue('')
    await userEvent.keyboard('Urgente')
    expect(nth(after, 1)).toHaveValue('Urgente')
    expect(update).not.toHaveBeenCalled()
  })
})
