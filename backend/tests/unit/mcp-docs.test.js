const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { TOOLS } = require('../../src/mcp/catalog/docs')
const { validateArguments } = require('../../src/mcp/schema')
const { sanitizeDoc } = require('../../src/domain/doc-content')

const ctx = { principal: { userId: 'u1' } }

/** Serviços falsos: guardam as chamadas e devolvem o que o teste pedir. */
function spyServices(returns) {
  const calls = []
  const handler = (service) =>
    new Proxy(
      {},
      {
        get: (_, method) => async (...args) => {
          calls.push({ service, method, args: args.slice(1) })
          const value = (returns || {})[`${service}.${method}`]
          return typeof value === 'function' ? value(...args.slice(1)) : value
        },
      },
    )
  return { calls, services: new Proxy({}, { get: (_, service) => handler(service) }) }
}
const byName = (name) => TOOLS.find((t) => t.name === name)

const user = { id: 'u2', name: 'Ana', email: 'ana@x', avatar_url: null }
const DOC = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Guia' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Leia ' }, { type: 'text', text: 'antes', marks: [{ type: 'bold' }] }] },
  ],
}
const PAGE = {
  id: 'pg1',
  space: { id: 'sp1', key: 'ENG', name: 'Engenharia' },
  parent_id: 'pg0',
  title: 'Guia',
  status: 'published',
  content: DOC,
  version: 3,
  published_at: '2026-10-01T10:00:00.000Z',
  published_by: user,
  created_by: user,
  is_home: false,
  ancestors: [{ id: 'pg0', title: 'Início' }],
  children: [{ id: 'pg2', title: 'Filha', status: 'draft' }],
  draft: { title: 'Guia 2', by: user, at: '2026-10-02T10:00:00.000Z' },
  capabilities: { edit: true, manage: false },
}

