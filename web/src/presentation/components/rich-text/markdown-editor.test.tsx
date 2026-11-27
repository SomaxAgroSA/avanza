import { beforeAll, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import i18n from '@/core/i18n'
import type { MentionPerson } from '@/domain/tasks'
import { renderWithProviders } from '@/test/utils'
import { AppMarkdownEditor } from './index'
import { matchMentionPeople, placeBeside } from './mention'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const PEOPLE: MentionPerson[] = [
  { id: 'u1', name: 'Jorge Benítez' },
  { id: 'u2', name: 'Mário Souza' },
  { id: 'u3', name: 'Ana Paula', outside: true },
]

function Field({ initial = '', onChange, people, focusOnMount }: { initial?: string; onChange: (value: string) => void; people?: MentionPerson[]; focusOnMount?: boolean }) {
  // como o campo de comentário: guarda o texto e, para limpar, recria o editor (key)
  const [value, setValue] = useState(initial)
  const [round, setRound] = useState(0)
  return (
    <>
      <AppMarkdownEditor
        key={round}
        focusOnMount={focusOnMount}
        label="Novo comentário"
        defaultValue={round === 0 ? initial : ''}
        people={people}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
      <output>{value}</output>
      <button type="button" onClick={() => setRound((n) => n + 1)}>
        limpar
      </button>
    </>
  )
}

describe('AppMarkdownEditor', () => {
  it('mesma barra da Documentação; "Inserir" só com menção, bloco de código e divisor', async () => {
    renderWithProviders(<Field onChange={() => {}} people={PEOPLE} />)
    expect(await screen.findByRole('textbox', { name: 'Novo comentário' })).toBeInTheDocument()
    const toolbar = screen.getByRole('toolbar', { name: 'Formatação' })
    for (const name of ['Desfazer', 'Refazer', 'Negrito', 'Itálico', 'Sublinhado', 'Tachado', 'Marca-texto', 'Código em linha', 'Lista com marcadores', 'Lista numerada', 'Lista de verificação', 'Citação', 'Tabela']) {
      expect(within(toolbar).getByRole('button', { name })).toBeInTheDocument()
    }
    // sem envio de imagens, sem o botão de imagem
    expect(within(toolbar).queryByRole('button', { name: 'Imagem' })).toBeNull()
    await userEvent.click(within(toolbar).getByRole('button', { name: 'Inserir' }))
    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent)
    expect(items).toEqual(['Menção (@)', 'Bloco de código', 'Divisor'])
  })

  it('entrega Markdown: atalhos (lista, negrito) e barra', async () => {
    const onChange = vi.fn()
    renderWithProviders(<Field onChange={onChange} />)
    const box = await screen.findByRole('textbox', { name: 'Novo comentário' })
    await userEvent.click(box)
    await userEvent.type(box, 'veja o **manual** ')
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('veja o **manual**'))
    await userEvent.type(box, '{Enter}- um')
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('veja o **manual**\n\n- um'))
  })

  it('"@" abre a lista ao lado, filtra por sobrenome sem acento e a escolha vira @[Nome](id)', async () => {
    const onChange = vi.fn()
    renderWithProviders(<Field onChange={onChange} people={PEOPLE} />)
    const box = await screen.findByRole('textbox', { name: 'Novo comentário' })
    await userEvent.click(box)
    await userEvent.type(box, 'Oi @beni')
    const list = await screen.findByRole('listbox', { name: 'Pessoas para mencionar' })
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['JBJorge Benítez'])
    await userEvent.keyboard('{Enter}')
    await userEvent.type(box, 'veja')
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('Oi @[Jorge Benítez](u1) veja'))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('↓ move e Esc fecha; "palavra@" (e-mail) não abre', async () => {
    const onChange = vi.fn()
    renderWithProviders(<Field onChange={onChange} people={PEOPLE} />)
    const box = await screen.findByRole('textbox', { name: 'Novo comentário' })
    await userEvent.click(box)
    await userEvent.type(box, 'ana@empresa')
    expect(screen.queryByRole('listbox')).toBeNull()
    await userEvent.type(box, ' @')
    const list = await screen.findByRole('listbox')
    await userEvent.keyboard('{ArrowDown}')
    expect(within(list).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  })

  it('menção já gravada aparece como "@Nome" e volta igual; valor limpo de fora esvazia o campo', async () => {
    const onChange = vi.fn()
    renderWithProviders(<Field initial="Pode revisar, @[Mário Souza](u2)?" onChange={onChange} people={PEOPLE} focusOnMount />)
    const box = await screen.findByRole('textbox', { name: 'Novo comentário' })
    expect(box).toHaveTextContent('Pode revisar, @Mário Souza?')
    // abrir não regrava o texto (o Markdown antigo fica como está até alguém editar)
    expect(onChange).not.toHaveBeenCalled()
    // abre com o cursor no fim do texto (como a edição de um comentário)
    await waitFor(() => expect(box).toHaveFocus())
    await userEvent.type(box, ' Obrigado!', { skipClick: true })
    await waitFor(() => expect(onChange.mock.lastCall?.[0]).toBe('Pode revisar, @[Mário Souza](u2)? Obrigado!'))
    await userEvent.click(screen.getByRole('button', { name: 'limpar' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Novo comentário' })).toHaveTextContent(''))
  })
})

describe('lista de menções', () => {
  it('filtra por nome ou sobrenome, sem acento; quem começa assim vem antes', () => {
    expect(matchMentionPeople(PEOPLE, 'jo').map((p) => p.id)).toEqual(['u1'])
    expect(matchMentionPeople(PEOPLE, 'BENI').map((p) => p.id)).toEqual(['u1'])
    expect(matchMentionPeople(PEOPLE, 'a').map((p) => p.id)).toEqual(['u3', 'u2'])
    expect(matchMentionPeople(PEOPLE, '').length).toBe(3)
  })

  it('fica à direita do que se digita, na mesma linha; sem espaço, à esquerda do @', () => {
    const element = document.createElement('div')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    placeBeside(element, new DOMRect(100, 200, 40, 20))
    expect(element.style.left).toBe('146px')
    expect(element.style.top).toBe('196px')
    placeBeside(element, new DOMRect(900, 200, 40, 20))
    expect(element.style.left).toBe(`${900 - 256 - 6}px`)
  })
})
