/**
 * Casos de uso do Configurador geral (regras de negócio §15): configurações da plataforma (só
 * `platform.manage`), identidade pública (nome, logo e ícone — sem login), política de senha
 * (quem está logado), a limpeza diária do histórico de auditoria (rotina, sem usuário) e as Dependências
 * por área (§42, `settings.manage`; as antigas Pessoas de TI viram a área TI).
 *
 * Porta: `platformSettingsRepository` { get() → { values, files: { slot: { name, mime, size } }, updatedAt },
 * saveValues(values), setFile(slot, data), clearFile(slot), fileKeyOf(slot) }; o histórico usa
 * `auditRepository.countBefore(date)` e `purgeBefore(date)`.
 */

const { appError } = require('../core/errors')
const rbac = require('../domain/rbac')
const settingsDomain = require('../domain/platform-settings')
const { buildAuditEntry } = require('./audit')
const { toUserSummary } = require('./presenters')

const PERMISSION = 'platform.manage'
const IT_PEOPLE_PERMISSION = 'settings.manage'
const ENTITY = 'platform_settings'
const ENTITY_ID = 'platform'
const BRANDING_URL = '/api/v1/platform/branding/'

async function readRow(deps) {
  const repo = deps.platformSettingsRepository
  const row = repo ? await repo.get() : null
  return row || { values: {}, files: {}, updatedAt: null }
}

/** Valores vigentes (padrões onde ninguém mudou). Usado também pelo login e pelas senhas. */
async function currentSettings(deps) {
  return settingsDomain.normalizeSettings((await readRow(deps)).values)
}

async function currentPasswordPolicy(deps) {
  return settingsDomain.passwordPolicy(await currentSettings(deps))
}

async function currentLockoutPolicy(deps) {
  return settingsDomain.lockoutPolicy(await currentSettings(deps))
}

function invalid(fields) {
  return appError('VALIDATION_ERROR', undefined, { fields })
}

