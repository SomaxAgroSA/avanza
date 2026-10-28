/**
 * Catálogo de ferramentas MCP: cada ferramenta descreve os argumentos (JSON Schema) para o modelo e
 * delega para um caso de uso — sem regra de negócio aqui (como em http/routes.js). Quem chama age
 * como a pessoa dona do token de API: permissões, validação, histórico e notificações são os dos
 * casos de uso.
 *
 * Os textos são para o modelo (em inglês, como a especificação OpenAPI). Listas grandes (tarefas,
 * quadro, backlog) saem enxutas para caber no contexto; o detalhe completo vem de get_task.
 */

const projectDomain = require('../domain/project')
const workflow = require('../domain/workflow')
const relationDomain = require('../domain/relation')
const sprintDomain = require('../domain/sprint')
const report = require('../domain/report')

const READ = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false })
/** Só acrescenta (cria, comenta, relaciona). */
const ADD = Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false })
/** Altera o que existe (a mesma chamada de novo não muda mais nada). */
const CHANGE = Object.freeze({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false })

const BOARD_LIMIT = 50
const BACKLOG_LIMIT = 100

// ---------------------------------------------------------------- esquemas

function schema(properties, required) {
  const out = { type: 'object', properties, additionalProperties: false }
  if (required && required.length > 0) out.required = required
  return out
}

const id = (description) => ({ type: 'string', maxLength: 64, description })
const nullableId = (description) => ({ type: ['string', 'null'], maxLength: 64, description: `${description} null clears it.` })
const text = (max, description) => ({ type: 'string', maxLength: max, description })
const date = (description) => ({ type: 'string', maxLength: 30, description: `${description} (YYYY-MM-DD).` })
const nullableDate = (description) => ({ type: ['string', 'null'], maxLength: 30, description: `${description} (YYYY-MM-DD); null clears it.` })
const oneOf = (values, description) => ({ type: 'string', enum: values.slice(), description })
const hours = (description) => ({ type: 'number', minimum: 0.01, maximum: 100000, description })
const nullableHours = (description) => ({ type: ['number', 'null'], minimum: 0.01, maximum: 100000, description: `${description} null clears it.` })

const PAGE = {
  page: { type: 'integer', minimum: 1, description: 'Page number, starting at 1.' },
  per_page: { type: 'integer', minimum: 1, maximum: 100, description: 'Items per page (default 20, max 100).' },
}

const PROJECT_ID = id('Project id (from list_projects).')
const TASK_ID = id('Task id (from list_tasks; search accepts a task code such as CRM-12).')

const PROJECT_FIELDS = {
  name: text(120, 'Project name.'),
  description: text(10000, 'Project description (Markdown).'),
  status: oneOf(projectDomain.PROJECT_STATUS, 'Project status.'),
  priority: oneOf(projectDomain.PROJECT_PRIORITY, 'Project priority.'),
}

const TASK_FIELDS = {
  task_type_id: id('Task type id (from get_task_settings).'),
  title: text(200, 'Task title.'),
  description: text(50000, 'Task description (Markdown).'),
  status_id: id('Status id (from get_task_settings). Defaults to the default status.'),
  priority_id: id('Priority id (from get_task_settings). Defaults to the default priority.'),
  tag_ids: { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 20, description: 'Tag ids (from get_task_settings); replaces the current tags.' },
  checklist: {
    type: 'array',
    maxItems: 100,
    items: schema({ id: text(24, 'Existing item id, to keep it.'), text: text(500, 'Item text.'), done: { type: 'boolean', description: 'Whether the item is done.' } }, ['text']),
    description: 'Checklist items; replaces the whole checklist.',
  },
  custom_values: {
    type: 'object',
    description: 'Custom field values keyed by the field technical name (see get_task_type for names, types and options). Select fields take option ids.',
  },
}

const TASK_CREATE_FIELDS = Object.assign({}, TASK_FIELDS, {
  assignee_id: id('Assignee user id (a project member, see list_project_members).'),
  reporter_id: id('Reporter user id (a project member).'),
  start_date: date('Planned start'),
  due_date: date('Due date'),
  estimated_hours: hours('Estimated hours (> 0).'),
  actual_hours: hours('Hours spent (> 0).'),
  sprint_id: id('Sprint id (from list_sprints).'),
  parent_task_id: id('Parent task id, to create a subtask (same project).'),
})

