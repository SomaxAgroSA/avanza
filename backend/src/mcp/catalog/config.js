/**
 * Ferramentas MCP da configuração das tarefas (Configurações → Fluxo, Prioridades, Tipos de tarefa,
 * Campos personalizados e Tags): status, prioridades, tipos e os campos de cada tipo, a biblioteca de
 * campos e as tags. Cada ferramenta delega para o caso de uso da rota equivalente (http/routes.js);
 * permissões, validação e histórico são os dos casos de uso. A leitura do dia a dia (ids ativos) fica
 * em get_task_settings/get_task_type (catalog/work.js).
 */

const workflow = require('../../domain/workflow')
const cf = require('../../domain/custom-field')
const { READ, ADD, CHANGE, DELETE, schema, id, ids, text, oneOf, bool, int, color, PAGE, pick, without, pageQuery, page } = require('../kit')

const STATUS_ID = id('Status id (from list_statuses).')
const PRIORITY_ID = id('Priority id (from list_priorities).')
const TASK_TYPE_ID = id('Task type id (from list_task_types).')
const FIELD_ID = id('Custom field id (from list_custom_fields).')
const TAG_ID = id('Tag id (from get_task_settings).')

const INCLUDE_INACTIVE = bool('Also return inactive items (requires settings.manage). Reordering needs every id, inactive ones included.')
const KEY = text(30, 'Unique technical key: letters, digits and underscores, starting with a letter (normalized to UPPER_CASE, e.g. IN_REVIEW). It cannot change later.')

/** Campos comuns de status e prioridade (domain/workflow.js, application/lookups.js). */
const LOOKUP_FIELDS = {
  name: text(60, 'Display name.'),
  description: text(255, 'Short description.'),
  color: color(),
  is_active: bool('Inactive items stay on existing tasks but cannot be chosen for new ones. The default item must stay active.'),
  is_default: bool('Make it the default for new tasks (exactly one default; the previous one stops being default).'),
}

const STATUS_FIELDS = Object.assign({}, LOOKUP_FIELDS, {
  category: oneOf(workflow.STATUS_CATEGORIES, 'Workflow meaning of the status, whatever its name (done and cancelled close the task).'),
  wip_limit: int(0, 999, 'Kanban WIP limit of the column (0 = no limit).'),
  allowed_next: ids(50, 'Status ids a task in this status may move to (empty = any). It replaces the current list; it cannot include the status itself.'),
})

/** Uma versão traduzida (en/es) do tipo de tarefa. */
const TRANSLATION = {
  type: ['object', 'null'],
  properties: { name: text(60, 'Translated name.'), description: text(255, 'Translated description.') },
  additionalProperties: false,
  description: 'Translated version; null removes it.',
}

const TASK_TYPE_FIELDS = {
  name: text(60, 'Display name (Brazilian Portuguese, the original).'),
  description: text(255, 'Short description.'),
  icon: text(64, `Icon: one of ${cf.TASK_TYPE_ICONS.join(', ')} or the name of an icon imported into the icon library.`),
  color: color(),
  is_active: bool('Inactive types cannot be chosen for new tasks.'),
  translations: {
    type: 'object',
    properties: { en: TRANSLATION, es: TRANSLATION },
    additionalProperties: false,
    description: 'English and Spanish versions of name/description; replaces the current translations.',
  },
}

const TYPE_FIELD_ITEM = schema(
  {
    field_id: id('Custom field id (from list_custom_fields).'),
    required: bool('Always required.'),
    visible: bool('Shown in the task form (default true). A hidden field is never required.'),
    show_on_card: bool('Shown on the Kanban card.'),
    required_status_ids: ids(50, 'Required only when the task is in these statuses (ignored when required is true).'),
  },
  ['field_id'],
)

const FIELD_CONFIG = {
  type: 'object',
  properties: {
    max_length: int(1, 10000, 'text (max 255) and textarea (max 10000): maximum length.'),
    decimals: int(0, 6, 'decimal: decimal places (default 2).'),
    min: { type: 'number', description: 'number/decimal: minimum value.' },
    max: { type: 'number', description: 'number/decimal: maximum value.' },
    allow_create_options: bool('select/multiselect: people may add new options from the task form.'),
  },
  additionalProperties: false,
  description: 'Type settings; replaces the current ones.',
}

