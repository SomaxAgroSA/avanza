/**
 * Catálogo de ferramentas MCP: cada ferramenta descreve os argumentos (JSON Schema) para o modelo e
 * delega para um caso de uso — sem regra de negócio aqui (como em http/routes.js). Quem chama age
 * como a pessoa dona do token de API: permissões, validação, histórico e notificações são os dos
 * casos de uso.
 *
 * As ferramentas ficam por módulo em src/mcp/catalog/ (peças comuns em src/mcp/kit.js). Os textos são
 * para o modelo (em inglês, como a especificação OpenAPI). Listas grandes saem enxutas para caber no
 * contexto; o detalhe completo vem das ferramentas get_*.
 */

const work = require('./catalog/work')
const timeline = require('./catalog/timeline')
const plan = require('./catalog/plan')
const docs = require('./catalog/docs')
const config = require('./catalog/config')
const admin = require('./catalog/admin')

const TOOLS = [].concat(work.TOOLS, timeline.TOOLS, plan.TOOLS, docs.TOOLS, config.TOOLS, admin.TOOLS)

/** Orientação geral entregue ao modelo no `initialize`. */
const INSTRUCTIONS = [
  'Avanza is a project management platform: projects, tasks, backlog, sprints, Kanban, timeline and milestones, a separate project management board per project (get_plan: groups, elements, custom columns, dependencies, journal, issues), documentation spaces and pages (content as Markdown), reports, and administration (workflow statuses, priorities, task types, custom fields, tags, users, roles, audit log, platform, e-mail and webhooks) for users with the permission.',
  'You act as the user who owns the API token, with their permissions; every change is recorded in the audit history under their name.',
  'Tools take ids, not names: find them with list_projects, list_tasks (search accepts a task code such as CRM-12), get_task_settings (statuses, priorities, task types, tags) and list_project_members (people).',
  'Statuses are shared by all projects and grouped in categories (backlog, todo, in_progress, done, cancelled). Change a task status with move_task; only transitions in allowed_next are accepted (empty = any).',
  'A task type may require custom fields, always or in some statuses. A VALIDATION_ERROR lists the missing ones in details.fields (custom_values.<name>); get_task_type shows their types and options.',
  'Dates are YYYY-MM-DD. Descriptions and comments accept Markdown. Errors come back as { error: { code, message, details } }; FORBIDDEN or *_NOT_FOUND usually mean the user lacks the permission or is not a member of the project.',
  'Files cannot be uploaded through these tools: uploads are done in the Avanza screen.',
  'Confirm with the user before deleting or archiving anything.',
].join('\n')

module.exports = { TOOLS, INSTRUCTIONS, compactTask: work.compactTask }
