const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { markdownToDoc, docToMarkdown } = require('../../src/domain/doc-markdown')
const { sanitizeDoc } = require('../../src/domain/doc-content')

// ---------------------------------------------------------------- apoio

const t = (text, ...marks) => (marks.length ? { type: 'text', text, marks: marks.map((m) => (typeof m === 'string' ? { type: m } : m)) } : { type: 'text', text })
const link = (href) => ({ type: 'link', attrs: { href } })
const p = (...content) => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' })
const h = (level, ...content) => ({ type: 'heading', attrs: { level }, content })
const doc = (...content) => (content.length ? { type: 'doc', content } : { type: 'doc' })
const li = (...content) => ({ type: 'listItem', content })
const ul = (...items) => ({ type: 'bulletList', content: items })
const ol = (start, ...items) => ({ type: 'orderedList', attrs: { start }, content: items })
const task = (checked, ...content) => ({ type: 'taskItem', attrs: { checked }, content })
const tl = (...items) => ({ type: 'taskList', content: items })
const cellAttrs = { colspan: 1, rowspan: 1, colwidth: null }
const th = (...content) => ({ type: 'tableHeader', attrs: cellAttrs, content })
const td = (...content) => ({ type: 'tableCell', attrs: cellAttrs, content })
const tr = (...cells) => ({ type: 'tableRow', content: cells })
const FILE = '/api/v1/docs/files/abcdefghijklmno'

/** O documento gerado passa intacto pela higienização e volta igual depois de ir e voltar. */
function assertStable(md) {
  const parsed = markdownToDoc(md)
  const clean = sanitizeDoc(parsed)
  assert.equal(clean.error, undefined)
  assert.deepEqual(clean.doc, parsed)
  const out = docToMarkdown(parsed)
  assert.deepEqual(markdownToDoc(out), parsed, `ida e volta mudou:\n${out}`)
  assert.equal(docToMarkdown(markdownToDoc(out)), out)
  return parsed
}

/** Documento (como o editor grava) → Markdown → o mesmo documento. */
function assertDocStable(input) {
  const md = docToMarkdown(input)
  assert.deepEqual(markdownToDoc(md), input, `não voltou igual:\n${md}`)
  return md
}

// ---------------------------------------------------------------- blocos

