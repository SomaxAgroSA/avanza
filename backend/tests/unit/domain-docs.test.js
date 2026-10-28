const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const content = require('../../src/domain/doc-content')
const tree = require('../../src/domain/doc-tree')
const docs = require('../../src/domain/docs')
const { createPrincipal } = require('../../src/domain/rbac')

const FILE = 'abcdefghij12345'
const p = (...children) => ({ type: 'paragraph', content: children })
const text = (value, marks) => (marks ? { type: 'text', text: value, marks } : { type: 'text', text: value })

describe('domain/doc-content — higienização do conteúdo do editor', () => {
  it('aceita os blocos do editor e extrai o texto para a busca', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [text('Visão geral')] },
        p(text('Tela de '), text('listagem', [{ type: 'bold' }]), text(' do módulo.')),
        { type: 'callout', attrs: { tone: 'warning' }, content: [p(text('Atenção ao fuso.'))] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('Dia'))] }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(text('Revisado'))] }] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 1, rowspan: 1 }, content: [p(text('Status'))] }] }] },
        { type: 'image', attrs: { src: `/api/v1/docs/files/${FILE}`, alt: 'Legenda', width: 50 } },
        { type: 'codeBlock', attrs: { language: 'js' }, content: [text('const a = 1')] },
        { type: 'tableOfContents' },
        { type: 'horizontalRule' },
      ],
    }
    const result = content.sanitizeDoc(doc)
    assert.equal(result.error, undefined)
    assert.deepEqual(result.fileIds, [FILE])
    assert.match(result.text, /Visão geral/)
    assert.match(result.text, /Tela de listagem do módulo\./)
    assert.match(result.text, /Atenção ao fuso\./)
    assert.equal(result.doc.content[6].attrs.width, 50)
  })

  it('recusa estrutura desconhecida e remove o que é perigoso (links e imagens externas, atributos estranhos)', () => {
    assert.equal(content.sanitizeDoc({ type: 'html', content: [] }).error, 'invalid_content')
    assert.equal(content.sanitizeDoc({ type: 'doc', content: [{ type: 'iframe' }] }).error, 'invalid_content')
    const result = content.sanitizeDoc({
      type: 'doc',
      content: [
        p(text('clique', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]), text(' site', [{ type: 'link', attrs: { href: 'https://aliare.co', onclick: 'x' } }])),
        { type: 'image', attrs: { src: 'https://evil.example/x.png' } },
        { type: 'heading', attrs: { level: 9, style: 'color:red' }, content: [text('T')] },
        { type: 'callout', attrs: { tone: 'purple' }, content: [p(text('x'))] },
      ],
    })
    const [first, ...rest] = result.doc.content
    // link com javascript: vira texto comum; o https fica, sem atributos extras
    assert.equal(first.content[0].marks, undefined)
    assert.deepEqual(first.content[1].marks, [{ type: 'link', attrs: { href: 'https://aliare.co' } }])
    // imagem de fora da documentação é descartada
    assert.ok(!rest.some((n) => n.type === 'image'))
    assert.deepEqual(rest[0].attrs, { level: 2 })
    assert.deepEqual(rest[1].attrs, { tone: 'info' })
  })

  it('limita tamanho e profundidade', () => {
    let deep = p(text('x'))
    for (let i = 0; i < 40; i++) deep = { type: 'blockquote', content: [deep] }
    assert.equal(content.sanitizeDoc({ type: 'doc', content: [deep] }).error, 'too_deep')
    assert.equal(content.sanitizeDoc({ type: 'doc', content: [p(text('x'.repeat(content.MAX_TEXT + 1)))] }).error, 'too_long')
  })

  it('documento vazio é válido (página nova)', () => {
    assert.deepEqual(content.sanitizeDoc(null).doc, { type: 'doc', content: [] })
    assert.equal(content.sanitizeDoc(null).text, '')
  })

  it('busca sem acento e sem maiúsculas; trecho em volta do termo', () => {
    assert.equal(content.fold('Atenção ÀS Regras'), 'atencao as regras')
    const snip = content.snippet('O cadastro de parceiros exige a validação do CNPJ antes de salvar o registro.', 'validacao', 20)
    assert.match(snip, /validação do CNPJ/)
    assert.ok(snip.startsWith('…'))
    assert.equal(content.snippet('curto', 'nada', 20), 'curto')
  })
})

