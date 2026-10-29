/**
 * Catálogo MCP — Documentação (espaços e páginas estilo Confluence, rascunho, publicação, versões e
 * busca). Cada ferramenta só delega para o caso de uso da rota correspondente (http/routes.js:
 * services.docSpaces e services.docPages); permissões, higienização, histórico e versões são os dos
 * casos de uso.
 *
 * O conteúdo das páginas é o JSON do editor (TipTap); para o modelo ele entra e sai em Markdown
 * (domain/doc-markdown.js) — a conversão é só de formato, a higienização continua no caso de uso.
 * Envio de arquivos fica de fora (o MCP fala só JSON): imagens precisam já existir na documentação.
 */

const docsDomain = require('../../domain/docs')
const { markdownToDoc, docToMarkdown } = require('../../domain/doc-markdown')
const { READ, ADD, CHANGE, ACTION, DELETE, schema, id, nullableId, text, oneOf, int, color, PROJECT_ID, pick } = require('../kit')

// ---------------------------------------------------------------- esquemas locais

const SPACE_ID = id('Documentation space id (from list_doc_spaces or get_doc_space).')
const PAGE_ID = id('Page id (from get_doc_space, search_docs or list_recent_doc_pages).')
const TITLE = text(200, 'Page title.')
const VERSION = int(1, 1000000, 'Version number (from list_doc_versions).')
const MARKDOWN = text(
  500000,
  'Page content in Markdown: headings (# to ####), **bold**, *italic*, ~~strike~~, `code`, ==highlight==, <u>underline</u>, links (http(s), mailto or /docs/...), bullet/numbered/task lists (- [ ] / - [x]) nested by indentation, > quotes, fenced code blocks with language, ---, GFM tables (first row = header), callouts as > [!NOTE] / [!TIP] / [!WARNING] / [!CAUTION], and [TOC] for a table of contents. Images only as ![alt](/api/v1/docs/files/<id>) of files already uploaded to the documentation (optionally {width=25|50|75|100%}); raw HTML is kept as text. It replaces the whole content.',
)

const SPACE_FIELDS = {
  name: text(80, 'Space name.'),
  description: text(500, 'Short description (also the first paragraph of the home page when the space is created).'),
  icon: text(64, `Icon: one of ${docsDomain.SPACE_ICONS.join(', ')} or the name of an icon imported into the icon library.`),
  color: color(),
  visibility: oneOf(docsDomain.SPACE_VISIBILITIES, 'company = everyone with docs.view; project = only people who see the project (needs project_id).'),
}

// ---------------------------------------------------------------- apresentação

const who = (user) => (user ? { id: user.id, name: user.name } : null)

/** Página enxuta (sem o JSON do editor); `content_markdown` só quando pedido. */
function compactPage(page, withContent) {
  const out = {
    id: page.id,
    space: page.space,
    title: page.title,
    status: page.status,
    version: page.version,
    is_home: page.is_home,
    parent_id: page.parent_id,
    breadcrumb: page.ancestors,
    children: page.children,
    published_at: page.published_at,
    published_by: who(page.published_by),
    draft: page.draft ? { title: page.draft.title, by: who(page.draft.by), at: page.draft.at } : null,
    capabilities: page.capabilities,
  }
  if (withContent) out.content_markdown = page.content ? docToMarkdown(page.content) : null
  return out
}

/** Corpo de rascunho/publicação: Markdown vira o documento do editor. */
function pageBody(args) {
  const body = pick(args, ['title'])
  if (args.content_markdown !== undefined) body.content = markdownToDoc(args.content_markdown)
  return body
}

// ---------------------------------------------------------------- ferramentas

