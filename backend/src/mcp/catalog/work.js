/**
 * Ferramentas MCP de trabalho do dia a dia: conta, projetos, configuração das tarefas (leitura),
 * tarefas, Kanban, backlog, sprints, relatórios e notificações. Cada ferramenta delega para um caso de
 * uso (como em http/routes.js) e age como a pessoa do token.
 */

const projectDomain = require('../../domain/project')
const workflow = require('../../domain/workflow')
const relationDomain = require('../../domain/relation')
const sprintDomain = require('../../domain/sprint')
const report = require('../../domain/report')
const { URGENCY_LEVELS } = require('../../domain/task')
const { READ, ADD, CHANGE, DELETE, schema, id, nullableId, ids, text, date, nullableDate, oneOf, bool, int, hours, nullableHours, PAGE, PROJECT_ID, TASK_ID, pick, without, pageQuery, page } = require('../kit')

const BOARD_LIMIT = 50
const BACKLOG_LIMIT = 100

const URGENCY = 'Urgency traffic light: high (red), medium (yellow) or low (green); independent of the priority.'
const urgency = () => oneOf(URGENCY_LEVELS, URGENCY)
const nullableUrgency = () => ({ type: ['string', 'null'], enum: URGENCY_LEVELS.slice(), description: `${URGENCY} null clears it.` })
const urgencyFilter = () => oneOf(URGENCY_LEVELS.concat(['none']), 'Only items with this urgency; none = without urgency.')

const AREA = 'Responsible area id (an active area from get_task_settings or list_areas).'
const PARENT = 'Parent project id (from list_projects): one level only — the parent cannot have a parent and a project with subprojects cannot get one. Requires being a manager of the parent.'
const MEMBER_ROLE = 'Role in the project: manager = edits the project and its members; member = works on tasks; viewer = read and comment only; it = IT owner, sees only the project brief (get_project_brief) and the tasks assigned to them or marked visible to IT.'
const areaFilter = () => text(64, 'Only items of this responsible area id, or "none" for items without an area.')

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
  plan_item_id: id('Project management element (or subelement) this task executes, from get_plan (same project). Linked tasks drive the element progress.'),
  urgency: urgency(),
  area_id: id(AREA),
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
  plan_item_id: nullableId('Project management element (or subelement) this task executes, from get_plan (same project).'),
  urgency: nullableUrgency(),
  area_id: nullableId(AREA),
})

const REPORT_FILTERS = {
  from: date('Period start (default: 30 days ago)'),
  to: date('Period end (default: today; at most 366 days after from)'),
  group_by: oneOf(report.DIMENSIONS, 'Breakdown dimension (default status).'),
  project_id: PROJECT_ID,
  assignee_id: text(64, 'Assignee user id, "me" or "none".'),
  task_type_id: id('Only tasks of this type.'),
  priority_id: id('Only tasks with this priority.'),
  status_id: id('Only tasks in this status.'),
  tz_offset: { type: 'integer', minimum: -840, maximum: 840, description: 'Minutes to add to local time to get UTC (JavaScript getTimezoneOffset; Brasília = 180). Defines "today".' },
}

/** Filtros do relatório no formato da API (tz_offset vai como texto, como na query). */
function reportQuery(args) {
  const query = pick(args, ['from', 'to', 'group_by', 'project_id', 'assignee_id', 'task_type_id', 'priority_id', 'status_id', 'metric'])
  if (args.tz_offset !== undefined) query.tz_offset = String(args.tz_offset)
  return query
}

// ---------------------------------------------------------------- apoio

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
    plan_item: task.plan_item ? { id: task.plan_item.id, name: task.plan_item.name } : null,
    urgency: task.urgency || null,
    area: task.area ? { id: task.area.id, name: task.area.name } : null,
    in_report: task.in_report !== false,
    it_visible: !!task.it_visible,
    start_date: task.start_date || null,
    due_date: task.due_date || null,
    tags: (task.tags || []).map(nameOf),
    blocked: !!task.blocked,
    parent_task_id: task.parent_task_id || null,
    updated_at: task.updated_at || null,
  }
}

const compactStatus = (status) => ({ id: status.id, name: status.name, category: status.category })