describe('domain/doc-tree — árvore de páginas', () => {
  const pages = [
    { id: 'a', parentId: null },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'b' },
    { id: 'd', parentId: null },
  ]

  it('não move uma página para dentro dela mesma ou de uma subpágina sua', () => {
    assert.equal(tree.wouldCycle(pages, 'a', 'c'), true)
    assert.equal(tree.wouldCycle(pages, 'a', 'a'), true)
    assert.equal(tree.wouldCycle(pages, 'c', 'd'), false)
    assert.equal(tree.wouldCycle(pages, 'b', null), false)
  })

  it('profundidade, descendentes e trilha (breadcrumb)', () => {
    assert.equal(tree.depthOf(pages, 'c'), 3)
    assert.deepEqual(tree.descendantsOf(pages, 'a').sort(), ['b', 'c'])
    assert.deepEqual(tree.ancestorsOf(pages, 'c'), ['a', 'b'])
    // mover "a" (com 2 níveis abaixo) para dentro de "d" dá profundidade 4
    assert.equal(tree.subtreeHeight(pages, 'a'), 3)
  })

  it('posição entre vizinhos (passo 1024); sem espaço → null (renumerar)', () => {
    assert.equal(tree.positionBetween(null, null), 1024)
    assert.equal(tree.positionBetween(1024, null), 2048)
    assert.equal(tree.positionBetween(null, 1024), 0)
    assert.equal(tree.positionBetween(1024, 2048), 1536)
    assert.equal(tree.positionBetween(1024, 1024.0000001), null)
  })
})

describe('domain/docs — acesso ao espaço', () => {
  const principal = (perms) => createPrincipal({ userId: 'u', roleId: 'r', roleCode: 'MEMBER', permissions: perms })
  const company = { id: 's1', projectId: null, visibility: 'company' }
  const projectOnly = { id: 's2', projectId: 'p1', visibility: 'project' }
  const member = { canView: true, role: 'member', isOwner: false, isManager: false, viewAll: false }
  const viewer = { canView: true, role: 'viewer', isOwner: false, isManager: false, viewAll: false }
  const manager = { canView: true, role: 'manager', isOwner: false, isManager: true, viewAll: false }
  const outsider = { canView: false, role: null, isOwner: false, isManager: false, viewAll: false }

  it('espaço da empresa: qualquer um com docs.view lê; docs.edit edita; docs.manage configura', () => {
    assert.deepEqual(docs.spaceAccess(principal(['docs.view']), company, null), { canRead: true, canEdit: false, canManage: false })
    assert.deepEqual(docs.spaceAccess(principal(['docs.view', 'docs.edit']), company, null), { canRead: true, canEdit: true, canManage: false })
    assert.deepEqual(docs.spaceAccess(principal(['docs.view', 'docs.edit', 'docs.manage']), company, null), { canRead: true, canEdit: true, canManage: true })
    assert.deepEqual(docs.spaceAccess(principal([]), company, null), { canRead: false, canEdit: false, canManage: false })
  })

  it('espaço só do projeto: lê quem vê o projeto; edita quem colabora; configura o gestor', () => {
    const all = principal(['docs.view', 'docs.edit', 'docs.manage'])
    assert.deepEqual(docs.spaceAccess(all, projectOnly, outsider), { canRead: false, canEdit: false, canManage: false })
    assert.deepEqual(docs.spaceAccess(all, projectOnly, viewer), { canRead: true, canEdit: false, canManage: false })
    assert.deepEqual(docs.spaceAccess(all, projectOnly, member), { canRead: true, canEdit: true, canManage: false })
    assert.deepEqual(docs.spaceAccess(all, projectOnly, manager), { canRead: true, canEdit: true, canManage: true })
    // espaço do projeto aberto à empresa: quem não é do projeto lê, mas não edita
    assert.deepEqual(docs.spaceAccess(all, { ...projectOnly, visibility: 'company' }, outsider), { canRead: true, canEdit: false, canManage: false })
  })

  it('valida chave e visibilidade', () => {
    assert.equal(docs.spaceKeyIssue('MANUAL'), null)
    assert.equal(docs.spaceKeyIssue('manual'), 'invalid_format')
    assert.equal(docs.spaceKeyIssue('1ABC'), 'invalid_format')
    assert.equal(docs.visibilityIssue('project', null), 'project_required')
    assert.equal(docs.visibilityIssue('company', null), null)
    assert.equal(docs.visibilityIssue('secreto', 'p1'), 'invalid_option')
  })
})
