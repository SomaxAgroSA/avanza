/**
 * Quadro do projeto — GP-5: colunas personalizadas (docs/diretriz_feature_gerenciamento_projetos.md
 * §5.5 e §22).
 *
 * - O gestor (`plan.manage` + gestor/dono, projeto aberto) adiciona, renomeia, edita as opções,
 *   altera o tipo, duplica e exclui colunas; até 30 por quadro.
 * - Os valores ficam em cada elemento (`custom`) e são preenchidos por quem edita o quadro (pelo
 *   `updateItem` de sempre). Excluir a coluna, tirar uma opção da lista ou alterar o tipo limpa os
 *   valores que deixam de valer — a troca de tipo tem prévia (`dry_run`) com o que se perde.
 * - Histórico no projeto: plan_column.created/updated/type_changed/duplicated/deleted.
 */

const columnsDomain = require('../domain/plan-columns')
const { createPlanSupport, invalid, presentColumn, MAX_ITEMS } = require('./plan-support')

let optionSeq = 0
/** Id das opções novas da lista (único o bastante dentro da coluna). */
function newOptionId(clock) {
  optionSeq = (optionSeq + 1) % 1e6
  return `o${clock.now().getTime().toString(36)}${optionSeq.toString(36)}`
}

const COPY_SUFFIX = { 'pt-BR': 'cópia', en: 'copy', es: 'copia' }

