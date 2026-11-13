/**
 * Catálogo MCP — Gestão de projetos (o "quadro" do projeto: grupos, elementos e subelementos,
 * etiquetas de status e de recurso, dependências, importação, atualizações, diário, problemas,
 * linha de base, relatório e colunas personalizadas). Cada ferramenta só delega para o caso de uso
 * da rota correspondente (http/routes.js: services.plan, planInteraction, planCollaboration,
 * planManagement, planColumns e audit). Arquivos (envio) ficam de fora: o MCP fala só JSON.
 *
 * get_plan sai enxuto (o quadro pode ter até 3000 elementos); get_plan_item traz o elemento inteiro.
 */

const planDomain = require('../../domain/plan')
const linkDomain = require('../../domain/plan-links')
const mgmtDomain = require('../../domain/plan-management')
const columnsDomain = require('../../domain/plan-columns')
const updatesDomain = require('../../domain/plan-updates')
const importDomain = require('../../domain/plan-import')
const { READ, ADD, CHANGE, ACTION, DELETE, schema, id, nullableId, ids, text, date, nullableDate, oneOf, bool, int, color, PAGE, PROJECT_ID, pick, without, pageQuery, page } = require('../kit')

// ---------------------------------------------------------------- esquemas locais

/** Número com limites (horas aceitam 0, ao contrário de `hours` do kit). */
const number = (min, max, description) => ({ type: 'number', minimum: min, maximum: max, description })
const nullable = (prop) => Object.assign({}, prop, { type: [].concat(prop.type, 'null'), description: `${prop.description} null clears it.` })

const PLAN_ITEM_ID = id('Plan item (element or subitem) id (from get_plan).')
const GROUP_ID = id('Group id (from get_plan).')
const COLOR = color('Color')
/** Valor de célula de coluna personalizada (o tipo da coluna decide o que vale). */
const CELL_VALUE = {
  type: ['string', 'number', 'boolean', 'null'],
  maxLength: columnsDomain.LINK_MAX,
  description:
    'Value by column type: text = string; number = number; date = "YYYY-MM-DD"; checkbox = true/false; dropdown = option id (from the column settings in get_plan); people = user id (a project member); link = http(s) URL. null clears it.',
}

const ITEM_FIELDS = {
  name: text(planDomain.ITEM_NAME_MAX, 'Name.'),
  status_id: nullableId('Plan status id (from get_plan statuses).'),
  owner_id: nullableId('Owner user id (a project member, see list_project_members).'),
  start_date: nullableDate('Schedule start'),
  end_date: nullableDate('Schedule end (not before the start)'),
  due_date: nullableDate('Due date'),
  resource_ids: { type: ['array', 'null'], items: { type: 'string', maxLength: 64 }, maxItems: planDomain.MAX_RESOURCES, description: 'Resource ids (from get_plan resources); replaces the current list. null clears it.' },
  estimated_hours: nullable(number(0, 100000, "Estimated effort in hours (work). null = use the sum of the linked tasks' hours.")),
  actual_hours: nullable(number(0, 100000, "Hours actually spent. null = use the sum of the linked tasks' hours.")),
  duration_days: nullable(int(0, 3650, 'Duration in days, used only when the item has no schedule dates.')),
  progress: nullable(int(0, 100, 'Manual progress 0-100 (ignored when the status is done or the element has subitems, which compute it).')),
  custom: {
    type: 'object',
    description: 'Custom column values keyed by column id (from get_plan columns), e.g. {"<column_id>": 10}; null removes a value. Only top-level elements have them, not subitems. See set_plan_item_value for the value format.',
  },
}

const COLUMN_SETTINGS = {
  type: 'object',
  properties: {
    options: {
      type: 'array',
      maxItems: columnsDomain.MAX_OPTIONS,
      items: schema(
        {
          id: text(64, 'Existing option id, to keep it (item values point to it). Omit for a new option.'),
          name: text(columnsDomain.OPTION_NAME_MAX, 'Option name (unique in the column).'),
          color: COLOR,
        },
        ['name', 'color'],
      ),
      description: 'dropdown only: the full option list (replaces it; options left out are removed and their values cleared).',
    },
    unit: text(8, 'number only: unit shown after the value (e.g. "R$", "kg").'),
  },
  additionalProperties: false,
  description: 'Type settings: dropdown → { options }; number → { unit }; other types have none.',
}

