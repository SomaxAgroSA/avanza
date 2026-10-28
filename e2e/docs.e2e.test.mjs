/**
 * Documentação (expansão, Onda 2) no navegador: espaço criado pela tela, página escrita no editor
 * (menu "/", aviso, imagem enviada, tabela), rascunho salvo sozinho, publicação, nova versão e
 * restauração, busca sem acento, arrastar na árvore e leitor sem edição nem rascunhos.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN, PASSWORD, api, launchBrowser, login, seedBase, startApp } from './support.mjs'

/** Os avisos (canto superior direito) ficam alguns segundos sobre as ações do topo. */
const toastsGone = async (page) => {
  // o aviso pausa enquanto o mouse está sobre ele
  await page.mouse.move(20, 600)
  await page.waitForSelector('.Toastify__toast', { state: 'detached', timeout: 15000 })
}

/** PNG 2×2 válido. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mNk+M9Qz0AEYBxVSF+FAAhKDveksOjmAAAAAElFTkSuQmCC', 'base64')

describe('E2E — Documentação', { timeout: 300000 }, () => {
  let app
  let browser
  const contexts = []

  before(async () => {
    app = await startApp()
    browser = await launchBrowser()
    await seedBase(app.admin)
  })

  after(async () => {
    for (const context of contexts) await context.close().catch(() => {})
    if (browser) await browser.close()
    if (app) await app.pb.stop()
  })

  async function signIn(email, password, options) {
    const session = await login(browser, app.baseUrl, email, password, options)
    contexts.push(session.context)
    return session
  }

  it('espaço e página no editor; publica, versiona, restaura; busca; árvore; leitor', async () => {
    const { page, errors } = await signIn(ADMIN.email, ADMIN.password, { viewport: { width: 1600, height: 900 } })
    await page.goto(`${app.baseUrl}/docs`)
    await page.getByRole('button', { name: 'Novo espaço' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Novo espaço de documentação' })
    await dialog.getByRole('textbox', { name: /Nome/ }).fill('Manual do CRM')
    assert.equal(await dialog.getByRole('textbox', { name: /Chave/ }).inputValue(), 'MDC')
    await dialog.getByRole('textbox', { name: /Descrição/ }).fill('Como usar o CRM no dia a dia.')
    await dialog.getByRole('button', { name: 'Criar espaço' }).click()
    await page.waitForURL('**/docs/MDC')
    await page.getByRole('heading', { level: 1, name: 'Manual do CRM' }).waitFor()

    // nova página abre direto no editor
    await page.getByRole('button', { name: 'Nova página' }).click()
    await page.waitForURL('**/edit')
    const pageId = page.url().split('/docs/MDC/')[1].split('/')[0]
    await page.getByRole('textbox', { name: 'Título da página' }).fill('Cadastro de clientes')
    const editor = page.getByRole('textbox', { name: 'Conteúdo da página' })
    await editor.click()
    await page.keyboard.type('/h2')
    await page.getByRole('listbox', { name: 'Inserir bloco' }).waitFor()
    await page.keyboard.press('Enter')
    await page.keyboard.type('Regras')
    await page.keyboard.press('Enter')
    await page.keyboard.type('O cadastro exige a validação do CNPJ.')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/atencao')
    await page.getByRole('option', { name: /Aviso: atenção/ }).waitFor()
    await page.keyboard.press('Enter')
    await page.keyboard.type('Não salve sem o CNPJ.')
    await page.keyboard.press('ArrowDown')
    // imagem pelo botão da barra (o seletor de arquivos do sistema)
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('toolbar', { name: 'Formatação' }).getByRole('button', { name: 'Imagem' }).click()
    await (await chooser).setFiles({ name: 'tela.png', mimeType: 'image/png', buffer: PNG })
    await editor.locator('img[src^="/api/v1/docs/files/"]').waitFor()
    await page.getByRole('button', { name: 'Inserir' }).click()
    await page.getByRole('menuitem', { name: 'Tabela' }).click()
    // o menu fecha (o foco passa um instante pelo body) e só então devolve o foco ao texto: digitar
    // antes disso perde as teclas e o Tab vai para o link "Pular para o conteúdo"
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Conteúdo da página')
    await page.keyboard.type('Campo')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Regra')
    // o rascunho é salvo sozinho, pouco depois de parar de digitar
    await page.waitForFunction(
      async (id) => {
        const res = await fetch(`/api/v1/docs/pages/${id}/draft`)
        const body = await res.json()
        return JSON.stringify(body.data.content).includes('"Regra"')
      },
      pageId,
      { timeout: 10000, polling: 500 },
    )
    await page.getByText(/Rascunho salvo às/).waitFor()
    const draft = (await api(page, 'GET', `/docs/pages/${pageId}/draft`)).json.data
    assert.equal(draft.title, 'Cadastro de clientes')
    assert.match(JSON.stringify(draft.content), /"callout".*"image".*"table"/)

    await page.getByRole('button', { name: 'Publicar', exact: true }).click()
    await page.waitForURL(`**/docs/MDC/${pageId}`)
    await page.getByRole('heading', { level: 1, name: 'Cadastro de clientes' }).waitFor()
    await page.getByRole('heading', { level: 2, name: 'Regras' }).waitFor()
    await page.getByRole('note', { name: 'Atenção' }).getByText('Não salve sem o CNPJ.').waitFor()
    await page.getByRole('table').getByText('Campo').waitFor()
    // a imagem carrega pelo download protegido
    const image = page.locator('article img').first()
    await image.waitFor()
    await page.waitForFunction((el) => el.complete && el.naturalWidth === 2, await image.elementHandle())
    await page.getByText(/Versão 1 · publicada por/).waitFor()

    // a coluna do espaço recolhe e expande pelo mesmo botão (rodapé); a escolha fica lembrada ao recarregar
    const panel = page.getByRole('complementary', { name: 'Painel do espaço Manual do CRM' })
    const panelTree = panel.getByRole('navigation', { name: 'Páginas do espaço' })
    await panel.getByRole('button', { name: 'Recolher painel' }).click()
    await panelTree.waitFor({ state: 'detached' })
    await page.reload()
    await page.getByRole('heading', { level: 1, name: 'Cadastro de clientes' }).waitFor()
    assert.equal(await panelTree.count(), 0)
    await panel.getByRole('button', { name: 'Expandir painel', exact: true }).click()
    await panelTree.waitFor()

    // nova versão e restauração da primeira
    await toastsGone(page)
    await page.getByRole('button', { name: 'Editar' }).click()
    await page.waitForURL('**/edit')
    await page.getByRole('textbox', { name: 'Título da página' }).fill('Cadastro de clientes (revisado)')
    await page.getByRole('button', { name: 'Publicar alterações' }).click()
    await page.getByRole('heading', { level: 1, name: 'Cadastro de clientes (revisado)' }).waitFor()
    await page.getByText(/Versão 2 · publicada por/).waitFor()
    await toastsGone(page)
    await page.getByRole('button', { name: 'Versões' }).click()
    const drawer = page.getByRole('dialog', { name: 'Histórico de versões' })
    await drawer.getByRole('button', { name: /^Versão 1/ }).click()
    await drawer.getByRole('button', { name: 'Restaurar esta versão' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Restaurar esta versão' }).click()
    await page.getByText(/Versão 3 · publicada por/).waitFor()
    await page.getByRole('heading', { level: 1, name: 'Cadastro de clientes' }).waitFor()

    // busca sem acento, com destaque
    await page.goto(`${app.baseUrl}/docs`)
    await page.getByRole('searchbox', { name: 'Buscar na documentação' }).fill('VALIDACAO')
    await page.getByText('1 página encontrada').waitFor()
    await page.locator('mark', { hasText: 'validação' }).first().waitFor()

    // árvore: arrastar "FAQ" para dentro de "Cadastro de clientes"
    const space = (await api(page, 'GET', '/docs/spaces/MDC')).json.data.space
    const faq = (await api(page, 'POST', `/docs/spaces/${space.id}/pages`, { title: 'FAQ' })).json.data
    await api(page, 'POST', `/docs/pages/${faq.id}/publish`, { title: 'FAQ', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Perguntas frequentes.' }] }] } })
    const hidden = (await api(page, 'POST', `/docs/spaces/${space.id}/pages`, { title: 'Rascunho interno' })).json.data
    await page.goto(`${app.baseUrl}/docs/MDC/${pageId}`)
    const tree = page.getByRole('navigation', { name: 'Páginas do espaço' })
    const faqRow = tree.getByRole('link', { name: 'FAQ' }).locator('..')
    const targetRow = tree.getByRole('link', { name: 'Cadastro de clientes' }).locator('..')
    const box = await targetRow.boundingBox()
    await faqRow.dragTo(targetRow, { targetPosition: { x: 60, y: box.height / 2 } })
    await page.waitForFunction(
      async ([id, parent]) => {
        const res = await fetch('/api/v1/docs/spaces/MDC')
        const body = await res.json()
        return body.data.pages.some((p) => p.id === id && p.parent_id === parent)
      },
      [faq.id, pageId],
      { timeout: 10000 },
    )
    assert.deepEqual(errors, [])

    // leitor: lê, não edita, não vê rascunhos
    const viewer = await signIn('lia@kamban.test', PASSWORD)
    await viewer.page.goto(`${app.baseUrl}/docs/MDC/${pageId}`)
    await viewer.page.getByRole('heading', { level: 1, name: 'Cadastro de clientes' }).waitFor()
    await viewer.page.getByRole('navigation', { name: 'Páginas do espaço' }).getByRole('link', { name: 'FAQ' }).waitFor()
    assert.equal(await viewer.page.getByRole('button', { name: 'Editar' }).count(), 0)
    assert.equal(await viewer.page.getByRole('button', { name: 'Nova página' }).count(), 0)
    assert.equal(await viewer.page.getByRole('link', { name: 'Rascunho interno' }).count(), 0)
    assert.equal((await api(viewer.page, 'GET', `/docs/pages/${hidden.id}`)).status, 404)
    assert.equal((await api(viewer.page, 'PUT', `/docs/pages/${pageId}/draft`, { title: 'X', content: { type: 'doc', content: [] } })).status, 403)
    await viewer.page.goto(`${app.baseUrl}/docs/MDC/${pageId}/edit`)
    await viewer.page.waitForURL(`**/docs/MDC/${pageId}`)
    assert.deepEqual(viewer.errors, [])
  })
})