describe('mcp/catalog/docs', () => {
  it('catálogo: nomes, descrições, esquemas fechados e anotações coerentes', () => {
    const names = TOOLS.map((t) => t.name)
    assert.equal(new Set(names).size, names.length)
    TOOLS.forEach((tool) => {
      assert.match(tool.name, /^[a-z][a-z_]{2,40}$/, tool.name)
      assert.ok(tool.title && tool.description.length > 20, tool.name)
      assert.equal(tool.inputSchema.type, 'object', tool.name)
      assert.equal(tool.inputSchema.additionalProperties, false, tool.name)
      ;(tool.inputSchema.required || []).forEach((key) => assert.ok(tool.inputSchema.properties[key], `${tool.name}.${key}`))
      Object.keys(tool.inputSchema.properties).forEach((key) => assert.ok(tool.inputSchema.properties[key].description, `${tool.name}.${key} sem descrição`))
      const readOnly = /^(get|list|find|search|whoami)/.test(tool.name)
      assert.equal(tool.annotations.readOnlyHint, readOnly, tool.name)
      assert.equal(tool.annotations.openWorldHint, false, tool.name)
      assert.equal(typeof tool.run, 'function')
      if (/^(delete|remove)_/.test(tool.name)) {
        assert.match(tool.description, /confirm with the user first\.$/i, tool.name)
        assert.equal(tool.annotations.destructiveHint, true, tool.name)
      }
    })
    assert.deepEqual(names.sort(), [
      'create_doc_page', 'create_doc_space', 'delete_doc_page', 'delete_doc_space', 'discard_doc_draft', 'get_doc_draft', 'get_doc_page', 'get_doc_space',
      'get_doc_version', 'list_doc_spaces', 'list_doc_versions', 'list_recent_doc_pages', 'move_doc_page', 'publish_doc_page', 'restore_doc_version',
      'save_doc_draft', 'search_docs', 'update_doc_space',
    ])
  })

  it('esquemas: título exigido no rascunho, parent_id exigido (null = topo) ao mover, versão inteira', () => {
    assert.deepEqual(validateArguments({ page_id: 'p' }, byName('save_doc_draft').inputSchema), { title: 'required', content_markdown: 'required' })
    assert.deepEqual(validateArguments({ page_id: 'p' }, byName('publish_doc_page').inputSchema), {})
    assert.deepEqual(validateArguments({ page_id: 'p' }, byName('move_doc_page').inputSchema), { parent_id: 'required' })
    assert.deepEqual(validateArguments({ page_id: 'p', parent_id: null }, byName('move_doc_page').inputSchema), {})
    assert.deepEqual(validateArguments({ page_id: 'p', version: 1.5 }, byName('get_doc_version').inputSchema), { version: 'invalid_type' })
    assert.deepEqual(validateArguments({ key: 'ENG', name: 'Eng', visibility: 'team' }, byName('create_doc_space').inputSchema), { visibility: 'invalid_option' })
  })

  it('busca, recentes e espaços: argumentos no formato da API (chave no get, id no resto)', async () => {
    const { calls, services } = spyServices()
    await byName('search_docs').run({ query: 'implantação' }, { services, ctx })
    await byName('list_recent_doc_pages').run({}, { services, ctx })
    await byName('list_doc_spaces').run({}, { services, ctx })
    await byName('get_doc_space').run({ space_key: 'ENG' }, { services, ctx })
    await byName('create_doc_space').run({ key: 'ENG', name: 'Engenharia', visibility: 'project', project_id: 'p1' }, { services, ctx })
    await byName('update_doc_space').run({ space_id: 'sp1', name: 'Eng', color: 'blue' }, { services, ctx })
    await byName('delete_doc_space').run({ space_id: 'sp1' }, { services, ctx })
    assert.deepEqual(
      calls.map((c) => [c.service, c.method, c.args]),
      [
        ['docPages', 'search', [{ q: 'implantação' }]],
        ['docPages', 'recent', []],
        ['docSpaces', 'listSpaces', []],
        ['docSpaces', 'getSpace', ['ENG']],
        ['docSpaces', 'createSpace', [{ key: 'ENG', name: 'Engenharia', visibility: 'project', project_id: 'p1' }]],
        ['docSpaces', 'updateSpace', ['sp1', { name: 'Eng', color: 'blue' }]],
        ['docSpaces', 'deleteSpace', ['sp1']],
      ],
    )
  })

  it('get_doc_page: conteúdo em Markdown, sem o JSON do editor, com trilha, filhas e rascunho enxutos', async () => {
    const { calls, services } = spyServices({ 'docPages.getPage': PAGE })
    const out = await byName('get_doc_page').run({ page_id: 'pg1' }, { services, ctx })
    assert.deepEqual(calls[0].args, ['pg1'])
    assert.equal(out.content_markdown, '## Guia\n\nLeia **antes**')
    assert.equal(out.content, undefined)
    assert.deepEqual(out.breadcrumb, [{ id: 'pg0', title: 'Início' }])
    assert.deepEqual(out.children, [{ id: 'pg2', title: 'Filha', status: 'draft' }])
    assert.deepEqual(out.published_by, { id: 'u2', name: 'Ana' })
    assert.deepEqual(out.draft, { title: 'Guia 2', by: { id: 'u2', name: 'Ana' }, at: '2026-10-02T10:00:00.000Z' })
    assert.equal(out.version, 3)
    // nunca publicada: sem conteúdo
    const draftOnly = spyServices({ 'docPages.getPage': Object.assign({}, PAGE, { status: 'draft', content: null, draft: null, published_by: null }) })
    const fresh = await byName('get_doc_page').run({ page_id: 'pg1' }, { services: draftOnly.services, ctx })
    assert.equal(fresh.content_markdown, null)
    assert.equal(fresh.draft, null)
  })

  it('save_doc_draft e publish_doc_page: o Markdown vira o documento do editor antes do caso de uso', async () => {
    const { calls, services } = spyServices({ 'docPages.publishPage': PAGE, 'docPages.saveDraft': { saved_at: 'x' } })
    const md = '## Guia\n\n> [!TIP]\n> Use `npm ci`\n\n- [x] feito'
    await byName('save_doc_draft').run({ page_id: 'pg1', title: 'Guia', content_markdown: md }, { services, ctx })
    const published = await byName('publish_doc_page').run({ page_id: 'pg1', content_markdown: 'Texto **novo**' }, { services, ctx })
    await byName('publish_doc_page').run({ page_id: 'pg1' }, { services, ctx })
    const [save, publish, publishDraft] = calls
    assert.equal(save.method, 'saveDraft')
    assert.equal(save.args[0], 'pg1')
    assert.equal(save.args[1].title, 'Guia')
    assert.deepEqual(save.args[1].content, {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Guia' }] },
        { type: 'callout', attrs: { tone: 'success' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Use ' }, { type: 'text', text: 'npm ci', marks: [{ type: 'code' }] }] }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'feito' }] }] }] },
      ],
    })
    assert.deepEqual(sanitizeDoc(save.args[1].content).doc, save.args[1].content)
    assert.deepEqual(publish.args, ['pg1', { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Texto ' }, { type: 'text', text: 'novo', marks: [{ type: 'bold' }] }] }] } }])
    // sem conteúdo: publica o rascunho como está
    assert.deepEqual(publishDraft.args, ['pg1', {}])
    assert.equal(published.content_markdown, undefined)
    assert.equal(published.content, undefined)
    assert.equal(published.version, 3)
  })

  it('páginas e versões: ids no caminho e o resto como corpo; versões em Markdown', async () => {
    const version = { version: 2, title: 'Guia', content: DOC, author: user, created_at: '2026-09-01T00:00:00.000Z' }
    const draft = { title: 'Guia 2', content: DOC, saved_at: '2026-10-02T10:00:00.000Z', by: user }
    const { calls, services } = spyServices({
      'docPages.createPage': Object.assign({}, PAGE, { status: 'draft', content: null }),
      'docPages.movePage': PAGE,
      'docPages.restoreVersion': PAGE,
      'docPages.getVersion': version,
      'docPages.getDraft': draft,
    })
    const created = await byName('create_doc_page').run({ space_id: 'sp1', title: 'Nova', parent_id: 'pg0' }, { services, ctx })
    await byName('move_doc_page').run({ page_id: 'pg1', parent_id: null, next_id: 'pg3' }, { services, ctx })
    await byName('discard_doc_draft').run({ page_id: 'pg1' }, { services, ctx })
    await byName('delete_doc_page').run({ page_id: 'pg1' }, { services, ctx })
    await byName('list_doc_versions').run({ page_id: 'pg1' }, { services, ctx })
    const got = await byName('get_doc_version').run({ page_id: 'pg1', version: 2 }, { services, ctx })
    await byName('restore_doc_version').run({ page_id: 'pg1', version: 2 }, { services, ctx })
    const gotDraft = await byName('get_doc_draft').run({ page_id: 'pg1' }, { services, ctx })
    assert.deepEqual(
      calls.map((c) => [c.service, c.method, c.args]),
      [
        ['docPages', 'createPage', ['sp1', { title: 'Nova', parent_id: 'pg0' }]],
        ['docPages', 'movePage', ['pg1', { parent_id: null, next_id: 'pg3' }]],
        ['docPages', 'discardDraft', ['pg1']],
        ['docPages', 'deletePage', ['pg1']],
        ['docPages', 'listVersions', ['pg1']],
        ['docPages', 'getVersion', ['pg1', 2]],
        ['docPages', 'restoreVersion', ['pg1', 2]],
        ['docPages', 'getDraft', ['pg1']],
      ],
    )
    assert.equal(created.id, 'pg1')
    assert.equal(created.content, undefined)
    assert.deepEqual(got, { version: 2, title: 'Guia', content_markdown: '## Guia\n\nLeia **antes**', author: { id: 'u2', name: 'Ana' }, created_at: '2026-09-01T00:00:00.000Z' })
    assert.deepEqual(gotDraft, { title: 'Guia 2', content_markdown: '## Guia\n\nLeia **antes**', saved_at: '2026-10-02T10:00:00.000Z', by: { id: 'u2', name: 'Ana' } })
  })
})