const IMPORT_ROW = schema(
  {
    group: text(planDomain.GROUP_NAME_MAX, 'Group name (or numbered title such as "1.0 Initiation"); a missing group is created (needs plan manager).'),
    name: text(planDomain.ITEM_NAME_MAX, 'Element name.'),
    parent: text(planDomain.ITEM_NAME_MAX, 'Parent element name in the same group (from these rows or already on the board) to create a subitem.'),
    status: text(planDomain.STATUS_NAME_MAX, 'Plan status name; a missing one is created (needs plan manager).'),
    resources: { type: 'array', items: { type: 'string', maxLength: planDomain.RESOURCE_NAME_MAX }, maxItems: planDomain.MAX_RESOURCES, description: 'Resource names; missing ones are created.' },
    start_date: date('Schedule start'),
    end_date: date('Schedule end'),
    estimated_hours: number(0, 100000, 'Estimated hours.'),
    actual_hours: number(0, 100000, 'Hours spent.'),
    duration_days: int(0, 3650, 'Duration in days (without schedule dates).'),
    progress: int(0, 100, 'Manual progress 0-100.'),
  },
  ['group', 'name'],
)

// ---------------------------------------------------------------- apoio

const nameOf = (ref) => (ref ? ref.name : null)

/** Sem as chaves vazias (null, lista ou objeto vazio): o quadro inteiro precisa caber no contexto. */
function dense(record) {
  const out = {}
  Object.keys(record).forEach((key) => {
    const value = record[key]
    if (value === null || value === undefined) return
    if (Array.isArray(value) && value.length === 0) return
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return
    out[key] = value
  })
  return out
}

const day = (value) => (typeof value === 'string' ? value.slice(0, 10) : value || null)

/** Elemento/subelemento enxuto para get_plan (o completo vem de get_plan_item). */
function compactItem(item, statusById, resourceById) {
  const status = item.status_id ? statusById[item.status_id] : null
  return dense({
    id: item.id,
    name: item.name,
    group_id: item.parent_id ? null : item.group_id,
    status: status ? { id: status.id, name: status.name, category: status.category } : null,
    owner: item.owner ? { id: item.owner.id, name: item.owner.name } : null,
    start_date: day(item.start_date),
    end_date: day(item.end_date),
    due_date: day(item.due_date),
    progress: item.progress ? item.progress.value : 0,
    // tarefas ligadas (ADR-050): com elas, o progresso vem das tarefas
    tasks: item.tasks && item.tasks.total ? item.tasks : null,
    estimated_hours: item.estimated_hours,
    actual_hours: item.actual_hours,
    // sem o próprio, o esforço é a soma das horas das tarefas ligadas (regras §28); informar no elemento substitui
    hours_from_tasks: item.estimated_from_tasks || item.actual_from_tasks ? { estimated: !!item.estimated_from_tasks, actual: !!item.actual_from_tasks } : null,
    resources: (item.resource_ids || []).map((rid) => nameOf(resourceById[rid]) || rid),
    custom: item.custom,
    blocked: item.blocked || null,
    updates: item.updates || null,
  })
}

function compactPlan(plan, args) {
  const index = (list) => {
    const map = {}
    list.forEach((x) => {
      map[x.id] = x
    })
    return map
  }
  const statusById = index(plan.statuses)
  const resourceById = index(plan.resources)
  const withSubitems = args.include_subitems !== false
  const children = {}
  plan.items.forEach((i) => {
    if (i.parent_id) (children[i.parent_id] = children[i.parent_id] || []).push(i)
  })
  const groups = args.group_id ? plan.groups.filter((g) => g.id === args.group_id || g.parent_id === args.group_id) : plan.groups
  const groupIds = groups.map((g) => g.id)
  const totals = (summary) =>
    summary ? dense({ items: summary.items, progress: summary.progress, start_date: day(summary.start_date), end_date: day(summary.end_date), estimated_hours: summary.estimated_hours }) : null
  return {
    project: plan.project,
    capabilities: plan.capabilities,
    settings: plan.settings,
    statuses: plan.statuses.map((s) => ({ id: s.id, name: s.name, category: s.category })),
    resources: plan.resources.map((r) => ({ id: r.id, name: r.name })),
    columns: plan.columns.map((c) => dense({ id: c.id, name: c.name, type: c.type, settings: c.settings })),
    summary: totals(plan.summary),
    groups: groups.map((g) => dense({ id: g.id, number: g.number, name: g.name, parent_id: g.parent_id, totals: totals(g.summary) })),
    links: plan.links,
    items: plan.items
      .filter((i) => !i.parent_id && groupIds.indexOf(i.group_id) >= 0)
      .map((i) => {
        const out = compactItem(i, statusById, resourceById)
        const kids = children[i.id] || []
        if (withSubitems && kids.length > 0) out.subitems = kids.map((k) => compactItem(k, statusById, resourceById))
        else if (kids.length > 0) out.subitem_count = kids.length
        return out
      }),
    truncated: plan.truncated,
  }
}

