import { describe, expect, it } from 'vitest'
import type { RichContent } from './docs'
import { createMarkdownCodec, isTaskImageSrc, safeTaskHref, taskMarkdown } from './markdown-doc'

const { toDoc, toMarkdown } = taskMarkdown
const roundTrip = (md: string) => toMarkdown(toDoc(md))
const text = (value: string, marks?: RichContent['marks']): RichContent => (marks ? { type: 'text', text: value, marks } : { type: 'text', text: value })
const p = (...content: RichContent[]): RichContent => ({ type: 'paragraph', content })

describe('taskMarkdown — ida e volta estável', () => {
  const samples = [
    'Texto simples',
    'Olá @[Mário Souza](u2) veja o **manual**',
    '# Título\n\n## Subtítulo\n\nTexto com *itálico*, ~~riscado~~, `código`, ==destaque== e <u>sublinhado</u>.',
    'Primeira linha\nsegunda linha',
    '- um\n- dois\n  - dois.um',
    '3. três\n4. quatro',
    '- [ ] fazer\n- [x] feito',
    '> citação\n> continua',
    '```js\nconst a = 1\n```',
    'antes\n\n---\n\ndepois',
    '| Campo | Regra |\n| --- | --- |\n| CNPJ | **Obrigatório** |',
    '![print.png](/api/v1/attachments/abc123def456ghi/file)',
    'Veja [o site](https://exemplo.com) e <https://kamban.dev>',
  ]
  it.each(samples)('%j', (md) => {
    expect(roundTrip(md)).toBe(md)
    expect(roundTrip(roundTrip(md))).toBe(roundTrip(md))
  })

  it('texto que pareceria marcação ganha escape e volta igual', () => {
    const doc: RichContent = { type: 'doc', content: [p(text('2. não é lista * nem @[falsa](menção) # nada'))] }
    const md = toMarkdown(doc)
    expect(toDoc(md)).toEqual(doc)
  })
})

describe('taskMarkdown — menções', () => {
  it('@[Nome](id) vira o nó mention e volta no formato salvo', () => {
    const doc = toDoc('Oi @[Carla Mendes](u1), tudo bem?')
    expect(doc.content?.[0]?.content?.[1]).toEqual({ type: 'mention', attrs: { id: 'u1', label: 'Carla Mendes' } })
    expect(toMarkdown(doc)).toBe('Oi @[Carla Mendes](u1), tudo bem?')
  })

  it('nome com "]" ou id inválido não quebram o formato', () => {
    const doc: RichContent = {
      type: 'doc',
      content: [p(text('a '), { type: 'mention', attrs: { id: 'u1', label: 'Ana ]x' } }, text(' b '), { type: 'mention', attrs: { id: 'id inválido', label: 'Zé' } })],
    }
    expect(toMarkdown(doc)).toBe('a @[Ana  x](u1) b @Zé')
  })

  it('e-mail não é menção', () => {
    expect(toDoc('fale com ana@empresa.com').content?.[0]?.content).toEqual([text('fale com ana@empresa.com')])
  })
})

describe('taskMarkdown — textos antigos (como o AppMarkdown de antes)', () => {
  it('nova linha simples é quebra de linha; linha em branco separa parágrafos', () => {
    const doc = toDoc('linha 1\nlinha 2\n\noutro')
    expect(doc.content).toEqual([p(text('linha 1'), { type: 'hardBreak' }, text('linha 2')), p(text('outro'))])
  })

  it('"texto" seguido de "---" não vira título sublinhado', () => {
    expect(toDoc('algo\n---').content?.map((n) => n.type)).toEqual(['paragraph', 'horizontalRule'])
  })

  it('links só http(s); javascript: fica só o texto; HTML cru fica como texto', () => {
    const doc = toDoc('[site](https://kamban.dev) [mal](javascript:alert(1)) <img src=x>')
    const nodes = doc.content?.[0]?.content ?? []
    expect(nodes[0]).toEqual(text('site', [{ type: 'link', attrs: { href: 'https://kamban.dev' } }]))
    expect(JSON.stringify(nodes)).not.toContain('javascript')
    expect(nodes[nodes.length - 1]?.text).toContain('<img src=x>')
  })

  it('imagem de fora não carrega: vira link (http) ou só o texto', () => {
    expect(toDoc('![logo](https://exemplo.com/a.png)').content).toEqual([p(text('logo', [{ type: 'link', attrs: { href: 'https://exemplo.com/a.png' } }]))])
    expect(toDoc('![x](data:image/png;base64,AAA)').content).toEqual([p(text('x'))])
    expect(toDoc('![d](/api/v1/docs/files/abcdefghijklmno)').content?.[0]?.type).toBe('image')
  })

  it('alertas e [TOC] da Documentação não existem nos comentários', () => {
    expect(toDoc('> [!NOTE]\n> oi').content?.[0]?.type).toBe('blockquote')
    expect(toDoc('[TOC]').content?.[0]?.type).toBe('paragraph')
  })
})

describe('regras de endereço', () => {
  it('imagens só dos anexos e da Documentação; links só http(s)', () => {
    expect(isTaskImageSrc('/api/v1/attachments/abc/file')).toBe(true)
    expect(isTaskImageSrc('/api/v1/attachments/../x/file')).toBe(false)
    expect(isTaskImageSrc('https://exemplo.com/a.png')).toBe(false)
    expect(safeTaskHref(' https://a.b ')).toBe('https://a.b')
    expect(safeTaskHref('mailto:a@b.c')).toBeNull()
    expect(safeTaskHref('/docs/x')).toBeNull()
  })

  it('o codec configurável aceita outras regras (ex.: imagens retidas antes de criar a tarefa)', () => {
    const codec = createMarkdownCodec({ safeHref: safeTaskHref, isImageSrc: (src) => src.startsWith('blob:'), breaks: true })
    const md = '![foto](blob:http://localhost/1)'
    expect(codec.toDoc(md).content?.[0]?.type).toBe('image')
    expect(codec.toMarkdown(codec.toDoc(md))).toBe(md)
  })
})
