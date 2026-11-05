/**
 * Ferramentas MCP da Ficha do projeto (regras de negócio §30): objetivo geral, objetivos,
 * funcionalidades (com as tarefas vinculadas), escopo e resultados esperados com a série de medições.
 * Cada ferramenta delega para um caso de uso de application/charter.js.
 */

const charter = require('../../domain/charter')
const { READ, ADD, CHANGE, DELETE, schema, id, nullableId, ids, text, date, nullableDate, oneOf, PROJECT_ID, pick, without } = require('../kit')
const { compactTask } = require('./work')

const ITEM_ID = id('Charter item id (from get_project_charter).')
const STATES = charter.OBJECTIVE_STATES.concat(charter.FEATURE_STATES.filter((s) => charter.OBJECTIVE_STATES.indexOf(s) < 0))
const number = (description) => ({ type: 'number', description })

const ITEM_FIELDS = {
  title: text(charter.TITLE_MAX, 'Item title.'),
  description: text(charter.DESCRIPTION_MAX, 'Item description.'),
  state: oneOf(
    STATES,
    'Objective: auto (computed from its links), pending, in_progress, achieved or at_risk. Feature: auto (computed from its tasks), planned, in_progress, delivered or cancelled.',
  ),
  link_ids: ids(charter.MAX_LINKS, 'Objective only: the features and expected results it depends on (charter item ids); replaces the list.'),
  task_ids: ids(charter.MAX_TASKS, 'Feature only: the tasks of the project that deliver it (from list_tasks); replaces the list.'),
  unit: text(charter.UNIT_MAX, 'Result only: unit of the indicator (e.g. %, people).'),
  baseline: number('Result only: starting value (default 0). A target below the baseline means "the lower, the better".'),
  target: number('Result only: target value (required when creating a result).'),
  frequency: oneOf(charter.FREQUENCIES, 'Result only: how often it should be measured (none, weekly, monthly, quarterly).'),
}

/** Item com as tarefas da funcionalidade em resumo enxuto. */
const compactItem = (item) => (item && item.tasks ? Object.assign({}, item, { tasks: item.tasks.map(compactTask) }) : item)

/** Ficha com as tarefas das funcionalidades em resumo enxuto. */
const compactCharter = (result) => Object.assign({}, result, { items: result.items.map(compactItem) })