const TASK_UPDATE_FIELDS = Object.assign({}, TASK_FIELDS, {
  status_id: id('New status id; the transition must be allowed (prefer move_task).'),
  assignee_id: nullableId('Assignee user id (a project member).'),
  reporter_id: nullableId('Reporter user id (a project member).'),
  start_date: nullableDate('Planned start'),
  due_date: nullableDate('Due date'),
  estimated_hours: nullableHours('Estimated hours (> 0).'),
  actual_hours: nullableHours('Hours spent (> 0).'),
  sprint_id: nullableId('Sprint id (from list_sprints).'),
  parent_task_id: nullableId('Parent task id (same project).'),
})

// ---------------------------------------------------------------- apoio

/** Copia só as chaves informadas: `undefined` fica de fora; `null` passa (limpa o campo). */
function pick(args, keys) {
  const out = {}
  keys.forEach((key) => {
    if (args[key] !== undefined) out[key] = args[key]
  })
  return out
}

function without(args, key) {
  const out = Object.assign({}, args)
  delete out[key]
  return out
}

/** `page`/`per_page` no formato da API (`perPage`). */
function pageQuery(args) {
  const query = {}
  if (args.page !== undefined) query.page = args.page
  if (args.per_page !== undefined) query.perPage = args.per_page
  return query
}

const nameOf = (ref) => (ref ? ref.name : null)

/** Resumo de tarefa enxuto (listas, quadro, backlog). */
function compactTask(task) {
  return {
    id: task.id,
    code: task.code,
    title: task.title,
    project: task.project ? task.project.key : null,
    type: nameOf(task.type),
    status: task.status ? { id: task.status.id, name: task.status.name, category: task.status.category } : null,
    priority: nameOf(task.priority),
    assignee: task.assignee ? { id: task.assignee.id, name: task.assignee.name } : null,
    sprint: nameOf(task.sprint),
    start_date: task.start_date || null,
    due_date: task.due_date || null,
    tags: (task.tags || []).map(nameOf),
    blocked: !!task.blocked,
    parent_task_id: task.parent_task_id || null,
    updated_at: task.updated_at || null,
  }
}

const compactStatus = (status) => ({ id: status.id, name: status.name, category: status.category })

const page = (result) => ({ items: result.items, meta: result.meta })

// ---------------------------------------------------------------- ferramentas