const FIELD_OPTION = schema(
  {
    id: id('Existing option id, to keep it (and its values on tasks).'),
    label: text(cf.MAX_OPTION_LABEL, 'Option label (unique in the field).'),
    color: color('Option color'),
    is_active: bool('Inactive options stay on existing tasks but cannot be chosen.'),
    is_default: bool('Default option (select: at most one).'),
  },
  ['label'],
)

const FIELD_FIELDS = {
  label: text(80, 'Label shown to people.'),
  description: text(255, 'Help text.'),
  config: FIELD_CONFIG,
  options: {
    type: 'array',
    items: FIELD_OPTION,
    maxItems: 200,
    description: 'select/multiselect options, in order. Replaces the whole list: send existing ones with their id; options left out are removed from the field and from tasks (prefer is_active false).',
  },
  default_value: { description: 'Default value for new tasks (not for select fields, which use is_default on the options; not for user, users, project, image and file).' },
  searchable: bool('Included in the task text search (text, textarea, url, email, phone).'),
  filterable: bool('Available as a task list filter.'),
  sortable: bool('Available as a task list sort.'),
}

const TAG_FIELDS = { name: text(40, 'Tag name (unique, case-insensitive).'), color: color() }

const historyTool = (name, title, entityType, idKey, idSchema, what) => ({
  name,
  title,
  description: `Returns the change history of ${what} (who changed what and when), newest first, paginated. Requires settings.manage or audit.view.`,
  inputSchema: schema(Object.assign({ [idKey]: idSchema }, PAGE), [idKey]),
  annotations: READ,
  run: async (args, { services, ctx }) => page(await services.audit.listEntityHistory(ctx, entityType, args[idKey], pageQuery(args))),
})

const includeInactive = (args) => (args.include_inactive ? { include_inactive: '1' } : {})