const TOOLS = [
  // ---------------------------------------------------------------- busca
  {
    name: 'search_docs',
    title: 'Search documentation',
    description:
      'Searches the title and published content of the documentation pages the user can read (accent and case insensitive), up to 30 results with a snippet. Read a result with get_doc_page.',
    inputSchema: schema({ query: text(100, 'Text to search (2 to 100 characters).') }, ['query']),
    annotations: READ,
    run: (args, { services, ctx }) => services.docPages.search(ctx, { q: args.query }),
  },
  {
    name: 'list_recent_doc_pages',
    title: 'Recently published pages',
    description: 'Lists the 10 most recently published documentation pages the user can read, with space and who published them.',
    inputSchema: schema({}),
    annotations: READ,
    run: (_args, { services, ctx }) => services.docPages.recent(ctx),
  },

  // ---------------------------------------------------------------- espaços
  {
    name: 'list_doc_spaces',
    title: 'List documentation spaces',
    description:
      'Lists the documentation spaces the user can read (company-wide or of a project): id, key, name, visibility, project, home page, number of published pages and what the user can do (edit pages, manage the space).',
    inputSchema: schema({}),
    annotations: READ,
    run: (_args, { services, ctx }) => services.docSpaces.listSpaces(ctx),
  },
  {
    name: 'get_doc_space',
    title: 'Get documentation space',
    description:
      'Returns a space by its key with its page tree as a flat list (parent_id, position order, status draft/published, has_draft, is_home). Drafts that were never published only appear to people who can edit.',
    inputSchema: schema({ space_key: text(10, 'Space key (e.g. ENG), from list_doc_spaces.') }, ['space_key']),
    annotations: READ,
    run: (args, { services, ctx }) => services.docSpaces.getSpace(ctx, args.space_key),
  },
  {
    name: 'create_doc_space',
    title: 'Create documentation space',
    description:
      'Creates a documentation space; its home page is created and published with the space name. A project space needs being a manager of the project. Requires docs.manage.',
    inputSchema: schema(
      Object.assign(
        {
          key: text(10, 'Unique key: 2-10 uppercase letters or digits, starting with a letter (e.g. ENG). It cannot change later.'),
          project_id: PROJECT_ID,
        },
        SPACE_FIELDS,
      ),
      ['key', 'name', 'visibility'],
    ),
    annotations: ADD,
    run: (args, { services, ctx }) => services.docSpaces.createSpace(ctx, args),
  },
  {
    name: 'update_doc_space',
    title: 'Update documentation space',
    description: 'Changes a space (only the fields sent). The key and the project cannot change. Requires managing the space.',
    inputSchema: schema(Object.assign({ space_id: SPACE_ID }, SPACE_FIELDS), ['space_id']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.docSpaces.updateSpace(ctx, args.space_id, pick(args, Object.keys(SPACE_FIELDS))),
  },
  {
    name: 'delete_doc_space',
    title: 'Delete documentation space',
    description: 'Permanently deletes a space with all its pages, versions and files. It cannot be undone. Requires managing the space. Confirm with the user first.',
    inputSchema: schema({ space_id: SPACE_ID }, ['space_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.docSpaces.deleteSpace(ctx, args.space_id),
  },

  // ---------------------------------------------------------------- páginas
  {
    name: 'get_doc_page',
    title: 'Get documentation page',
    description:
      'Returns a page with its published content as content_markdown (null if never published), version, breadcrumb (ancestors from the top), children and, for editors, whether there is a pending draft (read it with get_doc_draft).',
    inputSchema: schema({ page_id: PAGE_ID }, ['page_id']),
    annotations: READ,
    run: async (args, { services, ctx }) => compactPage(await services.docPages.getPage(ctx, args.page_id), true),
  },
  {
    name: 'create_doc_page',
    title: 'Create documentation page',
    description:
      'Creates an empty page in a space, at the end of the top level or under parent_id (at most 8 levels). It starts as a draft only editors see: write it with save_doc_draft and make it public with publish_doc_page (or publish directly with content). Requires docs.edit.',
    inputSchema: schema({ space_id: SPACE_ID, title: TITLE, parent_id: id('Parent page id (same space); omit for the top level.') }, ['space_id', 'title']),
    annotations: ADD,
    run: async (args, { services, ctx }) => compactPage(await services.docPages.createPage(ctx, args.space_id, pick(args, ['title', 'parent_id'])), false),
  },
  {
    name: 'get_doc_draft',
    title: 'Get page draft',
    description: 'Returns what an editor is working on: the draft title and content_markdown, or the published ones when there is no draft (saved_at null). Requires being able to edit the page.',
    inputSchema: schema({ page_id: PAGE_ID }, ['page_id']),
    annotations: READ,
    run: async (args, { services, ctx }) => {
      const draft = await services.docPages.getDraft(ctx, args.page_id)
      return { title: draft.title, content_markdown: docToMarkdown(draft.content), saved_at: draft.saved_at, by: who(draft.by) }
    },
  },
  {
    name: 'save_doc_draft',
    title: 'Save page draft',
    description:
      'Saves the draft of a page (title and the whole content in Markdown) without changing what readers see; one draft per page, the last save wins. Publish it with publish_doc_page. Images must already exist in the documentation (no upload here).',
    inputSchema: schema({ page_id: PAGE_ID, title: TITLE, content_markdown: MARKDOWN }, ['page_id', 'title', 'content_markdown']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.docPages.saveDraft(ctx, args.page_id, pageBody(args)),
  },
  {
    name: 'publish_doc_page',
    title: 'Publish page',
    description:
      'Publishes a page as its next version and clears the draft. Without content_markdown it publishes the pending draft (or republishes the current content); title defaults to the draft or current title. Every call creates a version.',
    inputSchema: schema({ page_id: PAGE_ID, title: TITLE, content_markdown: MARKDOWN }, ['page_id']),
    annotations: ACTION,
    run: async (args, { services, ctx }) => compactPage(await services.docPages.publishPage(ctx, args.page_id, pageBody(args)), false),
  },
  {
    name: 'discard_doc_draft',
    title: 'Discard page draft',
    description: 'Discards the pending draft of a page; the published content stays. The unpublished changes are lost: confirm with the user first.',
    inputSchema: schema({ page_id: PAGE_ID }, ['page_id']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.docPages.discardDraft(ctx, args.page_id),
  },
  {
    name: 'move_doc_page',
    title: 'Move page',
    description:
      'Moves a page (with its subpages) in the tree of its space: under parent_id (null = top level), optionally right before next_id or after prev_id among the new siblings (default: last). No cycles, at most 8 levels; the home page does not move.',
    inputSchema: schema(
      {
        page_id: PAGE_ID,
        parent_id: nullableId('New parent page id (same space); null = top level.'),
        prev_id: id('Sibling that should stay right above.'),
        next_id: id('Sibling that should stay right below.'),
      },
      ['page_id', 'parent_id'],
    ),
    annotations: CHANGE,
    run: async (args, { services, ctx }) => compactPage(await services.docPages.movePage(ctx, args.page_id, pick(args, ['parent_id', 'prev_id', 'next_id'])), false),
  },
  {
    name: 'delete_doc_page',
    title: 'Delete page',
    description: 'Permanently deletes a page with all its subpages, versions and files (the home page cannot be deleted). Returns how many pages were deleted. Confirm with the user first.',
    inputSchema: schema({ page_id: PAGE_ID }, ['page_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.docPages.deletePage(ctx, args.page_id),
  },

  // ---------------------------------------------------------------- versões
  {
    name: 'list_doc_versions',
    title: 'List page versions',
    description: 'Lists the published versions of a page, newest first: number, title, author and date.',
    inputSchema: schema({ page_id: PAGE_ID }, ['page_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.docPages.listVersions(ctx, args.page_id),
  },
  {
    name: 'get_doc_version',
    title: 'Get page version',
    description: 'Returns one published version of a page: title, content_markdown, author and date.',
    inputSchema: schema({ page_id: PAGE_ID, version: VERSION }, ['page_id', 'version']),
    annotations: READ,
    run: async (args, { services, ctx }) => {
      const found = await services.docPages.getVersion(ctx, args.page_id, args.version)
      return { version: found.version, title: found.title, content_markdown: docToMarkdown(found.content), author: who(found.author), created_at: found.created_at }
    },
  },
  {
    name: 'restore_doc_version',
    title: 'Restore page version',
    description: 'Publishes the title and content of an old version as the next version (history is kept; the pending draft is cleared). Requires being able to edit the page.',
    inputSchema: schema({ page_id: PAGE_ID, version: VERSION }, ['page_id', 'version']),
    annotations: ACTION,
    run: async (args, { services, ctx }) => compactPage(await services.docPages.restoreVersion(ctx, args.page_id, args.version), false),
  },
]

module.exports = { TOOLS }
