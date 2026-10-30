/// <reference path="../pb_data/types.d.ts" />

/**
 * Ficha do projeto (regras de negócio §21).
 * - project_charters: um registro por projeto (objetivo geral, quem mudou por último).
 * - charter_items: objetivos, funcionalidades, escopo (inclui / não inclui) e resultados esperados.
 *   Vínculos com tarefas e com outros itens ficam em JSON (ids); quem lê ignora os que não existem mais.
 * - charter_measurements: série de medições de cada resultado esperado.
 * Regras de API nulas: acesso somente por /api/v1.
 */

const LOCKED_RULES = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null }

migrate(
  (app) => {
    const charter = require(`${__hooks}/src/domain/charter.js`)
    const users = app.findCollectionByNameOrId('users')
    const projects = app.findCollectionByNameOrId('projects')
    const states = charter.OBJECTIVE_STATES.concat(charter.FEATURE_STATES.filter((s) => charter.OBJECTIVE_STATES.indexOf(s) < 0))

    const charters = new Collection(
      Object.assign({}, LOCKED_RULES, {
        type: 'base',
        name: 'project_charters',
        fields: [
          { name: 'project_id', type: 'relation', required: true, collectionId: projects.id, maxSelect: 1, cascadeDelete: true },
          { name: 'objective', type: 'text', max: charter.OBJECTIVE_MAX },
          { name: 'updated_by', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: false },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE UNIQUE INDEX idx_charters_project ON project_charters (project_id)'],
      }),
    )
    app.save(charters)

    const items = new Collection(
      Object.assign({}, LOCKED_RULES, {
        type: 'base',
        name: 'charter_items',
        fields: [
          { name: 'project_id', type: 'relation', required: true, collectionId: projects.id, maxSelect: 1, cascadeDelete: true },
          { name: 'kind', type: 'select', required: true, maxSelect: 1, values: charter.KINDS },
          { name: 'title', type: 'text', required: true, max: charter.TITLE_MAX },
          { name: 'description', type: 'text', max: charter.DESCRIPTION_MAX },
          { name: 'position', type: 'number', onlyInt: true },
          { name: 'state', type: 'select', maxSelect: 1, values: states },
          { name: 'owner_id', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: false },
          { name: 'task_ids', type: 'json', maxSize: 20000 },
          { name: 'link_ids', type: 'json', maxSize: 5000 },
          { name: 'unit', type: 'text', max: charter.UNIT_MAX },
          { name: 'baseline', type: 'number' },
          { name: 'target', type: 'number' },
          { name: 'current', type: 'number' },
          { name: 'has_current', type: 'bool' },
          { name: 'start_date', type: 'date' },
          { name: 'due_date', type: 'date' },
          { name: 'frequency', type: 'select', maxSelect: 1, values: charter.FREQUENCIES },
          { name: 'measured_at', type: 'date' },
          { name: 'created_by', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: false },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE INDEX idx_charter_items_project ON charter_items (project_id, kind, position)'],
      }),
    )
    app.save(items)

    const measurements = new Collection(
      Object.assign({}, LOCKED_RULES, {
        type: 'base',
        name: 'charter_measurements',
        fields: [
          { name: 'project_id', type: 'relation', required: true, collectionId: projects.id, maxSelect: 1, cascadeDelete: true },
          { name: 'item_id', type: 'relation', required: true, collectionId: items.id, maxSelect: 1, cascadeDelete: true },
          { name: 'value', type: 'number' },
          { name: 'note', type: 'text', max: charter.NOTE_MAX },
          { name: 'measured_at', type: 'date', required: true },
          { name: 'created_by', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: false },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        ],
        indexes: ['CREATE INDEX idx_charter_measurements_item ON charter_measurements (item_id, measured_at)'],
      }),
    )
    app.save(measurements)
  },
  (app) => {
    ;['charter_measurements', 'charter_items', 'project_charters'].forEach((name) => app.delete(app.findCollectionByNameOrId(name)))
  },
)
