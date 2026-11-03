/**
 * Especificação OpenAPI 3.1 da API /api/v1 (servida em GET /api/v1/openapi.json).
 * Mantenha em sincronia com main.pb.js e docs/api.md.
 */

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

function op(summary, tags, responses, extra) {
  return Object.assign({ summary, tags, responses: Object.assign({}, responses, COMMON_ERRORS) }, extra || {})
}

function jsonBody(schema) {
  return { required: true, content: { 'application/json': { schema } } }
}

/** Caminhos de uma lista configurável (status ou prioridades): mesmas regras, prefixo de erro próprio. */
function lookupPaths(base, label, schema, errorPrefix) {
  const tags = ['workflow']
  return {
    [base]: {
      get: op(`${label} em ordem; inativos só com include_inactive=1 e settings.manage`, tags, { 200: ok(label, { type: 'array', items: ref(schema) }) }, {
        parameters: [{ name: 'include_inactive', in: 'query', schema: { type: 'string', enum: ['1'] } }],
      }),
      post: op(`Cria item (settings.manage); o primeiro vira o padrão`, tags, { 201: ok('Criado', ref(schema)), 409: errorResponse(`${errorPrefix}_KEY_IN_USE`) }, {
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
      patch: op('Atualiza (settings.manage); chave imutável; is_default=true desmarca o anterior; o padrão não pode ser desativado', tags, { 200: ok('Atualizado', ref(schema)) }, {
        parameters: [idParam, csrfHeader],
        requestBody: jsonBody(ref(`${schema}Input`)),
      }),
      delete: op('Exclui item sem tarefas e que não é o padrão', tags, { 200: ok('Excluído', { type: 'object' }), 409: errorResponse(`${errorPrefix}_IN_USE | ${errorPrefix}_IS_DEFAULT`) }, {
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
      title: 'BLYD Sync API',
      version: 'v1',
      description:
        'API REST da plataforma BLYD Sync. Autenticação por cookie de sessão HttpOnly (kb_session). ' +
        'Todas as respostas seguem o envelope { data, meta, error }.',
    },
    servers: [{ url: '/api/v1' }],
    security: [{ sessionCookie: [] }, { bearerToken: [] }],
    paths: Object.assign(lookupPaths('/statuses', 'Status', 'Status', 'STATUS'), lookupPaths('/priorities', 'Prioridades', 'Priority', 'PRIORITY'), lookupPaths('/areas', 'Áreas responsáveis', 'Area', 'AREA'), {
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
      '/auth/me': { get: op('Usuário autenticado, perfil e permissões', ['auth'], { 200: ok('Contexto do usuário', ref('Me')) }) },
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
        patch: op('Atualiza nome/descrição', ['rbac'], { 200: ok('Atualizado', ref('Role')) }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } }),
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
      '/projects': {
        get: op('Lista projetos acessíveis (paginado)', ['projects'], { 200: ok('Página de projetos', { type: 'array', items: ref('Project') }, true) }, {
          parameters: [
            { name: 'view', in: 'query', schema: { type: 'string', enum: ['all', 'mine', 'archived'] } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'perPage', in: 'query', schema: { type: 'integer', maximum: 100 } },
            { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'name, key, created_at, due_date, status, priority; prefixo "-" = desc' },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'priority', in: 'query', schema: { type: 'string' } },
            { name: 'urgency', in: 'query', schema: { type: 'string', enum: ['high', 'medium', 'low', 'none'] }, description: 'urgência do projeto; none = sem urgência' },
            { name: 'area_id', in: 'query', schema: { type: 'string' }, description: 'área responsável; none = sem área' },
            { name: 'owner_id', in: 'query', schema: { type: 'string' } },
          ],
        }),
        post: op('Cria projeto (projects.create); criador vira dono e gestor', ['projects'], { 201: ok('Criado', ref('Project')), 409: errorResponse('PROJECT_KEY_IN_USE') }, {
          parameters: [csrfHeader],
          requestBody: jsonBody(ref('ProjectInput')),
        }),
      },
      '/projects/{id}': {
        get: op('Detalhe do projeto (404 se sem acesso)', ['projects'], { 200: ok('Projeto', ref('Project')), 404: errorResponse('PROJECT_NOT_FOUND') }, { parameters: [idParam] }),
        patch: op('Atualiza projeto (gestor + projects.edit); a chave é imutável', ['projects'], { 200: ok('Atualizado', ref('Project')), 409: errorResponse('PROJECT_ARCHIVED') }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody(ref('ProjectInput')),
        }),
        delete: op('Exclui projeto arquivado (dono ou projects.view_all + projects.delete)', ['projects'], { 200: ok('Excluído', { type: 'object' }), 409: errorResponse('PROJECT_NOT_ARCHIVED') }, {
          parameters: [idParam, csrfHeader],
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
        get: op('Histórico de auditoria do projeto', ['projects'], { 200: ok('Registros', { type: 'array', items: ref('AuditEntry') }, true) }, { parameters: [idParam] }),
      },
      '/projects/{id}/members': {
        get: op('Membros do projeto', ['projects'], { 200: ok('Membros', { type: 'array', items: ref('ProjectMember') }) }, { parameters: [idParam] }),
        post: op('Adiciona membro (gestor)', ['projects'], { 201: ok('Membros atualizados', { type: 'array', items: ref('ProjectMember') }), 409: errorResponse('MEMBER_ALREADY_EXISTS') }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['user_id', 'role'], properties: { user_id: { type: 'string' }, role: { type: 'string', enum: ['manager', 'member', 'viewer', 'it'] } } }),
        }),
      },
      '/projects/{id}/member-candidates': {
        get: op('Usuários ativos que podem ser adicionados (gestor)', ['projects'], { 200: ok('Candidatos', { type: 'array', items: ref('UserSummary') }) }, {
          parameters: [idParam, { name: 'search', in: 'query', schema: { type: 'string' } }],
        }),
      },
      '/projects/{id}/members/{userId}': {
        patch: op('Altera o papel do membro (gestor; papel do dono é fixo)', ['projects'], { 200: ok('Membros', { type: 'array', items: ref('ProjectMember') }), 409: errorResponse('OWNER_ROLE_LOCKED') }, {
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
            { name: 'priority_id', in: 'query', schema: { type: 'string' } },
            { name: 'assignee_id', in: 'query', schema: { type: 'string' }, description: 'ID ou "me"' },
            { name: 'category', in: 'query', schema: { type: 'string' }, description: 'categorias de status separadas por vírgula (ex.: backlog,todo,in_progress)' },
            { name: 'tag_id', in: 'query', schema: { type: 'string' } },
            { name: 'sprint_id', in: 'query', schema: { type: 'string' }, description: 'id da sprint ou `none` (sem sprint)' },
            { name: 'in_report', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'entra (true) ou não (false) no informe do projeto' },
            { name: 'urgency', in: 'query', schema: { type: 'string', enum: ['high', 'medium', 'low', 'none'] }, description: 'urgência (semáforo); none = sem urgência' },
            { name: 'area_id', in: 'query', schema: { type: 'string' }, description: 'área responsável; none = sem área' },
            { name: 'search', in: 'query', schema: { type: 'string' }, description: 'título, código e campos personalizados pesquisáveis' },
            { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'code, title, created_at, updated_at, due_date, priority, status; prefixo "-" = desc' },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'perPage', in: 'query', schema: { type: 'integer', maximum: 100 } },
          ],
        }),
        post: op('Cria tarefa (tasks.create + colaborador do projeto)', ['tasks'], { 201: ok('Criada', ref('TaskDetail')), 404: errorResponse('PROJECT_NOT_FOUND') }, {
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
      '/tasks/{id}/report': {
        put: op('Liga/desliga a tarefa no informe do projeto (aba Informe); quem edita a tarefa; não exige os obrigatórios do status', ['tasks'], {
          200: ok('Tarefa', ref('TaskDetail')),
        }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['in_report'], properties: { in_report: { type: 'boolean' } } }),
        }),
      },
      '/tasks/{id}/urgency': {
        put: op('Urgência da tarefa (semáforo alta/média/baixa; null limpa); quem edita a tarefa; não exige os obrigatórios do status', ['tasks'], {
          200: ok('Tarefa', ref('TaskDetail')),
        }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['urgency'], properties: { urgency: { type: 'string', enum: ['high', 'medium', 'low'], nullable: true } } }),
        }),
      },
      '/tasks/{id}/area': {
        put: op('Área responsável da tarefa (null limpa); quem edita a tarefa; não exige os obrigatórios do status', ['tasks'], {
          200: ok('Tarefa', ref('TaskDetail')),
        }, {
          parameters: [idParam, csrfHeader],
          requestBody: jsonBody({ type: 'object', required: ['area_id'], properties: { area_id: { type: 'string', nullable: true } } }),
        }),
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
        get: op('Pessoas que podem ser mencionadas (ativas com acesso ao projeto)', ['comments'], { 200: ok('Pessoas', { type: 'array', items: ref('UserSummary') }) }, { parameters: [idParam] }),
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
        get: op('Indicadores e relatórios (reports.view) no escopo visível; sem projetos arquivados, salvo se escolhido em project_id. Período padrão: últimos 30 dias', ['reports'], {
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
        get: op('Resumo do projeto para o Responsável TI: objetivo geral, as tarefas atribuídas a quem pede e os itens da ficha sob a responsabilidade dele', ['charter'], { 200: ok('Resumo', { type: 'object', properties: { objective: { type: 'string' }, tasks: { type: 'array', items: ref('Task') }, items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string', enum: ['feature', 'result'] }, title: { type: 'string' }, description: { type: 'string' }, unit: { type: 'string' }, target: { type: ['number', 'null'] }, due_date: { type: ['string', 'null'] } } } } } }), 404: errorResponse('PROJECT_NOT_FOUND') }, { parameters: [idParam] }),
      },
      '/projects/{id}/charter': {
        get: op(
          'Ficha do projeto (quem vê o projeto): objetivo geral, itens com estado calculado (funcionalidades pelas tarefas vinculadas, objetivos pelos vínculos, resultados pela meta e o prazo), completude e resumo',
          ['charter'],
          { 200: ok('Ficha', ref('Charter')), 404: errorResponse('PROJECT_NOT_FOUND') },
          { parameters: [idParam] },
        ),
        put: op('Grava o objetivo geral (gestor/dono)', ['charter'], { 200: ok('Ficha', ref('Charter')), 403: errorResponse('FORBIDDEN') }, { parameters: [idParam, csrfHeader], requestBody: jsonBody({ type: 'object', required: ['objective'], properties: { objective: { type: 'string', maxLength: 2000 } } }) }),
      },
      '/projects/{id}/charter/items': {
        post: op('Cria item da ficha (gestor/dono)', ['charter'], { 201: ok('Item', ref('CharterItem')), 403: errorResponse('FORBIDDEN'), 404: errorResponse('PROJECT_NOT_FOUND') }, { parameters: [idParam, csrfHeader], requestBody: jsonBody(ref('CharterItemInput')) }),
      },
      '/projects/{id}/charter/order': {
        put: op('Nova ordem dos itens de um tipo (gestor/dono)', ['charter'], { 200: ok('Ficha', ref('Charter')) }, { parameters: [idParam, csrfHeader], requestBody: jsonBody({ type: 'object', required: ['kind', 'ids'], properties: { kind: { type: 'string', enum: ['objective', 'feature', 'scope_in', 'scope_out', 'result'] }, ids: { type: 'array', items: { type: 'string' } } } }) }),
      },
      '/charter-items/{id}': {
        patch: op('Edita item da ficha (gestor/dono). O tipo não muda', ['charter'], { 200: ok('Item', ref('CharterItem')), 404: errorResponse('CHARTER_ITEM_NOT_FOUND') }, { parameters: [idParam, csrfHeader], requestBody: jsonBody(ref('CharterItemInput')) }),
        delete: op('Exclui item da ficha (gestor/dono)', ['charter'], { 200: ok('Excluído', { type: 'object' }), 404: errorResponse('CHARTER_ITEM_NOT_FOUND') }, { parameters: [idParam, csrfHeader] }),
      },
      '/charter-items/{id}/measurements': {
        get: op('Medições de um resultado esperado (mais recente primeiro)', ['charter'], { 200: ok('Medições', { type: 'array', items: ref('CharterMeasurement') }), 404: errorResponse('CHARTER_ITEM_NOT_FOUND') }, { parameters: [idParam] }),
        post: op(
          'Registra medição (gestor/dono ou o responsável pelo resultado). A mais recente vira o valor atual',
          ['charter'],
          { 201: ok('Item', ref('CharterItem')), 403: errorResponse('FORBIDDEN'), 404: errorResponse('CHARTER_ITEM_NOT_FOUND') },
          { parameters: [idParam, csrfHeader], requestBody: jsonBody({ type: 'object', required: ['value'], properties: { value: { type: 'number' }, note: { type: 'string', maxLength: 500 }, measured_at: { type: 'string', format: 'date', description: 'padrão: hoje; não pode ser futura' } } }) },
        ),
      },
      '/docs/spaces': {
        get: op('Espaços de documentação que a pessoa lê (docs.view + visibilidade)', ['docs'], { 200: ok('Espaços', { type: 'array', items: ref('DocSpace') }) }),
        post: op('Cria espaço (docs.manage; espaço de projeto exige ser gestor). Nasce com a página inicial publicada', ['docs'], { 201: ok('Espaço', ref('DocSpace')), 409: errorResponse('DOC_SPACE_KEY_IN_USE') }, { parameters: [csrfHeader], requestBody: jsonBody(ref('DocSpaceInput')) }),
      },
      '/docs/spaces/{id}': {
        get: op('Espaço pela CHAVE (ex.: MANUAL), com a árvore de páginas visíveis (rascunhos só para quem edita)', ['docs'], { 200: ok('Espaço e páginas', { type: 'object' }), 404: errorResponse('DOC_SPACE_NOT_FOUND') }, { parameters: [idParam] }),
        patch: op('Configura o espaço (quem gerencia): name, description, icon, color, visibility', ['docs'], { 200: ok('Espaço', ref('DocSpace')), 404: errorResponse('DOC_SPACE_NOT_FOUND') }, { parameters: [idParam, csrfHeader], requestBody: jsonBody(ref('DocSpaceInput')) }),
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
        patch: op('Altera (platform.manage), parcial: audit_retention_months (1, 3, 6, 12, 24 ou 0 = manter sempre), lockout_threshold (3–20), lockout_base_minutes (1–60), lockout_max_minutes (≥ inicial, até 1440), password_min_length (8–64), password_require_mixed_case, password_require_symbol, platform_name (até 40). Com dry_run: true devolve { dry_run, audit_to_delete } sem gravar', ['platform'], { 200: ok('Configurações ou prévia', { type: 'object' }), 400: errorResponse('VALIDATION_ERROR') }, { parameters: [csrfHeader] }),
      },
      '/settings/platform/branding/{slot}': {
        post: op('Envia logo/ícone (platform.manage): multipart "file" — PNG, JPG, WebP, SVG sem conteúdo ativo (ICO só no ícone), até 1 MB, tipo conferido pelo conteúdo', ['platform'], { 200: ok('Configurações', { type: 'object' }), 400: errorResponse('VALIDATION_ERROR') }, { parameters: [{ name: 'slot', in: 'path', required: true, schema: { type: 'string', enum: ['logo_light', 'logo_dark', 'favicon'] } }, csrfHeader] }),
        delete: op('Remove logo/ícone (volta a marca padrão)', ['platform'], { 200: ok('Configurações', { type: 'object' }) }, { parameters: [{ name: 'slot', in: 'path', required: true, schema: { type: 'string', enum: ['logo_light', 'logo_dark', 'favicon'] } }, csrfHeader] }),
      },
      '/settings/platform/purge-audit': {
        post: op('Aplica a retenção do histórico agora (platform.manage; mesma regra da rotina diária) → { removed }', ['platform'], { 200: ok('Resultado', { type: 'object' }) }, { parameters: [csrfHeader] }),
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
      '/auth/password-policy': {
        get: op('Exigências vigentes para senhas (quem está logado): { min_length, max_length, require_letters_numbers, require_mixed_case, require_symbol }', ['auth'], { 200: ok('Política', { type: 'object' }) }),
      },
      '/docs/recent': {
        get: op('Páginas publicadas mais recentes dos espaços visíveis', ['docs'], { 200: ok('Recentes', { type: 'array', items: { type: 'object' } }) }),
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
            project: { type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' } } },
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
            urgency: { type: 'string', enum: ['high', 'medium', 'low'], nullable: true, description: 'urgência (semáforo): alta = vermelho, média = amarelo, baixa = verde' },
            area: { oneOf: [{ type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' }, color: { type: 'string' } } }, { type: 'null' }], description: 'área responsável (lista de /areas)' },
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
        Board: {
          type: 'object',
          properties: {
            project: { type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' }, archived: { type: 'boolean' } } },
            capabilities: { type: 'object', properties: { move: { type: 'boolean' }, create: { type: 'boolean' } } },
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
                        { type: 'object', properties: { card_fields: { type: 'array', items: { type: 'object', properties: { field: { type: 'object' }, value: {} } } } } },
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
            task_type_id: { type: 'string', description: 'Trocar o tipo descarta valores de campos que o novo tipo não tem' },
            parent_task_id: { type: ['string', 'null'], description: 'Subtarefa: pai do mesmo projeto, sem ciclo; null solta' },
            sprint_id: { type: ['string', 'null'], description: 'Sprint aberto do mesmo projeto; null tira da sprint' },
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
        Priority: { type: 'object', properties: LOOKUP_PROPERTIES },
        Area: { type: 'object', properties: LOOKUP_PROPERTIES },
        PriorityInput: { type: 'object', properties: LOOKUP_INPUT },
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
            config: { type: 'object', properties: { max_length: { type: 'integer' }, min: { type: 'number' }, max: { type: 'number' }, decimals: { type: 'integer' } } },
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
            visibility: { type: 'string', enum: ['company', 'project'] },
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
            owner: { type: 'object', nullable: true },
            state: { type: 'string', description: 'objetivo/funcionalidade: auto ou o estado escolhido à mão' },
            effective_state: { type: 'string', description: 'objetivo: pending|in_progress|achieved|at_risk; funcionalidade: planned|in_progress|late|delivered|cancelled' },
            link_ids: { type: 'array', items: { type: 'string' }, description: 'objetivo: funcionalidades e resultados vinculados' },
            task_ids: { type: 'array', items: { type: 'string' }, description: 'funcionalidade: tarefas vinculadas' },
            tasks: { type: 'array', items: ref('Task'), description: 'funcionalidade: resumo das tarefas (com tasks.view)' },
            progress: { type: 'object', properties: { done: { type: 'integer' }, total: { type: 'integer' } } },
            unit: { type: 'string' },
            baseline: { type: 'number' },
            target: { type: 'number' },
            current: { type: 'number', nullable: true },
            start_date: { type: 'string', format: 'date', nullable: true },
            due_date: { type: 'string', format: 'date', nullable: true },
            frequency: { type: 'string', enum: ['none', 'weekly', 'monthly', 'quarterly'] },
            measured_at: { type: 'string', format: 'date', nullable: true },
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
            owner_id: { type: 'string', nullable: true, description: 'dono ou membro do projeto' },
            link_ids: { type: 'array', items: { type: 'string' }, maxItems: 50 },
            task_ids: { type: 'array', items: { type: 'string' }, maxItems: 200 },
            unit: { type: 'string', maxLength: 20 },
            baseline: { type: 'number' },
            target: { type: 'number', description: 'resultado: obrigatório na criação' },
            start_date: { type: 'string', format: 'date', nullable: true },
            due_date: { type: 'string', format: 'date', nullable: true },
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
            created_by: { type: 'object', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Charter: {
          type: 'object',
          properties: {
            project_id: { type: 'string' },
            objective: { type: 'string' },
            updated_at: { type: 'string', format: 'date-time', nullable: true },
            updated_by: { type: 'object', nullable: true },
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
            urgency: { type: 'string', enum: ['high', 'medium', 'low'], nullable: true, description: 'urgência (semáforo); aceita null para limpar' },
            area: { oneOf: [{ type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' }, color: { type: 'string' } } }, { type: 'null' }], description: 'área responsável (lista de /areas)' },
            owner: ref('UserSummary'),
            start_date: { type: ['string', 'null'], format: 'date-time' },
            due_date: { type: ['string', 'null'], format: 'date-time' },
            archived_at: { type: ['string', 'null'], format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
            member_count: { type: 'integer' },
            my_role: { type: ['string', 'null'], enum: ['owner', 'manager', 'member', 'viewer', 'it', null] },
            capabilities: {
              type: 'object',
              properties: { edit: { type: 'boolean' }, manage_members: { type: 'boolean' }, archive: { type: 'boolean' }, delete: { type: 'boolean' }, transfer: { type: 'boolean' } },
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
          },
        },
      },
    },
  }
}

module.exports = { build }