describe('domain/doc-markdown — blocos', () => {
  it('títulos 1 a 4 (mais fundos viram 4) e o estilo sublinhado', () => {
    assert.deepEqual(markdownToDoc('# Um\n\n## Dois ##\n\n#### Quatro\n\n###### Seis'), doc(h(1, t('Um')), h(2, t('Dois')), h(4, t('Quatro')), h(4, t('Seis'))))
    assert.deepEqual(markdownToDoc('Título\n===\n\nSub\n---'), doc(h(1, t('Título')), h(2, t('Sub'))))
    assert.equal(docToMarkdown(doc(h(3, t('Três')))), '### Três')
    assert.equal(docToMarkdown(doc(h(2, t('C#')))), '## C\\#')
    assertDocStable(doc(h(2, t('C#')), h(1, t('a #'))))
  })

  it('parágrafos e quebras de linha (barra invertida, dois espaços, <br>)', () => {
    const parsed = markdownToDoc('linha um\nsegue\n\num\\\ndois  \ntrês<br>quatro')
    assert.deepEqual(parsed, doc(p(t('linha um segue')), p(t('um'), { type: 'hardBreak' }, t('dois'), { type: 'hardBreak' }, t('três'), { type: 'hardBreak' }, t('quatro'))))
    assert.equal(docToMarkdown(parsed), 'linha um segue\n\num\\\ndois\\\ntrês\\\nquatro')
    assertStable('a\\\nb')
  })

  it('listas com marcador, numeradas (com início) e de tarefas, aninhadas pelo recuo', () => {
    const md = '- a\n- b\n  - c\n    1. d\n\n3. três\n4. quatro\n\n- [x] feito\n- [ ] fazer\n  - [ ] sub'
    const parsed = assertStable(md)
    assert.deepEqual(
      parsed,
      doc(
        ul(li(p(t('a'))), li(p(t('b')), ul(li(p(t('c')), ol(1, li(p(t('d')))))))),
        ol(3, li(p(t('três'))), li(p(t('quatro')))),
        tl(task(true, p(t('feito'))), task(false, p(t('fazer')), tl(task(false, p(t('sub')))))),
      ),
    )
    assert.equal(docToMarkdown(parsed), md)
  })

  it('listas: recuo de 4 espaços, item com dois parágrafos, continuação preguiçosa e * / +', () => {
    assert.deepEqual(markdownToDoc('* a\n    + b'), doc(ul(li(p(t('a')), ul(li(p(t('b'))))))))
    assert.deepEqual(markdownToDoc('- a\n\n  b\n- c'), doc(ul(li(p(t('a')), p(t('b'))), li(p(t('c'))))))
    assert.deepEqual(markdownToDoc('- a\ncontinua'), doc(ul(li(p(t('a continua'))))))
    assert.deepEqual(markdownToDoc('10. dez\n    - sub'), doc(ol(10, li(p(t('dez')), ul(li(p(t('sub'))))))))
  })

  it('itens de lista sempre começam por parágrafo (exigência do editor)', () => {
    const parsed = assertStable('- ```js\n  x\n  ```\n- - filho')
    assert.deepEqual(parsed, doc(ul(li(p(), { type: 'codeBlock', attrs: { language: 'js' }, content: [t('x')] }), li(p(), ul(li(p(t('filho'))))))))
    assertDocStable(doc(ul(li(p()), li(p(t('b'))))))
  })

  it('duas listas do mesmo tipo seguidas continuam separadas', () => {
    const input = doc(ul(li(p(t('a')))), ul(li(p(t('b')))))
    assert.equal(assertDocStable(input), '- a\n\n<!-- -->\n\n- b')
    assertDocStable(doc(ul(li(p(t('a')))), tl(task(false, p(t('b'))))))
  })

  it('citação e destaques no formato de alerta do GitHub', () => {
    assert.deepEqual(markdownToDoc('> a\n>\n> b'), doc({ type: 'blockquote', content: [p(t('a')), p(t('b'))] }))
    assert.deepEqual(markdownToDoc('> a\ncontinua'), doc({ type: 'blockquote', content: [p(t('a continua'))] }))
    const tones = { NOTE: 'info', TIP: 'success', IMPORTANT: 'info', WARNING: 'warning', CAUTION: 'danger' }
    Object.keys(tones).forEach((alert) => {
      assert.deepEqual(markdownToDoc(`> [!${alert}]\n> texto`), doc({ type: 'callout', attrs: { tone: tones[alert] }, content: [p(t('texto'))] }))
    })
    const callouts = doc(
      { type: 'callout', attrs: { tone: 'info' }, content: [p(t('i'))] },
      { type: 'callout', attrs: { tone: 'success' }, content: [p(t('s')), ul(li(p(t('item'))))] },
      { type: 'callout', attrs: { tone: 'warning' }, content: [p(t('w'))] },
      { type: 'callout', attrs: { tone: 'danger' }, content: [{ type: 'blockquote', content: [p(t('d'))] }] },
    )
    assert.equal(assertDocStable(callouts).split('\n\n')[0], '> [!NOTE]\n> i')
    assert.deepEqual(markdownToDoc('> [!tip] na mesma linha'), doc({ type: 'callout', attrs: { tone: 'success' }, content: [p(t('na mesma linha'))] }))
    assert.deepEqual(markdownToDoc('>'), doc({ type: 'blockquote', content: [p()] }))
  })

  it('bloco de código com linguagem, crases dentro e linguagem inválida', () => {
    const parsed = markdownToDoc('```python\nprint(1)\n\n# não é título\n```\n\n~~~\na\n~~~\n\n```não válida!\nx\n```')
    assert.deepEqual(parsed, doc(
      { type: 'codeBlock', attrs: { language: 'python' }, content: [t('print(1)\n\n# não é título')] },
      { type: 'codeBlock', attrs: { language: null }, content: [t('a')] },
      { type: 'codeBlock', attrs: { language: null }, content: [t('x')] },
    ))
    const tricky = doc({ type: 'codeBlock', attrs: { language: 'md' }, content: [t('```\ncerca\n```\n')] }, { type: 'codeBlock', attrs: { language: null } })
    assert.match(assertDocStable(tricky), /^````md\n/)
  })

  it('linha horizontal, sumário e comentários ignorados', () => {
    assert.deepEqual(markdownToDoc('a\n\n---\n\n***\n\n[TOC]\n\n<!-- nota -->'), doc(p(t('a')), { type: 'horizontalRule' }, { type: 'horizontalRule' }, { type: 'tableOfContents' }))
    assert.equal(docToMarkdown(doc({ type: 'horizontalRule' }, { type: 'tableOfContents' })), '---\n\n[TOC]')
  })

  it('tabelas GFM: cabeçalho, \\| escapado, células vazias, <br> e linhas curtas', () => {
    const parsed = assertStable('| A | B \\| c |\n|---|:-:|\n| 1 | `x\\|y` |\n| um<br>dois<br><br>par |')
    assert.deepEqual(parsed, doc({
      type: 'table',
      content: [
        tr(th(p(t('A'))), th(p(t('B | c')))),
        tr(td(p(t('1'))), td(p(t('x|y', 'code')))),
        tr(td(p(t('um'), { type: 'hardBreak' }, t('dois')), p(t('par'))), td(p())),
      ],
    }))
    assert.equal(docToMarkdown(parsed), '| A | B \\| c |\n| --- | --- |\n| 1 | `x\\|y` |\n| um<br>dois<br><br>par |  |')
    // tabela sem cabeçalho (o editor permite) ganha a primeira linha como cabeçalho
    const plain = doc({ type: 'table', content: [tr(td(p(t('a'))), td(p(t('b'))))] })
    assert.deepEqual(markdownToDoc(docToMarkdown(plain)), doc({ type: 'table', content: [tr(th(p(t('a'))), th(p(t('b'))))] }))
    // listas dentro da célula viram parágrafos
    assert.equal(docToMarkdown(doc({ type: 'table', content: [tr(th(ul(li(p(t('x'))), li(p(t('y'))))))] })), '| x<br><br>y |\n| --- |')
  })

  it('imagens: só arquivos da documentação; largura e título; as outras viram link ou texto', () => {
    const image = { type: 'image', attrs: { src: FILE, alt: 'Diagrama', title: 'T', width: 50 } }
    assert.deepEqual(assertStable(`![Diagrama](${FILE} "T"){width=50%}`), doc(image))
    assert.deepEqual(markdownToDoc(`![](${FILE})`), doc({ type: 'image', attrs: { src: FILE, width: null } }))
    assert.deepEqual(markdownToDoc(`![x](${FILE}){width=33}`), doc({ type: 'image', attrs: { src: FILE, alt: 'x', width: null } }))
    assert.deepEqual(markdownToDoc(`antes ![a](${FILE}) depois`), doc(p(t('antes')), { type: 'image', attrs: { src: FILE, alt: 'a', width: null } }, p(t('depois'))))
    assert.deepEqual(markdownToDoc('![foto](https://ex.com/a.png)'), doc(p(t('foto', link('https://ex.com/a.png')))))
    assert.deepEqual(markdownToDoc('![x](javascript:alert(1)) ![](data:image/png;base64,AAA)'), doc(p(t('x'))))
    assert.deepEqual(markdownToDoc(`# Título ![a](${FILE})`), doc(h(1, t('Título a'))))
  })
})

