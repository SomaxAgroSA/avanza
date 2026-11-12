/**
 * Quadro do projeto — GP-4: Gestão (Diário do projeto e Gestão dos problemas), linha de base do
 * Cronograma e relatório com a saúde do projeto (docs/diretriz_feature_gerenciamento_projetos.md
 * §13, §15 e §16).
 *
 * - Ver (diário, problemas, relatório): acesso ao projeto + `plan.view` (inclusive leitor).
 * - Diário: quem edita o quadro registra; o autor ou o gestor edita/exclui.
 * - Problemas: quem edita o quadro abre e atualiza; quem abriu ou o gestor exclui. Numeração por
 *   projeto que não se repete (nem depois de excluir).
 * - Linha de base: o gestor salva (foto do cronograma atual dos elementos) e limpa.
 * - Projeto arquivado: só leitura. Registro de outro projeto invisível: 404.
 * - Histórico no projeto (plan_journal.*, plan_issue.*, plan_settings.baseline_*).
 */

const { appError } = require('../core/errors')
const planDomain = require('../domain/plan')
const mgmtDomain = require('../domain/plan-management')
const { planReport } = require('../domain/plan-report')
const { localDay } = require('../domain/report')
const { truncate } = require('./audit')
const { iso, toUserSummary } = require('./presenters')
const { createPlanSupport, invalid, indexBy, MAX_ITEMS } = require('./plan-support')

const EXCERPT = 300