function createPlanColumnsService(deps) {
  const columns = deps.planColumnRepository
  const items = deps.planItemRepository
  const support = createPlanSupport(deps)
  const { loadProject, loadOwned, assertCan, audit, listColumns } = support
  const newId = () => newOptionId(deps.clock)

  const check = (result) => {
    if (Object.keys(result.issues).length > 0) throw invalid(result.issues)
    return result.data
  }

  async function loadColumn(ctx, id) {
    const found = await loadOwned(ctx, columns, id, 'PLAN_COLUMN_NOT_FOUND')
    await assertCan(found.can, found.project, 'manage')
    return { column: found.record, project: found.project }
  }

  /** Elementos com valor na coluna. */
  const filled = async (projectId, columnId) => (await items.listByProject(projectId, MAX_ITEMS)).filter((i) => !i.parentId && i.custom && i.custom[columnId] !== undefined && i.custom[columnId] !== null)

  /** Reescreve os valores da coluna nos elementos (`values`: { item: valor|null }). */
  async function writeValues(repos, projectId, columnId, values) {
    for (const item of await items.listByProject(projectId, MAX_ITEMS)) {
      if (!(item.id in values)) continue
      const custom = Object.assign({}, item.custom || {})
      const value = values[item.id]
      if (value === null || value === undefined) delete custom[columnId]
      else custom[columnId] = value
      await repos.planItemRepository.update(item.id, { custom })
    }
  }

  async function createColumn(ctx, projectId, raw) {
    const { project, can } = await loadProject(ctx, projectId)
    await assertCan(can, project, 'manage')
    const data = check(columnsDomain.columnInput(raw, false, newId))
    if ((await listColumns(project.id)).length >= columnsDomain.MAX_COLUMNS) throw invalid({ columns: 'too_many' })
    const created = await deps.unitOfWork.run(async (repos) => {
      const column = await repos.planColumnRepository.create({
        projectId: project.id,
        name: data.name,
        type: data.type,
        settings: data.settings,
        position: ((await repos.planColumnRepository.maxPosition(project.id)) || 0) + 1024,
        createdBy: ctx.principal.userId,
      })
      await audit(repos, ctx, 'project', project.id, 'plan_column.created', null, { column: column.name, column_type: column.type })
      return column
    })
    return presentColumn(created)
  }

  /** Renomear e/ou editar as opções da lista (a opção que sai limpa os valores que a usavam). */
  async function updateColumn(ctx, id, raw) {
    const { column, project } = await loadColumn(ctx, id)
    const data = check(columnsDomain.columnInput(raw, true, newId, column.type))
    const patch = {}
    if (data.name !== undefined && data.name !== column.name) patch.name = data.name
    if (data.settings !== undefined && JSON.stringify(data.settings) !== JSON.stringify(column.settings || {})) patch.settings = data.settings
    if (Object.keys(patch).length === 0) return presentColumn(column)
    const removed = {}
    if (patch.settings && column.type === 'dropdown') {
      const kept = (patch.settings.options || []).map((o) => o.id)
      ;(await filled(project.id, column.id)).forEach((item) => {
        if (kept.indexOf(item.custom[column.id]) < 0) removed[item.id] = null
      })
    }
    const saved = await deps.unitOfWork.run(async (repos) => {
      const result = await repos.planColumnRepository.update(column.id, patch)
      if (Object.keys(removed).length) await writeValues(repos, project.id, column.id, removed)
      const before = { column: column.name }
      const after = { column: result.name }
      if (patch.settings) after.cleared_values = Object.keys(removed).length
      await audit(repos, ctx, 'project', project.id, 'plan_column.updated', before, after)
      return result
    })
    return presentColumn(saved)
  }

  /** `{ type*, settings, dry_run }`: converte os valores; com `dry_run` só conta (nada é gravado). */
  async function changeType(ctx, id, raw) {
    const { column, project } = await loadColumn(ctx, id)
    const input = raw || {}
    if (columnsDomain.COLUMN_TYPES.indexOf(input.type) < 0) throw invalid({ type: input.type ? 'invalid_option' : 'required' })
    const data = check(columnsDomain.columnInput({ name: column.name, type: input.type, settings: input.settings }, false, newId))
    const list = await filled(project.id, column.id)
    const values = {}
    list.forEach((item) => {
      values[item.id] = item.custom[column.id]
    })
    // a conversão do domínio é síncrona: os nomes das pessoas da coluna são lidos antes
    const userNames = new Map()
    if (column.type === 'people') {
      for (const userId of Object.values(values)) {
        if (!userId || userNames.has(userId)) continue
        const user = await deps.userRepository.findById(userId)
        userNames.set(userId, user ? user.name : null)
      }
    }
    const nameOf = (userId) => (userId && userNames.has(userId) ? userNames.get(userId) : null)
    const result = columnsDomain.convertValues(column, { type: data.type, settings: data.settings }, values, { newId, nameOf })
    if (input.dry_run) return { converted: list.length - result.lost, lost: result.lost }
    if (data.type === column.type) return presentColumn(column)
    const saved = await deps.unitOfWork.run(async (repos) => {
      const updated = await repos.planColumnRepository.update(column.id, { type: data.type, settings: result.settings })
      await writeValues(repos, project.id, column.id, result.values)
      await audit(repos, ctx, 'project', project.id, 'plan_column.type_changed', { column: column.name, column_type: column.type }, { column: column.name, column_type: data.type, lost_values: result.lost })
      return updated
    })
    return presentColumn(saved)
  }

  /** Cópia da coluna logo depois dela, com os mesmos valores nos elementos. */
  async function duplicateColumn(ctx, id) {
    const { column, project } = await loadColumn(ctx, id)
    if ((await listColumns(project.id)).length >= columnsDomain.MAX_COLUMNS) throw invalid({ columns: 'too_many' })
    const siblings = await listColumns(project.id)
    const index = siblings.findIndex((c) => c.id === column.id)
    const next = siblings[index + 1]
    const position = next ? (column.position + next.position) / 2 : column.position + 1024
    const name = `${column.name} (${COPY_SUFFIX[deps.locale] || COPY_SUFFIX['pt-BR']})`.slice(0, columnsDomain.NAME_MAX)
    const list = await filled(project.id, column.id)
    const copy = await deps.unitOfWork.run(async (repos) => {
      const created = await repos.planColumnRepository.create({ projectId: project.id, name, type: column.type, settings: JSON.parse(JSON.stringify(column.settings || {})), position, createdBy: ctx.principal.userId })
      const values = {}
      list.forEach((item) => {
        values[item.id] = item.custom[column.id]
      })
      await writeValues(repos, project.id, created.id, values)
      await audit(repos, ctx, 'project', project.id, 'plan_column.duplicated', { column: column.name }, { column: created.name })
      return created
    })
    return presentColumn(copy)
  }

  /** Exclui a coluna e os valores dela nos elementos. */
  async function deleteColumn(ctx, id) {
    const { column, project } = await loadColumn(ctx, id)
    const list = await filled(project.id, column.id)
    await deps.unitOfWork.run(async (repos) => {
      const values = {}
      list.forEach((item) => {
        values[item.id] = null
      })
      await writeValues(repos, project.id, column.id, values)
      await repos.planColumnRepository.delete(column.id)
      await audit(repos, ctx, 'project', project.id, 'plan_column.deleted', { column: column.name, column_type: column.type, filled_values: list.length }, null)
    })
    return { deleted: true, values: list.length }
  }

  return { createColumn, updateColumn, changeType, duplicateColumn, deleteColumn }
}

module.exports = { createPlanColumnsService }