// ---------------------------------------------------------------- marcações

describe('domain/doc-markdown — marcações', () => {
  it('negrito, itálico, riscado, código, destaque e sublinhado', () => {
    const parsed = markdownToDoc('**n** *i* _i2_ ~~r~~ `c` ==d== <u>s</u>')
    assert.deepEqual(parsed, doc(p(t('n', 'bold'), t(' '), t('i', 'italic'), t(' '), t('i2', 'italic'), t(' '), t('r', 'strike'), t(' '), t('c', 'code'), t(' '), t('d', 'highlight'), t(' '), t('s', 'underline'))))
    assert.equal(docToMarkdown(parsed), '**n** *i* *i2* ~~r~~ `c` ==d== <u>s</u>')
  })

  it('marcações aninhadas e sobrepostas', () => {
    assert.deepEqual(markdownToDoc('***ambos***'), doc(p(t('ambos', 'bold', 'italic'))))
    assert.deepEqual(markdownToDoc('**a *b* c**'), doc(p(t('a ', 'bold'), t('b', 'bold', 'italic'), t(' c', 'bold'))))
    assertStable('**negrito *e itálico*** e ~~**riscado forte**~~ ==*x*==')
    assertDocStable(doc(p(t('a', 'bold', 'italic'), t('b', 'italic'))))
    assertDocStable(doc(p(t('a', 'italic'), t('b', 'bold', 'italic'), t('c', 'bold'))))
    // espaço na ponta da marcação sai para fora dela (o Markdown não fecha `**` depois de espaço)
    assert.equal(docToMarkdown(doc(p(t('a. ', 'bold'), t('b'), t(' fim ', 'strike'), t('!')))), '**a.** b ~~fim~~ !')
    assertStable('**a.**b e ~~*x.*~~y')
    assertDocStable(doc(p(t('x', link('https://a.com'), 'bold'), t('y', link('https://a.com')), t('z', 'bold'))))
  })

  it('código não leva outras marcações (como no editor) e escolhe a cerca de crases', () => {
    assert.deepEqual(markdownToDoc('**`x`**'), doc(p(t('x', 'code'))))
    assert.deepEqual(markdownToDoc('`` a`b ``'), doc(p(t('a`b', 'code'))))
    assertDocStable(doc(p(t('`tick`', 'code'), t(' e '), t(' esp ', 'code'))))
  })

  it('links: só http(s), mailto e internos; o resto fica como texto', () => {
    assert.deepEqual(markdownToDoc('[site](https://ex.com/a_(b)) [mail](mailto:a@b.c) [doc](/docs/ENG/abc) [arquivo](' + FILE + ')'), doc(p(
      t('site', link('https://ex.com/a_(b)')), t(' '), t('mail', link('mailto:a@b.c')), t(' '), t('doc', link('/docs/ENG/abc')), t(' '), t('arquivo', link(FILE)),
    )))
    assert.deepEqual(markdownToDoc('[x](javascript:alert(1)) [y](ftp://a) [z](/outro) [w](https://a.com "título")'), doc(p(t('x y z '), t('w', link('https://a.com')))))
    assert.deepEqual(markdownToDoc('<https://a.com/x> e https://b.com/y. e (https://c.com)'), doc(p(
      t('https://a.com/x', link('https://a.com/x')), t(' e '), t('https://b.com/y', link('https://b.com/y')), t('. e ('), t('https://c.com', link('https://c.com')), t(')'),
    )))
    assert.deepEqual(markdownToDoc('[**forte** e *leve*](https://a.com)'), doc(p(t('forte', link('https://a.com'), 'bold'), t(' e ', link('https://a.com')), t('leve', link('https://a.com'), 'italic'))))
    // link inseguro gravado no documento sai como texto
    assert.equal(docToMarkdown(doc(p(t('x', link('javascript:alert(1)'))))), 'x')
    assert.equal(docToMarkdown(doc(p(t('https://a.com', link('https://a.com')), t(' e '), t('aqui', link('https://a.com/(x)'))))), '<https://a.com> e [aqui](https://a.com/\\(x\\))')
    assertStable('[aqui](https://a.com/\\(x\\)) <mailto:a@b.c>')
  })

  it('texto com caracteres do Markdown é escapado e volta igual', () => {
    const literal = doc(
      p(t('# não é título')),
      p(t('1. não é lista')),
      p(t('- nem isto'), { type: 'hardBreak' }, t('> nem citação')),
      p(t('*a* _b_ snake_case `c` [d](e) ~~f~~ ==g== <u>h</u> <br> a\\b http://x.com 2 * 3 | i')),
      p(t('---')),
      p(t('[TOC]')),
      p(t('[ ] não é tarefa')),
      p(t('<!-- não é comentário -->')),
      ul(li(p(t('[x] também não')))),
    )
    assertDocStable(literal)
    assert.equal(docToMarkdown(doc(p(t('snake_case e _x_')))), 'snake_case e \\_x\\_')
  })

  it('espaços nas pontas de uma marcação ficam do lado de fora', () => {
    const md = docToMarkdown(doc(p(t('a'), t(' negrito ', 'bold'), t('b'))))
    assert.equal(md, 'a **negrito** b')
  })
})

