const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { createTestDatabase } = require('../support/db-harness')
const { insertRow } = require('../../src/infrastructure/sql')
const config = require('../../src/infrastructure/repositories/task-config')

describe('repositórios da configuração das tarefas', () => {
  let t
  let fields
  let types
  let typeFields
  let statuses
  let priorities
  let tags
  let owner
  let project
  let taskNumber = 0

  before(async () => {
    t = await createTestDatabase()
    fields = config.createCustomFieldRepository(t.db, {})
    types = config.createTaskTypeRepository(t.db, {})
    typeFields = config.createTaskTypeFieldRepository(t.db, {})
    statuses = config.createLookupRepository(t.db, {}, 'task_statuses', { hasCategory: true, taskColumn: 'status_id' })
    priorities = config.createLookupRepository(t.db, {}, 'task_priorities', { hasCategory: false, taskColumn: 'priority_id' })
    tags = config.createTagRepository(t.db, {})
    const role = await t.db.one("SELECT id FROM roles WHERE code = 'ADMIN'")
    owner = await insertRow(t.db, 'users', { email: 'dono@avanza.test', name: 'Dono', role_id: role.id, status: 'active' })
    project = await insertRow(t.db, 'projects', { name: 'P', key: 'CFG', owner_id: owner.id })
  })
  after(() => t.drop())

  async function seedTask(values) {
    taskNumber += 1
    const [type, status, priority] = await Promise.all([
      t.db.one('SELECT id FROM task_types ORDER BY "order" LIMIT 1'),
      t.db.one('SELECT id FROM task_statuses WHERE is_default'),
      t.db.one('SELECT id FROM task_priorities WHERE is_default'),
    ])
    return insertRow(t.db, 'tasks', Object.assign({ project_id: project.id, task_type_id: type.id, status_id: status.id, priority_id: priority.id, title: 'T', number: taskNumber, code: `CFG-${taskNumber}` }, values))
  }

  describe('campos personalizados', () => {
    it('gravam JSON (config e padrão) e devolvem a entidade do PocketBase', async () => {
      const created = await fields.create({ name: 'aprovado', label: 'Aprovado', type: 'checkbox', description: '', config: {}, defaultValue: false, searchable: false, filterable: true, sortable: undefined })
      assert.equal(created.defaultValue, false)
      assert.deepEqual(created.config, {})
      assert.equal(created.sortable, false)
      const text = await fields.create({ name: 'codigo_sap', label: 'Código SAP', type: 'text', config: { max_length: 20 }, defaultValue: null })
      assert.deepEqual((await fields.findByName('codigo_sap')).config, { max_length: 20 })
      assert.equal(text.defaultValue, null)
      const updated = await fields.update(text.id, { label: 'Código do SAP', config: null, defaultValue: ['a', 'b'] })
      assert.deepEqual(updated.config, {})
      assert.deepEqual(updated.defaultValue, ['a', 'b'])
      assert.equal(await fields.findByName('nada'), null)
      assert.deepEqual((await fields.findManyByIds([text.id, created.id])).map((f) => f.name).sort(), ['aprovado', 'codigo_sap'])
    })

    it('listam por rótulo, com busca (rótulo ou nome) e filtro de tipo', async () => {
      const all = await fields.list({})
      const labels = all.map((f) => f.label)
      assert.deepEqual(labels, labels.slice().sort((a, b) => a.localeCompare(b, 'en')))
      assert.deepEqual((await fields.list({ search: 'sap' })).map((f) => f.name), ['codigo_sap'])
      assert.deepEqual((await fields.list({ search: 'CODIGO_' })).map((f) => f.name), ['codigo_sap'])
      assert.deepEqual((await fields.list({ type: 'checkbox', search: 'aprov' })).map((f) => f.name), ['aprovado'])
      assert.deepEqual(await fields.list({ type: 'checkbox', search: 'sap' }), [])
    })

    it('recusam nome repetido', async () => {
      await assert.rejects(fields.create({ name: 'aprovado', label: 'Outro', type: 'text' }), { code: 'FIELD_NAME_IN_USE' })
    })

    it('sincronizam as opções: mantêm, criam, removem e reordenam', async () => {
      const select = await fields.create({ name: 'fase', label: 'Fase', type: 'select', config: {} })
      const other = await fields.create({ name: 'area', label: 'Área', type: 'select', config: {} })
      const [foreign] = await fields.syncOptions(other.id, [{ id: null, label: 'TI', color: 'blue', isActive: true }])
      const first = await fields.syncOptions(select.id, [
        { id: null, label: 'Início', color: 'green', isActive: true },
        { id: null, label: 'Meio', color: '', isActive: true },
        { id: null, label: 'Fim', color: 'red', isActive: false },
      ])
      assert.deepEqual(first.map((o) => [o.label, o.color, o.order, o.isActive, o.fieldId]), [
        ['Início', 'green', 0, true, select.id],
        ['Meio', 'gray', 1, true, select.id],
        ['Fim', 'red', 2, false, select.id],
      ])
      // "Fim" sobe para o topo, "Meio" sai, uma nova entra; o id de outro campo vira opção nova
      const second = await fields.syncOptions(select.id, [
        { id: first[2].id, label: 'Fim', color: 'red', isActive: true },
        { id: first[0].id, label: 'Começo', color: 'green', isActive: true },
        { id: foreign.id, label: 'Nova', color: 'blue', isActive: true },
      ])
      assert.equal(second[0].id, first[2].id)
      assert.equal(second[1].id, first[0].id)
      assert.notEqual(second[2].id, foreign.id)
      const listed = await fields.listOptions([select.id, other.id])
      assert.deepEqual(listed.filter((o) => o.fieldId === select.id).map((o) => [o.label, o.order, o.isActive]), [
        ['Fim', 0, true],
        ['Começo', 1, true],
        ['Nova', 2, true],
      ])
      assert.deepEqual(listed.filter((o) => o.fieldId === other.id).map((o) => o.id), [foreign.id])
      assert.deepEqual(await fields.listOptions([]), [])

      // opção adicionada pela tarefa: trava o campo e lê as opções; cria no fim; reativa
      const locked = await t.db.transaction(() => fields.lockOptions(select.id))
      assert.deepEqual(locked.map((o) => o.label), ['Fim', 'Começo', 'Nova'])
      const added = await fields.createOption(select.id, { label: 'Extra', color: 'teal', order: 3, isActive: true })
      assert.deepEqual([added.fieldId, added.label, added.color, added.order, added.isActive], [select.id, 'Extra', 'teal', 3, true])
      const off = await fields.updateOption(added.id, { isActive: false })
      assert.equal(off.isActive, false)
      assert.equal(off.label, 'Extra')
      assert.equal((await fields.updateOption(added.id, { isActive: true })).isActive, true)
      assert.equal(await fields.updateOption('nao-existe', { isActive: true }), null)
      assert.deepEqual((await fields.listOptions([select.id])).map((o) => o.label), ['Fim', 'Começo', 'Nova', 'Extra'])
      // apagar o campo leva as opções
      await fields.delete(select.id)
      assert.equal(await fields.findById(select.id), null)
      assert.deepEqual(await fields.listOptions([select.id]), [])
    })
  })

  describe('tipos de tarefa e campos do tipo', () => {
    it('listam ativos (ou todos) por ordem e nome; maior ordem; traduções', async () => {
      const before = await types.list({ includeInactive: true })
      const max = await types.maxOrder()
      assert.equal(max, Math.max.apply(null, before.map((x) => x.order)))
      const created = await types.create({ key: 'SPIKE', name: 'Spike', description: '', translations: { en: { name: 'Spike' } }, icon: 'zap', color: 'violet', order: max + 1, isActive: false })
      assert.deepEqual(created.translations, { en: { name: 'Spike' } })
      assert.equal((await types.findByKey('SPIKE')).id, created.id)
      assert.equal((await types.list({})).some((x) => x.id === created.id), false)
      const all = await types.list({ includeInactive: true })
      assert.equal(all[all.length - 1].id, created.id)
      assert.equal(await types.maxOrder(), max + 1)
      const plain = await types.create({ key: 'PLAIN', name: 'Plain', order: 0, isActive: true })
      assert.deepEqual(plain.translations, {})
      await assert.rejects(types.create({ key: 'SPIKE', name: 'De novo' }), { code: 'TASK_TYPE_KEY_IN_USE' })
    })

    it('reordenam numa instrução e contam tarefas; tipo em uso não sai', async () => {
      const all = await types.list({ includeInactive: true })
      const reversed = all.map((x) => x.id).reverse()
      await types.setOrder(reversed)
      const after = await types.list({ includeInactive: true })
      assert.deepEqual(after.map((x) => x.id), reversed)
      assert.deepEqual(after.map((x) => x.order), reversed.map((_, i) => i))
      const used = await types.findByKey('PLAIN')
      assert.equal(await types.countTasks(used.id), 0)
      await seedTask({ task_type_id: used.id })
      assert.equal(await types.countTasks(used.id), 1)
      await assert.rejects(types.delete(used.id), { code: 'TASK_TYPE_IN_USE' })
      const spike = await types.findByKey('SPIKE')
      await types.delete(spike.id)
      assert.equal(await types.findById(spike.id), null)
    })

    it('trocam os campos do tipo (com status exigidos) e contam/listam em lote', async () => {
      const type = await types.findByKey('PLAIN')
      const [a, b] = await Promise.all([fields.findByName('aprovado'), fields.findByName('codigo_sap')])
      await typeFields.replace(type.id, [
        { fieldId: b.id, order: 1, required: false, visible: true, showOnCard: true, requiredStatusIds: ['sd3hl494b91f1z7'] },
        { fieldId: a.id, order: 0, required: true, visible: true, showOnCard: false },
      ])
      assert.deepEqual(await typeFields.listByType(type.id), [
        { typeId: type.id, fieldId: a.id, order: 0, required: true, visible: true, showOnCard: false, requiredStatusIds: [] },
        { typeId: type.id, fieldId: b.id, order: 1, required: false, visible: true, showOnCard: true, requiredStatusIds: ['sd3hl494b91f1z7'] },
      ])
      const usage = await typeFields.typesUsingFields([a.id, b.id, 'naoexiste12345'])
      assert.ok(usage[a.id].includes(type.id))
      assert.deepEqual(usage[b.id], [type.id])
      assert.equal(usage.naoexiste12345, undefined)
      assert.deepEqual(await typeFields.countByTypes([type.id, 'naoexiste12345']), { [type.id]: 2 })
      await typeFields.replace(type.id, [])
      assert.deepEqual(await typeFields.listByType(type.id), [])
      assert.deepEqual(await typeFields.typesUsingFields([]), {})
    })

    it('trocas simultâneas dos campos do mesmo tipo não colidem no índice', async () => {
      const type = await types.findByKey('PLAIN')
      const [a, b] = await Promise.all([fields.findByName('aprovado'), fields.findByName('codigo_sap')])
      const items = [
        { fieldId: a.id, order: 0, required: false, visible: true, showOnCard: false, requiredStatusIds: [] },
        { fieldId: b.id, order: 1, required: false, visible: true, showOnCard: false, requiredStatusIds: [] },
      ]
      await Promise.all([1, 2, 3].map(() => t.db.transaction(() => typeFields.replace(type.id, items))))
      assert.equal((await typeFields.listByType(type.id)).length, 2)
    })
  })

  describe('status e prioridades', () => {
    it('status trazem categoria, WIP e destinos; prioridades não', async () => {
      const backlog = await statuses.findByKey('BACKLOG')
      assert.equal(backlog.category, 'backlog')
      assert.equal(backlog.wipLimit, 0)
      assert.deepEqual(backlog.allowedNext, [])
      const medium = await priorities.findByKey('MEDIA')
      assert.equal(medium.isDefault, true)
      assert.equal('category' in medium, false)
      assert.equal('allowedNext' in medium, false)
    })

    it('criam, atualizam (destinos em JSON) e recusam chave repetida', async () => {
      const backlog = await statuses.findByKey('BACKLOG')
      const max = await statuses.maxOrder()
      const created = await statuses.create({ key: 'BLOQUEADO', name: 'Bloqueado', description: '', color: 'red', category: 'in_progress', wipLimit: 3, allowedNext: [backlog.id], order: max + 1, isActive: false, isDefault: false })
      assert.deepEqual(created.allowedNext, [backlog.id])
      assert.equal(created.wipLimit, 3)
      assert.equal((await statuses.list({})).some((s) => s.id === created.id), false)
      assert.equal((await statuses.list({ includeInactive: true })).pop().id, created.id)
      const updated = await statuses.update(created.id, { allowedNext: [], wipLimit: undefined, name: 'Travado' })
      assert.deepEqual(updated.allowedNext, [])
      assert.equal(updated.wipLimit, 3)
      assert.equal(updated.name, 'Travado')
      await assert.rejects(statuses.create({ key: 'BLOQUEADO', name: 'X' }), { code: 'STATUS_KEY_IN_USE' })
      await assert.rejects(priorities.create({ key: 'ALTA', name: 'X' }), { code: 'PRIORITY_KEY_IN_USE' })
    })

    it('reordenam, trocam o padrão e contam tarefas; item em uso não sai', async () => {
      const all = await priorities.list({ includeInactive: true })
      const order = all.map((p) => p.id).reverse()
      await priorities.setOrder(order)
      assert.deepEqual((await priorities.list({})).map((p) => p.id), order)
      const low = await priorities.findByKey('BAIXA')
      await t.db.transaction(async () => {
        await priorities.clearDefault()
        await priorities.update(low.id, { isDefault: true })
      })
      assert.deepEqual((await priorities.list({})).filter((p) => p.isDefault).map((p) => p.key), ['BAIXA'])
      assert.equal(await priorities.countTasks(low.id), 0)
      await seedTask({ priority_id: low.id })
      assert.equal(await priorities.countTasks(low.id), 1)
      await assert.rejects(priorities.delete(low.id), { code: 'PRIORITY_IN_USE' })
      const blocked = await statuses.findByKey('BLOQUEADO')
      await statuses.delete(blocked.id)
      assert.equal(await statuses.findById(blocked.id), null)
    })

    it('áreas: carga inicial das 11 áreas, sem padrão; em uso por tarefa ou projeto não sai', async () => {
      const areas = config.createLookupRepository(t.db, {}, 'areas', { hasCategory: false, taskColumn: 'area_id', projectColumn: 'area_id' })
      const seeded = await areas.list({})
      assert.deepEqual(
        seeded.map((a) => a.name),
        ['Inteligencia Estratégica', 'Dpto. TI', 'Desarrollo e Innovación', 'Marketing', 'Contabilidad', 'Administración', 'Fertilizantes', 'Logística', 'Supply', 'Comex', 'Créditos'],
      )
      assert.ok(seeded.every((a) => a.isActive && !a.isDefault && !('category' in a)))
      await assert.rejects(areas.create({ key: 'TI', name: 'X' }), { code: 'AREA_KEY_IN_USE' })
      const ti = await areas.findByKey('TI')
      const comex = await areas.findByKey('COMEX')
      const supply = await areas.findByKey('SUPPLY')
      await seedTask({ area_id: ti.id })
      const other = await insertRow(t.db, 'projects', { name: 'Comex', key: 'CMX', owner_id: owner.id, area_id: comex.id })
      assert.deepEqual([await areas.countTasks(ti.id), await areas.countProjects(ti.id), await areas.countProjects(comex.id)], [1, 0, 1])
      // a chave estrangeira também segura (RESTRICT) se a contagem passar
      await assert.rejects(areas.delete(ti.id), { code: 'AREA_IN_USE' })
      await assert.rejects(areas.delete(comex.id), { code: 'AREA_IN_USE' })
      await t.db.exec('DELETE FROM projects WHERE id = $1', [other.id])
      const created = await areas.create({ key: 'NOVA', name: 'Nova', description: '', color: 'teal', order: (await areas.maxOrder()) + 1, isActive: true, isDefault: false })
      assert.equal((await areas.list({})).pop().id, created.id)
      await areas.delete(created.id)
      await areas.delete(supply.id)
      assert.equal(await areas.findById(supply.id), null)
    })

    it('trocas de padrão simultâneas deixam um padrão só', async () => {
      const list = await statuses.list({ includeInactive: true })
      await Promise.all(
        list.slice(0, 4).map((s) =>
          t.db.transaction(async () => {
            await statuses.clearDefault()
            await statuses.update(s.id, { isDefault: true })
          }),
        ),
      )
      assert.equal((await statuses.list({ includeInactive: true })).filter((s) => s.isDefault).length, 1)
    })
  })

  describe('tags', () => {
    it('criam, buscam pela chave, listam por nome e contam tarefas', async () => {
      const urgent = await tags.create({ name: 'Urgente', nameKey: 'urgente', color: 'red' })
      const api = await tags.create({ name: 'api', nameKey: 'api', color: 'blue' })
      assert.equal((await tags.findByKey('urgente')).id, urgent.id)
      assert.equal(await tags.findByKey('nada'), null)
      assert.deepEqual((await tags.list()).map((x) => x.name), ['api', 'Urgente'])
      const task = await seedTask({})
      await insertRow(t.db, 'task_tag_relations', { task_id: task.id, tag_id: urgent.id })
      assert.deepEqual(await tags.countTasks([urgent.id, api.id]), { [urgent.id]: 1 })
      assert.deepEqual(await tags.countTasks([]), {})
      const renamed = await tags.update(api.id, { name: 'API', nameKey: 'api' })
      assert.equal(renamed.name, 'API')
      assert.equal(renamed.color, 'blue')
      await tags.delete(urgent.id)
      assert.deepEqual(await t.db.query('SELECT id FROM task_tag_relations WHERE tag_id = $1', [urgent.id]), [])
    })

    it('chave de nome repetida vira TAG_NAME_IN_USE (também em paralelo e ao renomear)', async () => {
      await assert.rejects(tags.create({ name: 'API', nameKey: 'api', color: 'red' }), { code: 'TAG_NAME_IN_USE' })
      const other = await tags.create({ name: 'Front', nameKey: 'front', color: 'green' })
      await assert.rejects(tags.update(other.id, { name: 'Api', nameKey: 'api' }), { code: 'TAG_NAME_IN_USE' })
      const results = await Promise.allSettled([1, 2].map(() => t.db.transaction(() => tags.create({ name: 'Dup', nameKey: 'dup', color: 'gray' }))))
      assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected'])
      assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'TAG_NAME_IN_USE')
    })
  })
})