const TOOLS = [
  // ---------------------------------------------------------------- status (fluxo)
  {
    name: 'list_statuses',
    title: 'List statuses',
    description: 'Lists the workflow statuses in board order (shared by all projects): key, category, color, WIP limit, allowed_next transitions (empty = any), default and active flags. Requires tasks.view or settings.manage.',
    inputSchema: schema({ include_inactive: INCLUDE_INACTIVE }),
    annotations: READ,
    run: (args, { services, ctx }) => services.statuses.list(ctx, includeInactive(args)),
  },
  {
    name: 'create_status',
    title: 'Create status',
    description: 'Creates a workflow status (a Kanban column, added at the end; it applies to every project). Requires settings.manage.',
    inputSchema: schema(Object.assign({ key: KEY }, STATUS_FIELDS), ['key', 'name', 'category']),
    annotations: ADD,
    run: (args, { services, ctx }) => services.statuses.create(ctx, args),
  },
  {
    name: 'update_status',
    title: 'Update status',
    description: 'Changes a workflow status (only the fields sent; the key cannot change). Requires settings.manage.',
    inputSchema: schema(Object.assign({ status_id: STATUS_ID }, STATUS_FIELDS), ['status_id']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.statuses.update(ctx, args.status_id, without(args, 'status_id')),
  },
  {
    name: 'delete_status',
    title: 'Delete status',
    description: 'Deletes a workflow status. Refused for the default status or while tasks use it (STATUS_IN_USE; deactivate it instead). Requires settings.manage. Confirm with the user first.',
    inputSchema: schema({ status_id: STATUS_ID }, ['status_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.statuses.delete(ctx, args.status_id),
  },
  {
    name: 'reorder_statuses',
    title: 'Reorder statuses',
    description: 'Sets the board order of the statuses. Send every status id exactly once, inactive ones included (see list_statuses with include_inactive). Requires settings.manage.',
    inputSchema: schema({ ids: ids(200, 'All status ids in the new order.') }, ['ids']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.statuses.reorder(ctx, args.ids),
  },

  // ---------------------------------------------------------------- prioridades
  {
    name: 'list_priorities',
    title: 'List priorities',
    description: 'Lists the task priorities in order: key, color, default and active flags. Requires tasks.view or settings.manage.',
    inputSchema: schema({ include_inactive: INCLUDE_INACTIVE }),
    annotations: READ,
    run: (args, { services, ctx }) => services.priorities.list(ctx, includeInactive(args)),
  },
  {
    name: 'create_priority',
    title: 'Create priority',
    description: 'Creates a task priority (added at the end). Requires settings.manage.',
    inputSchema: schema(Object.assign({ key: KEY }, LOOKUP_FIELDS), ['key', 'name']),
    annotations: ADD,
    run: (args, { services, ctx }) => services.priorities.create(ctx, args),
  },
  {
    name: 'update_priority',
    title: 'Update priority',
    description: 'Changes a task priority (only the fields sent; the key cannot change). Requires settings.manage.',
    inputSchema: schema(Object.assign({ priority_id: PRIORITY_ID }, LOOKUP_FIELDS), ['priority_id']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.priorities.update(ctx, args.priority_id, without(args, 'priority_id')),
  },
  {
    name: 'delete_priority',
    title: 'Delete priority',
    description: 'Deletes a task priority. Refused for the default priority or while tasks use it (PRIORITY_IN_USE; deactivate it instead). Requires settings.manage. Confirm with the user first.',
    inputSchema: schema({ priority_id: PRIORITY_ID }, ['priority_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.priorities.delete(ctx, args.priority_id),
  },
  {
    name: 'reorder_priorities',
    title: 'Reorder priorities',
    description: 'Sets the order of the priorities. Send every priority id exactly once, inactive ones included. Requires settings.manage.',
    inputSchema: schema({ ids: ids(200, 'All priority ids in the new order.') }, ['ids']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.priorities.reorder(ctx, args.ids),
  },

  // ---------------------------------------------------------------- tipos de tarefa
  {
    name: 'list_task_types',
    title: 'List task types',
    description: 'Lists the task types in order with key, icon, color, translations, active flag and how many custom fields each one has (get_task_type shows the fields). Requires tasks.view or settings.manage.',
    inputSchema: schema({ include_inactive: INCLUDE_INACTIVE }),
    annotations: READ,
    run: (args, { services, ctx }) => services.taskTypes.listTypes(ctx, includeInactive(args)),
  },
  {
    name: 'create_task_type',
    title: 'Create task type',
    description: 'Creates a task type (added at the end, without fields: add them with set_task_type_fields). Requires settings.manage.',
    inputSchema: schema(Object.assign({ key: KEY }, TASK_TYPE_FIELDS), ['key', 'name']),
    annotations: ADD,
    run: (args, { services, ctx }) => services.taskTypes.createType(ctx, args),
  },
  {
    name: 'update_task_type',
    title: 'Update task type',
    description: 'Changes a task type (only the fields sent; the key cannot change). Requires settings.manage.',
    inputSchema: schema(Object.assign({ task_type_id: TASK_TYPE_ID }, TASK_TYPE_FIELDS), ['task_type_id']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.taskTypes.updateType(ctx, args.task_type_id, without(args, 'task_type_id')),
  },
  {
    name: 'delete_task_type',
    title: 'Delete task type',
    description: 'Deletes a task type. Refused while tasks use it (TASK_TYPE_IN_USE; deactivate it instead). Requires settings.manage. Confirm with the user first.',
    inputSchema: schema({ task_type_id: TASK_TYPE_ID }, ['task_type_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.taskTypes.deleteType(ctx, args.task_type_id),
  },
  {
    name: 'reorder_task_types',
    title: 'Reorder task types',
    description: 'Sets the order of the task types. Send every type id exactly once, inactive ones included. Requires settings.manage.',
    inputSchema: schema({ ids: ids(500, 'All task type ids in the new order.') }, ['ids']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.taskTypes.reorderTypes(ctx, args.ids),
  },
  {
    name: 'set_task_type_fields',
    title: 'Set task type fields',
    description:
      'Replaces the custom fields of a task type: the list order is the form order; fields left out are removed from the type. Send the current fields too (see get_task_type). Requires settings.manage.',
    inputSchema: schema({ task_type_id: TASK_TYPE_ID, fields: { type: 'array', items: TYPE_FIELD_ITEM, maxItems: 100, description: 'Fields of the type, in order.' } }, ['task_type_id', 'fields']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.taskTypes.setTypeFields(ctx, args.task_type_id, args.fields),
  },
  historyTool('get_task_type_history', 'Task type history', 'task_type', 'task_type_id', TASK_TYPE_ID, 'a task type'),

  // ---------------------------------------------------------------- campos personalizados
  {
    name: 'list_custom_fields',
    title: 'List custom fields',
    description: 'Lists the custom field library (shared by the task types): technical name, label, type, config, options and which task types use each field. Requires tasks.view or settings.manage.',
    inputSchema: schema({ search: text(100, 'Text to match in the label or technical name.'), type: oneOf(cf.FIELD_TYPES, 'Only fields of this type.') }),
    annotations: READ,
    run: (args, { services, ctx }) => services.customFields.listFields(ctx, pick(args, ['search', 'type'])),
  },
  {
    name: 'get_custom_field',
    title: 'Get custom field',
    description: 'Returns a custom field with its config, options (ids, labels, colors), default value and the task types that use it. Requires tasks.view or settings.manage.',
    inputSchema: schema({ field_id: FIELD_ID }, ['field_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.customFields.getField(ctx, args.field_id),
  },
  {
    name: 'create_custom_field',
    title: 'Create custom field',
    description: 'Creates a custom field in the library; put it on task types with set_task_type_fields. select and multiselect need options. Requires settings.manage.',
    inputSchema: schema(
      Object.assign(
        {
          type: oneOf(cf.FIELD_TYPES, 'Field type. It cannot change later.'),
          name: text(40, 'Technical name (key in custom_values): lowercase letters, digits and underscores, starting with a letter. Defaults to the label slug; it cannot change later.'),
        },
        FIELD_FIELDS,
      ),
      ['type', 'label'],
    ),
    annotations: ADD,
    run: (args, { services, ctx }) => services.customFields.createField(ctx, args),
  },
  {
    name: 'update_custom_field',
    title: 'Update custom field',
    description: 'Changes a custom field (only the fields sent; the name and the type cannot change). Requires settings.manage.',
    inputSchema: schema(Object.assign({ field_id: FIELD_ID }, FIELD_FIELDS), ['field_id']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.customFields.updateField(ctx, args.field_id, without(args, 'field_id')),
  },
  {
    name: 'delete_custom_field',
    title: 'Delete custom field',
    description: 'Deletes a custom field from the library. Refused while a task type uses it (FIELD_IN_USE lists them; remove it with set_task_type_fields first). Requires settings.manage. Confirm with the user first.',
    inputSchema: schema({ field_id: FIELD_ID }, ['field_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.customFields.deleteField(ctx, args.field_id),
  },
  {
    name: 'add_custom_field_option',
    title: 'Add field option',
    description:
      'Adds one option to a select/multiselect field that allows new options (config.allow_create_options); an existing option with the same label is returned (and reactivated) instead (created false). Requires settings.manage, tasks.create or tasks.edit.',
    inputSchema: schema({ field_id: FIELD_ID, label: text(cf.MAX_OPTION_LABEL, 'Option label.') }, ['field_id', 'label']),
    annotations: ADD,
    run: (args, { services, ctx }) => services.customFields.addOption(ctx, args.field_id, pick(args, ['label'])),
  },
  historyTool('get_custom_field_history', 'Custom field history', 'custom_field', 'field_id', FIELD_ID, 'a custom field'),

  // ---------------------------------------------------------------- tags
  {
    name: 'create_tag',
    title: 'Create tag',
    description: 'Creates a tag (global; tasks reference it in tag_ids). Requires settings.manage.',
    inputSchema: schema(TAG_FIELDS, ['name']),
    annotations: ADD,
    run: (args, { services, ctx }) => services.tags.createTag(ctx, args),
  },
  {
    name: 'update_tag',
    title: 'Update tag',
    description: 'Renames or recolors a tag (only the fields sent). Requires settings.manage.',
    inputSchema: schema(Object.assign({ tag_id: TAG_ID }, TAG_FIELDS), ['tag_id']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.tags.updateTag(ctx, args.tag_id, without(args, 'tag_id')),
  },
  {
    name: 'delete_tag',
    title: 'Delete tag',
    description: 'Deletes a tag and removes it from every task. Requires settings.manage. Confirm with the user first.',
    inputSchema: schema({ tag_id: TAG_ID }, ['tag_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.tags.deleteTag(ctx, args.tag_id),
  },
]

module.exports = { TOOLS }