// ---------------------------------------------------------------- documento

describe('domain/doc-markdown — documento', () => {
  it('vazio e entradas inesperadas', () => {
    assert.deepEqual(markdownToDoc(''), { type: 'doc' })
    assert.deepEqual(markdownToDoc(null), { type: 'doc' })
    assert.deepEqual(markdownToDoc('\n\n  \n'), { type: 'doc' })
    assert.equal(docToMarkdown(null), '')
    assert.equal(docToMarkdown({ type: 'doc', content: [] }), '')
    assert.equal(docToMarkdown(doc(p(), p(t('a')), p())), 'a')
    assert.deepEqual(markdownToDoc('a\r\nb'), doc(p(t('a b'))))
  })

  it('entrada patológica termina rápido e aninhamento fundo não estoura a pilha', () => {
    const started = Date.now()
    ;['a* '.repeat(60000), '*a '.repeat(30000) + 'b* '.repeat(30000), '['.repeat(50000), '[a](https://x.com/'.repeat(20000), '`a'.repeat(50000)].forEach((md) => {
      docToMarkdown(markdownToDoc(md))
    })
    assert.ok(Date.now() - started < 3000, `levou ${Date.now() - started} ms`)
    const deep = markdownToDoc('> '.repeat(5000) + 'x')
    assert.equal(deep.content[0].type, 'blockquote')
    assert.doesNotThrow(() => markdownToDoc(Array.from({ length: 200 }, (_, i) => `${'  '.repeat(i)}- x`).join('\n')))
  })

  it('um documento completo passa intacto pela higienização e a ida e volta é estável', () => {
    const md = [
      '# Guia de implantação',
      '',
      '[TOC]',
      '',
      'Leia **antes** de começar. Veja [a política](/docs/ENG/abc) e <https://ex.com>.',
      '',
      '> [!WARNING]',
      '> Faça *backup*:',
      '>',
      '> - banco',
      '> - arquivos',
      '',
      '## Passos',
      '',
      '1. Instale',
      '',
      '   ```bash',
      '   npm ci',
      '   ```',
      '2. Configure o `.env`',
      '   - [x] chave',
      '   - [ ] SMTP',
      '',
      '| Ambiente | URL |',
      '| --- | --- |',
      '| Produção | <https://app.ex.com> |',
      '',
      `![Arquitetura](${FILE}){width=75%}`,
      '',
      '---',
      '',
      '> Citação final com ==destaque== e <u>sublinhado</u>.',
    ].join('\n')
    const parsed = assertStable(md)
    assert.equal(docToMarkdown(parsed), md)
  })

  it('documento como o editor grava (com atributos extras) sai em Markdown e volta higienizado', () => {
    const editor = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2, id: 'x' }, content: [{ type: 'text', text: 'Olá', marks: [{ type: 'bold' }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://a.com', target: '_blank', rel: 'noopener' } }, { type: 'highlight', attrs: { color: null } }] }] },
        { type: 'orderedList', attrs: { start: 1, type: null }, content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
        { type: 'image', attrs: { src: FILE, alt: null, title: null, width: null } },
      ],
    }
    const md = docToMarkdown(editor)
    assert.equal(md, '## **Olá**\n\n[==link==](https://a.com)\n\n1.\n\n' + `![](${FILE})`)
    const back = markdownToDoc(md)
    assert.deepEqual(back, sanitizeDoc(back).doc)
    assert.deepEqual(back.content[1], p(t('link', link('https://a.com'), 'highlight')))
  })
})
