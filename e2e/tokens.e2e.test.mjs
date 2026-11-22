/**
 * Tokens de API no navegador: criar em Minha conta (o valor aparece uma vez), usar fora do navegador
 * com `Authorization: Bearer`, revogar e o acesso cair.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN, launchBrowser, login, seedBase, startApp } from './support.mjs'

describe('E2E — Tokens de API', { timeout: 180000 }, () => {
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

  const me = (token) => fetch(`${app.baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })

  it('cria em Minha conta, usa com Bearer fora do navegador e revoga', async () => {
    const { page, context, errors } = await login(browser, app.baseUrl, ADMIN.email, ADMIN.password)
    contexts.push(context)
    await page.goto(`${app.baseUrl}/account`)
    await page.getByRole('link', { name: 'Gerenciar tokens' }).click()
    await page.getByRole('heading', { name: 'Tokens de API' }).waitFor()
    await page.getByRole('button', { name: 'Novo token' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Nome/).fill('Planilha de horas')
    await dialog.getByRole('button', { name: 'Novo token' }).click()
    await page.getByText('Copie o seu token agora').waitFor()
    const token = await page.getByLabel('Token', { exact: true }).inputValue()
    assert.match(token, /^kb_pat_[A-Za-z0-9]{40}$/)
    await page.getByRole('button', { name: 'Já copiei' }).click()

    const response = await me(token)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).data.user.email, ADMIN.email)

    await page.reload()
    await page.getByText('Planilha de horas').waitFor()
    // Revogar (o Excluir da tabela) vem desligado em "Colunas e ações": fica no ··· da linha
    await page.getByRole('row').filter({ hasText: 'Planilha de horas' }).getByRole('button', { name: 'Mais ações' }).click()
    await page.getByRole('menuitem', { name: 'Revogar Planilha de horas' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Revogar' }).click()
    await page.getByText('Token "Planilha de horas" revogado.').waitFor()
    assert.equal((await me(token)).status, 401)
    assert.deepEqual(errors, [])
  })
})