const TOOLS = [
  // ---------------------------------------------------------------- conta
  {
    name: 'whoami',
    title: 'Current user',
    description:
      'Returns the Avanza user behind the API token (name, email, role) and their permission codes. Every tool acts as this user and is limited by these permissions and by project membership.',
    inputSchema: schema({}),
    annotations: READ,
    run: async (_args, { services, ctx }) => {
      const me = await services.auth.getMe(ctx)
      return { user: me.user, role: me.role, permissions: me.permissions }
    },
  },

  // ---------------------------------------------------------------- projetos
  {
    name: 'list_projects',
    title: 'List projects',
    description: 'Lists the projects the user can see, paginated. Each project has an id, a key (prefix of its task codes, e.g. CRM), owner, status, dates and what the user can do in it (capabilities).',
    inputSchema: schema(
      Object.assign(
        {
          search: text(100, 'Text to match in the project name or key.'),
          view: oneOf(['all', 'mine', 'archived'], 'all = open projects the user can see (default); mine = projects the user belongs to; archived = archived projects.'),
          status: oneOf(projectDomain.PROJECT_STATUS, 'Only projects with this status.'),
          priority: oneOf(projectDomain.PROJECT_PRIORITY, 'Only projects with this priority.'),
          sort: text(100, 'Comma-separated fields, "-" prefix for descending: name, key, created_at, due_date, status, priority.'),
        },
        PAGE,
      ),
    ),
    annotations: READ,
    run: async (args, { services, ctx }) => page(await services.projects.listProjects(ctx, Object.assign(pick(args, ['search', 'view', 'status', 'priority', 'sort']), pageQuery(args)))),
  },
  {
    name: 'get_project',
    title: 'Get project',
    description: 'Returns a project with its owner, member count, the user role in it and capabilities.',
    inputSchema: schema({ project_id: PROJECT_ID }, ['project_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.projects.getProject(ctx, args.project_id),
  },
  {
    name: 'create_project',
    title: 'Create project',
    description: 'Creates a project; the user becomes its owner and manager. Requires the projects.create permission.',
    inputSchema: schema(
      Object.assign(
        {
          key: text(10, 'Unique short code: 2-10 uppercase letters or digits, starting with a letter (e.g. CRM). Task codes use it (CRM-12). It cannot be changed later.'),
          start_date: date('Start date'),
          due_date: date('Due date'),
        },
        PROJECT_FIELDS,
      ),
      ['name', 'key'],
    ),
    annotations: ADD,
    run: (args, { services, ctx }) => services.projects.createProject(ctx, args),
  },
  {
    name: 'update_project',
    title: 'Update project',
    description: 'Changes a project (only the fields sent). The key cannot change; archived projects are read-only. Requires being a project manager.',
    inputSchema: schema(Object.assign({ project_id: PROJECT_ID, start_date: nullableDate('Start date'), due_date: nullableDate('Due date') }, PROJECT_FIELDS), ['project_id']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.projects.updateProject(ctx, args.project_id, without(args, 'project_id')),
  },
  {
    name: 'archive_project',
    title: 'Archive project',
    description: 'Archives a project: it becomes read-only and leaves the default project lists. Confirm with the user first.',
    inputSchema: schema({ project_id: PROJECT_ID }, ['project_id']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.projects.archiveProject(ctx, args.project_id),
  },
  {
    name: 'unarchive_project',
    title: 'Unarchive project',
    description: 'Reopens an archived project.',
    inputSchema: schema({ project_id: PROJECT_ID }, ['project_id']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.projects.unarchiveProject(ctx, args.project_id),
  },
  {
    name: 'list_project_members',
    title: 'List project members',
    description: 'Lists the people in a project (owner first) with their project role: manager, member or viewer. Use their ids as task assignee or reporter.',
    inputSchema: schema({ project_id: PROJECT_ID }, ['project_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.projects.listMembers(ctx, args.project_id),
  },
  {
    name: 'list_project_files',
    title: 'List project files',
    description:
      'Lists the files attached to a project itself (contracts, minutes, schedules — not task attachments), newest first: name, type, size, who uploaded and when. The url downloads the file with the same API token.',
    inputSchema: schema({ project_id: PROJECT_ID }, ['project_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.projectFiles.listFiles(ctx, args.project_id),
  },
  {
    name: 'find_member_candidates',
    title: 'Find people to add',
    description: 'Searches active users who are not yet members of the project (up to 20). Requires being a project manager.',
    inputSchema: schema({ project_id: PROJECT_ID, search: text(100, 'Text to match in the name or email.') }, ['project_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.projects.memberCandidates(ctx, args.project_id, pick(args, ['search'])),
  },
  {
    name: 'add_project_member',
    title: 'Add project member',
    description: 'Adds a person to a project. manager = edits the project and its members; member = works on tasks; viewer = read and comment only. Requires being a project manager.',
    inputSchema: schema(
      { project_id: PROJECT_ID, user_id: id('User id (from find_member_candidates).'), role: oneOf(projectDomain.MEMBER_ROLES, 'Role in the project.') },
      ['project_id', 'user_id', 'role'],
    ),
    annotations: ADD,
    run: (args, { services, ctx }) => services.projects.addMember(ctx, args.project_id, pick(args, ['user_id', 'role'])),
  },

  // ---------------------------------------------------------------- configuração das tarefas
  {
    name: 'get_task_settings',
    title: 'Task settings',
    description:
      'Returns the workflow statuses (shared by all projects; category, WIP limit and allowed_next transitions — empty means any), priorities, task types and tags. Call it to get the ids before creating, updating or moving tasks.',
    inputSchema: schema({}),
    annotations: READ,
    run: async (_args, { services, ctx }) => ({
      statuses: await services.statuses.list(ctx, {}),
      priorities: await services.priorities.list(ctx, {}),
      task_types: await services.taskTypes.listTypes(ctx, {}),
      tags: await services.tags.listTags(ctx),
    }),
  },
  {
    name: 'get_task_type',
    title: 'Get task type',
    description:
      'Returns a task type with its custom fields: technical name (the key in custom_values), type, options, whether it is required always or only in some statuses (required_status_ids), and visibility.',
    inputSchema: schema({ task_type_id: id('Task type id (from get_task_settings).') }, ['task_type_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.taskTypes.getType(ctx, args.task_type_id),
  },

  // ---------------------------------------------------------------- tarefas
  {
    name: 'list_tasks',
    title: 'List tasks',
    description: 'Searches tasks in the projects the user can see, paginated, as compact summaries (use get_task for the full detail). All filters are optional and combine.',
    inputSchema: schema(
      Object.assign(
        {
          project_id: PROJECT_ID,
          search: text(100, 'Text to match in the title, the code (e.g. CRM-12) or searchable custom fields.'),
          status_id: id('Only tasks in this status.'),
          categories: { type: 'array', items: { type: 'string', enum: workflow.STATUS_CATEGORIES.slice() }, maxItems: 5, description: 'Only tasks whose status is in these categories (e.g. ["todo", "in_progress"] for open work).' },
          assignee_id: text(64, 'Assignee user id, or "me".'),
          priority_id: id('Only tasks with this priority.'),
          task_type_id: id('Only tasks of this type.'),
          tag_id: id('Only tasks with this tag.'),
          sprint_id: text(64, 'Sprint id, or "none" for tasks without a sprint.'),
          sort: text(100, 'Comma-separated fields, "-" prefix for descending: code, title, created_at, updated_at, due_date, priority, status. Default: code.'),
        },
        PAGE,
      ),
    ),
    annotations: READ,
    run: async (args, { services, ctx }) => {
      const query = Object.assign(pick(args, ['project_id', 'search', 'status_id', 'assignee_id', 'priority_id', 'task_type_id', 'tag_id', 'sprint_id', 'sort']), pageQuery(args))
      if (args.categories && args.categories.length > 0) query.category = args.categories.join(',')
      const result = await services.tasks.listTasks(ctx, query)
      return { items: result.items.map(compactTask), meta: result.meta }
    },
  },
  {
    name: 'get_task',
    title: 'Get task',
    description: 'Returns the full task: description, status, people, dates, hours, tags, checklist, custom field values, parent/fork and what the user can do (capabilities).',
    inputSchema: schema({ task_id: TASK_ID }, ['task_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.tasks.getTask(ctx, args.task_id),
  },
  {
    name: 'create_task',
    title: 'Create task',
    description:
      'Creates a task in a project; it gets the next code of the project (e.g. CRM-13). Status and priority default to the defaults. Custom fields required by the type (or by the initial status) must be sent in custom_values.',
    inputSchema: schema(Object.assign({ project_id: PROJECT_ID }, TASK_CREATE_FIELDS), ['project_id', 'task_type_id', 'title']),
    annotations: ADD,
    run: (args, { services, ctx }) => services.tasks.createTask(ctx, args),
  },
  {
    name: 'update_task',
    title: 'Update task',
    description:
      'Changes a task (only the fields sent; null clears people, dates, hours, sprint and parent). The project cannot change. Changing the type drops custom values the new type does not have.',
    inputSchema: schema(Object.assign({ task_id: TASK_ID }, TASK_UPDATE_FIELDS), ['task_id']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.tasks.updateTask(ctx, args.task_id, without(args, 'task_id')),
  },
  {
    name: 'move_task',
    title: 'Move task',
    description:
      'Moves a task to a status (Kanban column), optionally between two cards of that column. The current status must allow the transition (allowed_next). If the target status requires fields that are empty, a VALIDATION_ERROR lists them: fill them with update_task (status_id + custom_values) instead.',
    inputSchema: schema(
      {
        task_id: TASK_ID,
        status_id: id('Target status id (from get_task_settings).'),
        prev_id: id('Card that should stay above (same column).'),
        next_id: id('Card that should stay below (same column).'),
      },
      ['task_id', 'status_id'],
    ),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.tasks.moveTask(ctx, args.task_id, without(args, 'task_id')),
  },
  {
    name: 'delete_task',
    title: 'Delete task',
    description: 'Permanently deletes a task (subtasks are detached and relations removed). It cannot be undone: confirm with the user first.',
    inputSchema: schema({ task_id: TASK_ID }, ['task_id']),
    annotations: Object.freeze({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }),
    run: (args, { services, ctx }) => services.tasks.deleteTask(ctx, args.task_id),
  },
  {
    name: 'list_task_comments',
    title: 'List task comments',
    description: 'Lists the comments of a task, oldest first, with author and mentions.',
    inputSchema: schema({ task_id: TASK_ID }, ['task_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.comments.listComments(ctx, args.task_id),
  },
  {
    name: 'add_task_comment',
    title: 'Comment on task',
    description: 'Adds a comment to a task as the user (Markdown). Mention people with @[Name](userId); they are notified. Anyone with access to the project can comment.',
    inputSchema: schema({ task_id: TASK_ID, content: text(10000, 'Comment text (Markdown).') }, ['task_id', 'content']),
    annotations: ADD,
    run: (args, { services, ctx }) => services.comments.createComment(ctx, args.task_id, pick(args, ['content'])),
  },
  {
    name: 'get_task_history',
    title: 'Task history',
    description: 'Returns the readable change history of a task (who changed what and when), newest first, paginated.',
    inputSchema: schema(Object.assign({ task_id: TASK_ID }, PAGE), ['task_id']),
    annotations: READ,
    run: async (args, { services, ctx }) => page(await services.audit.listEntityHistory(ctx, 'task', args.task_id, pageQuery(args))),
  },
  {
    name: 'get_task_relations',
    title: 'Task relations',
    description: 'Returns the parent, subtasks (with progress), forks and related tasks (blocks, depends on, duplicates, relates) of a task.',
    inputSchema: schema({ task_id: TASK_ID }, ['task_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.relations.listRelations(ctx, args.task_id),
  },
  {
    name: 'link_tasks',
    title: 'Link tasks',
    description: 'Relates two tasks, from the point of view of task_id (e.g. type "blocked_by" = task_id is blocked by target_id). Blocking/dependency cycles are refused.',
    inputSchema: schema(
      { task_id: TASK_ID, type: oneOf(relationDomain.VIEW_TYPES, 'Relation type.'), target_id: id('The other task id.') },
      ['task_id', 'type', 'target_id'],
    ),
    annotations: ADD,
    run: (args, { services, ctx }) => services.relations.createRelation(ctx, args.task_id, pick(args, ['type', 'target_id'])),
  },

  // ---------------------------------------------------------------- kanban, backlog e sprints
  {
    name: 'get_board',
    title: 'Kanban board',
    description: 'Returns the Kanban board of a project: one column per active status (in workflow order) with WIP limit, allowed transitions, total and the first cards as compact summaries.',
    inputSchema: schema({ project_id: PROJECT_ID, limit_per_column: { type: 'integer', minimum: 1, maximum: 500, description: `Cards per column (default ${BOARD_LIMIT}).` } }, ['project_id']),
    annotations: READ,
    run: async (args, { services, ctx }) => {
      const board = await services.board.getBoard(ctx, args.project_id)
      const limit = args.limit_per_column || BOARD_LIMIT
      return {
        project: board.project,
        capabilities: board.capabilities,
        columns: board.columns.map((column) => ({
          status: compactStatus(column.status),
          wip_limit: column.wip_limit,
          allowed_next: column.allowed_next,
          total: column.total,
          truncated: column.truncated || column.tasks.length > limit,
          tasks: column.tasks.slice(0, limit).map(compactTask),
        })),
      }
    },
  },
  {
    name: 'get_backlog',
    title: 'Backlog',
    description: 'Returns the backlog of a project: tasks not started yet (backlog and todo categories) in priority order, plus the planning statuses and the open sprints.',
    inputSchema: schema({ project_id: PROJECT_ID, limit: { type: 'integer', minimum: 1, maximum: 1000, description: `How many tasks (default ${BACKLOG_LIMIT}).` } }, ['project_id']),
    annotations: READ,
    run: async (args, { services, ctx }) => {
      const backlog = await services.backlog.getBacklog(ctx, args.project_id)
      const limit = args.limit || BACKLOG_LIMIT
      return {
        project: backlog.project,
        capabilities: backlog.capabilities,
        statuses: backlog.statuses.map(compactStatus),
        sprints: backlog.sprints,
        items: backlog.items.slice(0, limit).map(compactTask),
        truncated: backlog.truncated || backlog.items.length > limit,
      }
    },
  },
  {
    name: 'list_sprints',
    title: 'List sprints',
    description: 'Lists the sprints of a project (open ones by default) with goal, dates and state.',
    inputSchema: schema({ project_id: PROJECT_ID, include_closed: { type: 'boolean', description: 'Also return closed sprints.' } }, ['project_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.sprints.listSprints(ctx, args.project_id, args.include_closed ? { include_closed: '1' } : {}),
  },
  {
    name: 'create_sprint',
    title: 'Create sprint',
    description: 'Creates a planned sprint in a project. Put tasks in it with update_task (sprint_id). Requires being a project manager.',
    inputSchema: schema(
      {
        project_id: PROJECT_ID,
        name: text(sprintDomain.NAME_MAX, 'Sprint name.'),
        goal: text(sprintDomain.GOAL_MAX, 'Sprint goal.'),
        start_date: date('Start date'),
        end_date: date('End date'),
      },
      ['project_id', 'name'],
    ),
    annotations: ADD,
    run: (args, { services, ctx }) => services.sprints.createSprint(ctx, args.project_id, without(args, 'project_id')),
  },
  {
    name: 'update_sprint',
    title: 'Update sprint',
    description: 'Changes a sprint, including its state: planned → active (start) → closed. Closing sends unfinished tasks back to the backlog without a sprint (returned_count). Requires being a project manager.',
    inputSchema: schema(
      {
        sprint_id: id('Sprint id (from list_sprints).'),
        name: text(sprintDomain.NAME_MAX, 'Sprint name.'),
        goal: { type: ['string', 'null'], maxLength: sprintDomain.GOAL_MAX, description: 'Sprint goal; null clears it.' },
        start_date: nullableDate('Start date'),
        end_date: nullableDate('End date'),
        state: oneOf(sprintDomain.SPRINT_STATES, 'Sprint state.'),
      },
      ['sprint_id'],
    ),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.sprints.updateSprint(ctx, args.sprint_id, without(args, 'sprint_id')),
  },

  // ---------------------------------------------------------------- relatórios
  {
    name: 'get_report',
    title: 'Task report',
    description:
      'Returns task indicators for a period (open, in progress, overdue, created, completed, lead/cycle time…), a daily or weekly series, a breakdown and the overdue tasks. Defaults to the last 30 days of all visible projects. Requires reports.view.',
    inputSchema: schema({
      from: date('Period start (default: 30 days ago)'),
      to: date('Period end (default: today; at most 366 days after from)'),
      group_by: oneOf(report.DIMENSIONS, 'Breakdown dimension (default status).'),
      project_id: PROJECT_ID,
      assignee_id: text(64, 'Assignee user id, "me" or "none".'),
      task_type_id: id('Only tasks of this type.'),
      priority_id: id('Only tasks with this priority.'),
      status_id: id('Only tasks in this status.'),
      tz_offset: { type: 'integer', minimum: -840, maximum: 840, description: 'Minutes to add to local time to get UTC (JavaScript getTimezoneOffset; Brasília = 180). Defines "today".' },
    }),
    annotations: READ,
    run: (args, { services, ctx }) => {
      const query = pick(args, ['from', 'to', 'group_by', 'project_id', 'assignee_id', 'task_type_id', 'priority_id', 'status_id'])
      if (args.tz_offset !== undefined) query.tz_offset = String(args.tz_offset)
      return services.reports.getReport(ctx, query)
    },
  },
]

/** Orientação geral entregue ao modelo no `initialize`. */
const INSTRUCTIONS = [
  'Avanza is a project management platform: projects, tasks, backlog, sprints and Kanban.',
  'You act as the user who owns the API token, with their permissions; every change is recorded in the audit history under their name.',
  'Tools take ids, not names: find them with list_projects, list_tasks (search accepts a task code such as CRM-12), get_task_settings (statuses, priorities, task types, tags) and list_project_members (people).',
  'Statuses are shared by all projects and grouped in categories (backlog, todo, in_progress, done, cancelled). Change a task status with move_task; only transitions in allowed_next are accepted (empty = any).',
  'A task type may require custom fields, always or in some statuses. A VALIDATION_ERROR lists the missing ones in details.fields (custom_values.<name>); get_task_type shows their types and options.',
  'Dates are YYYY-MM-DD. Descriptions and comments accept Markdown. Errors come back as { error: { code, message, details } }; FORBIDDEN or *_NOT_FOUND usually mean the user lacks the permission or is not a member of the project.',
  'Confirm with the user before deleting or archiving anything.',
].join('\n')

module.exports = { TOOLS, INSTRUCTIONS, compactTask }