const TOOLS = [
  {
    name: 'get_project_brief',
    title: 'Project brief',
    description:
      'Returns what the project needs from the user: the general objective, the tasks assigned to them or marked visible to IT, and the charter features and expected results they own. It is the only project view of an IT owner (role it); anyone who sees the project can also ask for it.',
    inputSchema: schema({ project_id: PROJECT_ID }, ['project_id']),
    annotations: READ,
    run: async (args, { services, ctx }) => {
      const brief = await services.charter.getBrief(ctx, args.project_id)
      return Object.assign({}, brief, { tasks: brief.tasks.map(compactTask) })
    },
  },
  {
    name: 'get_project_charter',
    title: 'Project charter',
    description:
      'Returns the charter of a project (requires the charter section of the project; FORBIDDEN otherwise): general objective, specific objectives, features (with linked tasks and progress), scope (included / not included) and expected results (baseline, target, current value, situation on_track/late/achieved/no_data, stale = not measured in time), plus completeness and a summary. States marked auto are computed from the links.',
    inputSchema: schema({ project_id: PROJECT_ID }, ['project_id']),
    annotations: READ,
    run: async (args, { services, ctx }) => compactCharter(await services.charter.getCharter(ctx, args.project_id)),
  },
  {
    name: 'update_project_charter',
    title: 'Set charter objective',
    description: 'Sets the general objective of the project charter. Requires being a project manager.',
    inputSchema: schema({ project_id: PROJECT_ID, objective: text(charter.OBJECTIVE_MAX, 'General objective of the project.') }, ['project_id', 'objective']),
    annotations: CHANGE,
    run: async (args, { services, ctx }) => compactCharter(await services.charter.updateCharter(ctx, args.project_id, pick(args, ['objective']))),
  },
  {
    name: 'create_charter_item',
    title: 'Create charter item',
    description:
      'Adds an item to the project charter: objective, feature, scope_in (included in scope), scope_out (not included) or result (expected result with an indicator). Each kind takes only its own fields; the others are ignored. Requires being a project manager.',
    inputSchema: schema(
      Object.assign(
        {
          project_id: PROJECT_ID,
          kind: oneOf(charter.KINDS, 'Item kind (cannot change later).'),
          owner_id: id('Objective, feature or result: responsible person (the owner or a project member).'),
          start_date: date('Result only: start of the measurement period'),
          due_date: date('Result only: deadline to reach the target'),
        },
        ITEM_FIELDS,
      ),
      ['project_id', 'kind', 'title'],
    ),
    annotations: ADD,
    run: async (args, { services, ctx }) => compactItem(await services.charter.createItem(ctx, args.project_id, without(args, 'project_id'))),
  },
  {
    name: 'update_charter_item',
    title: 'Update charter item',
    description: 'Changes a charter item (only the fields sent; the kind does not change). Requires being a project manager.',
    inputSchema: schema(
      Object.assign(
        {
          item_id: ITEM_ID,
          owner_id: nullableId('Responsible person (the owner or a project member).'),
          start_date: nullableDate('Result only: start of the measurement period'),
          due_date: nullableDate('Result only: deadline to reach the target'),
        },
        ITEM_FIELDS,
      ),
      ['item_id'],
    ),
    annotations: CHANGE,
    run: async (args, { services, ctx }) => compactItem(await services.charter.updateItem(ctx, args.item_id, without(args, 'item_id'))),
  },
  {
    name: 'reorder_charter_items',
    title: 'Reorder charter items',
    description: 'Sets the order of the charter items of one kind: item_ids must list all items of that kind, in the new order. Requires being a project manager.',
    inputSchema: schema(
      { project_id: PROJECT_ID, kind: oneOf(charter.KINDS, 'Kind of the items.'), item_ids: ids(charter.MAX_ITEMS, 'All item ids of that kind, in the new order.') },
      ['project_id', 'kind', 'item_ids'],
    ),
    annotations: CHANGE,
    run: async (args, { services, ctx }) => compactCharter(await services.charter.reorderItems(ctx, args.project_id, { kind: args.kind, ids: args.item_ids })),
  },
  {
    name: 'delete_charter_item',
    title: 'Delete charter item',
    description: 'Deletes a charter item (a result loses its measurements; objectives lose the link to it). Requires being a project manager. Confirm with the user first.',
    inputSchema: schema({ item_id: ITEM_ID }, ['item_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.charter.deleteItem(ctx, args.item_id),
  },
  {
    name: 'list_charter_measurements',
    title: 'Result measurements',
    description: 'Lists the measurements of an expected result, newest first (value, date, note, who measured).',
    inputSchema: schema({ item_id: id('Expected result id (a charter item of kind result).') }, ['item_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.charter.listMeasurements(ctx, args.item_id),
  },
  {
    name: 'add_charter_measurement',
    title: 'Measure result',
    description:
      'Records a measurement of an expected result; the most recent date becomes its current value. Allowed for project managers and for the person responsible for the result. The date cannot be in the future.',
    inputSchema: schema(
      {
        item_id: id('Expected result id (a charter item of kind result).'),
        value: number('Measured value.'),
        note: text(charter.NOTE_MAX, 'Comment about the measurement (e.g. its source).'),
        measured_at: date('Measurement date (default: today)'),
      },
      ['item_id', 'value'],
    ),
    annotations: ADD,
    run: async (args, { services, ctx }) => compactItem(await services.charter.addMeasurement(ctx, args.item_id, without(args, 'item_id'))),
  },
]

module.exports = { TOOLS }