/** Colunas do quadro com no máximo `limit` cards enxutos cada. */
function compactColumns(columns, limit) {
  const max = limit || BOARD_LIMIT
  return columns.map((column) => ({
    status: compactStatus(column.status),
    wip_limit: column.wip_limit,
    allowed_next: column.allowed_next,
    total: column.total,
    truncated: column.truncated || column.tasks.length > max,
    tasks: column.tasks.slice(0, max).map(compactTask),
  }))
}

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
          urgency: urgencyFilter(),
          area_id: areaFilter(),
          parent_id: text(64, 'Only the subprojects of this parent project id, or "none" for main projects (without a parent).'),
          sort: text(100, 'Comma-separated fields, "-" prefix for descending: name, key, created_at, due_date, status, priority.'),
        },
        PAGE,
      ),
    ),
    annotations: READ,
    run: async (args, { services, ctx }) => page(await services.projects.listProjects(ctx, Object.assign(pick(args, ['search', 'view', 'status', 'priority', 'urgency', 'area_id', 'parent_id', 'sort']), pageQuery(args)))),
  },
  {
    name: 'get_project',
    title: 'Get project',
    description:
      'Returns a project with its owner, member count, parent project and number of subprojects, the user role in it (it = IT owner: use get_project_brief) and capabilities (sections = charter, history, members, report the user sees in it).',
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
          urgency: urgency(),
          area_id: id(AREA),
          parent_id: id(PARENT),
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
    inputSchema: schema(
      Object.assign(
        { project_id: PROJECT_ID, start_date: nullableDate('Start date'), due_date: nullableDate('Due date'), urgency: nullableUrgency(), area_id: nullableId(AREA), parent_id: nullableId(`${PARENT} null detaches it.`) },
        PROJECT_FIELDS,
      ),
      ['project_id'],
    ),
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
    description: 'Adds a person to a project with a role (manager, member, viewer or it). Requires being a project manager with the members section.',
    inputSchema: schema(
      { project_id: PROJECT_ID, user_id: id('User id (from find_member_candidates).'), role: oneOf(projectDomain.MEMBER_ROLES, MEMBER_ROLE) },
      ['project_id', 'user_id', 'role'],
    ),
    annotations: ADD,
    run: (args, { services, ctx }) => services.projects.addMember(ctx, args.project_id, pick(args, ['user_id', 'role'])),
  },

  {
    name: 'update_project_member',
    title: 'Change member role',
    description: 'Changes the role of a person in a project (manager, member, viewer or it). The owner keeps managing. Requires being a project manager with the members section.',
    inputSchema: schema(
      { project_id: PROJECT_ID, user_id: id('User id (from list_project_members).'), role: oneOf(projectDomain.MEMBER_ROLES, MEMBER_ROLE) },
      ['project_id', 'user_id', 'role'],
    ),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.projects.updateMemberRole(ctx, args.project_id, args.user_id, pick(args, ['role'])),
  },
  {
    name: 'remove_project_member',
    title: 'Remove project member',
    description: 'Removes a person from a project (the owner cannot be removed; their tasks stay). Requires being a project manager. Confirm with the user first.',
    inputSchema: schema({ project_id: PROJECT_ID, user_id: id('User id (from list_project_members).') }, ['project_id', 'user_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.projects.removeMember(ctx, args.project_id, args.user_id),
  },
  {
    name: 'transfer_project_ownership',
    title: 'Transfer project ownership',
    description: 'Makes another active person the owner of the project (they become manager). Requires being the owner or an administrator. Confirm with the user first.',
    inputSchema: schema({ project_id: PROJECT_ID, user_id: id('New owner user id.') }, ['project_id', 'user_id']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.projects.transferOwnership(ctx, args.project_id, pick(args, ['user_id'])),
  },
  {
    name: 'delete_project',
    title: 'Delete project',
    description: 'Permanently deletes a project and everything in it (tasks, sprints, files, project management board). It cannot be undone: prefer archive_project. Confirm with the user first.',
    inputSchema: schema({ project_id: PROJECT_ID }, ['project_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.projects.deleteProject(ctx, args.project_id),
  },
  {
    name: 'get_project_history',
    title: 'Project history',
    description: 'Returns the readable change history of a project (settings, members, files…), newest first, paginated. Requires the history section of the project (FORBIDDEN otherwise).',
    inputSchema: schema(Object.assign({ project_id: PROJECT_ID }, PAGE), ['project_id']),
    annotations: READ,
    run: async (args, { services, ctx }) => page(await services.audit.listEntityHistory(ctx, 'project', args.project_id, pageQuery(args))),
  },
  {
    name: 'delete_project_file',
    title: 'Delete project file',
    description: 'Deletes a file of the project (uploader or project manager). Confirm with the user first.',
    inputSchema: schema({ file_id: id('Project file id (from list_project_files).') }, ['file_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.projectFiles.deleteFile(ctx, args.file_id),
  },

  // ---------------------------------------------------------------- configuração das tarefas
  {
    name: 'get_task_settings',
    title: 'Task settings',
    description:
      'Returns the workflow statuses (shared by all projects; category, WIP limit and allowed_next transitions — empty means any), priorities, responsible areas, task types and tags. Call it to get the ids before creating, updating or moving tasks.',
    inputSchema: schema({}),
    annotations: READ,
    run: async (_args, { services, ctx }) => ({
      statuses: await services.statuses.list(ctx, {}),
      priorities: await services.priorities.list(ctx, {}),
      areas: await services.areas.list(ctx, {}),
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
          plan_item_id: id('Only tasks linked to this project management element (from get_plan).'),
          urgency: urgencyFilter(),
          area_id: areaFilter(),
          in_report: bool('true = only tasks included in the project report; false = only the excluded ones.'),
          it_visible: bool('true = only tasks marked visible to the IT owner of the project; false = only the unmarked ones.'),
          sort: text(100, 'Comma-separated fields, "-" prefix for descending: code, title, created_at, updated_at, due_date, priority, status. Default: code.'),
        },
        PAGE,
      ),
    ),
    annotations: READ,
    run: async (args, { services, ctx }) => {
      const query = Object.assign(pick(args, ['project_id', 'search', 'status_id', 'assignee_id', 'priority_id', 'task_type_id', 'tag_id', 'sprint_id', 'plan_item_id', 'urgency', 'area_id', 'sort']), pageQuery(args))
      if (args.categories && args.categories.length > 0) query.category = args.categories.join(',')
      if (args.in_report !== undefined) query.in_report = String(args.in_report)
      if (args.it_visible !== undefined) query.it_visible = String(args.it_visible)
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
      'Changes a task (only the fields sent; null clears people, dates, hours, sprint, parent, urgency and area). The project cannot change. Changing the type drops custom values the new type does not have.',
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
    name: 'set_task_in_report',
    title: 'Include task in project report',
    description:
      'Includes (true) or excludes (false) a task from the project report (the Report tab of the project page). Every task is included by default. Requires editing the task and the report section of the project. Does not require the fields of the status; recorded in the task history.',
    inputSchema: schema({ task_id: TASK_ID, in_report: bool('true = included in the project report; false = left out.') }, ['task_id', 'in_report']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.tasks.setTaskReport(ctx, args.task_id, pick(args, ['in_report'])),
  },
  {
    name: 'set_task_it_visible',
    title: 'Show task to the IT owner',
    description:
      'Marks (true) or unmarks (false) a task as visible to the IT owner of the project (members with the role it), who otherwise only sees the tasks assigned to them. Requires editing the task; the IT owner cannot change it. Does not require the fields of the status; recorded in the task history.',
    inputSchema: schema({ task_id: TASK_ID, it_visible: bool('true = the IT owner sees the task; false = only if assigned to them.') }, ['task_id', 'it_visible']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.tasks.setTaskItVisible(ctx, args.task_id, pick(args, ['it_visible'])),
  },
  {
    name: 'delete_task',
    title: 'Delete task',
    description: 'Permanently deletes a task (subtasks are detached and relations removed). It cannot be undone: confirm with the user first.',
    inputSchema: schema({ task_id: TASK_ID }, ['task_id']),
    annotations: DELETE,
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

  {
    name: 'unlink_tasks',
    title: 'Unlink tasks',
    description: 'Removes a relation between two tasks (the relation id comes from get_task_relations).',
    inputSchema: schema({ relation_id: id('Relation id (from get_task_relations).') }, ['relation_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.relations.deleteRelation(ctx, args.relation_id),
  },
  {
    name: 'fork_task',
    title: 'Fork task',
    description:
      'Creates a new task of the same type from an existing one, keeping the origin (forked_from). By default it copies description, tags, custom fields and checklist (items reopened); attachments and relations only if asked.',
    inputSchema: schema(
      {
        task_id: TASK_ID,
        title: text(200, 'Title of the new task (default: the same).'),
        project_id: id('Project of the new task (default: the same project).'),
        copy: Object.assign(
          schema({
            description: bool('Copy the description.'),
            tags: bool('Copy the tags.'),
            custom_values: bool('Copy the custom field values.'),
            checklist: bool('Copy the checklist (items reopened).'),
            attachments: bool('Copy the attachments.'),
            relations: bool('Copy the relations.'),
          }),
          { description: 'What to copy (unset keys use the default).' },
        ),
      },
      ['task_id'],
    ),
    annotations: ADD,
    run: (args, { services, ctx }) => services.relations.forkTask(ctx, args.task_id, without(args, 'task_id')),
  },
  {
    name: 'update_task_comment',
    title: 'Edit comment',
    description: 'Edits a task comment (only its author). Markdown; mentions with @[Name](userId).',
    inputSchema: schema({ comment_id: id('Comment id (from list_task_comments).'), content: text(10000, 'New comment text (Markdown).') }, ['comment_id', 'content']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.comments.updateComment(ctx, args.comment_id, pick(args, ['content'])),
  },
  {
    name: 'delete_task_comment',
    title: 'Delete comment',
    description: 'Deletes a task comment (its author or a project manager). Confirm with the user first.',
    inputSchema: schema({ comment_id: id('Comment id (from list_task_comments).') }, ['comment_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.comments.deleteComment(ctx, args.comment_id),
  },
  {
    name: 'list_task_attachments',
    title: 'List task attachments',
    description: 'Lists the files attached to a task (name, type, size, field or comment it belongs to, who uploaded). The url downloads the file with the same API token. Uploading is done in the Avanza screen.',
    inputSchema: schema({ task_id: TASK_ID }, ['task_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.attachments.listAttachments(ctx, args.task_id),
  },
  {
    name: 'delete_task_attachment',
    title: 'Delete task attachment',
    description: 'Deletes a file attached to a task. Confirm with the user first.',
    inputSchema: schema({ attachment_id: id('Attachment id (from list_task_attachments).') }, ['attachment_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.attachments.deleteAttachment(ctx, args.attachment_id),
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
      return { project: board.project, capabilities: board.capabilities, columns: compactColumns(board.columns, args.limit_per_column) }
    },
  },
  {
    name: 'get_board_all_projects',
    title: 'Kanban of all projects',
    description:
      'Returns one Kanban board with the tasks of all open projects the user can see (or only the given ones): the projects included and one column per active status with the first cards (each card says its project).',
    inputSchema: schema({
      project_ids: ids(50, 'Only these projects (ids from list_projects); default: all visible open projects.'),
      limit_per_column: { type: 'integer', minimum: 1, maximum: 500, description: `Cards per column (default ${BOARD_LIMIT}).` },
    }),
    annotations: READ,
    run: async (args, { services, ctx }) => {
      const board = await services.board.getAllBoard(ctx, args.project_ids && args.project_ids.length > 0 ? { project_ids: args.project_ids.join(',') } : {})
      return { projects: board.projects, capabilities: board.capabilities, columns: compactColumns(board.columns, args.limit_per_column) }
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
  {
    name: 'rank_backlog_task',
    title: 'Prioritize backlog task',
    description:
      'Moves a task within the backlog order (between prev_id and next_id, both optional) and optionally changes its sprint (sprint_id, null = no sprint). Only tasks not started yet (backlog/todo categories).',
    inputSchema: schema(
      {
        task_id: TASK_ID,
        prev_id: id('Backlog task that should stay above.'),
        next_id: id('Backlog task that should stay below.'),
        sprint_id: nullableId('Sprint id (from list_sprints).'),
      },
      ['task_id'],
    ),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.backlog.rankTask(ctx, args.task_id, without(args, 'task_id')),
  },
  {
    name: 'reorder_sprints',
    title: 'Reorder sprints',
    description: 'Sets the order of the open sprints of a project. Send all their ids in the new order. Requires being a project manager.',
    inputSchema: schema({ project_id: PROJECT_ID, sprint_ids: ids(200, 'All open sprint ids, in the new order.') }, ['project_id', 'sprint_ids']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.sprints.reorderSprints(ctx, args.project_id, args.sprint_ids),
  },
  {
    name: 'delete_sprint',
    title: 'Delete sprint',
    description: 'Deletes a sprint; its tasks go back to the backlog without a sprint. Requires being a project manager. Confirm with the user first.',
    inputSchema: schema({ sprint_id: id('Sprint id (from list_sprints).') }, ['sprint_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.sprints.deleteSprint(ctx, args.sprint_id),
  },

  // ---------------------------------------------------------------- relatórios
  {
    name: 'get_report',
    title: 'Task report',
    description:
      'Returns task indicators for a period (open, in progress, overdue, created, completed, lead/cycle time…), a daily or weekly series, a breakdown and the overdue tasks. Defaults to the last 30 days of all visible projects. Requires reports.view.',
    inputSchema: schema(REPORT_FILTERS),
    annotations: READ,
    run: (args, { services, ctx }) => {
      return services.reports.getReport(ctx, reportQuery(args))
    },
  },  {
    name: 'list_report_tasks',
    title: 'Tasks behind an indicator',
    description: 'Lists the tasks counted in one report indicator (same period and filters as get_report), paginated, as compact summaries; time indicators add metric_hours. Requires reports.view.',
    inputSchema: schema(Object.assign({ metric: oneOf(report.METRICS, 'Indicator, as in get_report.') }, REPORT_FILTERS, PAGE), ['metric']),
    annotations: READ,
    run: async (args, { services, ctx }) => {
      const result = await services.reports.listIndicatorTasks(ctx, Object.assign(reportQuery(args), pageQuery(args)))
      return { items: result.items.map((task) => Object.assign(compactTask(task), { metric_hours: task.metric_hours === undefined ? null : task.metric_hours })), meta: result.meta }
    },
  },

  {
    name: 'get_executive_dashboard',
    title: 'Executive dashboard',
    description:
      'Returns the executive dashboard over ALL projects (or the given ones), read-only: summary, portfolio with each project health (from the project management board) and progress, project management totals (status, schedule, effort, open issues, upcoming milestones), Kanban (funnel, created vs completed, lead/cycle time, overdue), deliveries over time and what was done per project (archived included). Requires executive.view.',
    inputSchema: schema({
      project_ids: ids(200, 'Only these projects (ids from list_projects); default: all.'),
      statuses: { type: 'array', items: { type: 'string', enum: projectDomain.PROJECT_STATUS.slice() }, maxItems: 5, description: 'Only projects with these project statuses; default: all.' },
      from: date('Period start; default: since the beginning'),
      to: date('Period end, inclusive; default: today'),
      tz_offset: REPORT_FILTERS.tz_offset,
    }),
    annotations: READ,
    run: (args, { services, ctx }) => {
      const query = pick(args, ['from', 'to'])
      if (args.project_ids && args.project_ids.length > 0) query.project_ids = args.project_ids.join(',')
      if (args.statuses && args.statuses.length > 0) query.statuses = args.statuses.join(',')
      if (args.tz_offset !== undefined) query.tz_offset = String(args.tz_offset)
      return services.executive.getDashboard(ctx, query)
    },
  },
  // ---------------------------------------------------------------- notificações
  {
    name: 'list_notifications',
    title: 'List notifications',
    description: 'Lists the notifications of the user (mentions, assignments, due dates…), newest first, paginated.',
    inputSchema: schema({
      unread_only: bool('Only unread notifications.'),
      page: PAGE.page,
      per_page: int(1, 50, 'Items per page (default 20, max 50).'),
    }),
    annotations: READ,
    run: async (args, { services, ctx }) => page(await services.notifications.listNotifications(ctx, Object.assign(args.unread_only ? { unread: '1' } : {}, pageQuery(args)))),
  },
  {
    name: 'mark_notification_read',
    title: 'Mark notification read',
    description: 'Marks one notification of the user as read.',
    inputSchema: schema({ notification_id: id('Notification id (from list_notifications).') }, ['notification_id']),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.notifications.markRead(ctx, args.notification_id),
  },
  {
    name: 'mark_all_notifications_read',
    title: 'Mark all notifications read',
    description: 'Marks all notifications of the user as read.',
    inputSchema: schema({}),
    annotations: CHANGE,
    run: (_args, { services, ctx }) => services.notifications.markAllRead(ctx),
  },
]

module.exports = { TOOLS, compactTask }