function createPlatformSettingsService(deps) {
  function presentBranding(files) {
    const out = {}
    settingsDomain.BRANDING_SLOTS.forEach((slot) => {
      const file = files && files[slot]
      out[slot] = file ? { name: file.name, mime: file.mime, size: file.size } : null
    })
    return out
  }

  function present(row) {
    return {
      values: settingsDomain.normalizeSettings(row.values),
      defaults: settingsDomain.DEFAULTS,
      limits: Object.assign({}, settingsDomain.LIMITS, { platform_name: { max: settingsDomain.NAME_MAX } }),
      retention_options: settingsDomain.RETENTION_MONTHS,
      branding: presentBranding(row.files),
      updated_at: row.updatedAt ? row.updatedAt.toISOString() : null,
    }
  }

  async function getSettings(ctx) {
    rbac.assertCan(ctx.principal, PERMISSION)
    return present(await readRow(deps))
  }

  /** Quantos registros do histórico ficam fora do prazo `months` (0 = nenhum). */
  async function auditOutside(months) {
    const cutoff = settingsDomain.retentionCutoff(months, deps.clock.now())
    return cutoff ? await deps.auditRepository.countBefore(cutoff) : 0
  }

  /**
   * Alteração parcial. Com `dry_run: true` só calcula a prévia (quantos registros do histórico a nova
   * retenção apagaria) — a tela pede confirmação ao encurtar o prazo.
   */
  async function updateSettings(ctx, raw) {
    rbac.assertCan(ctx.principal, PERMISSION)
    const input = Object.assign({}, raw || {})
    const dryRun = input.dry_run === true
    delete input.dry_run
    // Pessoas de TI e Dependências por área têm rotas e permissão próprias (settings.manage): aqui não entram
    ;['it_people', 'dependency_areas'].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(input, key)) throw invalid({ [key]: 'unknown_field' })
    })
    const before = await currentSettings(deps)
    const result = settingsDomain.validateSettings(input, before)
    if (Object.keys(result.fields).length > 0) throw invalid(result.fields)
    const after = result.values

    if (dryRun) {
      const shorter = settingsDomain.isShorterRetention(before.audit_retention_months, after.audit_retention_months)
      return { dry_run: true, audit_to_delete: shorter ? await auditOutside(after.audit_retention_months) : 0 }
    }

    const changes = settingsDomain.diffSettings(before, after)
    if (changes) {
      await deps.unitOfWork.run(async (repos) => {
        await repos.platformSettingsRepository.saveValues(after)
        await repos.auditRepository.record(
          buildAuditEntry(ctx, { entityType: ENTITY, entityId: ENTITY_ID, action: 'platform_settings.update', oldValue: changes.old, newValue: changes.new }),
        )
      })
    }
    return present(await readRow(deps))
  }

  /** `upload`: { name, size, bytes (conteúdo; SVG inteiro), handle (arquivo para gravar) }. */
  async function uploadBranding(ctx, slot, upload) {
    rbac.assertCan(ctx.principal, PERMISSION)
    if (settingsDomain.BRANDING_SLOTS.indexOf(slot) < 0) throw invalid({ slot: 'invalid_slot' })
    if (!upload) throw invalid({ file: 'required' })
    const sizeIssue = settingsDomain.brandingSizeIssue(upload.size)
    if (sizeIssue) throw invalid({ file: sizeIssue })
    const type = settingsDomain.classifyBranding(slot, upload.name, upload.bytes || [])
    if (type.error) throw invalid({ file: type.error })
    const name = String(upload.name).split(/[\\/]/).pop().slice(0, 150)

    await deps.unitOfWork.run(async (repos) => {
      await repos.platformSettingsRepository.setFile(slot, { handle: upload.handle, name, mime: type.mime, size: upload.size })
      await repos.auditRepository.record(
        buildAuditEntry(ctx, { entityType: ENTITY, entityId: ENTITY_ID, action: 'platform_settings.branding_update', newValue: { slot, name, size: upload.size } }),
      )
    })
    return present(await readRow(deps))
  }

  async function removeBranding(ctx, slot) {
    rbac.assertCan(ctx.principal, PERMISSION)
    if (settingsDomain.BRANDING_SLOTS.indexOf(slot) < 0) throw invalid({ slot: 'invalid_slot' })
    const row = await readRow(deps)
    if (row.files && row.files[slot]) {
      await deps.unitOfWork.run(async (repos) => {
        await repos.platformSettingsRepository.clearFile(slot)
        await repos.auditRepository.record(
          buildAuditEntry(ctx, { entityType: ENTITY, entityId: ENTITY_ID, action: 'platform_settings.branding_remove', oldValue: { slot, name: row.files[slot].name } }),
        )
      })
    }
    return present(await readRow(deps))
  }

  /** Público (tela de login, título e ícone da aba): só o nome e os endereços das imagens. */
  async function publicInfo() {
    const row = await readRow(deps)
    const values = settingsDomain.normalizeSettings(row.values)
    const stamp = row.updatedAt ? row.updatedAt.getTime() : 0
    const url = (slot) => (row.files && row.files[slot] ? `${BRANDING_URL}${slot}?v=${stamp}` : null)
    const email = deps.emailSettingsRepository ? (await deps.emailSettingsRepository.get()).values : null
    return {
      name: values.platform_name,
      logo_light_url: url('logo_light'),
      logo_dark_url: url('logo_dark'),
      favicon_url: url('favicon'),
      password_reset: !!(email && email.enabled),
    }
  }

  /** Arquivo público da identidade: { key, name, mime } — lugar desconhecido ou vazio = NOT_FOUND. */
  async function brandingFile(slot) {
    const row = await readRow(deps)
    const file = settingsDomain.BRANDING_SLOTS.indexOf(slot) >= 0 && row.files ? row.files[slot] : null
    if (!file) throw appError('NOT_FOUND')
    return { key: await deps.platformSettingsRepository.fileKeyOf(slot), name: file.name, mime: file.mime }
  }

  async function passwordPolicy(ctx) {
    rbac.assertAuthenticated(ctx.principal)
    return await currentPasswordPolicy(deps)
  }

  /** Rotina diária: apaga o histórico mais antigo que a retenção e registra quantos saíram. */
  async function purgeAuditLogs(ctx) {
    const months = (await currentSettings(deps)).audit_retention_months
    if (!months) return { removed: 0, skipped: true }
    const cutoff = settingsDomain.retentionCutoff(months, deps.clock.now())
    const removed = await deps.auditRepository.purgeBefore(cutoff)
    if (removed > 0) {
      await deps.auditRepository.record(
        buildAuditEntry(ctx || { ip: '', userAgent: 'kamban-cron', correlationId: '' }, {
          entityType: 'audit_log',
          entityId: 'retention',
          action: 'audit_log.purge',
          newValue: { removed, before: cutoff.toISOString(), retention_months: months },
          userId: ctx && ctx.principal ? ctx.principal.userId : null,
        }),
      )
    }
    return { removed }
  }

  /** "Limpar agora" na tela (mesma regra da rotina diária; fica no histórico com quem pediu). */
  async function runRetentionNow(ctx) {
    rbac.assertCan(ctx.principal, PERMISSION)
    return await purgeAuditLogs(ctx)
  }

  // ------------------------------------------------------------------ Dependências por área (§42)

  async function usersById(ids) {
    const users = ids.length ? await deps.userRepository.findManyByIds(ids) : []
    const byId = {}
    users.forEach((u) => {
      byId[u.id] = u
    })
    return byId
  }

  async function candidates() {
    return (await deps.userRepository.searchActive({ search: '', excludeIds: [], limit: 500 })).map(toUserSummary)
  }

  async function presentItPeople(ids) {
    const byId = await usersById(ids)
    return { user_ids: ids.filter((id) => byId[id]), users: ids.filter((id) => byId[id]).map((id) => toUserSummary(byId[id])) }
  }

  async function presentAreas(areas) {
    const byId = await usersById(areas.reduce((all, a) => all.concat(a.user_ids), []))
    return areas.map((a) => {
      const ids = a.user_ids.filter((id) => byId[id])
      return { key: a.key, name: a.name, user_ids: ids, users: ids.map((id) => toUserSummary(byId[id])) }
    })
  }

  /** "Área: Fulano, Sicrano" de cada área, para o histórico. */
  async function auditAreas(areas) {
    const byId = await usersById(areas.reduce((all, a) => all.concat(a.user_ids), []))
    return areas.map((a) => {
      const names = a.user_ids
        .filter((id) => byId[id])
        .map((id) => byId[id].name)
        .sort()
      return names.length ? `${a.name}: ${names.join(', ')}` : a.name
    })
  }

  /** Grava as áreas e espelha a TI em `it_people` (a rota antiga e uma versão anterior continuam certas). */
  async function saveAreas(ctx, before, areas) {
    const ti = areas.find((a) => a.key === settingsDomain.TI_AREA_KEY)
    const after = Object.assign({}, before, { dependency_areas: areas, it_people: ti.user_ids })
    if (!settingsDomain.diffSettings(before, after)) return
    const oldValue = { dependency_areas: await auditAreas(settingsDomain.resolveDependencyAreas(before)) }
    const newValue = { dependency_areas: await auditAreas(areas) }
    await deps.unitOfWork.run(async (repos) => {
      await repos.platformSettingsRepository.saveValues(after)
      await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: ENTITY, entityId: ENTITY_ID, action: 'platform_settings.update', oldValue, newValue }))
    })
  }

  /**
   * Áreas das "Dependências" (a TI sempre, com as antigas Pessoas de TI enquanto ninguém salvou a tela nova)
   * e os usuários ativos que podem ser escolhidos (`candidates`, até 500 — quem tem settings.manage nem
   * sempre tem users.view).
   */
  async function getDependencyAreas(ctx) {
    rbac.assertCan(ctx.principal, IT_PEOPLE_PERMISSION)
    const values = await currentSettings(deps)
    return { areas: await presentAreas(settingsDomain.resolveDependencyAreas(values)), configured: Array.isArray(values.dependency_areas), candidates: await candidates() }
  }

  /** Troca a lista inteira (`areas`: [{ key?, name, user_ids }]); só usuários que existem; histórico com os nomes. */
  async function updateDependencyAreas(ctx, raw) {
    rbac.assertCan(ctx.principal, IT_PEOPLE_PERMISSION)
    const checked = settingsDomain.validateDependencyAreas(raw && raw.areas)
    if (checked.fields.areas) throw invalid(checked.fields)
    const ids = checked.areas.reduce((all, a) => all.concat(a.user_ids), [])
    const found = ids.length ? await deps.userRepository.findManyByIds(ids) : []
    if (found.length !== ids.length) throw invalid({ areas: 'invalid_option' })
    await saveAreas(ctx, await currentSettings(deps), checked.areas)
    const values = await currentSettings(deps)
    return { areas: await presentAreas(settingsDomain.resolveDependencyAreas(values)), configured: true }
  }

  /** Rota antiga: as pessoas da área TI (`it_people` enquanto não há áreas) e os candidatos. */
  async function getItPeople(ctx) {
    rbac.assertCan(ctx.principal, IT_PEOPLE_PERMISSION)
    const ti = settingsDomain.resolveDependencyAreas(await currentSettings(deps)).find((a) => a.key === settingsDomain.TI_AREA_KEY)
    const out = await presentItPeople(ti.user_ids)
    out.candidates = await candidates()
    return out
  }

  /**
   * Rota antiga: troca só as pessoas da área TI (`user_ids`). Com áreas configuradas, quem entra na TI sai da
   * área onde estava (uma pessoa fica numa área só). Histórico como antes, com os nomes.
   */
  async function updateItPeople(ctx, raw) {
    rbac.assertCan(ctx.principal, IT_PEOPLE_PERMISSION)
    const ids = raw && raw.user_ids
    const issue = settingsDomain.validateSettings({ it_people: ids }, {}).fields.it_people
    if (issue) throw invalid({ user_ids: issue })
    const unique = ids.filter((id, i, all) => all.indexOf(id) === i)
    const found = unique.length ? await deps.userRepository.findManyByIds(unique) : []
    if (found.length !== unique.length) throw invalid({ user_ids: 'invalid_option' })
    const before = await currentSettings(deps)
    const after = Object.assign({}, before, { it_people: unique })
    if (Array.isArray(before.dependency_areas)) {
      after.dependency_areas = settingsDomain
        .resolveDependencyAreas(before)
        .map((a) => Object.assign({}, a, { user_ids: a.key === settingsDomain.TI_AREA_KEY ? unique : a.user_ids.filter((id) => unique.indexOf(id) < 0) }))
    }
    if (settingsDomain.diffSettings(before, after)) {
      const names = async (list) => (list.length ? (await deps.userRepository.findManyByIds(list)).map((u) => u.name).sort() : [])
      const oldNames = await names(before.it_people)
      const newNames = found.map((u) => u.name).sort()
      await deps.unitOfWork.run(async (repos) => {
        await repos.platformSettingsRepository.saveValues(after)
        await repos.auditRepository.record(
          buildAuditEntry(ctx, { entityType: ENTITY, entityId: ENTITY_ID, action: 'platform_settings.update', oldValue: { it_people: oldNames }, newValue: { it_people: newNames } }),
        )
      })
    }
    return presentItPeople(unique)
  }

  return { getDependencyAreas, updateDependencyAreas, getItPeople, updateItPeople, runRetentionNow, getSettings, updateSettings, uploadBranding, removeBranding, publicInfo, brandingFile, passwordPolicy, purgeAuditLogs }
}

module.exports = { createPlatformSettingsService, currentSettings, currentPasswordPolicy, currentLockoutPolicy }
