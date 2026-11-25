/**
 * Especificação OpenAPI 3.1 da API /api/v1 (servida em GET /api/v1/openapi.json).
 * Mantenha em sincronia com main.pb.js e docs/api.md.
 */

const { HOME_PAGES } = require('../domain/user')
const { ONGOING_VIEWS, TASK_VIEWS, TASK_HIDDEN_BOXES, PROJECT_LISTS } = require('../domain/permissions')

/** "Com cópia" (ajuste 24/11): e-mails que recebem o aviso da tarefa ou demanda nova, uma vez. */
const COPY_EMAILS = {
  type: 'array',
  maxItems: 5,
  items: { type: 'string', format: 'email' },
  description: 'e-mails em cópia: cada um recebe um e-mail com o código e o título no assunto e a descrição, uma vez (sem envio de e-mails configurado, nada sai)',
}

/** Tarefas do perfil (ajuste 23/11): só a tela de quem tem o perfil; o acesso segue as permissões. */
const TASK_VIEW_PROPS = {
  tasks_start: { type: 'string', enum: TASK_VIEWS.tasks_start, description: 'onde o menu Tarefas abre: "" = Lista; inbox = Caixa de entrada (Recebidas); inbox_assigned, inbox_requested e inbox_all = as caixas Atribuídas a mim, Pedidas por mim e Todas' },
  tasks_list: { type: 'string', enum: TASK_VIEWS.tasks_list, description: 'a Lista: "" = todas as que a pessoa pode ver; mine = só Minhas tarefas; hidden = sem a Lista' },
  tasks_hidden_boxes: { type: 'array', items: { type: 'string', enum: TASK_HIDDEN_BOXES }, description: 'caixas pessoais da Caixa de entrada escondidas para o perfil ([] = todas visíveis)' },
  tasks_all_box: { type: 'string', enum: TASK_VIEWS.tasks_all_box, description: 'a caixa Todas da Caixa de entrada (exige projects.view_all): "" = visível; hidden = escondida' },
}

/** Projetos do perfil (ajuste 25/11): as listas do menu Projetos; só a tela, a API das listas não muda. */
const PROJECT_LIST_PROPS = {
  projects_lists: {
    type: 'array',
    minItems: 1,
    items: { type: 'string', enum: PROJECT_LISTS },
    description: 'listas do menu Projetos visíveis para o perfil, na ordem do menu (padrão: as quatro); com uma só, Projetos abre direto nela',
  },
}

const ref = (name) => ({ $ref: `#/components/schemas/${name}` })

function envelope(dataSchema, withPageMeta) {
  return {
    type: 'object',
    required: ['data', 'meta', 'error'],
    properties: {
      data: dataSchema,
      meta: withPageMeta ? ref('PageMeta') : ref('Meta'),
      error: { type: 'null' },
    },
  }
}

const ok = (description, dataSchema, withPageMeta) => ({
  description,
  content: { 'application/json': { schema: envelope(dataSchema, withPageMeta) } },
})

const errorResponse = (description) => ({
  description,
  content: { 'application/json': { schema: ref('ErrorEnvelope') } },
})

const COMMON_ERRORS = {
  401: errorResponse('UNAUTHENTICATED | SESSION_EXPIRED'),
  403: errorResponse('FORBIDDEN | CSRF_CHECK_FAILED | PRIVILEGE_ESCALATION | ...'),
  429: errorResponse('RATE_LIMITED'),
  500: errorResponse('INTERNAL_ERROR'),
}

const csrfHeader = {
  name: 'X-Requested-With',
  in: 'header',
  required: true,
  schema: { type: 'string', enum: ['kamban'] },
  description: 'Obrigatório em POST/PUT/PATCH/DELETE (proteção CSRF).',
}
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } }

/** Resposta de GET /dependencies e /ti-dependencies (§42). */
const DEPENDENCIES_SCHEMA = {
  type: 'object',
  properties: {
    generated_at: { type: 'string', format: 'date-time' },
    today: { type: 'string', description: 'AAAA-MM-DD no fuso de quem consulta' },
    people: { type: 'array', items: { $ref: '#/components/schemas/UserSummary' }, description: 'quem responde pelas entregas' },
    areas: { type: 'array', items: { type: 'object' }, description: '[{ key, name, deliveries }] — as áreas configuradas, na ordem, com quantas entregas têm' },
    totals: { type: 'object', description: 'deliveries, blocked, pending, none_due, overdue, projects' },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          project: { type: 'object', description: '{ id, key, name, due_date }' },
          counts: { type: 'object', description: 'deliveries, blocked, pending, none_due, overdue' },
          deliveries: { type: 'array', items: { type: 'object' }, description: '{ id, code, title, project, due_date, area{ key, name }, assignee_id, since, waiting_days, days_left, risk (none_due | overdue | ok), blocks, blocks_projects }' },
          blocked: { type: 'array', items: { type: 'object' }, description: '{ id, code, title, project, due_date, waiting_on: [{ id, code, title, project, due_date, area, relation_id }] }' },
          pending: { type: 'array', items: { type: 'object' }, description: '{ id, code, title, project, due_date, related_to{ …, area }, relation_id, can_confirm }' },
        },
      },
    },
  },
}
const DEPENDENCIES_PARAMS = [
  { name: 'project_ids', in: 'query', schema: { type: 'string' }, description: 'só estes projetos (ids separados por vírgula, até 200)' },
  { name: 'tz_offset', in: 'query', schema: { type: 'integer' }, description: 'minutos (Date#getTimezoneOffset) para o "hoje" de quem consulta' },
]

function op(summary, tags, responses, extra) {
  return Object.assign({ summary, tags, responses: Object.assign({}, responses, COMMON_ERRORS) }, extra || {})
}

function jsonBody(schema) {
  return { required: true, content: { 'application/json': { schema } } }
}

/**
 * Caminhos de uma lista configurável (status, prioridades ou áreas): mesmas regras, prefixo de erro
 * próprio. `noDefault` (áreas): sem item padrão; em uso por tarefas ou projetos não se exclui.
 */
function lookupPaths(base, label, schema, errorPrefix, noDefault) {
  const tags = ['workflow']
  return {
    [base]: {
      get: op(`${label} em ordem; inativos só com include_inactive=1 e settings.manage`, tags, { 200: ok(label, { type: 'array', items: ref(schema) }) }, {
        parameters: [{ name: 'include_inactive', in: 'query', schema: { type: 'string', enum: ['1'] } }],
      }),
      post: op(noDefault ? 'Cria item (settings.manage); sem padrão' : 'Cria item (settings.manage); o primeiro vira o padrão', tags, { 201: ok('Criado', ref(schema)), 409: errorResponse(`${errorPrefix}_KEY_IN_USE`) }, {
        parameters: [csrfHeader],
        requestBody: jsonBody(ref(`${schema}Input`)),
      }),
    },
    [`${base}/order`]: {
      put: op('Reordena; exige a lista completa de ids', tags, { 200: ok(label, { type: 'array', items: ref(schema) }) }, {
        parameters: [csrfHeader],
        requestBody: jsonBody({ type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'string' } } } }),
      }),
    },
    [`${base}/{id}`]: {
      get: op('Detalhe', tags, { 200: ok('Item', ref(schema)), 404: errorResponse(`${errorPrefix}_NOT_FOUND`) }, { parameters: [idParam] }),
      patch: op(noDefault ? 'Atualiza (settings.manage); chave imutável' : 'Atualiza (settings.manage); chave imutável; is_default=true desmarca o anterior; o padrão não pode ser desativado', tags, { 200: ok('Atualizado', ref(schema)) }, {
        parameters: [idParam, csrfHeader],
        requestBody: jsonBody(ref(`${schema}Input`)),
      }),
      delete: op(noDefault ? 'Exclui item sem tarefas nem projetos (em uso: details { tasks, projects })' : 'Exclui item sem tarefas e que não é o padrão', tags, { 200: ok('Excluído', { type: 'object' }), 409: errorResponse(noDefault ? `${errorPrefix}_IN_USE` : `${errorPrefix}_IN_USE | ${errorPrefix}_IS_DEFAULT`) }, {
        parameters: [idParam, csrfHeader],
      }),
    },
  }
}

const LOOKUP_PROPERTIES = {
  id: { type: 'string' },
  key: { type: 'string' },
  name: { type: 'string' },
  description: { type: 'string' },
  color: { type: 'string' },
  order: { type: 'integer' },
  is_active: { type: 'boolean' },
  is_default: { type: 'boolean' },
  created_at: { type: 'string', format: 'date-time' },
  updated_at: { type: 'string', format: 'date-time' },
}

const LOOKUP_INPUT = {
  key: { type: 'string', description: 'Só na criação; /^[A-Z][A-Z0-9_]{1,29}$/ (normalizada)' },
  name: { type: 'string' },
  description: { type: 'string' },
  color: { type: 'string' },
  is_active: { type: 'boolean' },
  is_default: { type: 'boolean' },
}