function createPlanManagementService(deps) {
  const journal = deps.planJournalRepository
  const issues = deps.planIssueRepository
  const support = createPlanSupport(deps)
  const { loadProject, loadOwned, assertCan, audit, ensureStatuses, settingsOf, pendingMap, progressOf, assertRefs } = support

  const today = () => deps.clock.now().toISOString().slice(0, 10)
  const usersFor = async (ids) => {
    const unique = ids.filter((id, i, all) => id && all.indexOf(id) === i)
    return indexBy(unique.length ? await deps.userRepository.findManyByIds(unique) : [])
  }
  const summaryOf = (users, id) => (id && users[id] ? toUserSummary(users[id]) : null)
  const check = (result) => {
    if (Object.keys(result.issues).length > 0) throw invalid(result.issues)
    return result.data
  }

  /* ------------------------------------------------------------------ diário */

  function presentEntry(entry, users, can, userId) {
    return {
      id: entry.id,
      entry_date: entry.entryDate,
      content: entry.content,
      author: summaryOf(users, entry.authorId),
      created_at: iso(entry.createdAt),
      updated_at: iso(entry.updatedAt),
      capabilities: mgmtDomain.journalCapabilities(can, entry, userId),
    }
  }

  async function listJournal(ctx, projectId) {
    const { project, can } = await loadProject(ctx, projectId)
    const list = mgmtDomain.sortJournal(await journal.listByProject(project.id))
    const users = await usersFor(list.map((e) => e.authorId))
    return { entries: list.map((e) => presentEntry(e, users, can, ctx.principal.userId)), capabilities: { create: can.edit } }
  }

  const journalAudit = (entry) => ({ entry_date: entry.entryDate, content: truncate(entry.content, EXCERPT) })

  async function createJournalEntry(ctx, projectId, raw) {
    const { project, can } = await loadProject(ctx, projectId)
    await assertCan(can, project, 'edit')
    const data = check(mgmtDomain.journalInput(raw, false))
    const created = await deps.unitOfWork.run(async (repos) => {
      const entry = await repos.planJournalRepository.create({ projectId: project.id, entryDate: data.entry_date, content: data.content, authorId: ctx.principal.userId })
      await audit(repos, ctx, 'project', project.id, 'plan_journal.created', null, journalAudit(entry))
      return entry
    })
    return presentEntry(created, await usersFor([created.authorId]), can, ctx.principal.userId)
  }

  async function loadEntry(ctx, id) {
    const found = await loadOwned(ctx, journal, id, 'PLAN_JOURNAL_NOT_FOUND')
    return { entry: found.record, project: found.project, can: found.can }
  }

  function assertEntry(ctx, found, action) {
    if (mgmtDomain.journalCapabilities(found.can, found.entry, ctx.principal.userId)[action]) return
    throw appError(found.project.archivedAt ? 'PROJECT_ARCHIVED' : 'FORBIDDEN')
  }

  async function updateJournalEntry(ctx, id, raw) {
    const found = await loadEntry(ctx, id)
    assertEntry(ctx, found, 'edit')
    const data = check(mgmtDomain.journalInput(raw, true))
    const patch = {}
    if (data.entry_date !== undefined && data.entry_date !== found.entry.entryDate) patch.entryDate = data.entry_date
    if (data.content !== undefined && data.content !== found.entry.content) patch.content = data.content
    let saved = found.entry
    if (Object.keys(patch).length > 0) {
      const before = journalAudit(found.entry)
      saved = await deps.unitOfWork.run(async (repos) => {
        const result = await repos.planJournalRepository.update(found.entry.id, patch)
        await audit(repos, ctx, 'project', found.project.id, 'plan_journal.updated', before, journalAudit(result))
        return result
      })
    }
    return presentEntry(saved, await usersFor([saved.authorId]), found.can, ctx.principal.userId)
  }

  async function deleteJournalEntry(ctx, id) {
    const found = await loadEntry(ctx, id)
    assertEntry(ctx, found, 'delete')
    await deps.unitOfWork.run(async (repos) => {
      await repos.planJournalRepository.delete(found.entry.id)
      await audit(repos, ctx, 'project', found.project.id, 'plan_journal.deleted', journalAudit(found.entry), null)
    })
    return { deleted: true }
  }

  /* ------------------------------------------------------------------ problemas */

  function presentIssue(issue, users, can, userId) {
    return {
      id: issue.id,
      number: issue.number,
      opened_on: issue.openedOn,
      description: issue.description,
      state: issue.state,
      owner: summaryOf(users, issue.ownerId),
      resolved_on: issue.resolvedOn || null,
      created_by: summaryOf(users, issue.createdBy),
      created_at: iso(issue.createdAt),
      updated_at: iso(issue.updatedAt),
      capabilities: mgmtDomain.issueCapabilities(can, issue, userId),
    }
  }

  const issueUsers = async (list) => await usersFor(list.reduce((ids, i) => ids.concat([i.ownerId, i.createdBy]), []))

  async function listIssues(ctx, projectId) {
    const { project, can } = await loadProject(ctx, projectId)
    const list = (await issues.listByProject(project.id)).sort((a, b) => a.number - b.number)
    const users = await issueUsers(list)
    return { issues: list.map((i) => presentIssue(i, users, can, ctx.principal.userId)), capabilities: { create: can.edit } }
  }

  /** Histórico legível: número, campos que mudaram e o nome do responsável. */
  async function issueAudit(issue, keys) {
    const owner = issue.ownerId ? await deps.userRepository.findById(issue.ownerId) : null
    const all = { opened_on: issue.openedOn, description: truncate(issue.description, EXCERPT), issue_state: issue.state, issue_owner: owner ? owner.name : null }
    const out = { issue: `#${issue.number}` }
    ;(keys || Object.keys(all)).forEach((key) => {
      out[key] = all[key]
    })
    return out
  }

  async function createIssue(ctx, projectId, raw) {
    const { project, can } = await loadProject(ctx, projectId)
    await assertCan(can, project, 'edit')
    const data = check(mgmtDomain.issueInput(raw, false))
    if (data.owner_id) await assertRefs(project, { owner_id: data.owner_id })
    const created = await deps.unitOfWork.run(async (repos) => {
      const settings = await repos.planSettingsRepository.findByProject(project.id)
      const number = Math.max(settings && settings.issueSeq ? settings.issueSeq : 0, await repos.planIssueRepository.maxNumber(project.id)) + 1
      await repos.planSettingsRepository.save(project.id, { issueSeq: number })
      const issue = await repos.planIssueRepository.create({
        projectId: project.id,
        number,
        openedOn: data.opened_on,
        description: data.description,
        state: data.state,
        ownerId: data.owner_id || null,
        resolvedOn: mgmtDomain.resolvedOn({ state: null }, data.state, today()),
        createdBy: ctx.principal.userId,
      })
      await audit(repos, ctx, 'project', project.id, 'plan_issue.created', null, await issueAudit(issue))
      return issue
    })
    return presentIssue(created, await issueUsers([created]), can, ctx.principal.userId)
  }

  async function loadIssue(ctx, id) {
    const found = await loadOwned(ctx, issues, id, 'PLAN_ISSUE_NOT_FOUND')
    return { issue: found.record, project: found.project, can: found.can }
  }

  function assertIssue(ctx, found, action) {
    if (mgmtDomain.issueCapabilities(found.can, found.issue, ctx.principal.userId)[action]) return
    throw appError(found.project.archivedAt ? 'PROJECT_ARCHIVED' : 'FORBIDDEN')
  }

  async function updateIssue(ctx, id, raw) {
    const found = await loadIssue(ctx, id)
    assertIssue(ctx, found, 'edit')
    const data = check(mgmtDomain.issueInput(raw, true))
    if (data.owner_id) await assertRefs(found.project, { owner_id: data.owner_id })
    const current = found.issue
    const patch = {}
    const changed = []
    if (data.opened_on !== undefined && data.opened_on !== current.openedOn) {
      patch.openedOn = data.opened_on
      changed.push('opened_on')
    }
    if (data.description !== undefined && data.description !== current.description) {
      patch.description = data.description
      changed.push('description')
    }
    if (data.state !== undefined && data.state !== current.state) {
      patch.state = data.state
      patch.resolvedOn = mgmtDomain.resolvedOn(current, data.state, today())
      changed.push('issue_state')
    }
    if (data.owner_id !== undefined && (data.owner_id || null) !== (current.ownerId || null)) {
      patch.ownerId = data.owner_id || null
      changed.push('issue_owner')
    }
    let saved = current
    if (changed.length > 0) {
      const before = await issueAudit(current, changed)
      saved = await deps.unitOfWork.run(async (repos) => {
        const result = await repos.planIssueRepository.update(current.id, patch)
        await audit(repos, ctx, 'project', found.project.id, 'plan_issue.updated', before, await issueAudit(result, changed))
        return result
      })
    }
    return presentIssue(saved, await issueUsers([saved]), found.can, ctx.principal.userId)
  }

  async function deleteIssue(ctx, id) {
    const found = await loadIssue(ctx, id)
    assertIssue(ctx, found, 'delete')
    const before = await issueAudit(found.issue)
    await deps.unitOfWork.run(async (repos) => {
      await repos.planIssueRepository.delete(found.issue.id)
      await audit(repos, ctx, 'project', found.project.id, 'plan_issue.deleted', before, null)
    })
    return { deleted: true }
  }

  /* ------------------------------------------------------------------ linha de base */

  async function saveBaseline(ctx, projectId) {
    const { project, can } = await loadProject(ctx, projectId)
    await assertCan(can, project, 'manage')
    const snapshot = mgmtDomain.baselineSnapshot(await deps.planItemRepository.listByProject(project.id, MAX_ITEMS))
    const savedAt = deps.clock.now()
    const count = Object.keys(snapshot).length
    await deps.unitOfWork.run(async (repos) => {
      await repos.planSettingsRepository.save(project.id, { baseline: { savedAt, items: snapshot } })
      await audit(repos, ctx, 'project', project.id, 'plan_settings.baseline_saved', null, { baseline_items: count })
    })
    return { saved_at: iso(savedAt), items: count }
  }

  async function clearBaseline(ctx, projectId) {
    const { project, can } = await loadProject(ctx, projectId)
    await assertCan(can, project, 'manage')
    if (!(await settingsOf(project)).baseline) return { cleared: false }
    await deps.unitOfWork.run(async (repos) => {
      await repos.planSettingsRepository.save(project.id, { baseline: null })
      await audit(repos, ctx, 'project', project.id, 'plan_settings.baseline_cleared', null, null)
    })
    return { cleared: true }
  }

  /* ------------------------------------------------------------------ relatório */

  function readOffset(query) {
    const raw = query && query.tz_offset !== undefined && query.tz_offset !== '' ? String(query.tz_offset) : '0'
    if (!/^-?\d{1,3}$/.test(raw) || Math.abs(Number(raw)) > 840) throw invalid({ tz_offset: 'invalid_type' })
    return Number(raw)
  }

  /**
   * Relatório do quadro. `scope=family` (resumo do projeto principal) soma os subprojetos abertos que a
   * pessoa vê — elementos, esforço, problemas e saúde juntos; sem a opção, só o projeto (aba Gestão).
   * `details` traz o que está por trás de cada fator, para o card da saúde abrir a lista.
   */
  async function getReport(ctx, projectId, query) {
    const { project } = await loadProject(ctx, projectId)
    const offset = readOffset(query)
    const scope = query && query.scope === 'family' ? 'family' : 'project'
    const family = [project]
    if (scope === 'family' && !project.parentId) {
      const children = (await deps.projectRepository.listAll())
        .filter((p) => p.parentId === project.id && !p.archivedAt)
        .sort((a, b) => (a.key > b.key ? 1 : -1))
      for (const child of children) {
        try {
          family.push((await loadProject(ctx, child.id)).project)
        } catch (error) {
          // subprojeto que a pessoa não vê fica fora da conta
          if (!error || error.code !== 'PROJECT_NOT_FOUND') throw error
        }
      }
    }

    const statusById = {}
    const items = []
    const groups = []
    const resources = []
    const issueList = []
    const pending = {}
    const progress = {}
    const projectOf = {}
    const counts = {}
    for (const p of family) {
      const statuses = indexBy(await ensureStatuses(p))
      Object.assign(statusById, statuses)
      const list = await deps.planItemRepository.listByProject(p.id, MAX_ITEMS)
      const categoryOf = (i) => (i.statusId && statuses[i.statusId] ? statuses[i.statusId].category : null)
      list.forEach((i) => {
        projectOf[i.id] = p
      })
      counts[p.id] = list.filter((i) => !i.parentId).length
      items.push(...list)
      Object.assign(progress, await progressOf(list, statuses))
      Object.assign(pending, await pendingMap(list, await deps.planLinkRepository.listByProject(p.id), categoryOf))
      const groupList = await deps.projectGroupRepository.listByProject(p.id)
      const numbers = planDomain.numberGroups(groupList)
      planDomain.orderGroups(groupList).forEach((g) => groups.push({ id: g.id, name: p.id === project.id ? g.name : `${p.key} · ${g.name}`, color: g.color, number: numbers[g.id] }))
      resources.push(...(await deps.planResourceRepository.listByProject(p.id)))
      ;(await issues.listByProject(p.id)).forEach((issue) => issueList.push(Object.assign({}, issue, { project: p })))
    }
    const categoryOf = (i) => (i.statusId && statusById[i.statusId] ? statusById[i.statusId].category : null)
    const report = planReport({ items, categoryOf, progress, groups, resources, issues: issueList, pending, today: localDay(deps.clock.now(), offset) })

    const ref = (p) => ({ id: p.id, key: p.key, name: p.name })
    const byId = indexBy(items)
    const present = (id) => {
      const item = byId[id]
      const status = item.statusId ? statusById[item.statusId] : null
      return {
        id: item.id,
        name: item.name,
        project: ref(projectOf[item.id]),
        status: status ? { name: status.name, color: status.color, category: status.category } : null,
        start_date: item.startDate || null,
        end_date: item.endDate || item.startDate || null,
        progress: (progress[item.id] || { value: 0 }).value,
      }
    }
    const details = {}
    Object.keys(report.details).forEach((key) => {
      details[key] = report.details[key].map(present)
    })
    details.issues = issueList
      .filter((i) => i.state !== 'resolved')
      .map((i) => ({ id: i.id, number: i.number, description: truncate(i.description || '', 200), state: i.state, opened_on: i.openedOn || null, project: ref(i.project) }))
    report.details = details
    report.scope = { mode: scope, projects: family.map((p) => Object.assign(ref(p), { items: counts[p.id] })) }
    return report
  }

  return {
    listJournal,
    createJournalEntry,
    updateJournalEntry,
    deleteJournalEntry,
    listIssues,
    createIssue,
    updateIssue,
    deleteIssue,
    saveBaseline,
    clearBaseline,
    getReport,
  }
}

module.exports = { createPlanManagementService }
