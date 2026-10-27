/**
 * E-mail no navegador (PocketBase isolado + SMTP de teste): o Admin configura o envio na tela e manda
 * o teste; "Esqueci minha senha" ponta a ponta (pedido → e-mail → link → nova senha → login); convite
 * de usuário (sem senha → link → criar senha → login).
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { ADMIN, launchBrowser, login, seedBase, startApp } from './support.mjs'

const require = createRequire(import.meta.url)
const { startSmtpSink } = require('../backend/tests/support/smtp-sink.js')
const linkOf = (message) => /(https?:\/\/[^\s]+\/reset-password\?token=[A-Za-z0-9_-]+)/.exec(message.text)[1]

describe('E2E — E-mail', { timeout: 240000 }, () => {
  let app
  let browser
  let smtp
  const contexts = []

  before(async () => {
    app = await startApp()
    browser = await launchBrowser()
    smtp = await startSmtpSink()
    await seedBase(app.admin)
  })

  after(async () => {
    for (const context of contexts) await context.close().catch(() => {})
    if (browser) await browser.close()
    if (app) await app.pb.stop()
    if (smtp) await smtp.stop()
  })

  async function guest() {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
    contexts.push(context)
    return context.newPage()
  }

  const flush = async () => assert.equal((await app.admin.post('/settings/email/outbox/flush')).status, 200)

  it('Admin configura o envio na tela e o e-mail de teste chega', async () => {
    const { page, context, errors } = await login(browser, app.baseUrl, ADMIN.email, ADMIN.password)
    contexts.push(context)
    await page.goto(`${app.baseUrl}/settings/integrations`)
    await page.getByRole('heading', { name: 'Integrações' }).waitFor()
    await page.getByRole('switch', { name: /Enviar e-mails/ }).click()
    await page.getByLabel(/^Servidor/).fill('127.0.0.1')
    await page.getByLabel(/^Porta/).fill(String(smtp.port))
    await page.getByLabel(/^Nome do remetente/).fill('Portal')
    await page.getByLabel(/^E-mail do remetente/).fill('portal@empresa.test')
    await page.getByLabel(/^Endereço da plataforma/).fill(app.baseUrl)
    await page.getByRole('button', { name: 'Salvar' }).click()
    await page.getByText('Configurações de e-mail salvas.').waitFor()
    await page.getByRole('button', { name: 'Enviar e-mail de teste' }).click()
    await page.getByText(`E-mail de teste enviado para ${ADMIN.email}.`).waitFor()
    const message = await smtp.waitFor((m) => m.subject === 'Teste de e-mail — Avanza')
    assert.deepEqual(message.to, [ADMIN.email])
    assert.deepEqual(errors, [])
  })

  it('"Esqueci minha senha": pedido no login, link do e-mail, nova senha e entrada com ela', async () => {
    const page = await guest()
    await page.goto(`${app.baseUrl}/login`)
    await page.getByRole('link', { name: 'Esqueci minha senha' }).click()
    await page.getByLabel(/^E-mail/).fill('mario@kamban.test')
    await page.getByRole('button', { name: 'Enviar link' }).click()
    await page.getByText(/o link chega em instantes/).waitFor()
    await flush()
    const message = await smtp.waitFor((m) => m.to[0] === 'mario@kamban.test' && /Redefinir/.test(m.subject))

    await page.goto(linkOf(message))
    await page.getByRole('heading', { name: 'Nova senha' }).waitFor()
    await page.getByLabel(/^Nova senha/).fill('SenhaNovaDoMario1')
    await page.getByLabel(/^Confirme a nova senha/).fill('SenhaNovaDoMario1')
    await page.getByRole('button', { name: 'Salvar nova senha' }).click()
    await page.waitForURL('**/login')
    await page.getByText('Senha alterada. Entre com a senha nova.').waitFor()
    await page.getByLabel(/^E-mail/).fill('mario@kamban.test')
    await page.getByLabel(/^Senha/).fill('SenhaNovaDoMario1')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await page.waitForURL('**/dashboard')

    // o mesmo link não vale de novo
    const again = await guest()
    await again.goto(linkOf(message))
    await again.getByText('Este link já foi usado. Cada link vale uma vez.').waitFor()
  })

  it('convite: Admin cria a pessoa sem senha; ela cria a dela pelo link e entra', async () => {
    const { page, context, errors } = await login(browser, app.baseUrl, ADMIN.email, ADMIN.password)
    contexts.push(context)
    await page.goto(`${app.baseUrl}/users`)
    await page.getByRole('button', { name: 'Novo usuário' }).click()
    const dialog = page.getByRole('dialog')
    assert.equal(await dialog.getByRole('switch', { name: /Enviar convite por e-mail/ }).getAttribute('aria-checked'), 'true')
    await dialog.getByLabel(/^Nome/).fill('Bia Convidada')
    await dialog.getByLabel(/^E-mail/).fill('bia@kamban.test')
    await dialog.getByRole('button', { name: 'Novo usuário' }).click()
    await page.getByText('Convite enviado para bia@kamban.test.').waitFor()
    await flush()
    const message = await smtp.waitFor((m) => m.to[0] === 'bia@kamban.test')
    assert.equal(message.subject, 'Você foi convidado para o Avanza')

    const bia = await guest()
    await bia.goto(linkOf(message))
    await bia.getByRole('heading', { name: 'Crie sua senha' }).waitFor()
    await bia.getByLabel(/^Nova senha/).fill('SenhaDaBia12345')
    await bia.getByLabel(/^Confirme a nova senha/).fill('SenhaDaBia12345')
    await bia.getByRole('button', { name: 'Criar senha' }).click()
    await bia.waitForURL('**/login')
    await bia.getByLabel(/^E-mail/).fill('bia@kamban.test')
    await bia.getByLabel(/^Senha/).fill('SenhaDaBia12345')
    await bia.getByRole('button', { name: 'Entrar' }).click()
    await bia.waitForURL('**/dashboard')
    assert.deepEqual(errors, [])
  })
})