/** Área resumida que sai na tarefa e no projeto (null = sem área). */
const COMPANY_REF = {
  oneOf: [{ type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, short_code: { type: 'string', description: "sigla ('' = sem sigla)" } } }, { type: 'null' }],
  description: 'empresa (§46); na tarefa, a do projeto ou, na demanda interna, a dela; null = sem empresa',
}
const AREA_REF = {
  oneOf: [{ type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' }, color: { type: 'string' } } }, { type: 'null' }],
  description: 'área responsável (lista de /areas); null = sem área',
}

/** Kanban: limite WIP e destinos permitidos do status. */
const STATUS_FLOW = {
  wip_limit: { type: 'integer', minimum: 0, maximum: 999, description: '0 = sem limite' },
  allowed_next: { type: 'array', items: { type: 'string' }, description: 'IDs de status de destino; vazio = qualquer' },
}

const STATUS_CATEGORY = { type: 'string', enum: ['backlog', 'todo', 'in_progress', 'done', 'cancelled'], description: 'done/cancelled = tarefa encerrada' }

function build() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Avanza API',
      version: 'v1',
      description:
        'API REST da plataforma Avanza. Autenticação por cookie de sessão HttpOnly (kb_session). ' +
        'Todas as respostas seguem o envelope { data, meta, error }.',
    },
    servers: [{ url: '/api/v1' }],
    security: [{ sessionCookie: [] }, { bearerToken: [] }],
    paths: Object.assign(lookupPaths('/statuses', 'Status', 'Status', 'STATUS'), lookupPaths('/priorities', 'Prioridades', 'Priority', 'PRIORITY'), lookupPaths('/areas', 'Áreas responsáveis', 'Area', 'AREA', true), {
      '/health': { get: op('Health check', ['system'], { 200: ok('Serviço saudável', ref('Health')) }, { security: [] }) },
      '/auth/login': {
        post: op(
          'Login com e-mail e senha',
          ['auth'],
          {
            200: ok('Sessão criada; cookie kb_session definido', {
              type: 'object',
              properties: { user: ref('User'), session: ref('Session') },
            }),
            400: errorResponse('VALIDATION_ERROR'),
          },
          {
            security: [],
            parameters: [csrfHeader],
            requestBody: jsonBody({
              type: 'object',
              required: ['email', 'password'],
              properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' }, remember: { type: 'boolean' } },
            }),
          },
        ),
      },
      '/auth/logout': { post: op('Encerra a sessão atual', ['auth'], { 200: ok('Sessão encerrada', { type: 'object' }) }, { parameters: [csrfHeader] }) },
      '/auth/me': { get: op('Usuário autenticado, perfil, permissões e o que a plataforma desligou para todos (platform.panorama_enabled, §26.2)', ['auth'], { 200: ok('Contexto do usuário', ref('Me')) }) },
      '/auth/sessions': { get: op('Sessões ativas do usuário', ['auth'], { 200: ok('Sessões', { type: 'array', items: ref('Session') }) }) },
      '/auth/sessions/revoke-others': {
        post: op('Encerra todas as outras sessões do usuário (mantém a atual)', ['auth'], { 200: ok('Encerradas', { type: 'object', properties: { revoked: { type: 'integer' } } }) }, {
          parameters: [csrfHeader],
        }),
      },
      '/auth/sessions/{id}': {
        delete: op('Revoga uma sessão própria', ['auth'], { 200: ok('Revogada', { type: 'object' }), 404: errorResponse('SESSION_NOT_FOUND') }, {
          parameters: [idParam, csrfHeader],
        }),
      },
      '/auth/password': {
        post: op('Troca a própria senha (encerra as outras sessões)', ['auth'], { 200: ok('Senha alterada', { type: 'object', properties: { changed: { type: 'boolean' }, other_sessions_revoked: { type: 'integer' } } }), 400: errorResponse('VALIDATION_ERROR (current_password: incorrect | new_password: same_as_current | ...)') }, {
          parameters: [csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['current_password', 'new_password'], properties: { current_password: { type: 'string' }, new_password: { type: 'string', minLength: 10, maxLength: 72 } } }),
        }),
      },
      '/permissions': { get: op('Catálogo de permissões (permissions.manage)', ['rbac'], { 200: ok('Permissões', { type: 'array', items: ref('Permission') }) }) },
      '/roles': {
        get: op('Lista perfis', ['rbac'], { 200: ok('Perfis', { type: 'array', items: ref('Role') }) }),
        post: op('Cria perfil (permissions.manage)', ['rbac'], { 201: ok('Criado', ref('Role')), 400: errorResponse('VALIDATION_ERROR'), 409: errorResponse('ROLE_CODE_IN_USE') }, {
          parameters: [csrfHeader],
          requestBody: jsonBody(ref('RoleInput')),
        }),
      },
      '/roles/{id}': {
        get: op('Detalhe do perfil', ['rbac'], { 200: ok('Perfil', ref('Role')), 404: errorResponse('ROLE_NOT_FOUND') }, { parameters: [idParam] }),
        patch: op('Atualiza nome, descrição e os ajustes de tela do perfil (Em andamento, Tarefas, Projetos; permissions.manage)', ['rbac'], { 200: ok('Atualizado', ref('Role')) }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              ongoing_view: { type: 'string', enum: ONGOING_VIEWS, description: 'vista de Em andamento do perfil (§41); "" = Gestão' },
              ...TASK_VIEW_PROPS,
              ...PROJECT_LIST_PROPS,
            },
          }),
        }),
        delete: op('Exclui perfil customizado', ['rbac'], { 200: ok('Excluído', { type: 'object' }), 409: errorResponse('ROLE_IN_USE') }, {
          parameters: [idParam, csrfHeader],
        }),
      },
      '/roles/{id}/permissions': {
        put: op('Substitui as permissões do perfil', ['rbac'], { 200: ok('Atualizado', ref('Role')) }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['permissions'], properties: { permissions: { type: 'array', items: { type: 'string' } } } }),
        }),
      },
      '/users': {
        get: op('Lista usuários (paginado)', ['users'], { 200: ok('Página de usuários', { type: 'array', items: ref('User') }, true) }, {
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
            { name: 'perPage', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'name, email, status, created_at, last_login_at; prefixo "-" = desc' },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'disabled'] } },
            { name: 'role_id', in: 'query', schema: { type: 'string' } },
          ],
        }),
        post: op('Cria usuário (users.create)', ['users'], { 201: ok('Criado', ref('User')), 409: errorResponse('EMAIL_ALREADY_IN_USE') }, {
          parameters: [csrfHeader],
          requestBody: jsonBody(ref('UserCreate')),
        }),
      },
      '/users/{id}': {
        get: op('Detalhe do usuário', ['users'], { 200: ok('Usuário', ref('User')), 404: errorResponse('USER_NOT_FOUND') }, { parameters: [idParam] }),
        patch: op('Atualiza usuário (parcial)', ['users'], { 200: ok('Atualizado', ref('User')) }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody(ref('UserUpdate')),
        }),
      },
      '/users/{id}/password': {
        post: op('Redefine a senha de outro usuário (users.edit); encerra as sessões dele', ['users'], { 200: ok('Redefinida', { type: 'object' }), 400: errorResponse('USE_CHANGE_PASSWORD | VALIDATION_ERROR') }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['password'], properties: { password: { type: 'string', minLength: 10, maxLength: 72 } } }),
        }),
      },
      '/users/{id}/history': {
        get: op('Histórico de auditoria do usuário (users.view ou audit.view)', ['users'], { 200: ok('Registros', { type: 'array', items: ref('AuditEntry') }, true), 404: errorResponse('USER_NOT_FOUND') }, {
          parameters: [idParam, { name: 'page', in: 'query', schema: { type: 'integer' } }, { name: 'perPage', in: 'query', schema: { type: 'integer' } }],
        }),
      },
      '/icons': {
        get: op('Biblioteca de ícones (qualquer autenticado): [{ name, created_at, created_by, usage: { projects, task_types, doc_spaces } }] — nomes do Lucide aceitos nos ícones de projeto, tipo de tarefa e espaço, além dos padrões', ['settings'], { 200: ok('Ícones', { type: 'array', items: { type: 'object' } }) }),
      },
      '/settings/icons': {
        post: op('Importa ícones da galeria (settings.manage): { names: [] } — até 60, nomes do Lucide (minúsculas, números e hífens); repetidos são ignorados → a biblioteca', ['settings'], { 200: ok('Ícones', { type: 'array', items: { type: 'object' } }), 400: errorResponse('VALIDATION_ERROR') }, { parameters: [csrfHeader] }),
      },
      '/settings/icons/{name}': {
        delete: op('Remove da biblioteca (settings.manage) — só se nenhum projeto, tipo ou espaço usa (ICON_IN_USE com as contagens)', ['settings'], { 200: ok('Removido', { type: 'object' }), 404: errorResponse('ICON_NOT_FOUND'), 409: errorResponse('ICON_IN_USE') }, {
          parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }, csrfHeader],
        }),
      },
      '/users/{id}/avatar': {
        get: op('Foto do usuário (qualquer pessoa autenticada; nosniff + CSP sandbox; cache de 1 dia — avatar_url muda a cada foto nova)', ['users'], { 200: { description: 'Imagem' }, 404: errorResponse('NOT_FOUND') }, { parameters: [idParam] }),
        post: op('Envia a foto (o próprio usuário ou users.edit): multipart "file" — PNG, JPG ou WebP até 2 MB, tipo conferido pelo conteúdo; substitui a anterior', ['users'], { 200: ok('Usuário', ref('User')), 400: errorResponse('VALIDATION_ERROR') }, { parameters: [idParam, csrfHeader] }),
        delete: op('Remove a foto (volta às iniciais)', ['users'], { 200: ok('Usuário', ref('User')) }, { parameters: [idParam, csrfHeader] }),
      },
      '/audit-logs': {
        get: op('Histórico de auditoria (audit.view), mais recentes primeiro', ['audit'], { 200: ok('Registros', { type: 'array', items: ref('AuditEntry') }, true) }, {
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'perPage', in: 'query', schema: { type: 'integer', maximum: 100 } },
            { name: 'entity_type', in: 'query', schema: { type: 'string' } },
            { name: 'entity_id', in: 'query', schema: { type: 'string' } },
            { name: 'user_id', in: 'query', schema: { type: 'string' } },
            { name: 'action', in: 'query', schema: { type: 'string' } },
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
        }),
      },
      '/team-activity': {
        get: op('Equipo ahora (§41): por pessoa, os projetos em andamento em que ela agiu nos últimos 7 dias (ações dela no histórico da tarefa: status, passo, comentário, anexo, edição) ou tem tarefas abertas atribuídas, com as tarefas em que agiu (acted_tasks, a última ação e a data) e as tarefas por trás dos números. Só projetos que a pessoa vê por inteiro; as demandas internas que ela enxerga (§45) entram num bloco com project.kind = demands. Exige tasks.view (sem ele, lista vazia)', ['projects'], {
          200: ok('Atividade', {
            type: 'object',
            properties: {
              window_days: { type: 'integer' },
              generated_at: { type: 'string', format: 'date-time' },
              people: { type: 'array', items: { type: 'object', description: 'user + projects[{ project, state: working|active|idle, in_progress, recent (tarefas em que agiu), actions (ações dela), open, stale, last_activity (última ação dela), acted_tasks[{ id, code, title, status, updated_at, in_progress, actions, action{ type: status_changed|step|commented|attached|created|edited, at, from, to, step, excerpt, count } }], tasks[] }]' } },
            },
          }),
        }),
      },
      '/project-task-counts': {
        get: op('Tarefas por projeto (§41): de cada projeto não arquivado que a pessoa vê por inteiro, quantas estão executadas (done) e quantas faltam (as demais, sem as canceladas). Alimenta o painel Direção e gerência de Em andamento; exige tasks.view (sem ele, lista vazia); projeto sem tarefas não aparece', ['projects'], {
          200: ok('Contagens', {
            type: 'object',
            properties: { projects: { type: 'array', items: { type: 'object', properties: { project_id: { type: 'string' }, done: { type: 'integer' }, open: { type: 'integer' } } } } },
          }),
        }),
      },
      '/dependencies': {
        get: op('Dependências por área (§42): por projeto não arquivado que a pessoa vê por inteiro, as entregas abertas de outras áreas (tarefa aberta atribuída a alguém de uma área de Configurações → Dependências por área, ou ao Responsável TI do projeto, que conta na área TI), cada uma com a área { key, name } e o risco pelo prazo da própria tarefa (none_due, overdue, ok); as tarefas abertas bloqueadas por elas ("bloqueia"/"depende de", inclusive de outro projeto) e as só relacionadas (a validar, nunca bloqueio); e as áreas com quantas entregas têm. As demandas internas abertas que a pessoa enxerga (§45) entram como entregas num bloco com project.kind = demands. Exige tasks.view (sem ele, vazio). Alimenta o painel Direção e gerência de Em andamento', ['projects'], {
          200: ok('Dependências', DEPENDENCIES_SCHEMA),
          400: errorResponse('VALIDATION_ERROR'),
        }, { parameters: DEPENDENCIES_PARAMS }),
      },
      '/ti-dependencies': {
        get: op('Compatibilidade: o mesmo que /dependencies, só com as entregas da área TI (areas = [TI])', ['projects'], {
          200: ok('Dependências da TI', DEPENDENCIES_SCHEMA),
          400: errorResponse('VALIDATION_ERROR'),
        }, { parameters: DEPENDENCIES_PARAMS }),
      },
      '/projects': {
        get: op('Lista projetos acessíveis (paginado)', ['projects'], { 200: ok('Página de projetos', { type: 'array', items: ref('Project') }, true) }, {
          parameters: [
            { name: 'view', in: 'query', schema: { type: 'string', enum: ['all', 'mine', 'ongoing', 'finished', 'archived'] }, description: 'ongoing = planejamento, em curso ou pausado; finished = concluído ou cancelado (só abertos)' },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'perPage', in: 'query', schema: { type: 'integer', maximum: 100 } },
            { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'name, key, created_at, due_date, status, priority; prefixo "-" = desc' },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string' }, description: 'um ou vários separados por vírgula (§37), ex.: planning,active' },
            { name: 'priority', in: 'query', schema: { type: 'string' }, description: 'um ou vários separados por vírgula (§37), ex.: high,critical' },
            { name: 'urgency', in: 'query', schema: { type: 'string' }, description: 'high, medium, low ou none (sem urgência); um ou vários separados por vírgula (§37)' },
            { name: 'area_id', in: 'query', schema: { type: 'string' }, description: 'área responsável; none = sem área' },
            { name: 'parent_id', in: 'query', schema: { type: 'string' }, description: 'subprojetos deste pai; none = só projetos sem pai (§34)' },
            { name: 'owner_id', in: 'query', schema: { type: 'string' } },
            { name: 'facets', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'true = meta.facets com as contagens por status, priority e urgency (cada grupo sem o próprio filtro; §37)' },
          ],
        }),
        post: op('Cria projeto (projects.create); criador vira dono e gestor', ['projects'], { 201: ok('Criado', ref('Project')), 409: errorResponse('PROJECT_KEY_IN_USE') }, {
          parameters: [csrfHeader],
          requestBody: jsonBody(ref('ProjectInput')),
        }),
      },
      '/projects/{id}': {
        get: op('Detalhe do projeto (404 se sem acesso; o Responsável TI também abre: my_role = it, §33)', ['projects'], { 200: ok('Projeto', ref('Project')), 404: errorResponse('PROJECT_NOT_FOUND') }, { parameters: [idParam] }),
        patch: op('Atualiza projeto (gestor + projects.edit); a chave é imutável', ['projects'], { 200: ok('Atualizado', ref('Project')), 409: errorResponse('PROJECT_ARCHIVED') }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody(ref('ProjectInput')),
        }),
        delete: op('Exclui projeto arquivado (dono ou projects.view_all + projects.delete). Com espaços de documentação, `docs` é obrigatório: move (para `docs_project_id`, que a pessoa gerencia), general (sem projeto, toda a empresa) ou delete (saem junto); sem ele → 409 PROJECT_HAS_DOCS com `details.spaces`', ['projects'], { 200: ok('Excluído', { type: 'object' }), 409: errorResponse('PROJECT_HAS_DOCS') }, {
          parameters: [
            idParam,
            csrfHeader,
            { name: 'docs', in: 'query', schema: { type: 'string', enum: ['move', 'general', 'delete'] } },
            { name: 'docs_project_id', in: 'query', schema: { type: 'string' } },
          ],
        }),
      },
      '/projects/{id}/archive': { post: op('Arquiva o projeto', ['projects'], { 200: ok('Arquivado', ref('Project')) }, { parameters: [idParam, csrfHeader] }) },
      '/projects/{id}/unarchive': { post: op('Desarquiva o projeto', ['projects'], { 200: ok('Restaurado', ref('Project')) }, { parameters: [idParam, csrfHeader] }) },
      '/projects/{id}/owner': {
        put: op('Transfere a posse (dono ou projects.view_all)', ['projects'], { 200: ok('Transferido', ref('Project')) }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['user_id'], properties: { user_id: { type: 'string' } } }),
        }),
      },
      '/projects/{id}/history': {
        get: op('Histórico de auditoria do projeto (seção Histórico, projects.history — §35)', ['projects'], { 200: ok('Registros', { type: 'array', items: ref('AuditEntry') }, true), 403: errorResponse('FORBIDDEN') }, { parameters: [idParam] }),
      },
      '/projects/{id}/members': {
        get: op('Membros do projeto', ['projects'], { 200: ok('Membros', { type: 'array', items: ref('ProjectMember') }) }, { parameters: [idParam] }),
        post: op('Adiciona membro (gestor + seção Membros); role it = Responsável TI (§33)', ['projects'], { 201: ok('Membros atualizados', { type: 'array', items: ref('ProjectMember') }), 409: errorResponse('MEMBER_ALREADY_EXISTS') }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['user_id', 'role'], properties: { user_id: { type: 'string' }, role: { type: 'string', enum: ['manager', 'member', 'viewer', 'it'] } } }),
        }),
      },
      '/projects/{id}/member-candidates': {
        get: op('Usuários ativos que podem ser adicionados (gestor + seção Membros)', ['projects'], { 200: ok('Candidatos', { type: 'array', items: ref('UserSummary') }) }, {
          parameters: [idParam, { name: 'search', in: 'query', schema: { type: 'string' } }],
        }),
      },
      '/projects/{id}/members/{userId}': {
        patch: op('Altera o papel do membro (gestor + seção Membros; papel do dono é fixo)', ['projects'], { 200: ok('Membros', { type: 'array', items: ref('ProjectMember') }), 409: errorResponse('OWNER_ROLE_LOCKED') }, {
          parameters: [idParam, { name: 'userId', in: 'path', required: true, schema: { type: 'string' } }, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['role'], properties: { role: { type: 'string', enum: ['manager', 'member', 'viewer', 'it'] } } }),
        }),
        delete: op('Remove membro (gestor) ou sai do projeto (o próprio membro)', ['projects'], { 200: ok('Removido', { type: 'object' }), 409: errorResponse('CANNOT_REMOVE_OWNER') }, {
          parameters: [idParam, { name: 'userId', in: 'path', required: true, schema: { type: 'string' } }, csrfHeader],
        }),
      },
      '/custom-fields': {
        get: op('Biblioteca de campos personalizados (settings.manage ou tasks.view)', ['task-config'], { 200: ok('Campos', { type: 'array', items: ref('CustomField') }) }),
        post: op('Cria campo (settings.manage); name e type são imutáveis', ['task-config'], { 201: ok('Criado', ref('CustomField')), 409: errorResponse('FIELD_NAME_IN_USE') }, {
          parameters: [csrfHeader],
          requestBody: jsonBody(ref('CustomFieldInput')),
        }),
      },
      '/custom-fields/{id}': {
        get: op('Detalhe do campo', ['task-config'], { 200: ok('Campo', ref('CustomField')), 404: errorResponse('FIELD_NOT_FOUND') }, { parameters: [idParam] }),
        patch: op('Atualiza campo (settings.manage); opções são sincronizadas pelo id', ['task-config'], { 200: ok('Atualizado', ref('CustomField')) }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody(ref('CustomFieldInput')),
        }),
        delete: op('Exclui campo que nenhum tipo usa (settings.manage)', ['task-config'], { 200: ok('Excluído', { type: 'object' }), 409: errorResponse('FIELD_IN_USE (details.types)') }, {
          parameters: [idParam, csrfHeader],
        }),
      },
      '/custom-fields/{id}/options': {
        post: op(
          'Adiciona opção pela tarefa (settings.manage, tasks.create ou tasks.edit) em seleção com config.allow_create_options; rótulo igual (sem diferenciar maiúsculas e acentos) devolve a opção existente, reativada se estava inativa',
          ['task-config'],
          {
            200: ok('Opção de mesmo rótulo (existente ou reativada)', ref('FieldOption')),
            201: ok('Opção criada no fim da lista, com a cor seguinte da paleta', ref('FieldOption')),
            400: errorResponse('VALIDATION_ERROR (fields.label: required, invalid_type, too_long; fields.options: too_many)'),
            403: errorResponse('FIELD_OPTIONS_LOCKED (campo não é seleção ou não permite adicionar opções) ou FORBIDDEN'),
            404: errorResponse('FIELD_NOT_FOUND'),
          },
          {
            parameters: [idParam, csrfHeader],
            requestBody: jsonBody({ type: 'object', required: ['label'], properties: { label: { type: 'string', maxLength: 60 } } }),
          },
        ),
      },
      '/task-types': {
        get: op('Tipos de tarefa em ordem; inativos só com include_inactive=1 e settings.manage', ['task-config'], { 200: ok('Tipos', { type: 'array', items: ref('TaskType') }) }, {
          parameters: [{ name: 'include_inactive', in: 'query', schema: { type: 'string', enum: ['1'] } }],
        }),
        post: op('Cria tipo de tarefa (settings.manage)', ['task-config'], { 201: ok('Criado', ref('TaskType')), 409: errorResponse('TASK_TYPE_KEY_IN_USE') }, {
          parameters: [csrfHeader],
          requestBody: jsonBody(ref('TaskTypeInput')),
        }),
      },
      '/task-types/order': {
        put: op('Reordena os tipos; exige a lista completa de ids', ['task-config'], { 200: ok('Tipos reordenados', { type: 'array', items: ref('TaskType') }) }, {
          parameters: [csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'string' } } } }),
        }),
      },
      '/task-types/{id}': {
        get: op('Tipo com seus campos configurados', ['task-config'], { 200: ok('Tipo', ref('TaskTypeDetail')), 404: errorResponse('TASK_TYPE_NOT_FOUND') }, { parameters: [idParam] }),
        patch: op('Atualiza tipo (settings.manage); a chave é imutável', ['task-config'], { 200: ok('Atualizado', ref('TaskType')) }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody(ref('TaskTypeInput')),
        }),
        delete: op('Exclui tipo sem tarefas (settings.manage)', ['task-config'], { 200: ok('Excluído', { type: 'object' }), 409: errorResponse('TASK_TYPE_IN_USE') }, {
          parameters: [idParam, csrfHeader],
        }),
      },
      '/task-types/{id}/fields': {
        put: op('Substitui os campos do tipo; a ordem é a posição na lista', ['task-config'], { 200: ok('Tipo atualizado', ref('TaskTypeDetail')) }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({
            type: 'object',
            required: ['fields'],
            properties: {
              fields: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['field_id'],
                  properties: {
                    field_id: { type: 'string' },
                    required: { type: 'boolean', description: 'obrigatório em todos os status' },
                    visible: { type: 'boolean' },
                    show_on_card: { type: 'boolean' },
                    required_status_ids: { type: 'array', items: { type: 'string' }, maxItems: 50, description: 'status em que o campo passa a ser exigido (ignorado se required ou oculto); status inexistente = VALIDATION_ERROR fields.fields=invalid_status' },
                  },
                },
              },
            },
          }),
        }),
      },
      '/task-types/{id}/history': {
        get: op('Histórico de auditoria do tipo', ['task-config'], { 200: ok('Registros', { type: 'array', items: ref('AuditEntry') }, true) }, { parameters: [idParam] }),
      },
      '/tasks': {
        get: op('Tarefas dos projetos visíveis (paginado)', ['tasks'], { 200: ok('Página de tarefas', { type: 'array', items: ref('Task') }, true) }, {
          parameters: [
            { name: 'project_id', in: 'query', schema: { type: 'string' } },
            { name: 'task_type_id', in: 'query', schema: { type: 'string' } },
            { name: 'status_id', in: 'query', schema: { type: 'string' } },
            { name: 'priority_id', in: 'query', schema: { type: 'string' }, description: 'um ou vários ids separados por vírgula (§44)' },
            { name: 'assignee_id', in: 'query', schema: { type: 'string' }, description: 'um ou vários ids separados por vírgula; "me" = quem consulta; "none" = sem ninguém' },
            { name: 'responsible_id', in: 'query', schema: { type: 'string' }, description: 'como assignee_id (vários, "me", "none"): o Responsável da Lista de tarefas — quem recebe e distribui (§45) ou, sem ele, a pessoa atribuída' },
            { name: 'due', in: 'query', schema: { type: 'string' }, description: 'Prazo em grupos, vários separados por vírgula: overdue (antes de hoje), today, next7 (de amanhã a 7 dias), later, none (sem prazo)' },
            { name: 'due_today', in: 'query', schema: { type: 'string', format: 'date' }, description: 'o "hoje" de quem consulta (AAAA-MM-DD) para o filtro due; sem ele, o dia do servidor (UTC)' },
            { name: 'category', in: 'query', schema: { type: 'string' }, description: 'categorias de status separadas por vírgula (ex.: backlog,todo,in_progress)' },
            { name: 'tag_id', in: 'query', schema: { type: 'string' } },
            { name: 'sprint_id', in: 'query', schema: { type: 'string' }, description: 'id da sprint ou `none` (sem sprint)' },
            { name: 'plan_item_id', in: 'query', schema: { type: 'string' }, description: 'tarefas ligadas a um elemento da Gestão de projetos' },
            { name: 'in_report', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'entra (true) ou não (false) no informe do projeto' },
            { name: 'it_visible', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'marcada (true) ou não (false) como visível para o Responsável TI (§36)' },
            { name: 'urgency', in: 'query', schema: { type: 'string' }, description: 'urgência (semáforo): high, medium, low ou none (sem urgência); um ou vários separados por vírgula (§44)' },
            { name: 'area_id', in: 'query', schema: { type: 'string' }, description: 'área responsável; none = sem área' },
            { name: 'company_id', in: 'query', schema: { type: 'string' }, description: 'empresa (§46): a do projeto ou, na demanda interna, a dela; none = sem empresa' },
            { name: 'kind', in: 'query', schema: { type: 'string', enum: ['project', 'demand'] }, description: 'Com projeto (project) ou Sem projeto = demandas internas (demand) (§45); sem o filtro, as duas' },
            { name: 'mine', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: '"Minhas tarefas": atribuídas a quem consulta e, nas demandas internas, também as que ela pediu ou recebeu como responsável (§45)' },
            { name: 'search', in: 'query', schema: { type: 'string' }, description: 'título, código e campos personalizados pesquisáveis' },
            { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'code, title, created_at, updated_at, due_date, priority, status; prefixo "-" = desc' },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'perPage', in: 'query', schema: { type: 'integer', maximum: 100 } },
          ],
        }),
        post: op('Cria tarefa (tasks.create + colaborador do projeto); campos de imagem/arquivo não são exigidos aqui — envie depois em /tasks/{id}/attachments com field', ['tasks'], { 201: ok('Criada', ref('TaskDetail')), 404: errorResponse('PROJECT_NOT_FOUND') }, {
          parameters: [csrfHeader],
          requestBody: jsonBody(ref('TaskInput')),
        }),
      },
      '/tasks/{id}': {
        get: op('Detalhe com campos do tipo, valores e capacidades (404 sem acesso)', ['tasks'], { 200: ok('Tarefa', ref('TaskDetail')), 404: errorResponse('TASK_NOT_FOUND') }, {
          parameters: [idParam],
        }),
        patch: op('Atualiza (parcial); null limpa responsável, relator, prazo e horas; project_id é imutável', ['tasks'], { 200: ok('Atualizada', ref('TaskDetail')) }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody(ref('TaskInput')),
        }),
        delete: op('Exclui (tasks.delete + gestor do projeto ou autor)', ['tasks'], { 200: ok('Excluída', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/tasks/{id}/it-visible': {
        put: op('Marca a tarefa como visível para o Responsável TI do projeto (§36); quem edita a tarefa (não o próprio Responsável TI); não exige os obrigatórios do status', ['tasks'], {
          200: ok('Tarefa', ref('TaskDetail')),
          403: errorResponse('FORBIDDEN'),
          404: errorResponse('TASK_NOT_FOUND'),
        }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['it_visible'], properties: { it_visible: { type: 'boolean' } } }),
        }),
      },
      '/tasks/{id}/report': {
        put: op('Liga/desliga a tarefa no informe do projeto (aba Informe); quem edita a tarefa e tem a seção Informe (projects.report, §35); não exige os obrigatórios do status', ['tasks'], {
          200: ok('Tarefa', ref('TaskDetail')),
          403: errorResponse('FORBIDDEN'),
          404: errorResponse('TASK_NOT_FOUND'),
        }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['in_report'], properties: { in_report: { type: 'boolean' } } }),
        }),
      },
      '/tasks/{id}/urgency': {
        put: op('Urgência da tarefa (semáforo alta/média/baixa; null limpa); quem edita a tarefa; não exige os obrigatórios do status', ['tasks'], {
          200: ok('Tarefa', ref('TaskDetail')),
          404: errorResponse('TASK_NOT_FOUND'),
        }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['urgency'], properties: { urgency: { type: ['string', 'null'], enum: ['high', 'medium', 'low', null] } } }),
        }),
      },
      '/tasks/{id}/area': {
        put: op('Área responsável da tarefa (null limpa); quem edita a tarefa; não exige os obrigatórios do status', ['tasks'], {
          200: ok('Tarefa', ref('TaskDetail')),
          404: errorResponse('TASK_NOT_FOUND'),
        }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['area_id'], properties: { area_id: { type: ['string', 'null'], description: 'área ativa de /areas' } } }),
        }),
      },
      '/tasks/{id}/copy': {
        post: op(
          '"Com cópia" numa tarefa que já existe (tarefa de projeto ou demanda interna): manda o aviso da tarefa aos endereços, uma vez — o mesmo e-mail da abertura (código e título no assunto, a descrição no corpo); quem edita a tarefa; não exige os obrigatórios do status; o histórico guarda para quem foi. Devolve copy_to = endereços que entraram na fila (vazio com o envio de e-mails desligado). Erros em fields.cc_emails: required, invalid_type, invalid_email, too_many',
          ['tasks'],
          {
            200: ok('Endereços que receberam', { type: 'object', properties: { copy_to: { type: 'array', items: { type: 'string', format: 'email' } } } }),
            400: errorResponse('VALIDATION_ERROR'),
            403: errorResponse('FORBIDDEN'),
            404: errorResponse('TASK_NOT_FOUND'),
          },
          {
            parameters: [idParam, csrfHeader],
            requestBody: jsonBody({ type: 'object', required: ['cc_emails'], properties: { cc_emails: COPY_EMAILS } }),
          },
        ),
      },
      '/demands': {
        get: op(
          'Demandas de uma caixa (§45; tasks.view): box = received (recebidas por mim como responsável), assigned (atribuídas a mim), requested (pedidas por mim) ou all (Todas: todas as demandas internas e tarefas de projeto com responsável — só com projects.view_all; sem ela, 403 FORBIDDEN); status = passos separados por vírgula (unassigned, assigned, in_progress, to_validate, done); owner_id e assignee_id filtram pelo responsável e por quem executa. Mais recentes primeiro; até 100 por página. Cada item é um resumo de tarefa com project (null na demanda interna) e demand = { status, owner, due_at, opened_at }',
          ['demands'],
          { 200: ok('Página de demandas', { type: 'array', items: ref('Task') }, true), 400: errorResponse('VALIDATION_ERROR'), 403: errorResponse('FORBIDDEN') },
          {
            parameters: [
              { name: 'box', in: 'query', required: true, schema: { type: 'string', enum: ['received', 'assigned', 'requested', 'all'] } },
              { name: 'status', in: 'query', schema: { type: 'string' } },
              { name: 'owner_id', in: 'query', schema: { type: 'string' }, description: 'Só as demandas desse responsável' },
              { name: 'assignee_id', in: 'query', schema: { type: 'string' }, description: 'Só as demandas atribuídas a essa pessoa' },
              { name: 'company_id', in: 'query', schema: { type: 'string' }, description: 'Só as demandas dessa empresa (§46; a da demanda interna ou a do projeto); none = sem empresa' },
              { name: 'project_id', in: 'query', schema: { type: 'string' }, description: 'Só as desse projeto; internal = só as demandas internas' },
              { name: 'priority_id', in: 'query', schema: { type: 'string' }, description: 'Prioridades separadas por vírgula' },
              { name: 'urgency', in: 'query', schema: { type: 'string' }, description: 'high, medium, low ou none (sem urgência), separadas por vírgula' },
              { name: 'search', in: 'query', schema: { type: 'string', maxLength: 100 }, description: 'Título ou código' },
              { name: 'page', in: 'query', schema: { type: 'integer' } },
              { name: 'perPage', in: 'query', schema: { type: 'integer', maximum: 100 } },
            ],
          },
        ),
        post: op(
          'Abre uma demanda interna, tarefa sem projeto (§45; tasks.create): nasce "Sem atribuir", numerada DEM-n, sem executor e sem prazo (o responsável define ao atribuir); a abertura é automática. O responsável recebe a notificação demand_received. Campos de fluxo (assignee_id, due_date, status_id…) enviados aqui são ignorados. custom_values = campos do tipo, com as regras de POST /tasks (padrões dos visíveis; obrigatórios sempre e do status em que nasce). Erros em fields: required, invalid_option (tipo, departamento ou prioridade inativos; responsável inexistente, inativo ou sem tasks.view) e custom_values.<nome> (required, unknown_field, invalid_option…; details.status = status considerado)',
          ['demands'],
          { 201: ok('Criada', ref('TaskDetail')), 400: errorResponse('VALIDATION_ERROR'), 403: errorResponse('FORBIDDEN') },
          {
            parameters: [csrfHeader],
            requestBody: jsonBody({
              type: 'object',
              required: ['task_type_id', 'title', 'demand_owner_id', 'area_id'],
              properties: {
                task_type_id: { type: 'string' },
                title: { type: 'string', maxLength: 200 },
                description: { type: 'string', maxLength: 50000, description: 'Markdown simples' },
                demand_owner_id: { type: 'string', description: 'Responsável: qualquer pessoa ativa (GET /demands/owners); recebe e distribui à equipe dela' },
                cc_emails: COPY_EMAILS,
                area_id: { type: 'string', description: 'Departamento que pede (área ativa de /areas)' },
                priority_id: { type: 'string', description: 'sem ela, a prioridade padrão' },
                urgency: { type: 'string', enum: ['high', 'medium', 'low'], nullable: true, description: 'Urgência (§31, semáforo); sem ela, nasce sem urgência' },
                company_id: { type: 'string', description: 'Empresa (§46): ativa de /companies; obrigatória quando existe alguma empresa ativa (required)' },
                custom_values: { type: 'object', description: 'campos do tipo por nome técnico (os mesmos da tarefa de projeto)', additionalProperties: true },
              },
            }),
          },
        ),
      },
      '/demands/overview': {
        get: op(
          'Números da Bandeja (§45): counts.received|assigned|requested = { unassigned, assigned, in_progress, to_validate, done } de quem consulta; pending = o selo da aba Bandeja e do menu Tarefas (o que espera por quem consulta: received.unassigned + assigned.assigned + assigned.in_progress + requested.to_validate) e team = carga da equipe [{ user, open_count, estimated_hours }] — as outras pessoas da área de quem consulta (Dependências por área) e quem executa as demandas que ela recebeu; conta atribuídas e em andamento. Com projects.view_all, também counts.all (todas as demandas, caixa Todas) e all_team (Carga das equipes: todas as pessoas com demandas atribuídas ou em andamento, no mesmo formato); sem ela, as duas chaves não vêm',
          ['demands'],
          { 200: ok('Resumo', { type: 'object' }) },
        ),
      },
      '/demands/owners': {
        get: op('Responsáveis possíveis no formulário de demanda e no campo "Responsável (recebe e distribui)" da tarefa (tasks.create): pessoas ativas, até 500, pela busca em nome ou e-mail', ['demands'], { 200: ok('Pessoas', { type: 'array', items: ref('UserSummary') }) }, {
          parameters: [{ name: 'search', in: 'query', schema: { type: 'string', maxLength: 100 } }],
        }),
      },
      '/demands/{id}/team': {
        get: op(
          'Quem pode receber a demanda (diálogos Atribuir e Passar a…): o responsável e quem tem projects.view_all veem a equipe do responsável (ele incluído); quem executa vê a mesma lista sem ele. Responsável fora de área: as pessoas ativas. Outros: FORBIDDEN',
          ['demands'],
          { 200: ok('Pessoas', { type: 'array', items: ref('UserSummary') }), 403: errorResponse('FORBIDDEN'), 404: errorResponse('TASK_NOT_FOUND') },
          { parameters: [idParam] },
        ),
      },
      '/demands/{id}/assign': {
        post: op(
          'O responsável (ou quem tem projects.view_all, em qualquer demanda) atribui ou reatribui (Sem atribuir, Atribuída ou Em andamento): quem executa (equipe do responsável — fields.assignee_id = not_in_team fora dela), prazo com data e hora (due_at, obrigatório) e estimativa em horas (ausente mantém; null limpa) e indicações para quem executa (comment, opcional, até 5000 caracteres; vão no histórico como note e no aviso). Trocar a pessoa volta para Atribuída; histórico task.demand_assigned/task.demand_reassigned; notificação assigned para quem recebe',
          ['demands'],
          { 200: ok('Demanda', ref('TaskDetail')), 400: errorResponse('VALIDATION_ERROR'), 403: errorResponse('FORBIDDEN'), 409: errorResponse('DEMAND_STATE_CONFLICT') },
          {
            parameters: [idParam, csrfHeader],
            requestBody: jsonBody({
              type: 'object',
              required: ['assignee_id', 'due_at'],
              properties: { assignee_id: { type: 'string' }, due_at: { type: 'string', format: 'date-time' }, estimated_hours: { type: ['number', 'null'], exclusiveMinimum: 0 }, comment: { type: 'string', maxLength: 5000 } },
            }),
          },
        ),
      },
      '/demands/{id}/start': {
        post: op('Quem executa começa (Atribuída → Em andamento); histórico task.demand_started', ['demands'], { 200: ok('Demanda', ref('TaskDetail')), 403: errorResponse('FORBIDDEN'), 409: errorResponse('DEMAND_STATE_CONFLICT') }, {
          parameters: [idParam, csrfHeader],
        }),
      },
      '/demands/{id}/pass': {
        post: op(
          'Quem executa passa a outra pessoa da equipe do responsável, com comentário obrigatório (comment): volta para Atribuída; quem passou continua vendo; avisa quem recebe (assigned) e o responsável (demand_passed); histórico task.demand_passed com a nota. fields.assignee_id: not_in_team, same_assignee',
          ['demands'],
          { 200: ok('Demanda', ref('TaskDetail')), 400: errorResponse('VALIDATION_ERROR'), 403: errorResponse('FORBIDDEN'), 409: errorResponse('DEMAND_STATE_CONFLICT') },
          {
            parameters: [idParam, csrfHeader],
            requestBody: jsonBody({ type: 'object', required: ['assignee_id', 'comment'], properties: { assignee_id: { type: 'string' }, comment: { type: 'string', maxLength: 5000 } } }),
          },
        ),
      },
      '/demands/{id}/conclude': {
        post: op(
          'Quem executa conclui com o comentário do que foi entregue (obrigatório) → Para validar; avisa quem pediu e o responsável (demand_concluded); histórico task.demand_concluded',
          ['demands'],
          { 200: ok('Demanda', ref('TaskDetail')), 400: errorResponse('VALIDATION_ERROR'), 403: errorResponse('FORBIDDEN'), 409: errorResponse('DEMAND_STATE_CONFLICT') },
          { parameters: [idParam, csrfHeader], requestBody: jsonBody({ type: 'object', required: ['comment'], properties: { comment: { type: 'string', maxLength: 5000 } } }) },
        ),
      },
      '/demands/{id}/validate': {
        post: op('Quem pediu valida a entrega (Para validar → Concluída); avisa quem executa e o responsável (demand_validated)', ['demands'], {
          200: ok('Demanda', ref('TaskDetail')),
          403: errorResponse('FORBIDDEN'),
          409: errorResponse('DEMAND_STATE_CONFLICT'),
        }, { parameters: [idParam, csrfHeader] }),
      },
      '/demands/{id}/return': {
        post: op(
          'Quem pediu devolve com comentário obrigatório (Para validar → Em andamento); avisa quem executa e o responsável (demand_returned); histórico task.demand_returned',
          ['demands'],
          { 200: ok('Demanda', ref('TaskDetail')), 400: errorResponse('VALIDATION_ERROR'), 403: errorResponse('FORBIDDEN'), 409: errorResponse('DEMAND_STATE_CONFLICT') },
          { parameters: [idParam, csrfHeader], requestBody: jsonBody({ type: 'object', required: ['comment'], properties: { comment: { type: 'string', maxLength: 5000 } } }) },
        ),
      },
      '/tasks/{id}/history': {
        get: op('Histórico da tarefa com valores legíveis', ['tasks'], { 200: ok('Registros', { type: 'array', items: ref('AuditEntry') }, true) }, { parameters: [idParam] }),
      },
      '/tasks/{id}/comments': {
        get: op('Comentários da tarefa (excluídos aparecem sem texto)', ['comments'], { 200: ok('Comentários', { type: 'array', items: ref('Comment') }) }, { parameters: [idParam] }),
        post: op('Comenta (qualquer pessoa com acesso ao projeto, inclusive leitor); menções: @[Nome](idDoUsuario)', ['comments'], {
          201: ok('Criado', ref('Comment')),
          404: errorResponse('TASK_NOT_FOUND'),
        }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['content'], properties: { content: { type: 'string', maxLength: 10000 } } }),
        }),
      },
      '/tasks/{id}/mention-candidates': {
        get: op('Pessoas que podem ser mencionadas: todas as ativas da plataforma; outside = ainda não vê a tarefa (mencionada num comentário, passa a ver e comentar só essa tarefa, sem editar, enquanto o comentário existir)', ['comments'], { 200: ok('Pessoas', { type: 'array', items: { allOf: [ref('UserSummary'), { type: 'object', properties: { outside: { type: 'boolean' } } }] } }) }, { parameters: [idParam] }),
      },
      '/comments/{id}': {
        patch: op('Edita o próprio comentário', ['comments'], { 200: ok('Atualizado', ref('Comment')), 404: errorResponse('COMMENT_NOT_FOUND') }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['content'], properties: { content: { type: 'string', maxLength: 10000 } } }),
        }),
        delete: op('Exclui (autor ou gestor do projeto; exclusão lógica)', ['comments'], { 200: ok('Excluído', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/tasks/{id}/attachments': {
        get: op('Anexos da tarefa', ['attachments'], { 200: ok('Anexos', { type: 'array', items: ref('Attachment') }) }, { parameters: [idParam] }),
        post: op(
          'Anexa arquivos (tasks.edit + colaborador). Tipo decidido pelo CONTEÚDO; até 20 MB por arquivo; imagens PNG/JPEG/GIF/WebP, PDF, Office, ZIP e texto (SVG/HTML recusados)',
          ['attachments'],
          { 201: ok('Anexados', { type: 'array', items: ref('Attachment') }) },
          {
            parameters: [idParam, csrfHeader],
            requestBody: {
              required: true,
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    required: ['files'],
                    properties: {
                      files: { type: 'array', items: { type: 'string', format: 'binary' } },
                      field: { type: 'string', description: 'nome técnico de um campo de imagem/arquivo do tipo (os anexos entram nele)' },
                      comment_id: { type: 'string', description: 'anexo do comentário (só o autor; vale a regra de comentar — inclusive leitor)' },
                    },
                  },
                },
              },
            },
          },
        ),
      },
      '/attachments/{id}/file': {
        get: op('Baixa/visualiza o arquivo (confere acesso ao projeto; nosniff + CSP sandbox; ?download=1 força download)', ['attachments'], {
          200: { description: 'Conteúdo do arquivo', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
          404: errorResponse('ATTACHMENT_NOT_FOUND'),
        }, { parameters: [idParam, { name: 'download', in: 'query', schema: { type: 'string', enum: ['1'] } }] }),
      },
      '/attachments/{id}': {
        delete: op('Exclui (quem enviou ou gestor); sai também dos campos de imagem/arquivo', ['attachments'], { 200: ok('Excluído', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/projects/{id}/files': {
        get: op('Arquivos do projeto (fora das tarefas), mais recentes primeiro — quem vê o projeto', ['attachments'], {
          200: ok('Arquivos', { type: 'array', items: ref('ProjectFile') }),
          404: errorResponse('PROJECT_NOT_FOUND'),
        }, { parameters: [idParam] }),
        post: op(
          'Envia arquivos ao projeto (tasks.edit + colaborador; projeto arquivado → 409). Mesmos tipos e limites dos anexos: tipo decidido pelo CONTEÚDO, até 20 MB por arquivo e 10 por envio',
          ['attachments'],
          { 201: ok('Enviados', { type: 'array', items: ref('ProjectFile') }), 403: errorResponse('FORBIDDEN'), 409: errorResponse('PROJECT_ARCHIVED') },
          {
            parameters: [idParam, csrfHeader],
            requestBody: {
              required: true,
              content: { 'multipart/form-data': { schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } } } } },
            },
          },
        ),
      },
      '/project-files/{id}/file': {
        get: op('Baixa/visualiza o arquivo do projeto (confere acesso ao projeto; nosniff + CSP sandbox; ?download=1 força download)', ['attachments'], {
          200: { description: 'Conteúdo do arquivo', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
          404: errorResponse('PROJECT_FILE_NOT_FOUND'),
        }, { parameters: [idParam, { name: 'download', in: 'query', schema: { type: 'string', enum: ['1'] } }] }),
      },
      '/project-files/{id}': {
        delete: op('Exclui o arquivo do projeto (quem enviou ou gestor)', ['attachments'], { 200: ok('Excluído', { type: 'object' }), 404: errorResponse('PROJECT_FILE_NOT_FOUND') }, { parameters: [idParam, csrfHeader] }),
      },
      '/board': {
        get: op('Quadro Kanban de todos os projetos abertos que a pessoa vê (membro, dono ou projects.view_all): mesmas colunas, total somando os projetos; cada card traz o projeto e capabilities.move (permissão no projeto do card)', ['kanban'], {
          200: ok('Quadro (project: null; projects: os projetos incluídos)', ref('Board')),
          400: errorResponse('VALIDATION_ERROR'),
          403: errorResponse('FORBIDDEN'),
        }, { parameters: [{ name: 'project_ids', in: 'query', schema: { type: 'string' }, description: 'restringe aos projetos indicados (ids separados por vírgula, até 200); id que a pessoa não vê é ignorado' }] }),
      },
      '/projects/{id}/board': {
        get: op('Quadro Kanban do projeto: colunas = status ativos (WIP, destinos permitidos, total) com cards na ordem manual', ['kanban'], {
          200: ok('Quadro', ref('Board')),
          404: errorResponse('PROJECT_NOT_FOUND'),
        }, { parameters: [idParam] }),
      },
      '/tasks/{id}/move': {
        post: op('Move o card: coluna (status) e posição entre prev_id (acima) e next_id (abaixo). Transição proibida → 409', ['kanban'], {
          200: ok('Tarefa', ref('TaskDetail')),
          409: errorResponse('TRANSITION_NOT_ALLOWED'),
        }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', properties: { status_id: { type: 'string' }, prev_id: { type: 'string' }, next_id: { type: 'string' } } }),
        }),
      },
      '/projects/{id}/backlog': {
        get: op('Backlog do projeto: tarefas em status da categoria backlog, na ordem de prioridade, com sprints abertas e capabilities (rank, create, manage_sprints)', ['backlog'], {
          200: ok('Backlog', ref('Backlog')),
          404: errorResponse('PROJECT_NOT_FOUND'),
        }, { parameters: [idParam] }),
      },
      '/tasks/{id}/rank': {
        post: op('Prioriza no backlog: posição entre prev_id e next_id; sprint_id troca a sprint (null = sem sprint). Fora do backlog → 409', ['backlog'], {
          200: ok('Tarefa', ref('TaskDetail')),
          409: errorResponse('NOT_IN_BACKLOG'),
        }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', properties: { prev_id: { type: 'string' }, next_id: { type: 'string' }, sprint_id: { type: ['string', 'null'] } } }),
        }),
      },
      '/projects/{id}/sprints': {
        get: op('Sprints do projeto (encerrados só com include_closed=1)', ['backlog'], { 200: ok('Sprints', { type: 'array', items: ref('Sprint') }) }, {
          parameters: [idParam, { name: 'include_closed', in: 'query', schema: { type: 'string', enum: ['1'] } }],
        }),
        post: op('Cria sprint (gestor do projeto)', ['backlog'], { 201: ok('Criado', ref('Sprint')) }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody(ref('SprintInput')),
        }),
      },
      '/projects/{id}/sprints/order': {
        put: op('Reordena as sprints abertas (gestor do projeto); exige a lista completa de ids', ['backlog'], {
          200: ok('Sprints', { type: 'array', items: ref('Sprint') }),
        }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'string' } } } }),
        }),
      },
      '/sprints/{id}': {
        patch: op('Atualiza sprint; state=closed devolve ao backlog (sem sprint) as tarefas não encerradas e informa returned_count', ['backlog'], {
          200: ok('Atualizado', ref('Sprint')),
          404: errorResponse('SPRINT_NOT_FOUND'),
        }, { parameters: [idParam, csrfHeader], requestBody: jsonBody(ref('SprintInput')) }),
        delete: op('Exclui sprint; as tarefas ficam sem sprint (com histórico)', ['backlog'], { 200: ok('Excluído', { type: 'object' }), 404: errorResponse('SPRINT_NOT_FOUND') }, {
          parameters: [idParam, csrfHeader],
        }),
      },
      '/tasks/{id}/relations': {
        get: op('Pai, subtarefas (com progresso), origem do fork, forks e relações da tarefa — cada relação no ponto de vista desta tarefa', ['relations'], {
          200: ok('Relacionamentos', ref('TaskRelations')),
          404: errorResponse('TASK_NOT_FOUND'),
        }, { parameters: [idParam] }),
        post: op('Cria relação (tasks.link + colaborador). type: relates, blocks, blocked_by, duplicates, duplicated_by, depends_on, dependency_of. Repetida → 409 RELATION_EXISTS; ciclo de bloqueio/dependência → 409 RELATION_CYCLE', ['relations'], {
          201: ok('Relação', ref('TaskRelation')),
          409: errorResponse('RELATION_EXISTS'),
        }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['type', 'target_id'], properties: { type: { type: 'string', enum: ['relates', 'blocks', 'blocked_by', 'duplicates', 'duplicated_by', 'depends_on', 'dependency_of'] }, target_id: { type: 'string' } } }),
        }),
      },
      '/relations/{id}': {
        delete: op('Desfaz a relação (tasks.link em qualquer um dos lados)', ['relations'], { 200: ok('Excluída', { type: 'object' }), 404: errorResponse('RELATION_NOT_FOUND') }, {
          parameters: [idParam, csrfHeader],
        }),
      },
      '/tasks/{id}/fork': {
        post: op('Fork (tasks.fork): nova tarefa no mesmo tipo, com a origem em forked_from; copy escolhe o que copiar (padrão: descrição, tags, campos e checklist; anexos e relações não)', ['relations'], {
          201: ok('Nova tarefa', ref('TaskDetail')),
        }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              title: { type: 'string', maxLength: 200 },
              project_id: { type: 'string', description: 'padrão: o projeto da origem' },
              copy: {
                type: 'object',
                properties: {
                  description: { type: 'boolean' },
                  tags: { type: 'boolean' },
                  custom_values: { type: 'boolean' },
                  checklist: { type: 'boolean', description: 'itens voltam a ficar pendentes' },
                  attachments: { type: 'boolean' },
                  relations: { type: 'boolean' },
                },
              },
            },
          }),
        }),
      },
      '/reports': {
        get: op('Indicadores e relatórios (reports.view) no escopo visível; sem projetos arquivados, salvo se escolhido em project_id. Inclui as demandas internas que a pessoa enxerga (§45; fora com project_id), sob o rótulo de projeto com kind = demands. Período padrão: últimos 30 dias', ['reports'], {
          200: ok('Relatório', ref('Report')),
          404: errorResponse('PROJECT_NOT_FOUND'),
        }, {
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'até 366 dias depois de from' },
            { name: 'tz_offset', in: 'query', schema: { type: 'integer', minimum: -840, maximum: 840 }, description: 'minutos de Date#getTimezoneOffset (Brasília = 180): define "hoje" e os dias da série' },
            { name: 'group_by', in: 'query', schema: { type: 'string', enum: ['status', 'priority', 'type', 'assignee', 'project'] } },
            { name: 'project_id', in: 'query', schema: { type: 'string' } },
            { name: 'assignee_id', in: 'query', schema: { type: 'string' }, description: 'id, me ou none' },
            { name: 'task_type_id', in: 'query', schema: { type: 'string' } },
            { name: 'priority_id', in: 'query', schema: { type: 'string' } },
            { name: 'status_id', in: 'query', schema: { type: 'string' } },
          ],
        }),
      },
      '/projects/{id}/plan': {
        get: op(
          'Quadro do projeto (Gerenciamento — à parte das tarefas; acesso ao projeto + plan.view): grupos numerados (1.0, 2.1…) com o rodapé de totais (distribuição de status, período, soma do esforço e da duração, progresso), etiquetas de status e de recursos, elementos e subelementos (com duração efetiva e progresso calculado {value, source}). Quadro novo nasce com as etiquetas de status iniciais. Capacidades: edit, manage',
          ['plan'],
          { 200: ok('Quadro', ref('Plan')), 404: errorResponse('PROJECT_NOT_FOUND') },
          { parameters: [idParam] },
        ),
      },
      '/projects/{id}/groups': {
        get: op('Grupos do quadro na ordem, numerados', ['plan'], { 200: ok('Grupos', { type: 'array', items: ref('ProjectGroup') }) }, { parameters: [idParam] }),
        post: op('Cria grupo (plan.manage + gestor/dono): { name*, color, parent_id } — até 2 níveis (too_deep); entra no fim', ['plan'], { 201: ok('Grupo', ref('ProjectGroup')) }, { parameters: [idParam, csrfHeader], requestBody: jsonBody(ref('ProjectGroupInput')) }),
      },
      '/groups/{id}': {
        patch: op('Renomeia/muda a cor', ['plan'], { 200: ok('Grupo', ref('ProjectGroup')), 404: errorResponse('GROUP_NOT_FOUND') }, { parameters: [idParam, csrfHeader], requestBody: jsonBody(ref('ProjectGroupInput')) }),
        delete: op('Exclui o grupo, os subgrupos e os elementos deles', ['plan'], { 200: ok('Excluído', { type: 'object', properties: { deleted: { type: 'integer' }, items: { type: 'integer' } } }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/groups/{id}/move': {
        put: op('Reordena/muda de nível: { parent_id, prev_id | next_id } (sem vizinho = fim)', ['plan'], { 200: ok('Grupo', ref('ProjectGroup')) }, { parameters: [idParam, csrfHeader] }),
      },
      '/groups/{id}/duplicate': {
        post: op('Duplica logo depois do original, com subgrupos, elementos e subelementos (mesmos valores)', ['plan'], { 201: ok('Grupo', ref('ProjectGroup')) }, { parameters: [idParam, csrfHeader] }),
      },
      '/projects/{id}/plan/items': {
        post: op('Cria elemento ({ group_id* }) ou subelemento ({ parent_id* }, segue o grupo do pai) — plan.edit + colaborador', ['plan'], { 201: ok('Elemento', ref('PlanItem')) }, { parameters: [idParam, csrfHeader], requestBody: jsonBody(ref('PlanItemInput')) }),
      },
      '/plan/items/{id}': {
        get: op('Elemento/subelemento', ['plan'], { 200: ok('Elemento', ref('PlanItem')), 404: errorResponse('PLAN_ITEM_NOT_FOUND') }, { parameters: [idParam] }),
        patch: op('Edição direta (parcial); null limpa; group_id move o elemento (subelementos acompanham; subelemento → follows_parent)', ['plan'], { 200: ok('Elemento', ref('PlanItem')) }, { parameters: [idParam, csrfHeader], requestBody: jsonBody(ref('PlanItemInput')) }),
        delete: op('Exclui o elemento e os subelementos', ['plan'], { 200: ok('Excluído', { type: 'object', properties: { deleted: { type: 'integer' } } }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/projects/{id}/plan/statuses': {
        post: op('Cria etiqueta de status (plan.manage): { name*, color, category }', ['plan'], { 201: ok('Etiqueta', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/plan/statuses/{id}': {
        patch: op('Edita etiqueta de status', ['plan'], { 200: ok('Etiqueta', { type: 'object' }), 404: errorResponse('PLAN_STATUS_NOT_FOUND') }, { parameters: [idParam, csrfHeader] }),
        delete: op('Exclui a etiqueta (os elementos ficam em branco)', ['plan'], { 200: ok('Excluída', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/projects/{id}/plan/resources': {
        post: op('Cria etiqueta de recurso (plan.edit): { name*, color } — nome único no quadro (PLAN_RESOURCE_NAME_IN_USE)', ['plan'], { 201: ok('Etiqueta', { type: 'object' }), 409: errorResponse('PLAN_RESOURCE_NAME_IN_USE') }, { parameters: [idParam, csrfHeader] }),
      },
      '/plan/items/{id}/move': {
        put: op('Arrastar/mover (plan.edit): { group_id?, prev_id | next_id } — reordena entre os irmãos; no elemento, troca de grupo com os subelementos (subelemento → follows_parent)', ['plan'], { 200: ok('Elemento', ref('PlanItem')) }, { parameters: [idParam, csrfHeader] }),
      },
      '/plan/items/{id}/duplicate': {
        post: op('Duplica logo depois do original, com os subelementos (sem as dependências)', ['plan'], { 201: ok('Cópia', ref('PlanItem')) }, { parameters: [idParam, csrfHeader] }),
      },
      '/projects/{id}/plan/items/bulk': {
        post: op(
          'Seleção em massa (até 200; tudo ou nada): { ids*, action*: update (status_id, add_resource_ids, remove_resource_ids) | move (group_id) | duplicate | delete }',
          ['plan'],
          { 200: ok('Resultado', { type: 'object', description: '{ updated | moved | duplicated | deleted }' }), 409: errorResponse('PLAN_DEPENDENCY_PENDING') },
          { parameters: [idParam, csrfHeader] },
        ),
      },
      '/plan/items/{id}/links': {
        post: op('Dependência (plan.edit): { type*: depends_on | blocks | relates, item_id* } — item_id: self | duplicate | cycle', ['plan'], { 201: ok('Ligação', ref('PlanLink')) }, { parameters: [idParam, csrfHeader] }),
      },
      '/plan/links/{id}': {
        delete: op('Desfaz a dependência', ['plan'], { 200: ok('Excluída', { type: 'object' }), 404: errorResponse('PLAN_LINK_NOT_FOUND') }, { parameters: [idParam, csrfHeader] }),
      },
      '/projects/{id}/plan/settings': {
        patch: op('Regra de dependência do quadro (plan.manage + gestor): { dependency_rule*: warn | block }', ['plan'], { 200: ok('Configuração', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/projects/{id}/plan/import': {
        post: op(
          'Importa elementos (até 500 linhas; tudo ou nada): { rows*: [{ group*, name*, parent, status, start_date, end_date, resources[], estimated_hours, actual_hours, duration_days, progress }] } — erros em error.details.rows { índice: { campo: código } }',
          ['plan'],
          { 201: ok('Criados', { type: 'object', description: '{ created: { groups, statuses, resources, items, subitems } }' }) },
          { parameters: [idParam, csrfHeader] },
        ),
      },
      '/plan/items/{id}/updates': {
        get: op('Atualizações do elemento (quem vê o quadro): { updates: [principal com replies[]], capabilities: { post } } — principais da mais nova para a mais antiga', ['plan'], { 200: ok('Atualizações', { type: 'object' }), 404: errorResponse('PLAN_ITEM_NOT_FOUND') }, { parameters: [idParam] }),
        post: op('Publica (quem vê o quadro, projeto aberto — inclusive leitor): JSON { content* (Markdown, @[Nome](id)), parent_id (resposta, um nível) } ou multipart com os mesmos campos + "files" (imagens coladas/anexadas: até 10, 20 MB cada, 50 MB no total; tipo pelo conteúdo; tudo ou nada — com arquivo o texto pode ficar vazio) — menção notifica (plan_mention), resposta avisa o autor (plan_reply)', ['plan'], { 201: ok('Atualização', ref('PlanUpdate')) }, { parameters: [idParam, csrfHeader] }),
      },
      '/plan/updates/{id}': {
        patch: op('Edita (só o autor): { content* } (vazio só se a atualização tem arquivo)', ['plan'], { 200: ok('Atualização', ref('PlanUpdate')), 404: errorResponse('PLAN_UPDATE_NOT_FOUND') }, { parameters: [idParam, csrfHeader] }),
        delete: op('Exclui (autor ou gestor): exclusão lógica, os arquivos dela são apagados, as respostas ficam', ['plan'], { 200: ok('Excluída', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/plan/items/{id}/mention-candidates': {
        get: op('Pessoas que podem ser mencionadas (participantes ativos do projeto)', ['plan'], { 200: ok('Pessoas', { type: 'array', items: ref('UserSummary') }) }, { parameters: [idParam] }),
      },
      '/plan/updates/{id}/files': {
        post: op('O autor anexa mais à atualização: multipart "files" (até 10, 20 MB cada, 50 MB no total; tipo pelo conteúdo)', ['plan'], { 201: ok('Arquivos', { type: 'array', items: ref('PlanFile') }), 404: errorResponse('PLAN_UPDATE_NOT_FOUND') }, { parameters: [idParam, csrfHeader] }),
      },
      '/plan/files/{id}/file': {
        get: op('Download/visualização (protegido: confere acesso; nosniff; CSP sandbox)', ['plan'], { 200: { description: 'Arquivo' }, 404: errorResponse('PLAN_FILE_NOT_FOUND') }, { parameters: [idParam] }),
      },
      '/plan/files/{id}': {
        delete: op('Exclui o arquivo da atualização (quem enviou ou o gestor)', ['plan'], { 200: ok('Excluído', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/plan/items/{id}/history': {
        get: op('Histórico do elemento (quem vê o quadro)', ['plan'], { 200: ok('Histórico', { type: 'array', items: { type: 'object' } }) }, { parameters: [idParam] }),
      },
      // quadro — GP-4 (visões e gestão)
      '/projects/{id}/plan/baseline': {
        put: op('Salva a linha de base do Cronograma (gestor): foto do cronograma atual dos elementos → { saved_at, items }', ['plan'], { 200: ok('Linha de base', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
        delete: op('Limpa a linha de base (gestor)', ['plan'], { 200: ok('Limpa', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/projects/{id}/plan/journal': {
        get: op('Diário do projeto (quem vê o quadro): { entries: [JournalEntry], capabilities: { create } } — do dia mais recente', ['plan'], { 200: ok('Diário', { type: 'object' }) }, { parameters: [idParam] }),
        post: op('Registra no diário (plan.edit + colaborador): { entry_date* (AAAA-MM-DD), content* (≤ 5.000) }', ['plan'], { 201: ok('Registro', ref('JournalEntry')) }, { parameters: [idParam, csrfHeader] }),
      },
      '/plan/journal/{id}': {
        patch: op('Edita o registro (autor ou gestor): { entry_date, content }', ['plan'], { 200: ok('Registro', ref('JournalEntry')), 404: errorResponse('PLAN_JOURNAL_NOT_FOUND') }, { parameters: [idParam, csrfHeader] }),
        delete: op('Exclui o registro (autor ou gestor)', ['plan'], { 200: ok('Excluído', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/projects/{id}/plan/issues': {
        get: op('Gestão dos problemas (quem vê o quadro): { issues: [PlanIssue], capabilities: { create } }', ['plan'], { 200: ok('Problemas', { type: 'object' }) }, { parameters: [idParam] }),
        post: op('Abre problema (plan.edit + colaborador): { opened_on*, description* (≤ 2.000), state (in_progress | pending | resolved; padrão pending), owner_id (participante) } — número por projeto que não se repete', ['plan'], { 201: ok('Problema', ref('PlanIssue')) }, { parameters: [idParam, csrfHeader] }),
      },
      '/plan/issues/{id}': {
        patch: op('Atualiza o problema (quem edita o quadro); resolved guarda resolved_on', ['plan'], { 200: ok('Problema', ref('PlanIssue')), 404: errorResponse('PLAN_ISSUE_NOT_FOUND') }, { parameters: [idParam, csrfHeader] }),
        delete: op('Exclui o problema (quem abriu ou o gestor)', ['plan'], { 200: ok('Excluído', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      // quadro — GP-5 (colunas personalizadas)
      '/projects/{id}/plan/columns': {
        post: op('Adiciona coluna (gestor): { name* (≤ 60), type* (text | number | date | checkbox | dropdown | people | link), settings (dropdown: { options: [{ name, color }] }; number: { unit }) } — até 30 por quadro', ['plan'], { 201: ok('Coluna', ref('PlanColumn')) }, { parameters: [idParam, csrfHeader] }),
      },
      '/plan/columns/{id}': {
        patch: op('Renomeia/edita as opções (gestor): { name, settings } — opção removida limpa os valores que a usavam', ['plan'], { 200: ok('Coluna', ref('PlanColumn')), 404: errorResponse('PLAN_COLUMN_NOT_FOUND') }, { parameters: [idParam, csrfHeader] }),
        delete: op('Exclui a coluna e os valores dela (gestor) → { deleted, values }', ['plan'], { 200: ok('Excluída', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/plan/columns/{id}/type': {
        post: op('Altera o tipo (gestor): { type*, settings, dry_run } — converte os valores quando dá; com dry_run devolve { converted, lost } sem gravar', ['plan'], { 200: ok('Coluna ou prévia', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/plan/columns/{id}/duplicate': {
        post: op('Duplica a coluna com os valores (gestor)', ['plan'], { 201: ok('Coluna', ref('PlanColumn')) }, { parameters: [idParam, csrfHeader] }),
      },
      '/projects/{id}/plan/report': {
        get: op('Relatório do quadro (quem vê o quadro): resumo, cronograma, esforço, recursos, grupos e saúde do projeto (pior fator, com os fatores); tz_offset em minutos (−840..840)', ['plan'], { 200: ok('Relatório', { type: 'object' }), 400: errorResponse('VALIDATION_ERROR') }, { parameters: [idParam, { name: 'tz_offset', in: 'query', schema: { type: 'integer' } }] }),
      },
      '/plan/resources/{id}': {
        patch: op('Renomeia/muda a cor (plan.edit)', ['plan'], { 200: ok('Etiqueta', { type: 'object' }), 404: errorResponse('PLAN_RESOURCE_NOT_FOUND') }, { parameters: [idParam, csrfHeader] }),
        delete: op('Exclui (plan.manage); sai dos elementos', ['plan'], { 200: ok('Excluída', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/projects/{id}/timeline': {
        get: op(
          'Timeline do projeto (tasks.view + acesso ao projeto): tarefas (com start_date e due_date), dependências "vem antes → vem depois" com conflito (a tarefa começa antes do prazo da que ela depende), sprints, marcos e capacidades (edit = mover barras; manage_milestones = gestor). Até 2000 tarefas (truncated)',
          ['timeline'],
          { 200: ok('Timeline', ref('Timeline')), 404: errorResponse('PROJECT_NOT_FOUND') },
          { parameters: [idParam] },
        ),
      },
      '/projects/{id}/milestones': {
        get: op('Marcos do projeto (pela data)', ['timeline'], { 200: ok('Marcos', { type: 'array', items: ref('Milestone') }), 404: errorResponse('PROJECT_NOT_FOUND') }, { parameters: [idParam] }),
        post: op('Cria marco (gestor/dono do projeto)', ['timeline'], { 201: ok('Marco', ref('Milestone')), 403: errorResponse('FORBIDDEN'), 404: errorResponse('PROJECT_NOT_FOUND') }, { parameters: [idParam, csrfHeader], requestBody: jsonBody(ref('MilestoneInput')) }),
      },
      '/milestones/{id}': {
        patch: op('Edita marco (gestor/dono)', ['timeline'], { 200: ok('Marco', ref('Milestone')), 404: errorResponse('MILESTONE_NOT_FOUND') }, { parameters: [idParam, csrfHeader], requestBody: jsonBody(ref('MilestoneInput')) }),
        delete: op('Exclui marco (gestor/dono)', ['timeline'], { 200: ok('Excluído', { type: 'object' }), 404: errorResponse('MILESTONE_NOT_FOUND') }, { parameters: [idParam, csrfHeader] }),
      },
      '/projects/{id}/brief': {
        get: op(
          'Resumo do projeto para o Responsável TI (§33): objetivo geral, as tarefas atribuídas a quem pede ou marcadas para TI e os itens da ficha sob a responsabilidade dele; quem vê o projeto também pode pedir',
          ['charter'],
          {
            200: ok('Resumo', {
              type: 'object',
              properties: {
                objective: { type: 'string' },
                tasks: { type: 'array', items: ref('Task') },
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      kind: { type: 'string', enum: ['feature', 'result'] },
                      title: { type: 'string' },
                      description: { type: 'string' },
                      unit: { type: 'string' },
                      target: { type: ['number', 'null'] },
                      due_date: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            }),
            404: errorResponse('PROJECT_NOT_FOUND'),
          },
          { parameters: [idParam] },
        ),
      },
      '/projects/{id}/charter': {
        get: op(
          'Ficha do projeto (quem vê o projeto e tem a seção Ficha, projects.charter — §35; sem ela, 403): objetivo geral, itens com estado calculado (funcionalidades pelas tarefas vinculadas, objetivos pelos vínculos, resultados pela meta e o prazo), completude e resumo',
          ['charter'],
          { 200: ok('Ficha', ref('Charter')), 404: errorResponse('PROJECT_NOT_FOUND') },
          { parameters: [idParam] },
        ),
        put: op('Grava o objetivo geral (gestor/dono)', ['charter'], { 200: ok('Ficha', ref('Charter')), 403: errorResponse('FORBIDDEN') }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['objective'], properties: { objective: { type: 'string', maxLength: 2000 } } }),
        }),
      },
      '/projects/{id}/charter/items': {
        post: op('Cria item da ficha (gestor/dono)', ['charter'], { 201: ok('Item', ref('CharterItem')), 403: errorResponse('FORBIDDEN'), 404: errorResponse('PROJECT_NOT_FOUND') }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody(ref('CharterItemInput')),
        }),
      },
      '/projects/{id}/charter/order': {
        put: op('Nova ordem dos itens de um tipo (gestor/dono)', ['charter'], { 200: ok('Ficha', ref('Charter')) }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({
            type: 'object',
            required: ['kind', 'ids'],
            properties: { kind: { type: 'string', enum: ['objective', 'feature', 'scope_in', 'scope_out', 'result'] }, ids: { type: 'array', items: { type: 'string' } } },
          }),
        }),
      },
      '/charter-items/{id}': {
        patch: op('Edita item da ficha (gestor/dono). O tipo não muda', ['charter'], { 200: ok('Item', ref('CharterItem')), 404: errorResponse('CHARTER_ITEM_NOT_FOUND') }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody(ref('CharterItemInput')),
        }),
        delete: op('Exclui item da ficha (gestor/dono)', ['charter'], { 200: ok('Excluído', { type: 'object' }), 404: errorResponse('CHARTER_ITEM_NOT_FOUND') }, { parameters: [idParam, csrfHeader] }),
      },
      '/charter-items/{id}/measurements': {
        get: op('Medições de um resultado esperado (mais recente primeiro)', ['charter'], { 200: ok('Medições', { type: 'array', items: ref('CharterMeasurement') }), 404: errorResponse('CHARTER_ITEM_NOT_FOUND') }, {
          parameters: [idParam],
        }),
        post: op(
          'Registra medição (gestor/dono ou o responsável pelo resultado). A mais recente vira o valor atual',
          ['charter'],
          { 201: ok('Item', ref('CharterItem')), 403: errorResponse('FORBIDDEN'), 404: errorResponse('CHARTER_ITEM_NOT_FOUND') },
          {
            parameters: [idParam, csrfHeader],
            requestBody: jsonBody({
              type: 'object',
              required: ['value'],
              properties: { value: { type: 'number' }, note: { type: 'string', maxLength: 500 }, measured_at: { type: 'string', format: 'date', description: 'padrão: hoje; não pode ser futura' } },
            }),
          },
        ),
      },
      '/docs/modules': {
        get: op('Módulos da documentação (§43), na ordem da lista, com quantos espaços a pessoa vê em cada um (docs.view)', ['docs'], { 200: ok('Módulos', { type: 'array', items: ref('DocModule') }) }),
        post: op('Cria módulo no fim da lista (docs.manage) — { name*, color }', ['docs'], { 201: ok('Módulo', ref('DocModule')), 409: errorResponse('DOC_MODULE_NAME_IN_USE') }, { parameters: [csrfHeader], requestBody: jsonBody(ref('DocModuleInput')) }),
      },
      '/docs/modules/{id}': {
        patch: op('Renomeia, troca a cor ou reordena (position = novo índice) o módulo (docs.manage)', ['docs'], { 200: ok('Módulo', ref('DocModule')), 404: errorResponse('DOC_MODULE_NOT_FOUND'), 409: errorResponse('DOC_MODULE_NAME_IN_USE') }, { parameters: [idParam, csrfHeader], requestBody: jsonBody(ref('DocModuleInput')) }),
        delete: op('Exclui o módulo (docs.manage); os espaços dele ficam sem módulo', ['docs'], { 200: ok('Excluído', { type: 'object', properties: { deleted: { type: 'boolean' }, spaces: { type: 'integer', description: 'espaços que ficaram sem módulo' } } }), 404: errorResponse('DOC_MODULE_NOT_FOUND') }, { parameters: [idParam, csrfHeader] }),
      },
      '/docs/spaces': {
        get: op('Espaços de documentação que a pessoa lê (docs.view + visibilidade)', ['docs'], { 200: ok('Espaços', { type: 'array', items: ref('DocSpace') }) }),
        post: op('Cria espaço (docs.manage; espaço de projeto exige ser gestor). Nasce com a página inicial publicada', ['docs'], { 201: ok('Espaço', ref('DocSpace')), 409: errorResponse('DOC_SPACE_KEY_IN_USE') }, { parameters: [csrfHeader], requestBody: jsonBody(ref('DocSpaceInput')) }),
      },
      '/docs/spaces/{id}': {
        get: op('Espaço pela CHAVE (ex.: MANUAL), com a árvore de páginas visíveis (rascunhos só para quem edita)', ['docs'], { 200: ok('Espaço e páginas', { type: 'object' }), 404: errorResponse('DOC_SPACE_NOT_FOUND') }, { parameters: [idParam] }),
        patch: op('Configura o espaço (quem gerencia): name, description, icon, color, visibility, module_id ("" / null = Sem módulo) e project_id (outro projeto que a pessoa gerencia, ou "" / null para tirar — aí visibility precisa ser company)', ['docs'], { 200: ok('Espaço', ref('DocSpace')), 404: errorResponse('DOC_SPACE_NOT_FOUND') }, { parameters: [idParam, csrfHeader], requestBody: jsonBody(ref('DocSpaceInput')) }),
        delete: op('Exclui o espaço com páginas, versões e arquivos (quem gerencia)', ['docs'], { 200: ok('Excluído', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/docs/spaces/{id}/pages': {
        post: op('Cria página (rascunho) — { title*, parent_id } (docs.edit)', ['docs'], { 201: ok('Página', ref('DocPage')), 409: errorResponse('DOC_PAGE_TOO_DEEP') }, { parameters: [idParam, csrfHeader] }),
      },
      '/docs/pages/{id}': {
        get: op('Página publicada (ou rascunho, para quem edita), trilha, subpáginas e rascunho pendente', ['docs'], { 200: ok('Página', ref('DocPage')), 404: errorResponse('DOC_PAGE_NOT_FOUND') }, { parameters: [idParam] }),
        delete: op('Exclui a página e as subpáginas (não a inicial)', ['docs'], { 200: ok('Excluídas', { type: 'object', properties: { deleted: { type: 'integer' } } }), 409: errorResponse('DOC_PAGE_IS_HOME') }, { parameters: [idParam, csrfHeader] }),
      },
      '/docs/pages/{id}/draft': {
        get: op('Rascunho para edição (ou o publicado, se não houver)', ['docs'], { 200: ok('Rascunho', { type: 'object' }) }, { parameters: [idParam] }),
        put: op('Salva o rascunho — { title*, content } (JSON do editor, higienizado: blocos/marcações conhecidos, links http(s)/mailto/internos, imagens só de /api/v1/docs/files/{id})', ['docs'], { 200: ok('Salvo', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
        delete: op('Descarta o rascunho', ['docs'], { 200: ok('Descartado', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/docs/pages/{id}/publish': {
        post: op('Publica (rascunho ou { title, content } enviados) e cria a próxima versão', ['docs'], { 200: ok('Página', ref('DocPage')) }, { parameters: [idParam, csrfHeader] }),
      },
      '/docs/pages/{id}/move': {
        put: op('Move na árvore — { parent_id, prev_id | next_id } (sem ciclo; até 8 níveis)', ['docs'], { 200: ok('Página', ref('DocPage')), 409: errorResponse('DOC_PAGE_CYCLE') }, { parameters: [idParam, csrfHeader] }),
      },
      '/docs/pages/{id}/versions': {
        get: op('Versões publicadas (mais recente primeiro)', ['docs'], { 200: ok('Versões', { type: 'array', items: { type: 'object' } }) }, { parameters: [idParam] }),
      },
      '/docs/pages/{id}/versions/{version}': {
        get: op('Conteúdo de uma versão', ['docs'], { 200: ok('Versão', { type: 'object' }), 404: errorResponse('DOC_VERSION_NOT_FOUND') }, { parameters: [idParam, { name: 'version', in: 'path', required: true, schema: { type: 'integer' } }] }),
      },
      '/docs/pages/{id}/versions/{version}/restore': {
        post: op('Restaura a versão (publica o conteúdo dela como a próxima versão)', ['docs'], { 200: ok('Página', ref('DocPage')) }, { parameters: [idParam, { name: 'version', in: 'path', required: true, schema: { type: 'integer' } }, csrfHeader] }),
      },
      '/docs/pages/{id}/files': {
        post: op('Envia imagens/arquivos da página (multipart "files"; tipo conferido pelo conteúdo; até 20 MB cada)', ['docs'], { 201: ok('Arquivos', { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, kind: { type: 'string' }, url: { type: 'string' } } } }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/docs/pages/{id}/tasks': {
        get: op('Tarefas vinculadas à página (só as que a pessoa vê; mesmo formato da lista de tarefas)', ['docs'], { 200: ok('Tarefas', { type: 'array', items: { type: 'object' } }), 404: errorResponse('DOC_PAGE_NOT_FOUND') }, { parameters: [idParam] }),
        post: op('Vincula tarefas à página (quem edita o espaço e vê as tarefas; até 50 por vez; o par repetido é ignorado). Devolve a lista atualizada', ['docs'], { 200: ok('Tarefas', { type: 'array', items: { type: 'object' } }), 404: errorResponse('TASK_NOT_FOUND') }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['task_ids'], properties: { task_ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 } } }),
        }),
      },
      '/docs/pages/{id}/tasks/{taskId}': {
        delete: op('Desvincula a tarefa da página (quem edita o espaço)', ['docs'], { 200: ok('Desvinculada', { type: 'object', properties: { deleted: { type: 'boolean' } } }) }, {
          parameters: [idParam, { name: 'taskId', in: 'path', required: true, schema: { type: 'string' } }, csrfHeader],
        }),
      },
      '/docs/pages/{id}/notices': {
        get: op('Avisos sobre a página (§47; quem edita o espaço): o mais recente de cada pessoa — id, user, actor, note, created_at, opened_at (null = ainda não abriu)', ['docs'], { 200: ok('Avisos', { type: 'array', items: { type: 'object' } }), 404: errorResponse('DOC_PAGE_NOT_FOUND') }, { parameters: [idParam] }),
        post: op('Avisa pessoas sobre a página publicada (§47; quem edita o espaço): notificação doc_shared no sino e por e-mail. Só pessoas ativas que leem a página (senão 400 user_ids: no_access); até 20; note até 500 caracteres. Devolve { notified, notices }', ['docs'], { 200: ok('Avisados', { type: 'object' }), 400: errorResponse('VALIDATION_ERROR'), 409: errorResponse('DOC_PAGE_NOT_PUBLISHED') }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['user_ids'], properties: { user_ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 }, note: { type: 'string', maxLength: 500 } } }),
        }),
      },
      '/docs/pages/{id}/notices/candidates': {
        get: op('Quem pode ser avisado sobre a página (§47): pessoas ativas que a leem, fora quem pergunta; suggested = responsável de Desenvolvimento do projeto do espaço (vem primeiro)', ['docs'], { 200: ok('Pessoas', { type: 'array', items: { type: 'object' } }), 409: errorResponse('DOC_PAGE_NOT_PUBLISHED') }, { parameters: [idParam] }),
      },
      '/tasks/{id}/docs': {
        get: op('Páginas de documentação vinculadas à tarefa (só as dos espaços que a pessoa lê): id, title, status, is_home, space, updated_at, linked_at, capabilities.unlink', ['docs'], { 200: ok('Páginas', { type: 'array', items: { type: 'object' } }), 404: errorResponse('TASK_NOT_FOUND') }, { parameters: [idParam] }),
      },
      '/docs/files/{id}': {
        get: op('Arquivo da página (quem vê a página): imagens em linha, demais como anexo; nosniff + CSP sandbox', ['docs'], { 200: { description: 'Arquivo' }, 404: errorResponse('DOC_FILE_NOT_FOUND') }, { parameters: [idParam] }),
      },
      '/docs/search': {
        get: op('Busca no título e no conteúdo publicado dos espaços visíveis (sem acento/maiúsculas; 2 a 100 caracteres), com trecho', ['docs'], { 200: ok('Resultados', { type: 'array', items: { type: 'object' } }) }, { parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }] }),
      },
      '/platform': {
        get: op('Público (sem login): identidade da plataforma — { name, logo_light_url, logo_dark_url, favicon_url } (endereços com ?v= para o cache)', ['platform'], { 200: ok('Identidade', { type: 'object' }) }),
      },
      '/platform/branding/{slot}': {
        get: op('Público: logo claro/escuro ou ícone do navegador (nosniff + CSP sandbox; cache de 1 dia — o endereço muda a cada troca)', ['platform'], { 200: { description: 'Imagem' }, 404: errorResponse('NOT_FOUND') }, { parameters: [{ name: 'slot', in: 'path', required: true, schema: { type: 'string', enum: ['logo_light', 'logo_dark', 'favicon'] } }] }),
      },
      '/settings/platform': {
        get: op('Configurações da plataforma (platform.manage): { values, defaults, limits, retention_options, branding, updated_at }', ['platform'], { 200: ok('Configurações', { type: 'object' }) }),
        patch: op('Altera (platform.manage), parcial: audit_retention_months (1, 3, 6, 12, 24 ou 0 = manter sempre), lockout_threshold (3–20), lockout_base_minutes (1–60), lockout_max_minutes (≥ inicial, até 1440), password_min_length (8–64), password_require_mixed_case, password_require_symbol, platform_name (até 40), panorama_enabled (§26.2: false tira o Panorama do menu de todos e o GET /executive responde 403 PANORAMA_DISABLED). Com dry_run: true devolve { dry_run, audit_to_delete } sem gravar', ['platform'], { 200: ok('Configurações ou prévia', { type: 'object' }), 400: errorResponse('VALIDATION_ERROR') }, { parameters: [csrfHeader] }),
      },
      '/settings/platform/branding/{slot}': {
        post: op('Envia logo/ícone (platform.manage): multipart "file" — PNG, JPG, WebP, SVG sem conteúdo ativo (ICO só no ícone), até 1 MB, tipo conferido pelo conteúdo', ['platform'], { 200: ok('Configurações', { type: 'object' }), 400: errorResponse('VALIDATION_ERROR') }, { parameters: [{ name: 'slot', in: 'path', required: true, schema: { type: 'string', enum: ['logo_light', 'logo_dark', 'favicon'] } }, csrfHeader] }),
        delete: op('Remove logo/ícone (volta a marca padrão)', ['platform'], { 200: ok('Configurações', { type: 'object' }) }, { parameters: [{ name: 'slot', in: 'path', required: true, schema: { type: 'string', enum: ['logo_light', 'logo_dark', 'favicon'] } }, csrfHeader] }),
      },
      '/settings/platform/purge-audit': {
        post: op('Aplica a retenção do histórico agora (platform.manage; mesma regra da rotina diária) → { removed }', ['platform'], { 200: ok('Resultado', { type: 'object' }) }, { parameters: [csrfHeader] }),
      },
      '/settings/table-column-labels': {
        get: op('Nomes das colunas das tabelas que valem para todos (§44; qualquer pessoa logada) → { labels: { tabela: { coluna: nome } } } — um texto só para os três idiomas; o nome da própria pessoa (guardado no navegador) vem antes', ['platform'], { 200: ok('Nomes', { type: 'object' }) }),
        patch: op('Troca os nomes de uma tabela (platform.manage): { table_id, labels: { coluna: nome } } → { labels } (o mapa inteiro). Nome sem espaços nas pontas, até 40; vazio volta ao nome do sistema; labels vazio tira a tabela. Ids: letra seguida de letras, números, _ ou - (até 64); até 80 colunas por tabela e 100 tabelas. Erros: fields.table_id (required, invalid_format, too_many), fields.labels (invalid_type, invalid_format, too_long, too_many). Histórico platform_settings.update com os nomes da tabela antes e depois', ['platform'], { 200: ok('Nomes', { type: 'object' }), 400: errorResponse('VALIDATION_ERROR'), 403: errorResponse('FORBIDDEN') }, {
          parameters: [csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['table_id'], properties: { table_id: { type: 'string', maxLength: 64 }, labels: { type: 'object', additionalProperties: { type: 'string', maxLength: 40 } } } }),
        }),
      },
      '/settings/dependency-areas': {
        get: op('Dependências por área (§42; settings.manage) → { areas: [{ key, name, user_ids, users }], configured, candidates } — sem configuração salva (configured = false), a área TI vem das antigas Pessoas de TI (it_people); candidates = usuários ativos, até 500', ['platform'], { 200: ok('Áreas', { type: 'object' }) }),
        put: op('Troca a lista inteira (settings.manage): { areas: [{ key?, name, user_ids }] } (até 20 áreas, nome até 40, até 50 pessoas por área). A área TI (key "ti") é obrigatória (pode ser renomeada); área nova sem key ganha uma pelo nome; uma pessoa fica numa área só. Erros em fields.areas: invalid_type, too_many, ti_required, name_required, name_too_long, duplicate_name, too_many_people, duplicate_person, invalid_option (usuário inexistente). A TI é espelhada em it_people; histórico platform_settings.update com "Área: nomes"', ['platform'], { 200: ok('Áreas', { type: 'object' }), 400: errorResponse('VALIDATION_ERROR') }, {
          parameters: [csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['areas'], properties: { areas: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, name: { type: 'string' }, user_ids: { type: 'array', items: { type: 'string' } } } } } } }),
        }),
      },
      '/settings/it-people': {
        get: op('Compatibilidade (§42; settings.manage): as pessoas da área TI de Dependências por área → { user_ids, users, candidates } (candidates = usuários ativos que podem ser escolhidos, até 500). Prefira /settings/dependency-areas', ['platform'], { 200: ok('Pessoas de TI', { type: 'object' }) }),
        put: op('Compatibilidade (settings.manage): troca só as pessoas da área TI { user_ids } (até 50, usuários existentes; quem entra sai da área onde estava); fica no histórico com os nomes. Prefira /settings/dependency-areas', ['platform'], { 200: ok('Pessoas de TI', { type: 'object' }), 400: errorResponse('VALIDATION_ERROR') }, {
          parameters: [csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['user_ids'], properties: { user_ids: { type: 'array', items: { type: 'string' } } } }),
        }),
      },
      '/settings/email': {
        get: op('Configurações do envio de e-mail (integrations.manage): { values: { enabled, host, port, username, tls, sender_name, sender_address, app_url }, has_password } — a senha nunca volta', ['integrations'], { 200: ok('Configurações', { type: 'object' }) }),
        patch: op('Altera (integrations.manage), parcial; ligado exige host, sender_address e app_url; password vazia mantém, null remove', ['integrations'], { 200: ok('Configurações', { type: 'object' }), 400: errorResponse('VALIDATION_ERROR') }, { parameters: [csrfHeader] }),
      },
      '/settings/email/test': {
        post: op('Envia na hora um e-mail de teste para quem pediu (ou { to }) → { sent, to }; EMAIL_NOT_CONFIGURED (409), EMAIL_SEND_FAILED (502, details.reason)', ['integrations'], { 200: ok('Enviado', { type: 'object' }) }, { parameters: [csrfHeader] }),
      },
      '/settings/email/outbox': {
        get: op('Fila de envio: { counts: { pending, sent, failed }, recent: [{ id, to, kind, subject, status, attempts, last_error, created_at, sent_at }] }', ['integrations'], { 200: ok('Fila', { type: 'object' }) }),
      },
      '/settings/email/outbox/flush': {
        post: op('Envia a fila agora (a rotina roda a cada minuto) → { sent, failed, retrying, busy?, skipped? }', ['integrations'], { 200: ok('Resultado', { type: 'object' }) }, { parameters: [csrfHeader] }),
      },
      '/auth/password-reset/request': {
        post: op('Público: { email } → { requested: true } sempre (não revela se a conta existe); no máximo 3 por conta por hora; o link vale 60 min', ['auth'], { 200: ok('Pedido', { type: 'object' }) }, { parameters: [csrfHeader] }),
      },
      '/auth/password-reset/check': {
        get: op('Público: ?token= → { valid, state: valid|used|expired|invalid, purpose: reset|invite, name, policy }', ['auth'], { 200: ok('Situação do link', { type: 'object' }) }, { parameters: [{ name: 'token', in: 'query', required: true, schema: { type: 'string' } }] }),
      },
      '/auth/password-reset/confirm': {
        post: op('Público: { token, password } (política vigente) → { changed, purpose }; encerra as sessões; RESET_TOKEN_INVALID (400)', ['auth'], { 200: ok('Senha definida', { type: 'object' }), 400: errorResponse('RESET_TOKEN_INVALID') }, { parameters: [csrfHeader] }),
      },
      '/users/{id}/invite': {
        post: op('Reenvia o convite (users.create) a quem ainda não entrou; o link anterior deixa de valer; USER_ALREADY_ACTIVE, EMAIL_NOT_CONFIGURED', ['users'], { 200: ok('Convidado', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/auth/tokens': {
        get: op('Os meus tokens de API (sem o valor): { id, name, prefix, state, created_at, expires_at, last_used_at, last_used_ip, revoked_at }', ['auth'], { 200: ok('Tokens', { type: 'array', items: { type: 'object' } }) }),
        post: op('Cria um token (api_tokens.create; só no navegador): { name*, expires_in_days*: 30|90|365|0 } → inclui `token` (o valor, só nesta resposta); API_TOKEN_LIMIT (20 ativos)', ['auth'], { 201: ok('Token', { type: 'object' }) }, { parameters: [csrfHeader] }),
      },
      '/auth/tokens/{id}': {
        delete: op('Revoga um token meu (só no navegador); de outra pessoa = API_TOKEN_NOT_FOUND', ['auth'], { 200: ok('Token', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/auth/tokens/{id}/reveal': {
        post: op('Mostra de novo o valor de um token meu, ativo, para copiar (só no navegador; fica no histórico como api_token.revealed). De outra pessoa = API_TOKEN_NOT_FOUND; revogado, vencido ou criado antes de guardar o valor = API_TOKEN_NOT_REVEALABLE', ['auth'], {
          200: ok('Token com o valor', { type: 'object', properties: { token: { type: 'string' } } }),
          403: errorResponse('TOKEN_NOT_ALLOWED'),
          404: errorResponse('API_TOKEN_NOT_FOUND'),
          409: errorResponse('API_TOKEN_NOT_REVEALABLE'),
        }, { parameters: [idParam, csrfHeader] }),
      },
      '/settings/api-tokens': {
        get: op('Tokens de todas as pessoas (integrations.manage), com user', ['integrations'], { 200: ok('Tokens', { type: 'array', items: { type: 'object' } }) }),
      },
      '/settings/api-tokens/{id}': {
        delete: op('Revoga o token de qualquer pessoa (integrations.manage)', ['integrations'], { 200: ok('Token', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/settings/webhooks': {
        get: op('Webhooks (integrations.manage), sem o segredo', ['integrations'], { 200: ok('Webhooks', { type: 'array', items: { type: 'object' } }) }),
        post: op('Cria (integrations.manage): { name*, url* (https; http/própria máquina só fora de produção; metadados da nuvem bloqueados), events* (catálogo; "grupo.*"), active } → inclui `secret` (só nesta resposta)', ['integrations'], { 201: ok('Webhook', { type: 'object' }), 400: errorResponse('VALIDATION_ERROR') }, { parameters: [csrfHeader] }),
      },
      '/settings/webhooks/events': {
        get: op('Catálogo de eventos: { events, groups }', ['integrations'], { 200: ok('Catálogo', { type: 'object' }) }),
      },
      '/settings/webhooks/{id}': {
        patch: op('Edita (parcial); religar zera as falhas seguidas; WEBHOOK_NOT_FOUND', ['integrations'], { 200: ok('Webhook', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
        delete: op('Exclui com as entregas', ['integrations'], { 200: ok('Excluído', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/settings/webhooks/{id}/rotate-secret': {
        post: op('Gera outro segredo → { secret } (o anterior deixa de valer)', ['integrations'], { 200: ok('Segredo', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/settings/webhooks/{id}/test': {
        post: op('Envia webhook.ping na hora (mesmo desligado) → a entrega com status e resposta', ['integrations'], { 200: ok('Entrega', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/settings/webhooks/{id}/deliveries': {
        get: op('As 50 entregas mais recentes', ['integrations'], { 200: ok('Entregas', { type: 'array', items: { type: 'object' } }) }, { parameters: [idParam] }),
      },
      '/settings/webhook-deliveries/{id}/redeliver': {
        post: op('Reenvia agora, do zero; WEBHOOK_DELIVERY_NOT_FOUND', ['integrations'], { 200: ok('Entrega', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/auth/preferences/{key}': {
        get: op('Preferência da própria pessoa → { key, value } (value null = padrão). Chaves: project_filter.<tela> (kanban, planning, plan, timeline, tasks, reports, executive)', ['auth'], { 200: ok('Preferência', { type: 'object' }), 400: errorResponse('VALIDATION_ERROR') }, { parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }] }),
        put: op('Grava a preferência da própria pessoa: { value } — project_filter: { statuses: [planning|active|paused|completed|cancelled], members_only } ; value null volta ao padrão', ['auth'], { 200: ok('Preferência', { type: 'object' }), 400: errorResponse('VALIDATION_ERROR') }, {
          parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['value'], properties: { value: { type: ['object', 'null'] } } }),
        }),
      },
      '/auth/password-policy': {
        get: op('Exigências vigentes para senhas (quem está logado): { min_length, max_length, require_letters_numbers, require_mixed_case, require_symbol }', ['auth'], { 200: ok('Política', { type: 'object' }) }),
      },
      '/docs/recent': {
        get: op('Páginas publicadas mais recentes dos espaços visíveis', ['docs'], { 200: ok('Recentes', { type: 'array', items: { type: 'object' } }) }),
      },
      '/docs/export': {
        get: op(
          'Exportar em PDF (§43, ADR-059; o navegador imprime): páginas publicadas de um espaço (space = chave) ou de todos os espaços de um módulo que a pessoa lê (module = id, pelo nome; espaço sem página publicada fica de fora), na ordem de leitura da árvore. Cada espaço: id, key, name, description, icon, color, module, project, home_page_id e pages [{ id, parent_id (primeira página publicada acima; null = raiz), depth, title, version, published_at, published_by, words, content }]. Nunca sai rascunho. Mesmas regras de leitura da tela (docs.view + visibilidade): espaço invisível = DOC_SPACE_NOT_FOUND. Exatamente um de space/module (fields.space = required; os dois = fields.module = invalid_option)',
          ['docs'],
          {
            200: ok('Exportação', {
              type: 'object',
              properties: {
                module: { type: ['object', 'null'], properties: { id: { type: 'string' }, name: { type: 'string' }, color: { type: 'string' } } },
                spaces: { type: 'array', items: { type: 'object' } },
              },
            }),
            400: errorResponse('VALIDATION_ERROR'),
            403: errorResponse('FORBIDDEN'),
            404: errorResponse('DOC_SPACE_NOT_FOUND'),
          },
          {
            parameters: [
              { name: 'space', in: 'query', schema: { type: 'string' }, description: 'chave do espaço' },
              { name: 'module', in: 'query', schema: { type: 'string' }, description: 'id do módulo (DOC_MODULE_NOT_FOUND se não existir)' },
            ],
          },
        ),
      },
      '/executive': {
        get: op(
          'Painel executivo (executive.view): Gestão de projetos + Kanban de TODOS os projetos (mesmo sem ser membro), só leitura — resumo, portfólio com a saúde de cada projeto, Gestão (status, cronograma, esforço, problemas, marcos), Kanban (funil, criadas × concluídas, tempos, atrasadas), série de entregas (semana/mês) e o que já foi feito (arquivados só nas entregas). Panorama: portfólio com objective e updated_at, plan.overdue_milestones, projects com area e owner. Com o Panorama desligado em Configurações → Geral (§26.2), 403 PANORAMA_DISABLED para todos',
          ['reports'],
          { 200: ok('Painel', { type: 'object' }), 400: errorResponse('VALIDATION_ERROR'), 403: errorResponse('FORBIDDEN ou PANORAMA_DISABLED') },
          {
            parameters: [
              { name: 'project_ids', in: 'query', schema: { type: 'string' }, description: 'ids separados por vírgula (até 200); vazio = todos' },
              { name: 'statuses', in: 'query', schema: { type: 'string' }, description: 'status do projeto separados por vírgula (planning, active, paused, completed, cancelled); vazio = todos' },
              { name: 'from', in: 'query', schema: { type: 'string', format: 'date' }, description: 'início (dia no fuso de tz_offset ou ISO); vazio = desde o início' },
              { name: 'to', in: 'query', schema: { type: 'string', format: 'date' }, description: 'fim (o dia inteiro); vazio = agora' },
              { name: 'tz_offset', in: 'query', schema: { type: 'integer', minimum: -840, maximum: 840 } },
              { name: 'area_ids', in: 'query', schema: { type: 'string' }, description: 'Panorama: áreas do projeto separadas por vírgula (none = sem área); recorta também arquivados e entregas' },
              { name: 'owner_ids', in: 'query', schema: { type: 'string' }, description: 'Panorama: responsável do projeto (sem ele, o dono), ids separados por vírgula' },
              {
                name: 'delivery_statuses',
                in: 'query',
                schema: { type: 'string' },
                description: 'Panorama: status a mais cujos projetos entram só nas entregas do período (ex.: completed) — fora do portfólio, da Gestão e do Kanban',
              },
            ],
          },
        ),
      },
      '/reports/tasks': {
        get: op(
          'Detalhamento de um indicador (reports.view): as tarefas por trás do número, paginadas, com o mesmo período, escopo e filtros de /reports — o total sempre bate com o indicador. Nos indicadores de tempo, cada item traz metric_hours',
          ['reports'],
          {
            200: ok('Página de tarefas', { type: 'array', items: { allOf: [ref('Task'), { type: 'object', properties: { metric_hours: { type: 'number', nullable: true } } }] } }, true),
            404: errorResponse('PROJECT_NOT_FOUND'),
          },
          {
            parameters: [
              {
                name: 'metric',
                in: 'query',
                required: true,
                schema: { type: 'string', enum: ['open', 'backlog', 'todo', 'in_progress', 'blocked', 'overdue', 'critical_bugs', 'created', 'completed', 'cancelled', 'lead_time', 'cycle_time', 'bug_resolution'] },
              },
              { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
              { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
              { name: 'tz_offset', in: 'query', schema: { type: 'integer', minimum: -840, maximum: 840 } },
              { name: 'project_id', in: 'query', schema: { type: 'string' } },
              { name: 'assignee_id', in: 'query', schema: { type: 'string' }, description: 'id, me ou none' },
              { name: 'task_type_id', in: 'query', schema: { type: 'string' } },
              { name: 'priority_id', in: 'query', schema: { type: 'string' } },
              { name: 'status_id', in: 'query', schema: { type: 'string' } },
              { name: 'page', in: 'query', schema: { type: 'integer' } },
              { name: 'perPage', in: 'query', schema: { type: 'integer', maximum: 100 } },
            ],
          },
        ),
      },
      '/notifications': {
        get: op('Notificações do usuário (mais recentes primeiro)', ['notifications'], { 200: ok('Notificações', { type: 'array', items: ref('Notification') }, true) }, {
          parameters: [
            { name: 'unread', in: 'query', schema: { type: 'string', enum: ['1'] } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'perPage', in: 'query', schema: { type: 'integer', maximum: 50 } },
          ],
        }),
      },
      '/notifications/unread-count': {
        get: op('Quantidade de não lidas', ['notifications'], { 200: ok('Contador', { type: 'object', properties: { count: { type: 'integer' } } }) }),
      },
      '/notifications/{id}/read': {
        post: op('Marca como lida (só as próprias)', ['notifications'], { 200: ok('Lida', { type: 'object' }), 404: errorResponse('NOTIFICATION_NOT_FOUND') }, { parameters: [idParam, csrfHeader] }),
      },
      '/notifications/read-all': {
        post: op('Marca todas como lidas', ['notifications'], { 200: ok('Atualizadas', { type: 'object', properties: { updated: { type: 'integer' } } }) }, { parameters: [csrfHeader] }),
      },
      '/notifications/due-reminders': {
        post: op('Roda agora a rotina de lembretes de prazo (settings.manage; também roda todo dia às 08:00)', ['notifications'], { 200: ok('Criadas', { type: 'object', properties: { created: { type: 'integer' } } }) }, { parameters: [csrfHeader] }),
      },
      '/tags': {
        get: op('Tags com contagem de tarefas', ['tags'], { 200: ok('Tags', { type: 'array', items: ref('Tag') }) }),
        post: op('Cria tag (settings.manage); nome único sem diferenciar maiúsculas/acentos', ['tags'], { 201: ok('Criada', ref('Tag')), 409: errorResponse('TAG_NAME_IN_USE') }, {
          parameters: [csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 40 }, color: { type: 'string' } } }),
        }),
      },
      '/tags/{id}': {
        patch: op('Renomeia ou troca a cor (settings.manage)', ['tags'], { 200: ok('Atualizada', ref('Tag')) }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', properties: { name: { type: 'string' }, color: { type: 'string' } } }),
        }),
        delete: op('Exclui a tag (sai das tarefas)', ['tags'], { 200: ok('Excluída', { type: 'object' }) }, { parameters: [idParam, csrfHeader] }),
      },
      '/companies': {
        get: op(
          'Empresas do grupo (§46; qualquer pessoa autenticada): só as ativas, por nome. include_inactive=true traz também as inativas e as contagens de uso (project_count, demand_count, usage_count) — só com platform.manage; sem ela, o parâmetro é ignorado',
          ['companies'],
          { 200: ok('Empresas', { type: 'array', items: ref('Company') }) },
          { parameters: [{ name: 'include_inactive', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } }] },
        ),
        post: op('Cria empresa (platform.manage); nome único sem diferenciar maiúsculas; sigla opcional (maiúsculas, até 10)', ['companies'], { 201: ok('Criada', ref('Company')), 400: errorResponse('VALIDATION_ERROR'), 409: errorResponse('COMPANY_NAME_IN_USE') }, {
          parameters: [csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 120 }, short_code: { type: 'string', maxLength: 10 }, active: { type: 'boolean' } } }),
        }),
      },
      '/companies/{id}': {
        patch: op('Altera nome, sigla ou estado (platform.manage). Não há exclusão: desativar (active=false) tira a empresa das opções dos registros novos; os que já a usam continuam com ela', ['companies'], { 200: ok('Atualizada', ref('Company')), 404: errorResponse('COMPANY_NOT_FOUND'), 409: errorResponse('COMPANY_NAME_IN_USE') }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', properties: { name: { type: 'string', maxLength: 120 }, short_code: { type: 'string', maxLength: 10 }, active: { type: 'boolean' } } }),
        }),
      },
      '/users/{id}/status': {
        patch: op('Ativa/desativa usuário (users.disable)', ['users'], { 200: ok('Atualizado', ref('User')) }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['active', 'disabled'] } } }),
        }),
      },
    }),
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'kb_session' },
        bearerToken: { type: 'http', scheme: 'bearer', description: 'Token de API pessoal (kb_pat_…), criado em Minha conta → Tokens de API. Sem cookie e sem o header de CSRF.' },
      },
      schemas: {
        Meta: { type: 'object', properties: { correlationId: { type: 'string' } } },
        PageMeta: {
          type: 'object',
          properties: {
            correlationId: { type: 'string' },
            page: { type: 'integer' },
            perPage: { type: 'integer' },
            total: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
        Error: {
          type: 'object',
          required: ['code', 'message', 'details'],
          properties: { code: { type: 'string', examples: ['TASK_NOT_FOUND'] }, message: { type: 'string' }, details: { type: 'object' } },
        },
        ErrorEnvelope: {
          type: 'object',
          properties: { data: { type: 'null' }, meta: ref('Meta'), error: ref('Error') },
        },
        Health: {
          type: 'object',
          properties: { status: { type: 'string' }, version: { type: 'string' }, checks: { type: 'object' }, time: { type: 'string', format: 'date-time' } },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string' },
            avatar_url: { type: ['string', 'null'] },
            status: { type: 'string', enum: ['active', 'disabled'] },
            role_id: { type: 'string' },
            locale: { type: 'string', enum: ['pt-BR', 'en', 'es'] },
            theme: { type: 'string', enum: ['light', 'dark', 'system'] },
            home_page: { type: 'string', enum: HOME_PAGES, description: 'tela aberta ao entrar (§38); "" = automática' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
            last_login_at: { type: ['string', 'null'], format: 'date-time' },
          },
        },
        UserCreate: {
          type: 'object',
          required: ['name', 'email', 'password', 'role_id'],
          properties: {
            name: { type: 'string', maxLength: 120 },
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 10, maxLength: 72 },
            role_id: { type: 'string' },
            locale: { type: 'string', enum: ['pt-BR', 'en', 'es'] },
          },
        },
        UserUpdate: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            role_id: { type: 'string' },
            locale: { type: 'string', enum: ['pt-BR', 'en', 'es'] },
            theme: { type: 'string', enum: ['light', 'dark', 'system'] },
            home_page: {
              type: 'string',
              enum: HOME_PAGES,
              description: 'tela aberta ao entrar (§38; exige users.edit, também para a própria); "" = automática. Com o Panorama desligado (§26.2), mudar para /tracking = panorama_disabled (quem já o tinha guarda o valor)',
            },
          },
        },
        Role: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            code: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            is_system: { type: 'boolean' },
            ongoing_view: { type: 'string', enum: ONGOING_VIEWS, description: 'vista da lista Em andamento para quem tem este perfil (§41): "" = Gestão (padrão), "both" = as duas, com seletor na tela; "executive" = Direção e gerência' },
            ...TASK_VIEW_PROPS,
            ...PROJECT_LIST_PROPS,
            permissions: { type: 'array', items: { type: 'string' } },
            user_count: { type: 'integer' },
          },
        },
        RoleInput: {
          type: 'object',
          required: ['code', 'name'],
          properties: {
            code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,31}$' },
            name: { type: 'string' },
            description: { type: 'string' },
            permissions: { type: 'array', items: { type: 'string' } },
            ongoing_view: { type: 'string', enum: ONGOING_VIEWS },
            ...TASK_VIEW_PROPS,
            ...PROJECT_LIST_PROPS,
          },
        },
        Permission: { type: 'object', properties: { id: { type: 'string' }, code: { type: 'string' }, module: { type: 'string' } } },
        Session: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            ip: { type: 'string' },
            user_agent: { type: 'string' },
            remember: { type: 'boolean' },
            created_at: { type: 'string', format: 'date-time' },
            last_seen_at: { type: 'string', format: 'date-time' },
            expires_at: { type: 'string', format: 'date-time' },
            current: { type: 'boolean' },
          },
        },
        AuditEntry: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            entity_type: { type: 'string' },
            entity_id: { type: 'string' },
            action: { type: 'string', examples: ['user.updated'] },
            old_value: { type: ['object', 'null'] },
            new_value: { type: ['object', 'null'] },
            user: { type: ['object', 'null'], properties: { id: { type: 'string' }, name: { type: ['string', 'null'] }, email: { type: ['string', 'null'] } } },
            ip: { type: 'string' },
            correlation_id: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        UserSummary: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, avatar_url: { type: ['string', 'null'] } },
        },
        Task: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            code: { type: 'string', examples: ['CRM-12'] },
            number: { type: 'integer' },
            title: { type: 'string' },
            project: { oneOf: [{ type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' } } }, { type: 'null' }], description: 'null na demanda interna (§45)' },
            demand: {
              oneOf: [
                {
                  type: 'object',
                  description: 'demanda interna (§45); no detalhe, também actions = { assign, start, pass, conclude, validate, return } de quem consulta',
                  properties: {
                    status: { type: 'string', enum: ['unassigned', 'assigned', 'in_progress', 'to_validate', 'done'] },
                    owner: { oneOf: [ref('UserSummary'), { type: 'null' }], description: 'Responsável (quem recebeu o pedido)' },
                    due_at: { type: ['string', 'null'], format: 'date-time', description: 'prazo com data e hora (definido ao atribuir)' },
                    opened_at: { type: 'string', format: 'date-time', description: 'abertura (automática)' },
                    actions: { type: 'object', additionalProperties: { type: 'boolean' } },
                  },
                },
                { type: 'null' },
              ],
            },
            type: { type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' }, icon: { type: 'string' }, color: { type: 'string' } } },
            status: ref('Status'),
            priority: ref('Priority'),
            creator: { oneOf: [ref('UserSummary'), { type: 'null' }] },
            assignee: { oneOf: [ref('UserSummary'), { type: 'null' }] },
            reporter: { oneOf: [ref('UserSummary'), { type: 'null' }] },
            parent_task_id: { type: ['string', 'null'] },
            subtask_progress: { type: 'object', properties: { done: { type: 'integer' }, total: { type: 'integer' } } },
            blocked: { type: 'boolean', description: 'algum bloqueador (bloqueia/depende de) ainda aberto' },
            in_report: { type: 'boolean', description: 'entra no informe do projeto (padrão: true)' },
            it_visible: { type: 'boolean', description: 'visível para o Responsável TI do projeto (§36; padrão: false)' },
            urgency: { type: ['string', 'null'], enum: ['high', 'medium', 'low', null], description: 'urgência (semáforo): alta = vermelho, média = amarelo, baixa = verde; null = sem urgência' },
            area: AREA_REF,
            company: COMPANY_REF,
            start_date: { type: ['string', 'null'], format: 'date-time', description: 'início planejado (timeline)' },
            due_date: { type: ['string', 'null'], format: 'date-time' },
            estimated_hours: { type: ['number', 'null'] },
            actual_hours: { type: ['number', 'null'] },
            started_at: { type: ['string', 'null'], format: 'date-time', description: 'primeira vez em andamento' },
            completed_at: { type: ['string', 'null'], format: 'date-time', description: 'status em categoria done/cancelled' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
            tags: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, color: { type: 'string' } } } },
            checklist_progress: { type: 'object', properties: { done: { type: 'integer' }, total: { type: 'integer' } } },
            sprint: { oneOf: [{ type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, state: { type: 'string' } } }, { type: 'null' }] },
            comment_count: { type: 'integer' },
            attachment_count: { type: 'integer' },
          },
        },
        ProjectGroup: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            project_id: { type: 'string' },
            parent_id: { type: ['string', 'null'] },
            name: { type: 'string' },
            color: { type: 'string' },
            position: { type: 'number' },
            number: { type: ['string', 'null'], description: '1.0, 2.1…' },
            stats: { type: ['object', 'null'] },
          },
        },
        ProjectGroupInput: { type: 'object', properties: { name: { type: 'string', maxLength: 120 }, color: { type: 'string' }, parent_id: { type: ['string', 'null'] } } },
        Plan: {
          type: 'object',
          properties: {
            project: { type: 'object' },
            capabilities: { type: 'object', properties: { edit: { type: 'boolean' }, manage: { type: 'boolean' } } },
            statuses: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, color: { type: 'string' }, category: { type: 'string', enum: ['todo', 'in_progress', 'review', 'blocked', 'done', 'canceled'] } } } },
            resources: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, color: { type: 'string' } } } },
            groups: { type: 'array', items: ref('ProjectGroup') },
            items: { type: 'array', items: ref('PlanItem') },
            links: { type: 'array', items: ref('PlanLink') },
            settings: { type: 'object', properties: { dependency_rule: { type: 'string', enum: ['warn', 'block'] } } },
            truncated: { type: 'boolean' },
          },
        },
        PlanItem: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            group_id: { type: 'string' },
            parent_id: { type: ['string', 'null'] },
            name: { type: 'string' },
            status_id: { type: ['string', 'null'], description: 'null = em branco' },
            start_date: { type: ['string', 'null'], format: 'date' },
            end_date: { type: ['string', 'null'], format: 'date' },
            due_date: { type: ['string', 'null'], format: 'date', description: 'Data (subelemento)' },
            owner: { oneOf: [ref('UserSummary'), { type: 'null' }], description: 'Responsável (subelemento)' },
            resource_ids: { type: 'array', items: { type: 'string' } },
            estimated_hours: { type: ['number', 'null'], description: 'Esforço estimado / Trabalho (h)' },
            actual_hours: { type: ['number', 'null'], description: 'Realizado (h)' },
            duration_days: { type: ['integer', 'null'], description: 'efetiva: pelo cronograma ou a informada' },
            duration_manual: { type: ['integer', 'null'] },
            progress: { type: 'object', properties: { value: { type: 'integer' }, source: { type: 'string', enum: ['done', 'subitems', 'manual', 'none'] } } },
            progress_manual: { type: ['integer', 'null'] },
            subitems: { type: 'integer' },
            blocked: { type: 'boolean', description: 'depende de elemento ainda aberto' },
            updates: { type: 'integer', description: 'atualizações (não excluídas) — contador da linha' },
            files: { type: 'integer' },
            baseline_start: { type: ['string', 'null'], description: 'linha de base do Cronograma (AAAA-MM-DD)' },
            custom: { type: 'object', description: 'valores das colunas personalizadas { coluna: valor } (só elementos); no PATCH, null limpa' },
            baseline_end: { type: ['string', 'null'] },
          },
        },
        PlanUpdate: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            item_id: { type: 'string' },
            parent_id: { type: ['string', 'null'] },
            author: { oneOf: [ref('UserSummary'), { type: 'null' }] },
            content: { type: 'string', description: 'vazio quando excluída (ou só com imagem/arquivo)' },
            mentions: { type: 'array', items: ref('UserSummary') },
            deleted: { type: 'boolean' },
            created_at: { type: 'string', format: 'date-time' },
            edited_at: { type: ['string', 'null'], format: 'date-time' },
            capabilities: { type: 'object', properties: { edit: { type: 'boolean' }, delete: { type: 'boolean' }, reply: { type: 'boolean' } } },
            files: { type: 'array', items: ref('PlanFile'), description: 'imagens/arquivos colados ou anexados (vazio quando excluída)' },
            replies: { type: 'array', items: { type: 'object' } },
          },
        },
        PlanColumn: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' }, type: { type: 'string', enum: ['text', 'number', 'date', 'checkbox', 'dropdown', 'people', 'link'] }, settings: { type: 'object' }, position: { type: 'number' } },
        },
        JournalEntry: {
          type: 'object',
          properties: { id: { type: 'string' }, entry_date: { type: 'string', format: 'date' }, content: { type: 'string' }, author: { oneOf: [ref('UserSummary'), { type: 'null' }] }, created_at: { type: 'string', format: 'date-time' }, capabilities: { type: 'object' } },
        },
        PlanIssue: {
          type: 'object',
          properties: { id: { type: 'string' }, number: { type: 'integer' }, opened_on: { type: 'string', format: 'date' }, description: { type: 'string' }, state: { type: 'string', enum: ['in_progress', 'pending', 'resolved'] }, owner: { oneOf: [ref('UserSummary'), { type: 'null' }] }, resolved_on: { type: ['string', 'null'], format: 'date' }, capabilities: { type: 'object' } },
        },
        PlanFile: {
          type: 'object',
          properties: { id: { type: 'string' }, item_id: { type: 'string' }, update_id: { type: ['string', 'null'] }, name: { type: 'string' }, mime: { type: 'string' }, kind: { type: 'string', enum: ['image', 'document'] }, size: { type: 'integer' }, url: { type: 'string' }, capabilities: { type: 'object' } },
        },
        PlanLink: {
          type: 'object',
          properties: { id: { type: 'string' }, from_id: { type: 'string' }, to_id: { type: 'string' }, type: { type: 'string', enum: ['blocks', 'relates'], description: 'blocks = from bloqueia to (to depende de from)' } },
        },
        PlanItemInput: {
          type: 'object',
          properties: {
            group_id: { type: 'string' },
            parent_id: { type: 'string', description: 'só na criação' },
            name: { type: 'string', maxLength: 255 },
            status_id: { type: ['string', 'null'] },
            start_date: { type: ['string', 'null'], format: 'date' },
            end_date: { type: ['string', 'null'], format: 'date', description: 'início ≤ fim (end_before_start)' },
            due_date: { type: ['string', 'null'], format: 'date' },
            owner_id: { type: ['string', 'null'], description: 'participante ativo do projeto' },
            resource_ids: { type: 'array', items: { type: 'string' }, maxItems: 20 },
            estimated_hours: { type: ['number', 'null'], minimum: 0 },
            actual_hours: { type: ['number', 'null'], minimum: 0 },
            duration_days: { type: ['integer', 'null'], minimum: 0, maximum: 3650 },
            progress: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
          },
        },
        Attachment: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            task_id: { type: 'string' },
            comment_id: { type: ['string', 'null'] },
            name: { type: 'string' },
            mime: { type: 'string' },
            kind: { type: 'string', enum: ['image', 'document'] },
            size: { type: 'integer' },
            uploaded_by: ref('UserSummary'),
            created_at: { type: 'string', format: 'date-time' },
            url: { type: 'string', description: '/api/v1/attachments/{id}/file' },
            capabilities: { type: 'object', properties: { delete: { type: 'boolean' } } },
          },
        },
        ProjectFile: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            project_id: { type: 'string' },
            name: { type: 'string' },
            mime: { type: 'string' },
            kind: { type: 'string', enum: ['image', 'document'] },
            size: { type: 'integer' },
            uploaded_by: ref('UserSummary'),
            created_at: { type: 'string', format: 'date-time' },
            url: { type: 'string', description: '/api/v1/project-files/{id}/file' },
            capabilities: { type: 'object', properties: { delete: { type: 'boolean' } } },
          },
        },
        Board: {
          type: 'object',
          properties: {
            project: {
              type: ['object', 'null'],
              description: 'null no quadro de todos os projetos (GET /board)',
              properties: { id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' }, archived: { type: 'boolean' } },
            },
            projects: {
              type: 'array',
              description: 'só no quadro de todos os projetos: os projetos incluídos, pela chave',
              items: { type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' } } },
            },
            capabilities: { type: 'object', properties: { move: { type: 'boolean' }, create: { type: 'boolean' } }, description: 'no quadro de todos os projetos: move = em algum projeto; create = em algum projeto' },
            columns: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  status: ref('Status'),
                  wip_limit: { type: 'integer', description: '0 = sem limite (aviso visual ao exceder)' },
                  allowed_next: { type: 'array', items: { type: 'string' }, description: 'vazio = qualquer destino' },
                  total: { type: 'integer' },
                  truncated: { type: 'boolean', description: 'colunas de encerramento mostram só as 30 mais recentes' },
                  tasks: {
                    type: 'array',
                    items: {
                      allOf: [
                        ref('Task'),
                        {
                          type: 'object',
                          properties: {
                            card_fields: { type: 'array', items: { type: 'object', properties: { field: { type: 'object' }, value: {} } } },
                            capabilities: {
                              type: 'object',
                              description: 'só no quadro de todos os projetos: pode mover este card (permissão no projeto dele)',
                              properties: { move: { type: 'boolean' } },
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
        Sprint: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            project_id: { type: 'string' },
            name: { type: 'string' },
            goal: { type: 'string' },
            start_date: { type: ['string', 'null'], format: 'date' },
            end_date: { type: ['string', 'null'], format: 'date' },
            state: { type: 'string', enum: ['planned', 'active', 'closed'] },
            order: { type: 'integer', description: 'ordem manual (encerradas aparecem por último)' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        SprintInput: {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 80 },
            goal: { type: ['string', 'null'], maxLength: 1000 },
            start_date: { type: ['string', 'null'], format: 'date' },
            end_date: { type: ['string', 'null'], format: 'date', description: 'não pode ser antes do início (end_before_start)' },
            state: { type: 'string', enum: ['planned', 'active', 'closed'], description: 'só na edição' },
          },
        },
        Backlog: {
          type: 'object',
          properties: {
            project: { type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' }, archived: { type: 'boolean' } } },
            capabilities: { type: 'object', properties: { rank: { type: 'boolean' }, create: { type: 'boolean' }, manage_sprints: { type: 'boolean' } } },
            statuses: { type: 'array', items: ref('Status'), description: 'status ativos da categoria backlog' },
            sprints: { type: 'array', items: ref('Sprint'), description: 'sprints não encerradas' },
            items: { type: 'array', items: ref('Task') },
            truncated: { type: 'boolean', description: 'mais de 1000 itens' },
          },
        },
        TaskRelation: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: ['relates', 'blocks', 'blocked_by', 'duplicates', 'duplicated_by', 'depends_on', 'dependency_of'] },
            task: ref('Task'),
            created_by: { oneOf: [ref('UserSummary'), { type: 'null' }] },
            created_at: { type: 'string', format: 'date-time' },
            capabilities: { type: 'object', properties: { delete: { type: 'boolean' } } },
          },
        },
        TaskRelations: {
          type: 'object',
          properties: {
            parent: { oneOf: [ref('Task'), { type: 'null' }] },
            children: { type: 'array', items: ref('Task') },
            subtask_progress: { type: 'object', properties: { done: { type: 'integer' }, total: { type: 'integer' } } },
            forked_from: { oneOf: [ref('Task'), { type: 'null' }] },
            forks: { type: 'array', items: ref('Task') },
            relations: { type: 'array', items: ref('TaskRelation') },
            capabilities: { type: 'object', properties: { link: { type: 'boolean' }, fork: { type: 'boolean' }, create_subtask: { type: 'boolean' }, edit: { type: 'boolean' } } },
          },
        },
        Report: {
          type: 'object',
          properties: {
            period: { type: 'object', properties: { from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' }, tz_offset: { type: 'integer' } } },
            generated_at: { type: 'string', format: 'date-time' },
            filters: { type: 'object' },
            definitions: {
              type: 'object',
              description: 'o que o relatório considera bug (tipos com chave BUG) e prioridade crítica (a primeira da lista)',
              properties: { bug_types: { type: 'array', items: { type: 'object' } }, critical_priority: { type: ['object', 'null'] } },
            },
            indicators: {
              type: 'object',
              description: 'agora: total, open, backlog, todo, in_progress, blocked, overdue, critical_bugs; no período: created, completed, cancelled, lead_time, cycle_time, bug_resolution ({ hours, count })',
            },
            series: { type: 'object', properties: { bucket: { type: 'string', enum: ['day', 'week'] }, points: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, created: { type: 'integer' }, completed: { type: 'integer' } } } } } },
            breakdown: {
              type: 'object',
              properties: {
                dimension: { type: 'string' },
                rows: { type: 'array', items: { type: 'object', description: 'key, label, total, open, overdue, blocked, created, completed, lead_time' } },
              },
            },
            overdue_tasks: { type: 'array', items: ref('Task'), description: 'até 50 atrasadas, do prazo mais antigo ao mais novo' },
          },
        },
        Notification: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: ['mention', 'assigned', 'comment', 'status_changed', 'due_soon', 'overdue'] },
            task: { type: 'object', properties: { id: { type: 'string' }, code: { type: 'string' }, title: { type: 'string' } } },
            actor: { oneOf: [ref('UserSummary'), { type: 'null' }], description: 'null em lembretes automáticos' },
            data: { type: 'object', description: 'comment (trecho), status, due_date conforme o tipo' },
            read: { type: 'boolean' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Company: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            short_code: { type: 'string' },
            active: { type: 'boolean' },
            project_count: { type: 'integer', description: 'só com include_inactive=true (platform.manage)' },
            demand_count: { type: 'integer', description: 'demandas internas; só com include_inactive=true (platform.manage)' },
            usage_count: { type: 'integer', description: 'projetos + demandas; só com include_inactive=true (platform.manage)' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        Tag: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' }, color: { type: 'string' }, task_count: { type: 'integer' } },
        },
        Comment: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            task_id: { type: 'string' },
            author: ref('UserSummary'),
            content: { type: 'string', description: 'Markdown simples; menções no formato @[Nome](id); vazio se excluído' },
            mentions: { type: 'array', items: ref('UserSummary') },
            attachments: { type: 'array', items: ref('Attachment') },
            deleted: { type: 'boolean' },
            created_at: { type: 'string', format: 'date-time' },
            edited_at: { type: ['string', 'null'], format: 'date-time' },
            capabilities: { type: 'object', properties: { edit: { type: 'boolean' }, delete: { type: 'boolean' } } },
          },
        },
        TaskDetail: {
          allOf: [
            ref('Task'),
            {
              type: 'object',
              properties: {
                description: { type: 'string' },
                custom_values: { type: 'object', description: 'valores por nome técnico do campo', additionalProperties: true },
                checklist: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, done: { type: 'boolean' } } } },
                fields: { type: 'array', items: { type: 'object', description: 'campos do tipo (mesmo formato de TaskTypeDetail.fields)' } },
                capabilities: { type: 'object', properties: { edit: { type: 'boolean' }, delete: { type: 'boolean' }, assign: { type: 'boolean' } } },
              },
            },
          ],
        },
        TaskInput: {
          type: 'object',
          properties: {
            project_id: { type: 'string', description: 'Só na criação' },
            cc_emails: COPY_EMAILS,
            demand_owner_id: {
              type: ['string', 'null'],
              description:
                'Responsável que recebe e distribui (§45): qualquer pessoa ativa com tasks.view, mesmo de fora do projeto. Liga o fluxo da demanda na tarefa (Sem atribuir → Atribuída → Em andamento → Para validar → Concluída; ações em /demands/{id}/…); status_id, assignee_id, due_date e estimated_hours passam a mudar só pelo fluxo (fields = demand_flow). Numa tarefa que já existe, o passo vem do que ela tem (executor e status ficam); null desliga e a tarefa volta ao normal. Quem participa do fluxo sem ser do projeto vê e trabalha só nessa tarefa. Pôr, trocar ou tirar o responsável exige poder atribuir no projeto (tasks.assign + colaborador; senão FORBIDDEN)',
            },
            task_type_id: { type: 'string', description: 'Trocar o tipo descarta valores de campos que o novo tipo não tem' },
            parent_task_id: { type: ['string', 'null'], description: 'Subtarefa: pai do mesmo projeto, sem ciclo; null solta' },
            sprint_id: { type: ['string', 'null'], description: 'Sprint aberto do mesmo projeto; null tira da sprint' },
            plan_item_id: { type: ['string', 'null'], description: 'Elemento (ou subelemento) da Gestão de projetos do mesmo projeto que a tarefa executa (ADR-050); null desliga. Não junto com plan_group_id (exclusive)' },
            plan_group_id: {
              type: 'string',
              description:
                'Etapa da Gestão (grupo ou subgrupo do mesmo projeto, ADR-052): cria na mesma transação uma linha nessa etapa com o título, o início planejado (ou hoje), o prazo (ou o início) e o responsável da tarefa, e liga a tarefa a ela. Cópia só nesse momento. Exige plan.view (não plan.edit); FORBIDDEN sem ela e para o Responsável TI. Não junto com plan_item_id (exclusive); no PATCH, só para a tarefa ainda sem elemento (already_linked)',
            },
            urgency: { type: ['string', 'null'], enum: ['high', 'medium', 'low', null], description: 'urgência (semáforo); null limpa. Para trocar sem exigir os obrigatórios do status, use PUT /tasks/{id}/urgency' },
            area_id: { type: ['string', 'null'], description: 'área responsável ativa de /areas; null limpa. Para trocar sem exigir os obrigatórios do status, use PUT /tasks/{id}/area' },
            company_id: { type: ['string', 'null'], description: 'empresa ativa de /companies (§46): só na demanda interna (a tarefa de projeto herda a do projeto e ignora o campo); null limpa só quando não há nenhuma ativa' },
            title: { type: 'string', maxLength: 200 },
            description: { type: 'string', maxLength: 50000 },
            status_id: { type: 'string', description: 'padrão: status marcado como padrão' },
            priority_id: { type: 'string', description: 'padrão: prioridade marcada como padrão' },
            assignee_id: { type: ['string', 'null'], description: 'exige tasks.assign; precisa colaborar no projeto.' },
            reporter_id: { type: ['string', 'null'], description: 'padrão: quem cria' },
            start_date: { type: ['string', 'null'], format: 'date', description: 'início planejado; não pode passar do prazo (after_due_date)' },
            due_date: { type: ['string', 'null'], format: 'date' },
            estimated_hours: { type: ['number', 'null'], exclusiveMinimum: 0 },
            actual_hours: { type: ['number', 'null'], exclusiveMinimum: 0 },
            custom_values: { type: 'object', description: 'por nome técnico; ausente = mantém; obrigatórios visíveis do tipo são exigidos', additionalProperties: true },
            tag_ids: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'substitui as tags da tarefa' },
            checklist: {
              type: 'array',
              maxItems: 100,
              description: 'substitui o checklist; itens sem id recebem um novo',
              items: { type: 'object', required: ['text'], properties: { id: { type: 'string' }, text: { type: 'string', maxLength: 300 }, done: { type: 'boolean' } } },
            },
          },
        },
        Status: { type: 'object', properties: Object.assign({}, LOOKUP_PROPERTIES, { category: STATUS_CATEGORY }, STATUS_FLOW) },
        StatusInput: { type: 'object', properties: Object.assign({}, LOOKUP_INPUT, { category: STATUS_CATEGORY }, STATUS_FLOW) },
        Priority: {
          type: 'object',
          properties: Object.assign({}, LOOKUP_PROPERTIES, {
            name: { type: 'string', description: 'no idioma do Accept-Language (pt-BR, en, es); sem tradução = original' },
            translations: {
              type: 'object',
              description: 'todas as versões para edição: pt-BR (original) + en/es ("" = sem tradução)',
              additionalProperties: { type: 'object', properties: { name: { type: 'string' } } },
            },
          }),
        },
        PriorityInput: {
          type: 'object',
          properties: Object.assign({}, LOOKUP_INPUT, {
            name: { type: 'string', description: 'original (pt-BR)' },
            translations: {
              type: 'object',
              description: 'opcional: { en: { name }, es: { name } } — substitui as traduções; vazio = usa o original. Idioma fora de en/es = invalid_locale',
              additionalProperties: { type: 'object', properties: { name: { type: 'string', maxLength: 60 } } },
            },
          }),
        },
        Area: { type: 'object', properties: LOOKUP_PROPERTIES, description: 'is_default sempre false (a área não tem padrão)' },
        AreaInput: { type: 'object', properties: Object.fromEntries(Object.entries(LOOKUP_INPUT).filter(([key]) => key !== 'is_default')) },
        FieldOption: {
          type: 'object',
          properties: { id: { type: 'string' }, label: { type: 'string' }, color: { type: 'string' }, order: { type: 'integer' }, is_active: { type: 'boolean' } },
        },
        CustomField: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string', examples: ['severidade'] },
            label: { type: 'string', examples: ['Severidade'] },
            type: { type: 'string', enum: ['text', 'textarea', 'number', 'decimal', 'boolean', 'date', 'datetime', 'select', 'multiselect', 'user', 'users', 'project', 'url', 'email', 'phone', 'image', 'file'] },
            description: { type: 'string' },
            config: {
              type: 'object',
              properties: {
                max_length: { type: 'integer' },
                min: { type: 'number' },
                max: { type: 'number' },
                decimals: { type: 'integer' },
                allow_create_options: { type: 'boolean', description: 'Seleção: quem cria/edita tarefas pode adicionar opções pelo formulário da tarefa (ausente = desligado)' },
              },
            },
            default_value: { description: 'Valor no formato do tipo; em seleção, id(s) da opção' },
            searchable: { type: 'boolean' },
            filterable: { type: 'boolean' },
            sortable: { type: 'boolean' },
            options: { type: 'array', items: ref('FieldOption') },
            used_by: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' } } } },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        CustomFieldInput: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Só na criação; /^[a-z][a-z0-9_]{1,39}$/' },
            label: { type: 'string' },
            type: { type: 'string', enum: ['text', 'textarea', 'number', 'decimal', 'boolean', 'date', 'datetime', 'select', 'multiselect', 'user', 'users', 'project', 'url', 'email', 'phone', 'image', 'file'], description: 'Só na criação' },
            description: { type: 'string' },
            config: { type: 'object' },
            default_value: { description: 'Ignorado em seleção: o padrão vem de options[].is_default' },
            searchable: { type: 'boolean' },
            filterable: { type: 'boolean' },
            sortable: { type: 'boolean' },
            options: {
              type: 'array',
              items: {
                type: 'object',
                required: ['label'],
                properties: { id: { type: 'string' }, label: { type: 'string' }, color: { type: 'string' }, is_active: { type: 'boolean' }, is_default: { type: 'boolean' } },
              },
            },
          },
        },
        TaskType: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            key: { type: 'string', examples: ['BUG'] },
            name: { type: 'string', description: 'no idioma do Accept-Language (pt-BR, en, es); sem tradução = original' },
            description: { type: 'string', description: 'no idioma do Accept-Language; sem tradução = original' },
            translations: {
              type: 'object',
              description: 'todas as versões para edição: pt-BR (original) + en/es ("" = sem tradução)',
              additionalProperties: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } },
            },
            icon: { type: 'string' },
            color: { type: 'string' },
            order: { type: 'integer' },
            is_active: { type: 'boolean' },
            field_count: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        DocSpace: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            key: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            icon: { type: 'string' },
            color: { type: 'string' },
            visibility: { type: 'string', enum: ['company', 'project'] },
            project: { type: ['object', 'null'] },
            module: { type: ['object', 'null'], description: 'módulo da tela inicial (§43): { id, name, color }; null = Sem módulo' },
            home_page_id: { type: 'string' },
            page_count: { type: 'integer' },
            capabilities: { type: 'object', properties: { edit: { type: 'boolean' }, manage: { type: 'boolean' } } },
          },
        },
        DocSpaceInput: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'só na criação; /^[A-Z][A-Z0-9]{1,9}$/' },
            name: { type: 'string', maxLength: 80 },
            description: { type: 'string', maxLength: 500 },
            icon: { type: 'string' },
            color: { type: 'string' },
            project_id: { type: 'string', description: 'só na criação' },
            module_id: { type: ['string', 'null'], description: 'módulo da documentação; "" ou null = Sem módulo' },
            visibility: { type: 'string', enum: ['company', 'project'] },
          },
        },
        DocModule: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            color: { type: 'string' },
            position: { type: 'integer' },
            space_count: { type: 'integer', description: 'espaços que a pessoa vê no módulo' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        DocModuleInput: {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 60 },
            color: { type: 'string', enum: ['gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'violet', 'pink'] },
            position: { type: 'integer', minimum: 0, description: 'só na edição: novo índice na lista' },
          },
        },
        DocPage: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            space: { type: 'object' },
            parent_id: { type: ['string', 'null'] },
            title: { type: 'string' },
            status: { type: 'string', enum: ['draft', 'published'] },
            content: { type: ['object', 'null'], description: 'JSON do editor (publicado)' },
            version: { type: 'integer' },
            ancestors: { type: 'array', items: { type: 'object' } },
            children: { type: 'array', items: { type: 'object' } },
            draft: { type: ['object', 'null'] },
            capabilities: { type: 'object' },
          },
        },
        Milestone: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            project_id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            due_date: { type: 'string', format: 'date' },
            state: { type: 'string', enum: ['pending', 'done'] },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        MilestoneInput: {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 120, description: 'obrigatório na criação' },
            description: { type: 'string', maxLength: 1000 },
            due_date: { type: 'string', format: 'date', description: 'obrigatório na criação' },
            state: { type: 'string', enum: ['pending', 'done'] },
          },
        },
        CharterItem: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            project_id: { type: 'string' },
            kind: { type: 'string', enum: ['objective', 'feature', 'scope_in', 'scope_out', 'result'] },
            title: { type: 'string' },
            description: { type: 'string' },
            position: { type: 'integer' },
            owner: { oneOf: [ref('UserSummary'), { type: 'null' }] },
            state: { type: 'string', description: 'objetivo/funcionalidade: auto ou o estado escolhido à mão' },
            effective_state: { type: 'string', description: 'objetivo: pending|in_progress|achieved|at_risk; funcionalidade: planned|in_progress|late|delivered|cancelled (late = alguma tarefa vinculada aberta com o prazo vencido)' },
            link_ids: { type: 'array', items: { type: 'string' }, description: 'objetivo: funcionalidades e resultados vinculados' },
            task_ids: { type: 'array', items: { type: 'string' }, description: 'funcionalidade: tarefas vinculadas' },
            tasks: { type: 'array', items: ref('Task'), description: 'funcionalidade: resumo das tarefas (com tasks.view)' },
            progress: { type: 'object', properties: { done: { type: 'integer' }, total: { type: 'integer' } } },
            unit: { type: 'string' },
            baseline: { type: 'number' },
            target: { type: 'number' },
            current: { type: ['number', 'null'] },
            start_date: { type: ['string', 'null'], format: 'date' },
            due_date: { type: ['string', 'null'], format: 'date' },
            frequency: { type: 'string', enum: ['none', 'weekly', 'monthly', 'quarterly'] },
            measured_at: { type: ['string', 'null'], format: 'date' },
            situation: { type: 'string', enum: ['achieved', 'on_track', 'late', 'no_data'] },
            percent: { type: 'integer' },
            stale: { type: 'boolean', description: 'passou do intervalo da frequência sem medição' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        CharterItemInput: {
          type: 'object',
          description: 'Cada tipo aceita só os seus campos; os demais são ignorados',
          properties: {
            kind: { type: 'string', enum: ['objective', 'feature', 'scope_in', 'scope_out', 'result'], description: 'obrigatório na criação; não muda' },
            title: { type: 'string', maxLength: 200, description: 'obrigatório na criação' },
            description: { type: 'string', maxLength: 1000 },
            state: { type: 'string', description: 'objetivo: auto|pending|in_progress|achieved|at_risk; funcionalidade: auto|planned|in_progress|late|delivered|cancelled' },
            owner_id: { type: ['string', 'null'], description: 'dono ou membro do projeto' },
            link_ids: { type: 'array', items: { type: 'string' }, maxItems: 50 },
            task_ids: { type: 'array', items: { type: 'string' }, maxItems: 200 },
            unit: { type: 'string', maxLength: 20 },
            baseline: { type: 'number' },
            target: { type: 'number', description: 'resultado: obrigatório na criação' },
            start_date: { type: ['string', 'null'], format: 'date' },
            due_date: { type: ['string', 'null'], format: 'date' },
            frequency: { type: 'string', enum: ['none', 'weekly', 'monthly', 'quarterly'] },
          },
        },
        CharterMeasurement: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            item_id: { type: 'string' },
            value: { type: 'number' },
            note: { type: 'string' },
            measured_at: { type: 'string', format: 'date' },
            created_by: { oneOf: [ref('UserSummary'), { type: 'null' }] },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Charter: {
          type: 'object',
          properties: {
            project_id: { type: 'string' },
            objective: { type: 'string' },
            updated_at: { type: ['string', 'null'], format: 'date-time' },
            updated_by: { oneOf: [ref('UserSummary'), { type: 'null' }] },
            capabilities: { type: 'object', properties: { edit: { type: 'boolean' } } },
            completeness: { type: 'object', properties: { sections: { type: 'object' }, done: { type: 'integer' }, total: { type: 'integer' }, percent: { type: 'integer' } } },
            summary: { type: 'object', description: 'features_total, features_delivered, tasks_total, tasks_done, results_total, results_on_track, results_late, results_stale' },
            items: { type: 'array', items: ref('CharterItem') },
          },
        },
        Timeline: {
          type: 'object',
          properties: {
            project: { type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' }, start_date: { type: 'string', nullable: true }, due_date: { type: 'string', nullable: true }, archived: { type: 'boolean' } } },
            capabilities: { type: 'object', properties: { edit: { type: 'boolean' }, manage_milestones: { type: 'boolean' } } },
            tasks: { type: 'array', items: ref('Task') },
            dependencies: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, type: { type: 'string', enum: ['blocks', 'depends_on'] }, from: { type: 'string' }, to: { type: 'string' }, conflict: { type: 'boolean' } } } },
            milestones: { type: 'array', items: ref('Milestone') },
            sprints: { type: 'array', items: { type: 'object' } },
            truncated: { type: 'boolean' },
          },
        },
        TaskTypeInput: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Só na criação; /^[A-Z][A-Z0-9_]{1,29}$/' },
            name: { type: 'string', description: 'original (pt-BR)' },
            description: { type: 'string', description: 'original (pt-BR)' },
            translations: {
              type: 'object',
              description: 'opcional: { en: { name, description }, es: {…} } — substitui as traduções; vazio = usa o original. Idioma fora de en/es = invalid_locale',
              additionalProperties: { type: 'object', properties: { name: { type: 'string', maxLength: 60 }, description: { type: 'string', maxLength: 255 } } },
            },
            icon: { type: 'string' },
            color: { type: 'string' },
            is_active: { type: 'boolean' },
          },
        },
        TaskTypeDetail: {
          allOf: [
            ref('TaskType'),
            {
              type: 'object',
              properties: {
                fields: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      field: ref('CustomField'),
                      order: { type: 'integer' },
                      required: { type: 'boolean' },
                      visible: { type: 'boolean' },
                      show_on_card: { type: 'boolean' },
                      required_status_ids: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            },
          ],
        },
        Project: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            key: { type: 'string', examples: ['CRM'] },
            description: { type: 'string' },
            icon: { type: 'string' },
            cover: { type: 'string' },
            status: { type: 'string', enum: ['planning', 'active', 'paused', 'completed', 'cancelled'] },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            urgency: { type: ['string', 'null'], enum: ['high', 'medium', 'low', null], description: 'urgência (semáforo); null = sem urgência' },
            area: AREA_REF,
            company: COMPANY_REF,
            parent: {
              oneOf: [
                { type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' }, icon: { type: 'string' }, cover: { type: 'string' } } },
                { type: 'null' },
              ],
              description: 'projeto pai (§34)',
            },
            child_count: { type: 'integer', description: 'quantidade de subprojetos (inclusive arquivados)' },
            owner: ref('UserSummary'),
            start_date: { type: ['string', 'null'], format: 'date-time' },
            due_date: { type: ['string', 'null'], format: 'date-time' },
            archived_at: { type: ['string', 'null'], format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
            member_count: { type: 'integer' },
            my_role: { type: ['string', 'null'], enum: ['owner', 'manager', 'member', 'viewer', 'it', null], description: 'it = Responsável TI (§33)' },
            capabilities: {
              type: 'object',
              properties: {
                edit: { type: 'boolean' },
                manage_members: { type: 'boolean' },
                archive: { type: 'boolean' },
                delete: { type: 'boolean' },
                transfer: { type: 'boolean' },
                upload_files: { type: 'boolean' },
                sections: { type: 'array', items: { type: 'string', enum: ['charter', 'history', 'members', 'report'] }, description: 'seções do projeto que o usuário vê (§35)' },
              },
            },
          },
        },
        ProjectInput: {
          type: 'object',
          required: ['name', 'key'],
          properties: {
            name: { type: 'string', maxLength: 120 },
            key: { type: 'string', pattern: '^[A-Z][A-Z0-9]{1,9}$', description: 'Somente na criação (imutável)' },
            description: { type: 'string', maxLength: 10000 },
            icon: { type: 'string' },
            cover: { type: 'string' },
            status: { type: 'string', enum: ['planning', 'active', 'paused', 'completed', 'cancelled'] },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            urgency: { type: ['string', 'null'], enum: ['high', 'medium', 'low', null], description: 'urgência (semáforo); null limpa' },
            area_id: { type: ['string', 'null'], description: 'área responsável ativa de /areas; null limpa' },
            company_id: { type: ['string', 'null'], description: 'empresa ativa de /companies (§46); obrigatória ao criar quando existe alguma ativa (required); null limpa só quando não há nenhuma ativa' },
            parent_id: { type: ['string', 'null'], description: 'projeto pai (§34: um só nível, pai que a pessoa edita); null solta' },
            start_date: { type: ['string', 'null'], format: 'date', description: 'AAAA-MM-DD; null limpa' },
            due_date: { type: ['string', 'null'], format: 'date', description: 'AAAA-MM-DD; null limpa' },
          },
        },
        ProjectMember: {
          type: 'object',
          properties: {
            user: ref('UserSummary'),
            role: { type: 'string', enum: ['manager', 'member', 'viewer', 'it'] },
            is_owner: { type: 'boolean' },
            joined_at: { type: 'string', format: 'date-time' },
          },
        },
        Me: {
          type: 'object',
          properties: {
            user: ref('User'),
            role: ref('Role'),
            permissions: { type: 'array', items: { type: 'string' } },
            session: ref('Session'),
            platform: {
              type: 'object',
              description: 'o que a plataforma liga ou desliga para todos (Configurações → Geral)',
              properties: { panorama_enabled: { type: 'boolean', description: 'Panorama (§26.2); false = fora do menu e da página inicial de todos' } },
            },
          },
        },
      },
    },
  }
}

module.exports = { build }
