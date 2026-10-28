import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { TagRepository } from '@/domain/repositories'
import type { OptionColor } from '@/domain/task-config'
import { fakeRepositories, makeCurrentUser, renderRoutes } from '@/test/utils'
import { TagsPage } from '@/features/tags/TagsPage'
import { ColorButton } from './config-visuals'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

describe('Cor personalizada', () => {
  it('na tag: a cor da marca pelo código vira a cor escolhida e é salva em #rrggbb', async () => {
    const create = vi.fn<TagRepository['create']>((data) => Promise.resolve({ id: 't1', name: data.name, color: data.color, taskCount: 0 }))
    const repositories = fakeRepositories({ auth: { me: async () => makeCurrentUser(['settings.manage']) }, tags: { list: () => Promise.resolve([]), create } })
    renderRoutes([{ path: '/settings/tags', element: <TagsPage /> }], { repositories, initialPath: '/settings/tags' })
    await userEvent.click(await screen.findByRole('button', { name: 'Nova tag' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/^Nome/), 'Marca')
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Personalizada' }))
    // código digitado sem # (o curto, de 3 dígitos, vale ao sair do campo)
    await userEvent.type(await screen.findByLabelText('Código da cor'), '1A7F37')
    await userEvent.keyboard('{Escape}')
    expect(within(dialog).getByRole('radio', { name: 'Cor personalizada #1a7f37' })).toHaveAttribute('aria-checked', 'true')
    expect(within(dialog).getByRole('radio', { name: 'Verde' })).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'Marca', color: '#1a7f37' }))
  })

  it('na bolinha das listas (status, recursos, opções): a cor da paleta salva na hora; a personalizada só uma vez, ao fechar', async () => {
    const onChange = vi.fn()
    function Harness() {
      const [color, setColor] = useState<OptionColor>('blue')
      return (
        <ColorButton
          color={color}
          label="Cor de Em análise"
          onChange={(next) => {
            onChange(next)
            setColor(next)
          }}
        />
      )
    }
    renderRoutes([{ path: '/', element: <Harness /> }], { repositories: fakeRepositories(), initialPath: '/' })
    await userEvent.click(await screen.findByRole('button', { name: 'Cor de Em análise' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Violeta' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith('violet')

    await userEvent.click(screen.getByRole('button', { name: 'Cor de Em análise' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Personalizada' }))
    const picker = await screen.findByLabelText('Escolher a cor')
    // o seletor do navegador avisa a cada ajuste
    fireEvent.input(picker, { target: { value: '#ff0000' } })
    fireEvent.input(picker, { target: { value: '#ff8800' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2))
    expect(onChange).toHaveBeenLastCalledWith('#ff8800')
  })
})
