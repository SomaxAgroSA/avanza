import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { LibraryIcon } from '@/domain/icons'
import type { IconLibraryRepository } from '@/domain/repositories'
import { TASK_TYPE_ICONS } from '@/domain/task-config'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { TASK_TYPE_ICON_COMPONENTS } from '@/features/task-config/config-theme'
import { IconLibraryPage } from './IconLibraryPage'
import { IconPicker } from './IconPicker'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const icon = (name: string, usage: Partial<LibraryIcon['usage']> = {}): LibraryIcon => ({
  name,
  createdAt: new Date('2026-10-28T12:00:00Z'),
  createdBy: null,
  usage: { projects: 0, taskTypes: 0, docSpaces: 0, ...usage },
})

describe('Biblioteca de ícones', () => {
  it('seletor: os padrões do lugar e depois os importados; quem gerencia vê o atalho para importar mais', async () => {
    const onPick = vi.fn()
    function Harness() {
      const [value, setValue] = useState('bug')
      return (
        <IconPicker
          label="Ícone"
          value={value}
          onChange={(next) => {
            onPick(next)
            setValue(next)
          }}
          builtins={TASK_TYPE_ICONS}
          components={TASK_TYPE_ICON_COMPONENTS}
          fallback={TASK_TYPE_ICON_COMPONENTS['check-square']}
          builtinLabel={(name) => i18n.t(`taskTypes.icons.${name}`)}
        />
      )
    }
    const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(['settings.manage']) }, icons: { list: () => Promise.resolve([icon('tractor'), icon('bug')]) } })
    renderRoutes([{ path: '/', element: <Harness /> }], { repositories, initialPath: '/' })
    const group = await screen.findByRole('radiogroup', { name: 'Ícone' })
    const tractor = await within(group).findByRole('radio', { name: 'tractor' })
    // "bug" já é padrão: não aparece duas vezes
    expect(within(group).getAllByRole('radio')).toHaveLength(TASK_TYPE_ICONS.length + 1)
    await userEvent.click(tractor)
    expect(onPick).toHaveBeenCalledWith('tractor')
    expect(tractor).toHaveAttribute('aria-checked', 'true')
    expect(await screen.findByRole('link', { name: 'Importar mais ícones da galeria' })).toHaveAttribute('href', '/settings/icons')
  })

  it('Configurações → Ícones: mostra onde cada um é usado, não remove o que está em uso e importa da galeria', async () => {
    const importIcons = vi.fn<IconLibraryRepository['importIcons']>((names) => Promise.resolve(names.map((name) => icon(name))))
    const remove = vi.fn<IconLibraryRepository['remove']>(() => Promise.resolve())
    const repositories = fakeRepositories({
      auth: { me: async () => makeCurrentUser(['settings.manage']) },
      icons: { list: () => Promise.resolve([icon('tractor', { projects: 2, docSpaces: 1 }), icon('sprout')]), importIcons, remove },
    })
    renderRoutes([{ path: '/settings/icons', element: <IconLibraryPage /> }], { repositories, initialPath: '/settings/icons' })
    expect(await screen.findByText('Em uso: 2 projetos, 1 espaço')).toBeInTheDocument()
    expect(screen.getByText('Sem uso')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'tractor está em uso e não pode ser removido' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Remover sprout' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('sprout'))

    await userEvent.click(screen.getByRole('button', { name: 'Importar da galeria' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Buscar ícone' }), 'tractor')
    // o já importado aparece marcado e não dá para escolher de novo
    expect(await within(dialog).findByRole('button', { name: 'tractor (já importado)' })).toBeDisabled()
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Buscar ícone' }))
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Buscar ícone' }), 'wheat')
    await userEvent.click(await within(dialog).findByRole('button', { name: 'wheat' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Importar 1 ícone' }))
    await waitFor(() => expect(importIcons).toHaveBeenCalledWith(['wheat']))
  })
})
