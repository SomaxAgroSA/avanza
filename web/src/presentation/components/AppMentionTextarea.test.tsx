import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/core/i18n'
import type { MentionPerson } from '@/domain/tasks'
import { AppMentionTextarea } from './AppMentionTextarea'

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

const people: MentionPerson[] = [
  { id: 'u1', name: 'Carla Mendes' },
  { id: 'u2', name: 'Mário Souza' },
  { id: 'u3', name: 'Ana Carolina' },
  { id: 'u4', name: 'Otto Brito', outside: true },
]

function Harness({ onMention }: { onMention: (p: MentionPerson) => void }) {
  const [value, setValue] = useState('')
  return (
    <>
      <AppMentionTextarea label="Comentário" value={value} onValueChange={setValue} people={people} onMention={onMention} />
      <output data-testid="value">{value}</output>
    </>
  )
}

describe('AppMentionTextarea', () => {
  it('"@" abre a lista filtrando por nome (sem acento), começo do nome primeiro', async () => {
    render(<Harness onMention={() => {}} />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Comentário' }), 'Oi @car')
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['CMCarla Mendes', 'ACAna Carolina'])
    await userEvent.type(screen.getByRole('combobox'), 'o')
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['ACAna Carolina'])
  })

  it('quem ainda não vê a tarefa aparece com "passa a ver esta tarefa" (ajuste 23/11)', async () => {
    render(<Harness onMention={() => {}} />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Comentário' }), '@ot')
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['OBOtto Britopassa a ver esta tarefa'])
  })

  it('setas e Enter escolhem; o texto recebe "@Nome " e a tela é avisada', async () => {
    const onMention = vi.fn()
    render(<Harness onMention={onMention} />)
    const input = screen.getByRole('combobox', { name: 'Comentário' })
    await userEvent.type(input, 'Oi @')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(screen.getByTestId('value')).toHaveTextContent('Oi @Mário Souza')
    expect(onMention).toHaveBeenCalledWith(people[1])
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('continuar digitando logo após escolher: o texto entra depois da menção (cursor no lugar certo)', async () => {
    render(<Harness onMention={() => {}} />)
    const input = screen.getByRole('combobox', { name: 'Comentário' })
    await userEvent.type(input, 'Oi @mar')
    await userEvent.keyboard('{Enter}pode ver?')
    expect(screen.getByTestId('value')).toHaveTextContent('Oi @Mário Souza pode ver?')
  })

  it('Esc fecha a lista sem apagar o texto; e-mail não abre a lista', async () => {
    render(<Harness onMention={() => {}} />)
    const input = screen.getByRole('combobox', { name: 'Comentário' })
    await userEvent.type(input, '@ma')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(screen.getByTestId('value')).toHaveTextContent('@ma')
    await userEvent.clear(input)
    await userEvent.type(input, 'fale com carla@ma')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('clique na pessoa também escolhe', async () => {
    const onMention = vi.fn()
    render(<Harness onMention={onMention} />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Comentário' }), '@')
    await userEvent.click(screen.getByRole('option', { name: /Ana Carolina/ }))
    expect(screen.getByTestId('value')).toHaveTextContent('@Ana Carolina')
    expect(onMention).toHaveBeenCalledWith(people[2])
  })

  it('colar imagem (Ctrl+V) ou soltar arquivo entrega os arquivos; texto copiado continua colando como texto', () => {
    const onFiles = vi.fn()
    render(<AppMentionTextarea label="Atualização" value="" onValueChange={() => {}} people={people} onMention={() => {}} onFiles={onFiles} />)
    const box = screen.getByRole('combobox', { name: 'Atualização' })
    const image = new File([new Uint8Array([1])], 'image.png', { type: 'image/png' })
    fireEvent.paste(box, { clipboardData: { files: [image], getData: () => '' } })
    expect(onFiles).toHaveBeenLastCalledWith([image], 'paste')
    // do Excel vem texto + uma imagem da seleção: fica o texto
    fireEvent.paste(box, { clipboardData: { files: [image], getData: () => 'A1\tB1' } })
    expect(onFiles).toHaveBeenCalledTimes(1)
    const doc = new File([new Uint8Array([1])], 'ata.pdf', { type: 'application/pdf' })
    fireEvent.drop(box, { dataTransfer: { files: [doc], types: ['Files'] } })
    expect(onFiles).toHaveBeenLastCalledWith([doc], 'drop')
  })
})
