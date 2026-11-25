import { beforeAll, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import i18n from '@/core/i18n'
import { DEFAULT_TASK_VIEWS } from '@/domain/task-views'
import { renderWithProviders } from '@/test/utils'
import { RoleTaskViews } from './RoleTaskViews'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

describe('Tarefas do perfil — dica (ajuste 25/11)', () => {
  it('diz que, com uma tela só marcada, a tela se chama "Caixa de entrada", sem botões, e abre direto', () => {
    renderWithProviders(<RoleTaskViews value={DEFAULT_TASK_VIEWS} onChange={() => {}} />)
    const show = screen.getByRole('group', { name: 'O que aparece' })
    expect(within(show).getByText(/Com uma só marcada, a tela se chama "Caixa de entrada", sem botões, e abre direto/)).toBeInTheDocument()
  })
})
