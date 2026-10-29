/**
 * Ferramentas MCP da Timeline do projeto: o cronograma das tarefas (com dependências e conflitos) e
 * os marcos. As datas das tarefas mudam com update_task (start_date/due_date).
 */

const timeline = require('../../domain/timeline')
const { READ, ADD, CHANGE, DELETE, schema, id, text, date, oneOf, PROJECT_ID, pick, without } = require('../kit')
const { compactTask } = require('./work')

const MILESTONE_ID = id('Milestone id (from list_milestones or get_timeline).')

const TOOLS = [
  {
    name: 'get_timeline',
    title: 'Project timeline',
    description:
      'Returns the timeline of a project: tasks as compact summaries (with start and due dates), dependencies "from comes before to" with conflict = the later task starts before the earlier is due, milestones and sprints. Move bars with update_task (start_date, due_date).',
    inputSchema: schema({ project_id: PROJECT_ID }, ['project_id']),
    annotations: READ,
    run: async (args, { services, ctx }) => {
      const result = await services.timeline.getTimeline(ctx, args.project_id)
      return Object.assign({}, result, { tasks: result.tasks.map(compactTask) })
    },
  },
  {
    name: 'list_milestones',
    title: 'List milestones',
    description: 'Lists the milestones of a project by date (name, description, due date, state pending/done).',
    inputSchema: schema({ project_id: PROJECT_ID }, ['project_id']),
    annotations: READ,
    run: (args, { services, ctx }) => services.milestones.listMilestones(ctx, args.project_id),
  },
  {
    name: 'create_milestone',
    title: 'Create milestone',
    description: 'Creates a milestone (a dated checkpoint) on the project timeline. Requires being a project manager.',
    inputSchema: schema(
      {
        project_id: PROJECT_ID,
        name: text(timeline.MILESTONE_NAME_MAX, 'Milestone name.'),
        description: text(timeline.MILESTONE_DESCRIPTION_MAX, 'Description.'),
        due_date: date('Milestone date'),
        state: oneOf(timeline.MILESTONE_STATES, 'State (default pending).'),
      },
      ['project_id', 'name', 'due_date'],
    ),
    annotations: ADD,
    run: (args, { services, ctx }) => services.milestones.createMilestone(ctx, args.project_id, without(args, 'project_id')),
  },
  {
    name: 'update_milestone',
    title: 'Update milestone',
    description: 'Changes a milestone (only the fields sent), e.g. state "done" when reached. Requires being a project manager.',
    inputSchema: schema(
      {
        milestone_id: MILESTONE_ID,
        name: text(timeline.MILESTONE_NAME_MAX, 'Milestone name.'),
        description: text(timeline.MILESTONE_DESCRIPTION_MAX, 'Description.'),
        due_date: date('Milestone date'),
        state: oneOf(timeline.MILESTONE_STATES, 'State.'),
      },
      ['milestone_id'],
    ),
    annotations: CHANGE,
    run: (args, { services, ctx }) => services.milestones.updateMilestone(ctx, args.milestone_id, pick(args, ['name', 'description', 'due_date', 'state'])),
  },
  {
    name: 'delete_milestone',
    title: 'Delete milestone',
    description: 'Deletes a milestone. Requires being a project manager. Confirm with the user first.',
    inputSchema: schema({ milestone_id: MILESTONE_ID }, ['milestone_id']),
    annotations: DELETE,
    run: (args, { services, ctx }) => services.milestones.deleteMilestone(ctx, args.milestone_id),
  },
]

module.exports = { TOOLS }
