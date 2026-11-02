/**
 * Catálogo de auditoria (Fase 9): toda ação que o servidor grava em audit_logs precisa de
 * rótulo legível nos três idiomas e estar no filtro da página de auditoria.
 * Uma ação nova sem rótulo quebra este teste (evita histórico com texto técnico na tela).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '..', '..', 'pb_hooks', 'src')
const WEB = path.join(__dirname, '..', '..', '..', 'web', 'src')
const ENTITIES = ['auth', 'user', 'role', 'project', 'task', 'task_type', 'custom_field', 'comment', 'attachment', 'tag', 'sprint', 'milestone', 'charter', 'charter_item', 'doc_space', 'doc_page', 'project_group', 'plan_item', 'plan_status', 'plan_resource', 'plan_settings', 'plan_journal', 'plan_issue', 'plan_column', 'platform_settings', 'audit_log', 'email_settings', 'api_token', 'webhook']

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? sourceFiles(full) : entry.name.endsWith('.js') ? [full] : []
  })
}

function emittedActions() {
  const found = new Set()
  const re = new RegExp(`'((?:${ENTITIES.join('|')})\\.[a-z_]+)'`, 'g')
  sourceFiles(path.join(SRC, 'application')).forEach((file) => {
    const text = fs.readFileSync(file, 'utf8')
    let m
    while ((m = re.exec(text))) found.add(m[1])
  })
  // status e prioridades: `${entity}.${action}` em application/lookups.js
  ;['status', 'priority'].forEach((entity) => ['created', 'updated', 'deleted', 'reordered'].forEach((verb) => found.add(`${entity}.${verb}`)))
  return [...found].sort()
}

describe('catálogo de auditoria', () => {
  const actions = emittedActions()

  it('encontrou as ações gravadas pelo servidor', () => {
    assert.ok(actions.length > 50, `só ${actions.length} ações`)
  })

  it('toda ação tem rótulo em pt-BR, en e es', () => {
    const missing = []
    ;['pt-BR', 'en', 'es'].forEach((lang) => {
      const labels = JSON.parse(fs.readFileSync(path.join(WEB, 'core', 'i18n', 'locales', `${lang}.json`), 'utf8')).audit.actions
      actions.forEach((action) => {
        if (!labels[action]) missing.push(`${lang}: ${action}`)
      })
    })
    assert.deepEqual(missing, [])
  })

  it('toda ação aparece no filtro da página de auditoria', () => {
    const format = fs.readFileSync(path.join(WEB, 'features', 'audit', 'audit-format.ts'), 'utf8')
    const missing = actions.filter((action) => !format.includes(`'${action}'`))
    assert.deepEqual(missing, [])
  })
})