const bulk = (action) => (args, { services, ctx }) => services.planInteraction.bulkItems(ctx, args.project_id, Object.assign({ action }, without(args, 'project_id')))
const BULK_IDS = ids(planDomain.MAX_BULK, `Plan item ids (from get_plan), up to ${planDomain.MAX_BULK}.`)

// ---------------------------------------------------------------- ferramentas

const TOOLS = [
  // ---------------------------------------------------------------- leitura
  {
    name: 'get_plan',
    title: 'Project management board',
    description:
      'Returns the project management board (Gestão de projetos) of a project, compact: plan statuses, resources, custom columns (with dropdown options), groups (phases, numbered like 1.0/1.1, with totals), dependency links and the elements with their subitems (status, owner, dates, progress, hours, resource names, custom values keyed by column id). Empty fields are omitted. This board is separate from tasks. Use get_plan_item for the full detail of one item.',
    inputSchema: schema(
      {
        project_id: PROJECT_ID,
        group_id: id('Only this group (and its subgroups).'),
        include_subitems: bool('Include subitems under each element (default true; false returns only subitem_count).'),
      },
      ['project_id'],
    ),
    annotations: READ,
    run: async (args, { services, ctx }) => compactPlan(await services.plan.getPlan(ctx, args.project_id), args),
  },
  {
    name: 'get_plan_item',
    title: 'Get plan item',
    description: "Returns the full plan item (element or subitem): group, parent, status, owner, dates, hours, duration, progress (value and source), resources, custom column values and number of subitems. Without hours of its own, the hours are the sum of the linked tasks' hours (estimated_from_tasks / actual_from_tasks).",
    inputSchema: schema({ plan_item_id: PLAN_ITEM_ID }, ['plan_item_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.plan.getItem(ctx, args.plan_item_id),
  },
  {
    name: 'get_plan_item_history',
    title: 'Plan item history',
    description: 'Returns the readable change history of a plan item (who changed what and when), newest first, paginated.',
    inputSchema: schema(Object.assign({ plan_item_id: PLAN_ITEM_ID }, PAGE), ['plan_item_id']),
    annotations: READ,
    run: async (args, { services, ctx }) => page(await services.audit.listEntityHistory(ctx, 'plan_item', args.plan_item_id, pageQuery(args))),
  },
  {
    name: 'get_plan_report',
    title: 'Project management report',
    description:
      'Returns the board report: summary (total, done, pending, overdue, stuck, progress), schedule of open elements, effort (estimated, actual, remaining, deviation), per resource and per group, and the project health (worst factor among schedule, progress, stuck, effort and issues, with each factor).',
    inputSchema: schema(
      {
        project_id: PROJECT_ID,
        tz_offset: int(-840, 840, 'Minutes to add to local time to get UTC (JavaScript getTimezoneOffset; Brasília = 180). Defines "today".'),
      },
      ['project_id'],
    ),
    annotations: READ,
    run: (args, { services, ctx }) => services.planManagement.getReport(ctx, args.project_id, args.tz_offset === undefined ? {} : { tz_offset: String(args.tz_offset) }),
  },

  // ---------------------------------------------------------------- grupos
  {
    name: 'create_plan_group',
    title: 'Create plan group',
    description: 'Creates a group (phase) at the end of the board, or a subgroup inside a top-level group (only two levels). Numbering (1.0, 1.1…) is automatic. Requires being a project manager with plan.manage.',
    inputSchema: schema(
      {
        project_id: PROJECT_ID,
        name: text(planDomain.GROUP_NAME_MAX, 'Group name (without the number).'),
        color: color('Group color (default blue)'),
        parent_id: id('Top-level group id, to create a subgroup.'),
      },
      ['project_id', 'name'],
    ),
    annotations: ADD,
    run: (args, { services, ctx }) => services.plan.createGroup(ctx, args.project_id, without(args, 'project_id')),
  },
  {
    name: 'update_plan_group',
    title: 'Update plan group',
    description: 'Renames or recolors a group. Requires being a project manager with plan.manage.',
    inputSchema: schema({ group_id: GROUP_ID, name: text(planDomain.GROUP_NAME_MAX, 'Group name.'), color: COLOR }, ['group_id']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.plan.updateGroup(ctx, args.group_id, without(args, 'group_id')),
  },
  {
    name: 'move_plan_group',
    title: 'Move plan group',
    description: 'Reorders a group among its siblings (after prev_id or before next_id; neither = at the end) and can change its level with parent_id. A group with subgroups cannot become a subgroup.',
    inputSchema: schema(
      {
        group_id: GROUP_ID,
        parent_id: { type: ['string', 'null'], maxLength: 64, description: 'Top-level group to move into; null makes it a top-level group; omit to keep the current level.' },
        prev_id: id('Sibling group that should stay before it.'),
        next_id: id('Sibling group that should stay after it.'),
      },
      ['group_id'],
    ),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.plan.moveGroup(ctx, args.group_id, without(args, 'group_id')),
  },
  {
    name: 'duplicate_plan_group',
    title: 'Duplicate plan group',
    description: 'Copies a group right after the original, with its subgroups, elements and subitems (same values, without dependencies).',
    inputSchema: schema({ group_id: GROUP_ID }, ['group_id']),
    annotations: ACTION,
    run: (args, { services, ctx }) => services.plan.duplicateGroup(ctx, args.group_id),
  },
  {
    name: 'delete_plan_group',
    title: 'Delete plan group',
    description: 'Permanently deletes a group with its subgroups, elements and subitems. It cannot be undone. Confirm with the user first.',
    inputSchema: schema({ group_id: GROUP_ID }, ['group_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.plan.deleteGroup(ctx, args.group_id),
  },

  // ---------------------------------------------------------------- elementos
  {
    name: 'create_plan_item',
    title: 'Create plan item',
    description:
      'Creates an element at the end of a group, or a subitem of an element (parent_id; it follows the parent group, one level only). Requires plan.edit and being a project manager or member. Returns the full item.',
    inputSchema: schema(
      Object.assign({ project_id: PROJECT_ID, group_id: id('Group id (from get_plan); required for an element.'), parent_id: id('Parent element id, to create a subitem.') }, ITEM_FIELDS),
      ['project_id', 'name'],
    ),
    annotations: ADD,
    run: (args, { services, ctx }) => services.plan.createItem(ctx, args.project_id, without(args, 'project_id')),
  },
  {
    name: 'update_plan_item',
    title: 'Update plan item',
    description:
      'Changes a plan item (only the fields sent; null clears). group_id moves an element (with its subitems) to the end of another group. With the board rule "block", starting or finishing an item whose dependencies are still open fails with PLAN_DEPENDENCY_PENDING.',
    inputSchema: schema(Object.assign({ plan_item_id: PLAN_ITEM_ID, group_id: id('Move the element to this group (not for subitems).') }, ITEM_FIELDS), ['plan_item_id']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.plan.updateItem(ctx, args.plan_item_id, without(args, 'plan_item_id')),
  },
  {
    name: 'set_plan_item_value',
    title: 'Set custom column value',
    description: 'Sets (or clears with null) the value of one custom column on an element (not on subitems). Columns, their types and dropdown options come from get_plan.',
    inputSchema: schema({ plan_item_id: PLAN_ITEM_ID, column_id: id('Custom column id (from get_plan columns).'), value: CELL_VALUE }, ['plan_item_id', 'column_id', 'value']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.plan.updateItem(ctx, args.plan_item_id, { custom: { [args.column_id]: args.value } }),
  },
  {
    name: 'move_plan_item',
    title: 'Move plan item',
    description: 'Reorders a plan item among its siblings (after prev_id or before next_id; neither = at the end) and, for an element, can move it with its subitems to another group.',
    inputSchema: schema(
      {
        plan_item_id: PLAN_ITEM_ID,
        group_id: id('Target group (elements only).'),
        prev_id: id('Sibling item that should stay above.'),
        next_id: id('Sibling item that should stay below.'),
      },
      ['plan_item_id'],
    ),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.planInteraction.moveItem(ctx, args.plan_item_id, without(args, 'plan_item_id')),
  },
  {
    name: 'duplicate_plan_item',
    title: 'Duplicate plan item',
    description: 'Copies a plan item right after the original (an element with its subitems; dependencies are not copied). Returns the copy.',
    inputSchema: schema({ plan_item_id: PLAN_ITEM_ID }, ['plan_item_id']),
    annotations: ACTION,
    run: (args, { services, ctx }) => services.planInteraction.duplicateItem(ctx, args.plan_item_id),
  },
  {
    name: 'delete_plan_item',
    title: 'Delete plan item',
    description: 'Permanently deletes a plan item with its subitems and dependency links. It cannot be undone. Confirm with the user first.',
    inputSchema: schema({ plan_item_id: PLAN_ITEM_ID }, ['plan_item_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.plan.deleteItem(ctx, args.plan_item_id),
  },
  {
    name: 'bulk_update_plan_items',
    title: 'Bulk update plan items',
    description: 'Changes several plan items of a project at once (all or nothing): status and/or resources to add or remove. At least one change is required.',
    inputSchema: schema(
      {
        project_id: PROJECT_ID,
        ids: BULK_IDS,
        status_id: nullableId('Plan status id for all of them.'),
        add_resource_ids: ids(planDomain.MAX_RESOURCES, 'Resource ids to add.'),
        remove_resource_ids: ids(planDomain.MAX_RESOURCES, 'Resource ids to remove.'),
      },
      ['project_id', 'ids'],
    ),
    annotations: CHANGE,
    run: bulk('update'),
  },
  {
    name: 'bulk_move_plan_items',
    title: 'Bulk move plan items',
    description: 'Moves several elements (not subitems) with their subitems to the end of a group.',
    inputSchema: schema({ project_id: PROJECT_ID, ids: BULK_IDS, group_id: id('Target group id (from get_plan).') }, ['project_id', 'ids', 'group_id']),
    annotations: CHANGE,
    run: bulk('move'),
  },
  {
    name: 'bulk_duplicate_plan_items',
    title: 'Bulk duplicate plan items',
    description: 'Duplicates several plan items, each right after its original (elements with their subitems).',
    inputSchema: schema({ project_id: PROJECT_ID, ids: BULK_IDS }, ['project_id', 'ids']),
    annotations: ACTION,
    run: bulk('duplicate'),
  },
  {
    name: 'bulk_delete_plan_items',
    title: 'Bulk delete plan items',
    description: 'Permanently deletes several plan items with their subitems and links. It cannot be undone. Confirm with the user first.',
    inputSchema: schema({ project_id: PROJECT_ID, ids: BULK_IDS }, ['project_id', 'ids']),
    annotations: DELETE,
    run: bulk('delete'),
  },
  {
    name: 'import_plan_items',
    title: 'Import plan items',
    description: `Creates many elements and subitems at once (up to ${importDomain.MAX_IMPORT_ROWS} rows, all or nothing), like the spreadsheet import. Groups, statuses and resources are matched by name; missing groups and statuses are created only for a project manager (otherwise the row fails), missing resources always. Errors point to the row index and field in details.rows.`,
    inputSchema: schema(
      {
        project_id: PROJECT_ID,
        rows: { type: 'array', items: IMPORT_ROW, maxItems: importDomain.MAX_IMPORT_ROWS, description: 'Rows in order; subitems reference their parent by name.' },
      },
      ['project_id', 'rows'],
    ),
    annotations: ADD,
    run: (args, { services, ctx }) => services.planInteraction.importItems(ctx, args.project_id, pick(args, ['rows'])),
  },

  // ---------------------------------------------------------------- dependências e regra do quadro
  {
    name: 'link_plan_items',
    title: 'Link plan items',
    description:
      'Creates a dependency from the point of view of plan_item_id: depends_on = it depends on target_item_id; blocks = it blocks target_item_id; relates = related. Blocking cycles are refused. Links (with ids) are listed in get_plan.',
    inputSchema: schema(
      { plan_item_id: PLAN_ITEM_ID, type: oneOf(linkDomain.LINK_TYPES, 'Dependency type.'), target_item_id: id('The other plan item id (same project).') },
      ['plan_item_id', 'type', 'target_item_id'],
    ),
    annotations: ADD,
    run: (args, { services, ctx }) => services.planInteraction.createLink(ctx, args.plan_item_id, { type: args.type, item_id: args.target_item_id }),
  },
  {
    name: 'delete_plan_link',
    title: 'Delete plan dependency',
    description: 'Removes a dependency link between plan items (link id from get_plan links). Confirm with the user first.',
    inputSchema: schema({ link_id: id('Link id (from get_plan links).') }, ['link_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.planInteraction.deleteLink(ctx, args.link_id),
  },
  {
    name: 'update_plan_settings',
    title: 'Board dependency rule',
    description: 'Sets the board dependency rule: warn = only flags items whose dependencies are open; block = prevents starting or finishing them. Requires being a project manager with plan.manage.',
    inputSchema: schema({ project_id: PROJECT_ID, dependency_rule: oneOf(linkDomain.DEPENDENCY_RULES, 'Dependency rule.') }, ['project_id', 'dependency_rule']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.planInteraction.updateSettings(ctx, args.project_id, pick(args, ['dependency_rule'])),
  },

  // ---------------------------------------------------------------- etiquetas de status e de recurso
  {
    name: 'create_plan_status',
    title: 'Create plan status',
    description: 'Adds a status label to the board. The category drives progress (done = 100%) and what counts as open. Requires being a project manager with plan.manage.',
    inputSchema: schema(
      {
        project_id: PROJECT_ID,
        name: text(planDomain.STATUS_NAME_MAX, 'Status name.'),
        color: color('Status color (default gray)'),
        category: oneOf(planDomain.STATUS_CATEGORIES, 'Category (default todo).'),
      },
      ['project_id', 'name'],
    ),
    annotations: ADD,
    run: (args, { services, ctx }) => services.plan.createStatus(ctx, args.project_id, without(args, 'project_id')),
  },
  {
    name: 'update_plan_status',
    title: 'Update plan status',
    description: 'Renames, recolors or recategorizes a board status label. Requires being a project manager with plan.manage.',
    inputSchema: schema(
      {
        plan_status_id: id('Plan status id (from get_plan statuses).'),
        name: text(planDomain.STATUS_NAME_MAX, 'Status name.'),
        color: COLOR,
        category: oneOf(planDomain.STATUS_CATEGORIES, 'Category.'),
      },
      ['plan_status_id'],
    ),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.plan.updateStatus(ctx, args.plan_status_id, without(args, 'plan_status_id')),
  },
  {
    name: 'delete_plan_status',
    title: 'Delete plan status',
    description: 'Deletes a board status label; items with it are left without status. Confirm with the user first.',
    inputSchema: schema({ plan_status_id: id('Plan status id (from get_plan statuses).') }, ['plan_status_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.plan.deleteStatus(ctx, args.plan_status_id),
  },
  {
    name: 'create_plan_resource',
    title: 'Create plan resource',
    description: 'Adds a resource label (person, team or asset; unique name in the project) to assign to plan items with resource_ids.',
    inputSchema: schema({ project_id: PROJECT_ID, name: text(planDomain.RESOURCE_NAME_MAX, 'Resource name.'), color: color('Resource color (default indigo)') }, ['project_id', 'name']),
    annotations: ADD,
    run: (args, { services, ctx }) => services.plan.createResource(ctx, args.project_id, without(args, 'project_id')),
  },
  {
    name: 'update_plan_resource',
    title: 'Update plan resource',
    description: 'Renames or recolors a resource label.',
    inputSchema: schema({ plan_resource_id: id('Resource id (from get_plan resources).'), name: text(planDomain.RESOURCE_NAME_MAX, 'Resource name.'), color: COLOR }, ['plan_resource_id']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.plan.updateResource(ctx, args.plan_resource_id, without(args, 'plan_resource_id')),
  },
  {
    name: 'delete_plan_resource',
    title: 'Delete plan resource',
    description: 'Deletes a resource label and removes it from the items. Requires being a project manager with plan.manage. Confirm with the user first.',
    inputSchema: schema({ plan_resource_id: id('Resource id (from get_plan resources).') }, ['plan_resource_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.plan.deleteResource(ctx, args.plan_resource_id),
  },

  // ---------------------------------------------------------------- atualizações do elemento
  {
    name: 'list_plan_updates',
    title: 'List plan item updates',
    description: 'Lists the updates (conversation) of a plan item, newest first, each with its replies, author, mentions and attached files (the url downloads with the same API token).',
    inputSchema: schema({ plan_item_id: PLAN_ITEM_ID }, ['plan_item_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.planCollaboration.listUpdates(ctx, args.plan_item_id),
  },
  {
    name: 'list_plan_mention_candidates',
    title: 'People to mention',
    description: 'Lists the active people of the project who can be @mentioned in plan item updates.',
    inputSchema: schema({ plan_item_id: PLAN_ITEM_ID }, ['plan_item_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.planCollaboration.mentionCandidates(ctx, args.plan_item_id),
  },
  {
    name: 'add_plan_update',
    title: 'Post plan item update',
    description: 'Posts an update on a plan item as the user (Markdown), or a reply to a top-level update (parent_id). Mention people with @[Name](userId) (see list_plan_mention_candidates); they are notified. File upload is not available here.',
    inputSchema: schema(
      {
        plan_item_id: PLAN_ITEM_ID,
        content: text(updatesDomain.MAX_CONTENT, 'Update text (Markdown).'),
        parent_id: id('Top-level update id to reply to (from list_plan_updates).'),
      },
      ['plan_item_id', 'content'],
    ),
    annotations: ADD,
    run: (args, { services, ctx }) => services.planCollaboration.createUpdate(ctx, args.plan_item_id, pick(args, ['content', 'parent_id']), []),
  },
  {
    name: 'edit_plan_update',
    title: 'Edit plan item update',
    description: 'Replaces the text of an update; only its author can edit. Newly mentioned people are notified.',
    inputSchema: schema({ update_id: id('Update id (from list_plan_updates).'), content: text(updatesDomain.MAX_CONTENT, 'New text (Markdown).') }, ['update_id', 'content']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.planCollaboration.editUpdate(ctx, args.update_id, pick(args, ['content'])),
  },
  {
    name: 'delete_plan_update',
    title: 'Delete plan item update',
    description: 'Removes an update (its text and files; replies stay). Only the author or a project manager. Confirm with the user first.',
    inputSchema: schema({ update_id: id('Update id (from list_plan_updates).') }, ['update_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.planCollaboration.deleteUpdate(ctx, args.update_id),
  },
  {
    name: 'delete_plan_file',
    title: 'Delete plan item file',
    description: 'Permanently deletes a file attached to a plan item update (file id from list_plan_updates). Only who uploaded it or a project manager. Confirm with the user first.',
    inputSchema: schema({ file_id: id('File id (from list_plan_updates files).') }, ['file_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.planCollaboration.deleteFile(ctx, args.file_id),
  },

  // ---------------------------------------------------------------- gestão: diário e problemas
  {
    name: 'list_plan_journal',
    title: 'Project journal',
    description: 'Lists the dated project journal entries (newest day first) with author and what the user can do with each.',
    inputSchema: schema({ project_id: PROJECT_ID }, ['project_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.planManagement.listJournal(ctx, args.project_id),
  },
  {
    name: 'add_plan_journal_entry',
    title: 'Add journal entry',
    description: 'Records a dated entry in the project journal (e.g. "Kick-off meeting held"). Requires editing the board.',
    inputSchema: schema({ project_id: PROJECT_ID, entry_date: date('Entry day'), content: text(mgmtDomain.JOURNAL_MAX, 'Entry text.') }, ['project_id', 'entry_date', 'content']),
    annotations: ADD,
    run: (args, { services, ctx }) => services.planManagement.createJournalEntry(ctx, args.project_id, without(args, 'project_id')),
  },
  {
    name: 'update_plan_journal_entry',
    title: 'Update journal entry',
    description: 'Changes the day or text of a journal entry. Only its author or a project manager.',
    inputSchema: schema(
      { journal_entry_id: id('Journal entry id (from list_plan_journal).'), entry_date: date('Entry day'), content: text(mgmtDomain.JOURNAL_MAX, 'Entry text.') },
      ['journal_entry_id'],
    ),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.planManagement.updateJournalEntry(ctx, args.journal_entry_id, without(args, 'journal_entry_id')),
  },
  {
    name: 'delete_plan_journal_entry',
    title: 'Delete journal entry',
    description: 'Permanently deletes a journal entry. Only its author or a project manager. Confirm with the user first.',
    inputSchema: schema({ journal_entry_id: id('Journal entry id (from list_plan_journal).') }, ['journal_entry_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.planManagement.deleteJournalEntry(ctx, args.journal_entry_id),
  },
  {
    name: 'list_plan_issues',
    title: 'Project issues',
    description: 'Lists the project issues (numbered #1, #2… per project) with opening day, description, state, owner and resolution day.',
    inputSchema: schema({ project_id: PROJECT_ID }, ['project_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.planManagement.listIssues(ctx, args.project_id),
  },
  {
    name: 'create_plan_issue',
    title: 'Open project issue',
    description: 'Opens a project issue with the next number. State defaults to pending; resolved records the day. Requires editing the board.',
    inputSchema: schema(
      {
        project_id: PROJECT_ID,
        opened_on: date('Opening day'),
        description: text(mgmtDomain.ISSUE_DESCRIPTION_MAX, 'Issue description.'),
        state: oneOf(mgmtDomain.ISSUE_STATES, 'Issue state (default pending).'),
        owner_id: nullableId('Owner user id (a project member).'),
      },
      ['project_id', 'opened_on', 'description'],
    ),
    annotations: ADD,
    run: (args, { services, ctx }) => services.planManagement.createIssue(ctx, args.project_id, without(args, 'project_id')),
  },
  {
    name: 'update_plan_issue',
    title: 'Update project issue',
    description: 'Changes a project issue (only the fields sent). Setting state resolved records the day; reopening clears it.',
    inputSchema: schema(
      {
        issue_id: id('Issue id (from list_plan_issues).'),
        opened_on: date('Opening day'),
        description: text(mgmtDomain.ISSUE_DESCRIPTION_MAX, 'Issue description.'),
        state: oneOf(mgmtDomain.ISSUE_STATES, 'Issue state.'),
        owner_id: nullableId('Owner user id (a project member).'),
      },
      ['issue_id'],
    ),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.planManagement.updateIssue(ctx, args.issue_id, without(args, 'issue_id')),
  },
  {
    name: 'delete_plan_issue',
    title: 'Delete project issue',
    description: 'Permanently deletes a project issue (its number is not reused). Only who opened it or a project manager. Confirm with the user first.',
    inputSchema: schema({ issue_id: id('Issue id (from list_plan_issues).') }, ['issue_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.planManagement.deleteIssue(ctx, args.issue_id),
  },

  // ---------------------------------------------------------------- linha de base
  {
    name: 'save_plan_baseline',
    title: 'Save schedule baseline',
    description: 'Saves the current schedule dates of the elements as the baseline (replacing the previous one), to compare planned vs. current in the timeline. Requires being a project manager with plan.manage.',
    inputSchema: schema({ project_id: PROJECT_ID }, ['project_id']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.planManagement.saveBaseline(ctx, args.project_id),
  },
  {
    name: 'clear_plan_baseline',
    title: 'Clear schedule baseline',
    description: 'Removes the saved schedule baseline of the board. Requires being a project manager with plan.manage. Confirm with the user first.',
    inputSchema: schema({ project_id: PROJECT_ID }, ['project_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.planManagement.clearBaseline(ctx, args.project_id),
  },

  // ---------------------------------------------------------------- colunas personalizadas
  {
    name: 'create_plan_column',
    title: 'Create custom column',
    description: `Adds a custom column to the board (up to ${columnsDomain.MAX_COLUMNS}). Fill values with set_plan_item_value or update_plan_item custom. Requires being a project manager with plan.manage.`,
    inputSchema: schema(
      {
        project_id: PROJECT_ID,
        name: text(columnsDomain.NAME_MAX, 'Column name.'),
        type: oneOf(columnsDomain.COLUMN_TYPES, 'Column type.'),
        settings: COLUMN_SETTINGS,
      },
      ['project_id', 'name', 'type'],
    ),
    annotations: ADD,
    run: (args, { services, ctx }) => services.planColumns.createColumn(ctx, args.project_id, without(args, 'project_id')),
  },
  {
    name: 'update_plan_column',
    title: 'Update custom column',
    description: 'Renames a custom column and/or replaces its settings (dropdown options, number unit). Removing a dropdown option clears the values that used it. Use change_plan_column_type to change the type.',
    inputSchema: schema({ column_id: id('Column id (from get_plan columns).'), name: text(columnsDomain.NAME_MAX, 'Column name.'), settings: COLUMN_SETTINGS }, ['column_id']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.planColumns.updateColumn(ctx, args.column_id, without(args, 'column_id')),
  },
  {
    name: 'change_plan_column_type',
    title: 'Change custom column type',
    description:
      'Changes the type of a custom column, converting the values when possible (values that do not convert are cleared). Call first with dry_run true to get { converted, lost } without saving, show it to the user and confirm.',
    inputSchema: schema(
      {
        column_id: id('Column id (from get_plan columns).'),
        type: oneOf(columnsDomain.COLUMN_TYPES, 'New column type.'),
        settings: COLUMN_SETTINGS,
        dry_run: bool('Only count what would be converted and lost; nothing is saved.'),
      },
      ['column_id', 'type'],
    ),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.planColumns.changeType(ctx, args.column_id, without(args, 'column_id')),
  },
  {
    name: 'duplicate_plan_column',
    title: 'Duplicate custom column',
    description: 'Copies a custom column right after it, with the same values on the elements.',
    inputSchema: schema({ column_id: id('Column id (from get_plan columns).') }, ['column_id']),
    annotations: ACTION,
    run: (args, { services, ctx }) => services.planColumns.duplicateColumn(ctx, args.column_id),
  },
  {
    name: 'delete_plan_column',
    title: 'Delete custom column',
    description: 'Permanently deletes a custom column and its values on all elements. Confirm with the user first.',
    inputSchema: schema({ column_id: id('Column id (from get_plan columns).') }, ['column_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.planColumns.deleteColumn(ctx, args.column_id),
  },
]

module.exports = { TOOLS, compactPlan }
