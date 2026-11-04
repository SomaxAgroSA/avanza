# API REST `/api/v1`

Especificação OpenAPI 3.1 servida em **`GET /api/v1/openapi.json`** (fonte: `backend/pb_hooks/src/http/openapi.js`).

## Convenções

- **Autenticação:** cookie `kb_session` (HttpOnly), obtido em `POST /auth/login`. Não há token no corpo das respostas.
- **CSRF:** `POST`, `PUT`, `PATCH` e `DELETE` exigem o header `X-Requested-With: kamban` (senão `403 CSRF_CHECK_FAILED`).
- **Correlation ID:** envie `X-Correlation-Id` (8–64 caracteres `[A-Za-z0-9-]`) ou o servidor gera um. Volta no header e em `meta.correlationId`.
- **JSON em snake_case**, datas ISO 8601 (UTC). Corpo JSON limitado a 1 MB.
- **Cache:** respostas com `Cache-Control: no-store`.

### Envelope
```json
{ "data": {}, "meta": { "correlationId": "..." }, "error": null }
```
```json
{ "data": null, "meta": { "correlationId": "..." }, "error": { "code": "USER_NOT_FOUND", "message": "User not found", "details": {} } }
```
**Tarefas — início planejado:** `start_date` (AAAA-MM-DD; `null` limpa) ao lado de `due_date`; início depois do prazo → `VALIDATION_ERROR` `start_date = after_due_date` (considera a data já salva quando só uma é enviada).

**Idioma:** o app envia `Accept-Language` (pt-BR, en ou es — o idioma da tela). Cadastros traduzidos (hoje: tipos de tarefa) saem nele; sem tradução ou idioma não suportado, sai o original (pt-BR). Os tipos também trazem `translations` com todas as versões (`pt-BR`, `en`, `es`; `""` = sem tradução) para edição; criar/editar aceita `translations: { en: { name, description }, es: {…} }` (substitui as anteriores; idioma fora de en/es → `VALIDATION_ERROR` `translations = invalid_locale`).

`VALIDATION_ERROR` traz `details.fields` = `{ campo: código }` (nas tarefas, campos personalizados vêm como `custom_values.<nome>`, e `details.status` = `{ id, name }` indica o status considerado — criar/editar/mover exige os campos obrigatórios do status em que a tarefa vai ficar) (códigos: `required`, `invalid_email`, `too_short`, `too_long`, `weak_password`, `invalid_format`, `invalid_option`, `invalid_type`, `too_many`, `invalid_date`, `incorrect`, `same_as_current`).

### Paginação, ordenação, filtros e busca
`?page=1&perPage=20` (máx. 100) · `?sort=name,-created_at` (só campos permitidos) · filtros por parâmetro (`status`, `role_id`) · `?search=`.
```json
"meta": { "page": 1, "perPage": 20, "total": 35, "totalPages": 2, "correlationId": "..." }
```

### Códigos de erro
| HTTP | Códigos |
|---|---|
| 400 | `VALIDATION_ERROR`, `BAD_REQUEST`, `USE_CHANGE_PASSWORD` |
| 401 | `UNAUTHENTICATED`, `SESSION_EXPIRED`, `INVALID_CREDENTIALS` |
| 403 | `FORBIDDEN`, `ACCOUNT_DISABLED`, `CSRF_CHECK_FAILED`, `PRIVILEGE_ESCALATION`, `CANNOT_EDIT_OWN_ROLE`, `CANNOT_DISABLE_SELF`, `ROLE_IMMUTABLE` |
| 404 | `ROUTE_NOT_FOUND`, `USER_NOT_FOUND`, `ROLE_NOT_FOUND`, `SESSION_NOT_FOUND`, `PROJECT_NOT_FOUND`, `MEMBER_NOT_FOUND`, `FIELD_NOT_FOUND`, `TASK_TYPE_NOT_FOUND`, `STATUS_NOT_FOUND`, `PRIORITY_NOT_FOUND`, `TASK_NOT_FOUND`, `COMMENT_NOT_FOUND`, `TAG_NOT_FOUND`, `ATTACHMENT_NOT_FOUND`, `NOTIFICATION_NOT_FOUND`, `SPRINT_NOT_FOUND`, `RELATION_NOT_FOUND`, `MILESTONE_NOT_FOUND`, `GROUP_NOT_FOUND`, `DOC_SPACE_NOT_FOUND`, `DOC_PAGE_NOT_FOUND`, `DOC_VERSION_NOT_FOUND`, `DOC_FILE_NOT_FOUND` |
| 409 | `TRANSITION_NOT_ALLOWED`, `RELATION_EXISTS`, `RELATION_CYCLE`, `NOT_IN_BACKLOG`, `EMAIL_ALREADY_IN_USE`, `ROLE_CODE_IN_USE`, `ROLE_IN_USE`, `PROJECT_KEY_IN_USE`, `PROJECT_ARCHIVED`, `PROJECT_NOT_ARCHIVED`, `MEMBER_ALREADY_EXISTS`, `CANNOT_REMOVE_OWNER`, `OWNER_ROLE_LOCKED`, `FIELD_NAME_IN_USE`, `FIELD_IN_USE`, `TASK_TYPE_KEY_IN_USE`, `TASK_TYPE_IN_USE`, `STATUS_KEY_IN_USE`, `STATUS_IN_USE`, `STATUS_IS_DEFAULT`, `PRIORITY_KEY_IN_USE`, `PRIORITY_IN_USE`, `PRIORITY_IS_DEFAULT`, `TAG_NAME_IN_USE`, `DOC_SPACE_KEY_IN_USE`, `DOC_PAGE_CYCLE`, `DOC_PAGE_TOO_DEEP`, `DOC_PAGE_IS_HOME` |
| 429 | `RATE_LIMITED`, `ACCOUNT_LOCKED` (bloqueio progressivo de login; `details.retry_after_seconds`) |
| 500 | `INTERNAL_ERROR` (sem detalhes internos; use o correlation id nos logs) |

## Endpoints — Fase 1

| Método | Rota | Permissão | Descrição |
|---|---|---|---|
| GET | `/health` | pública | status, versão, checagem do banco (503 se degradado) |
| GET | `/openapi.json` | pública | especificação |
| POST | `/auth/login` | pública | `{ email, password, remember }` → define cookie; retorna `{ user, session }` |
| POST | `/auth/logout` | autenticado | revoga a sessão atual e limpa o cookie |
| GET | `/auth/me` | autenticado | `{ user, role, permissions, session }` |
| GET | `/auth/sessions` | autenticado | sessões ativas do próprio usuário |
| DELETE | `/auth/sessions/{id}` | autenticado | revoga sessão própria (de outro usuário → 404) |
| POST | `/auth/sessions/revoke-others` | autenticado | encerra todas as outras sessões do usuário (mantém a atual) |
| POST | `/auth/password` | autenticado | `{ current_password, new_password }` — troca a própria senha e encerra as outras sessões |
| GET | `/permissions` | `permissions.manage` | catálogo |
| GET | `/roles` | `permissions.manage` ou `users.view/create/edit` | perfis com `permissions` e `user_count` |
| POST | `/roles` | `permissions.manage` | cria perfil personalizado |
| GET | `/roles/{id}` | idem listagem | detalhe |
| PATCH | `/roles/{id}` | `permissions.manage` | nome/descrição (SUPER_ADMIN imutável) |
| PUT | `/roles/{id}/permissions` | `permissions.manage` | substitui as permissões (`{ permissions: [...] }`) |
| DELETE | `/roles/{id}` | `permissions.manage` | só perfis personalizados sem usuários |
| GET | `/users` | `users.view` | lista paginada; `search`, `status`, `role_id`, `sort` (`name`, `email`, `status`, `created_at`, `last_login_at`) |
| POST | `/users` | `users.create` | `{ name, email, password, role_id, locale? }` |
| GET | `/users/{id}` | `users.view` (ou o próprio) | detalhe |
| PATCH | `/users/{id}` | `users.edit` (ou o próprio: `name`, `locale`, `theme`) | atualização parcial |
| PATCH | `/users/{id}/status` | `users.disable` | `{ status: "active" \| "disabled" }` — desativar revoga as sessões |
| POST | `/users/{id}/password` | `users.edit` | `{ password }` — redefine a senha de **outro** usuário (própria conta → `USE_CHANGE_PASSWORD`) e encerra as sessões dele |
| GET | `/users/{id}/history` | `users.view` ou `audit.view` | histórico de auditoria do usuário, paginado |
| GET | `/audit-logs` | `audit.view` | auditoria paginada (mais recentes primeiro); filtros `entity_type`, `entity_id`, `user_id`, `action`, `from`, `to` (ISO 8601) |

## Endpoints — Fase 2 (Projetos)

| Método | Rota | Regra de acesso | Descrição |
|---|---|---|---|
| GET | `/projects` | `projects.view` | `view=all\|mine\|archived`, `search`, `status`, `priority`, `urgency` (`high`, `medium`, `low`, `none`), `area_id` (ou `none`), `parent_id` (subprojetos de um pai, ou `none` = só projetos sem pai), `owner_id`, `sort` (`name`, `key`, `created_at`, `due_date`), paginado. Sem `projects.view_all`, só projetos em que é membro |
| POST | `/projects` | `projects.create` | `{ name, key, description?, icon?, cover?, status?, priority?, urgency?, area_id?, parent_id?, start_date?, due_date? }` — criador vira dono e gestor; `area_id` = área ativa de `/areas` (`null` no PATCH limpa); `parent_id` = projeto pai (§25: um só nível, pai que a pessoa edita; `null` no PATCH solta). Todo projeto sai com `parent` (`{ id, key, name, icon, cover }` ou `null`) e `child_count` |
| GET | `/projects/{id}` | ver o projeto | inclui `owner`, `member_count`, `my_role` e `capabilities` (o que o usuário pode fazer) |
| PATCH | `/projects/{id}` | gestor + `projects.edit` | parcial; `key` é imutável; datas aceitam `null`; projeto arquivado → `PROJECT_ARCHIVED` |
| POST | `/projects/{id}/archive` · `/unarchive` | gestor + `projects.edit` | arquivado = somente leitura |
| DELETE | `/projects/{id}` | dono ou `projects.view_all`, + `projects.delete` | só projeto arquivado (`PROJECT_NOT_ARCHIVED`) |
| PUT | `/projects/{id}/owner` | dono ou `projects.view_all`, + `projects.edit` | `{ user_id }` — novo dono vira gestor; o anterior continua gestor |
| GET | `/projects/{id}/history` | ver o projeto | auditoria do projeto |
| GET | `/projects/{id}/members` | ver o projeto | dono primeiro |
| POST | `/projects/{id}/members` | gestor + `projects.edit` | `{ user_id, role }` (`manager`, `member`, `viewer`, `it` — Responsável TI, §24) |
| GET | `/projects/{id}/member-candidates` | gestor + `projects.edit` | usuários ativos que ainda não são membros (`search`) — dispensa `users.view` |
| PATCH | `/projects/{id}/members/{userId}` | gestor + `projects.edit` | `{ role }`; papel do dono é fixo (`OWNER_ROLE_LOCKED`) |
| DELETE | `/projects/{id}/members/{userId}` | gestor, ou o próprio membro (sair) | dono não sai (`CANNOT_REMOVE_OWNER`) |

Projeto sem acesso responde **404 `PROJECT_NOT_FOUND`** (não revela existência).

## Endpoints — Fase 3 (Tipos de tarefa e campos personalizados)

Leitura: `settings.manage` ou `tasks.view` (o formulário de tarefas precisa da configuração). Escrita: `settings.manage`.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/custom-fields` | biblioteca completa, com `options` e `used_by` (tipos que usam o campo) |
| POST | `/custom-fields` | `{ name, label, type, description?, config?, default_value?, searchable?, filterable?, sortable?, options? }` — `name` e `type` são imutáveis depois |
| GET | `/custom-fields/{id}` | detalhe |
| PATCH | `/custom-fields/{id}` | parcial; `options` é sincronizado pelo `id` (sem `id` = nova; ausente = removida). Em seleção, o padrão vem de `options[].is_default` |
| DELETE | `/custom-fields/{id}` | só se nenhum tipo usa (`FIELD_IN_USE` com `details.types`) |
| GET | `/task-types` | em ordem; inativos só com `include_inactive=1` e `settings.manage` |
| POST | `/task-types` | `{ key, name, description?, icon?, color?, is_active? }` |
| PUT | `/task-types/order` | `{ ids: [...] }` — lista **completa** (`invalid_order` se faltar ou repetir) |
| GET | `/task-types/{id}` | tipo com `fields: [{ field, order, required, visible, show_on_card }]` |
| PATCH | `/task-types/{id}` | parcial; `key` é imutável |
| DELETE | `/task-types/{id}` | só sem tarefas (`TASK_TYPE_IN_USE`); em uso, desative |
| PUT | `/task-types/{id}/fields` | `{ fields: [{ field_id, required, visible, show_on_card, required_status_ids }] }` — substitui tudo; a ordem é a posição na lista. Campo oculto vira opcional e sai do card. `required_status_ids` (até 50): status em que o campo passa a ser exigido; ignorado quando `required` (vale em todos) ou oculto; status inexistente → `VALIDATION_ERROR` `fields.fields = invalid_status` |
| GET | `/task-types/{id}/history` | auditoria do tipo, paginada |

Valores de campos são validados no servidor pelo tipo (`domain/custom-field.js#validateValue`): tamanho, mín./máx., inteiro, datas ISO, URL http(s), e-mail, telefone e opções ativas.

## Endpoints — Fase 4 (Status, prioridades, tarefas, comentários e tags)

Leitura de status/prioridades/tags: `settings.manage` ou `tasks.view`. Alteração: `settings.manage`. Regras de acesso a tarefas e comentários em [permissions.md](permissions.md#tarefas-comentários-e-configurações-fase-4).

| Método | Rota | Descrição |
|---|---|---|
| GET · POST | `/statuses` · `/priorities` | lista em ordem (inativos com `include_inactive=1` e `settings.manage`) · cria `{ key, name, color?, description?, is_active?, is_default?, category* }` (*só status: `backlog`, `todo`, `in_progress`, `done`, `cancelled`) |
| PUT | `/statuses/order` · `/priorities/order` | `{ ids }` com a lista completa |
| GET · PATCH · DELETE | `/statuses/{id}` · `/priorities/{id}` | chave imutável; `is_default: true` desmarca o anterior; o padrão não pode ser desativado nem excluído (`*_IS_DEFAULT`); em uso não se exclui (`*_IN_USE`) |
| GET · POST · PUT `/order` · GET · PATCH · DELETE | `/areas` · `/areas/{id}` | **áreas responsáveis** — mesmas regras de status/prioridades, mas **sem padrão** (`is_default` não se aplica): tarefa e projeto podem ficar sem área; em uso por tarefas ou projetos não se exclui (`AREA_IN_USE`, `details: { tasks, projects }`) — desative |
| GET | `/tasks` | paginado; `project_id`, `task_type_id`, `status_id`, `priority_id`, `assignee_id` (ou `me`), `tag_id`, `category` (ex.: `backlog,todo,in_progress`), `in_report` (`true`/`false`), `urgency` (`high`, `medium`, `low`, `none`), `area_id` (ou `none`), `search` (título, código e campos personalizados pesquisáveis), `sort` (`code`, `title`, `created_at`, `updated_at`, `due_date`, `priority`, `status`) |
| POST | `/tasks` | `{ project_id, task_type_id, title, description?, status_id?, priority_id?, assignee_id?, reporter_id?, due_date?, estimated_hours?, actual_hours?, custom_values?, tag_ids?, checklist? }` — número sequencial por projeto (`CRM-12`); padrões de status, prioridade e valores dos campos |
| GET | `/tasks/{id}` | detalhe com `fields` do tipo, `custom_values` (por nome técnico), `checklist`, `tags` e `capabilities` |
| PATCH | `/tasks/{id}` | parcial; `null` limpa responsável/relator/prazo/horas; trocar o tipo descarta valores de campos que o novo tipo não tem; `project_id` é imutável |
| DELETE | `/tasks/{id}` | `tasks.delete` + gestor, `projects.view_all` ou autor |
| PUT | `/tasks/{id}/report` | `{ in_report: boolean }` — liga/desliga a tarefa no informe do projeto (aba Informe); quem edita a tarefa; **não** exige os obrigatórios do status; grava no histórico. Toda tarefa sai com `in_report` (padrão `true`) |
| PUT | `/tasks/{id}/urgency` | `{ urgency: "high" \| "medium" \| "low" \| null }` — urgência da tarefa (semáforo 🔴 alta, 🟡 média, 🟢 baixa; `null` limpa); quem edita a tarefa; **não** exige os obrigatórios do status; grava no histórico. Toda tarefa sai com `urgency` (padrão `null`) |
| PUT | `/tasks/{id}/area` | `{ area_id: "<id>" \| null }` — área responsável (área ativa de `/areas`; `null` limpa); quem edita a tarefa; **não** exige os obrigatórios do status; grava no histórico. Toda tarefa sai com `area` (`{ id, key, name, color }` ou `null`); `POST/PATCH /tasks` também aceitam `area_id` |
| GET | `/tasks/{id}/history` | histórico legível (nomes em vez de IDs; campos personalizados como `cf:<rótulo>`; comentários e menções) |
| GET · POST | `/tasks/{id}/comments` | lista (excluídos sem texto) · `{ content }` com menções `@[Nome](idDoUsuario)` — qualquer pessoa com acesso ao projeto, inclusive leitor |
| GET | `/tasks/{id}/mention-candidates` | pessoas ativas com acesso ao projeto (lista do @) |
| PATCH · DELETE | `/comments/{id}` | autor edita; autor ou gestor exclui (lógica) |
| GET · POST | `/tasks/{id}/attachments` | lista · envia (multipart: `files` e opcional `field` = campo de imagem/arquivo). Tipo decidido pelo **conteúdo**; até 20 MB; `tasks.edit` + colaborador |
| POST | `/tasks/{id}/attachments` com `comment_id` | anexo do comentário: só o autor do comentário (vale a regra de comentar — inclusive leitor); excluir o comentário apaga os arquivos dele |
| GET | `/notifications` | caixa do usuário, mais recentes primeiro (`unread=1`, paginado) |
| GET | `/notifications/unread-count` | contador para o sino |
| POST | `/notifications/{id}/read` · `/notifications/read-all` | marcar como lida (só as próprias; de outra pessoa → 404) |
| POST | `/notifications/due-reminders` | roda agora os lembretes de prazo (`settings.manage`; também roda todo dia às 08:00) |
| GET | `/attachments/{id}/file` | download/visualização protegida (`?download=1` força download) |
| DELETE | `/attachments/{id}` | quem enviou ou gestor; sai dos campos de imagem/arquivo |
| GET · POST | `/tags` | lista com `task_count` · cria `{ name, color? }` (nome único sem diferenciar maiúsculas/acentos) |
| PATCH · DELETE | `/tags/{id}` | renomear/cor · excluir (sai das tarefas) |

Horas (`estimated_hours`, `actual_hours`) precisam ser maiores que zero; `null` limpa (o PocketBase não tem número nulo — 0 significa "não informado").

## Endpoints — Fase 5 (Kanban)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/projects/{id}/board` | `kanban.view` + acesso ao projeto. Colunas = status ativos na ordem do fluxo, com `wip_limit`, `allowed_next`, `total`, `truncated` e `tasks` (resumo + `card_fields`: campos marcados "no card" no tipo). Colunas abertas trazem até 500 cards; as de encerramento (`done`/`cancelled`), as 30 mais recentes. `capabilities: { move, create }` |
| POST | `/tasks/{id}/move` | `{ status_id, prev_id?, next_id? }` — posição entre os vizinhos (renumera a coluna quando não há espaço). Mesma regra de `tasks.edit` + colaborador; mudar de coluna respeita `allowed_next` do status de origem (`TRANSITION_NOT_ALLOWED`, 409). Histórico registra a troca de status |

Status ganham `wip_limit` (0 = sem limite, até 999) e `allowed_next` (IDs de destino; vazio = qualquer) em `POST/PATCH /statuses`. O limite WIP é um alerta (não bloqueia); a transição é validada em toda troca de status — no quadro e em `PATCH /tasks/{id}`.

## Endpoints — Fase 6 (Backlog e sprints)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/projects/{id}/backlog` | o que ainda não começou (status das categorias `backlog` e `todo`), na ordem de prioridade (`position`), até 1000 itens (`truncated`); `statuses` planejáveis, `sprints` abertas e `capabilities: { rank, create, manage_sprints }` |
| POST | `/tasks/{id}/rank` | `{ prev_id?, next_id?, sprint_id? }` — prioriza entre vizinhos; `sprint_id` troca a sprint (`null` tira). Regra de `tasks.edit` + colaborador; tarefa em andamento/encerrada → `NOT_IN_BACKLOG` (409) |
| GET · POST | `/projects/{id}/sprints` | lista (encerradas só com `include_closed=1`) · cria `{ name, goal?, start_date?, end_date? }` (gestor do projeto) |
| PUT | `/projects/{id}/sprints/order` | `{ ids }` com todas as sprints abertas (gestor) |
| PATCH · DELETE | `/sprints/{id}` | edita (`state`: `planned`, `active`, `closed`; encerrar devolve ao backlog sem sprint o que não terminou e informa `returned_count`) · exclui (tarefas ficam sem sprint) |

Tarefas ganham `sprint: { id, name, state } | null` no resumo, `sprint_id` no POST/PATCH (`null` limpa) e o filtro `sprint_id` (id ou `none`) em `GET /tasks`. "Transformar em tarefa ativa" = `POST /tasks/{id}/move` para outro status.

## Endpoints — Fase 7 (Relacionamentos, subtarefas e fork)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/tasks/{id}/relations` | `parent`, `children` (+ `subtask_progress`), `forked_from`, `forks` e `relations` (cada uma com `type` do ponto de vista desta tarefa); só tarefas visíveis ao usuário; `capabilities: { link, fork, create_subtask, edit }` |
| POST | `/tasks/{id}/relations` | `{ type, target_id }` com `type` em `relates`, `blocks`, `blocked_by`, `duplicates`, `duplicated_by`, `depends_on`, `dependency_of` — `tasks.link` + colaborador; repetida → `RELATION_EXISTS`; ciclo de bloqueio/dependência → `RELATION_CYCLE` |
| DELETE | `/relations/{id}` | desfaz (`tasks.link` em qualquer um dos lados) |
| POST | `/tasks/{id}/fork` | `{ title?, project_id?, copy?: { description, tags, custom_values, checklist, attachments, relations } }` — `tasks.fork`; devolve a nova tarefa (201) com `forked_from` |

Subtarefas: `parent_task_id` em `POST/PATCH /tasks` (`null` solta; erros `other_project`, `cycle`, `too_deep`). O detalhe da tarefa traz `parent` e `forked_from` (`{ id, code, title }`); os resumos trazem `subtask_progress` e `blocked`; `capabilities` ganha `link` e `fork`.

## Endpoints — Fase 8 (Relatórios)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/reports` | `reports.view`; parâmetros `from`, `to` (ISO; padrão últimos 30 dias; até 366 dias), `tz_offset` (minutos de `getTimezoneOffset`; define "hoje" e os dias da série), `group_by` (`status`, `priority`, `type`, `assignee`, `project`) e filtros `project_id`, `assignee_id` (id, `me`, `none`), `task_type_id`, `priority_id`, `status_id`. Resposta: `period`, `generated_at`, `filters`, `definitions` (`bug_types`, `critical_priority`), `indicators` (agora e no período; tempos como `{ hours, count }`), `series` (`bucket` dia/semana), `breakdown` (`dimension`, `rows` com `label`) e `overdue_tasks` (até 50) |
| GET | `/projects/{id}/timeline` | acesso ao projeto + `tasks.view`; numa chamada: `project` (datas), `capabilities` (`edit` = mover barras, `manage_milestones` = gestor), `tasks` (resumos com `start_date`/`due_date`, até 2000 — `truncated`), `dependencies` (`{ id, type, from, to, conflict }` — de quem vem antes para quem vem depois; conflito = começa antes do prazo da anterior), `sprints` e `milestones` |
| GET/POST | `/projects/{id}/milestones` | listar (quem vê o projeto) / criar (gestor ou dono): `{ name*, due_date*, description, state: pending\|done }`; auditoria no projeto (`milestone.*`) |
| PATCH/DELETE | `/milestones/{id}` | editar/excluir (gestor ou dono); marco de projeto invisível → 404 `MILESTONE_NOT_FOUND` |
| GET | `/projects/{id}/brief` | **resumo do Responsável TI** (§24): `{ objective, tasks (só as atribuídas a quem pede), items (funcionalidades/resultados da ficha sob a responsabilidade dele: id, kind, title, description, unit, target, due_date) }`; quem vê o projeto também pode pedir |
| GET/PUT | `/projects/{id}/charter` | **ficha do projeto** (§21): ver (quem vê o projeto) / gravar o objetivo geral (gestor ou dono) `{ objective* }`. Resposta: `objective`, `capabilities.edit`, `completeness` (`sections`, `done`, `total`, `percent`), `summary` (funcionalidades entregues, tarefas, resultados no caminho/atrasados/sem medir) e `items` com estado calculado (`effective_state`, `progress`, `situation`, `percent`, `stale`) |
| POST | `/projects/{id}/charter/items` | cria item (gestor ou dono): `{ kind*: objective\|feature\|scope_in\|scope_out\|result, title*, description, state, owner_id, link_ids (objetivo), task_ids (funcionalidade), unit, baseline, target* (resultado), start_date, due_date, frequency: none\|weekly\|monthly\|quarterly }` — cada tipo aceita só os seus campos; erros `not_member`, `not_in_project`, `invalid_link`, `after_due_date` |
| PUT | `/projects/{id}/charter/order` | nova ordem de um tipo: `{ kind*, ids* }` (todos os itens do tipo) |
| PATCH/DELETE | `/charter-items/{id}` | editar/excluir (gestor ou dono); o tipo não muda; item de projeto invisível → 404 `CHARTER_ITEM_NOT_FOUND` |
| GET/POST | `/charter-items/{id}/measurements` | série de medições de um resultado (mais recente primeiro) / registrar `{ value*, note, measured_at }` (gestor, dono ou o responsável; data não futura); a mais recente vira o valor atual |
| GET | `/reports/tasks` | `reports.view`; **detalhamento de um indicador**: `metric` obrigatório (`open`, `backlog`, `todo`, `in_progress`, `blocked`, `overdue`, `critical_bugs`, `created`, `completed`, `cancelled`, `lead_time`, `cycle_time`, `bug_resolution`) + os mesmos período, fuso e filtros de `/reports` + `page`/`perPage` (até 100). Lista paginada das tarefas por trás do número (mesma regra da contagem: `meta.total` = valor do indicador), na ordem de leitura do indicador; nos de tempo, cada item traz `metric_hours` |

Escopo: projetos visíveis ao usuário; arquivados só quando escolhidos em `project_id`. Erros: `to_before_from` (em `to`), `too_long` (em `from`), `invalid_option` (`group_by`).

## Endpoints — Gerenciamento de Projetos (GP-1: quadro do projeto)
Módulo à parte das tarefas (nenhuma rota de tarefa aceita ou devolve campos do quadro).

| Método | Rota | Descrição |
|---|---|---|
| GET | `/projects/{id}/plan` | acesso ao projeto + `plan.view`: `capabilities` (`edit`, `manage`), `statuses` (etiquetas do projeto; padrões criados na 1ª leitura: Planejado, Em progresso, Confirmar, Parado, Feito), `resources`, `groups` (ordem do quadro, `number` 1.0/2.1, `summary` com `items`, `status_counts`, `start_date`, `end_date`, `estimated_hours`, `duration_days`, `progress` — sobre os elementos de 1º nível), `items` (elementos e subelementos: `group_id`, `parent_id`, `name`, `status_id`, `start_date`, `end_date`, `due_date`, `owner`, `resource_ids`, `estimated_hours`, `actual_hours`, `duration_days` efetiva, `duration_manual`, `progress {value, source: done\|subitems\|manual\|none}`, `progress_manual`, `subitems`, `position`), `truncated` (acima de 3000) |
| GET/POST | `/projects/{id}/groups` | listar · criar (gestor/dono + `plan.manage`): `{ name*, color, parent_id }` — até 2 níveis (`parent_id: too_deep`) |
| PATCH/DELETE | `/groups/{id}` | renomear/cor · excluir com subgrupos e elementos (`{ deleted, items }`); grupo invisível → 404 `GROUP_NOT_FOUND` |
| PUT | `/groups/{id}/move` | `{ parent_id, prev_id \| next_id }` (sem vizinho = fim) |
| POST | `/groups/{id}/duplicate` | cópia logo depois do original ("(cópia)"), com subgrupos, elementos e subelementos |
| POST | `/projects/{id}/plan/items` | `plan.edit` + colaborador: `{ group_id* \| parent_id*, name*, status_id, start_date, end_date, due_date, owner_id, resource_ids, estimated_hours, actual_hours, duration_days, progress }` — subelemento segue o grupo do pai (1 nível: `too_deep`) |
| GET/PATCH/DELETE | `/plan/items/{id}` | ler · editar (só o que vier; `null` limpa; `group_id` move com os subelementos; em subelemento → `follows_parent`; `parent_id` → `immutable`; fim antes do início → `end_before_start`) · excluir com subelementos (`{ deleted }`); 404 `PLAN_ITEM_NOT_FOUND` |
| POST | `/projects/{id}/plan/statuses` | gestor/dono + `plan.manage`: `{ name*, color, category }` (`todo`, `in_progress`, `review`, `blocked`, `done`, `canceled`) |
| PATCH/DELETE | `/plan/statuses/{id}` | editar · excluir (elementos ficam em branco: `{ deleted, items }`); 404 `PLAN_STATUS_NOT_FOUND` |
| POST | `/projects/{id}/plan/resources` | `plan.edit` + colaborador: `{ name*, color }`; nome repetido (sem acento/maiúsculas) → 409 `PLAN_RESOURCE_NAME_IN_USE` |
| PATCH/DELETE | `/plan/resources/{id}` | editar (`plan.edit`) · excluir (gestor + `plan.manage`; sai dos elementos: `{ deleted, items }`); 404 `PLAN_RESOURCE_NOT_FOUND` |

Validação: horas ≥ 0 com até 2 casas (≤ 100000); `duration_days` inteiro 0–3650; `progress` inteiro 0–100 (`null` = automático); até 20 recursos; responsável precisa ser do projeto (`not_member`). Auditoria: `plan_item.created/updated/deleted` no elemento; `project_group.*`, `plan_status.*` e `plan_resource.*` no projeto.

### GP-2 — interação
`GET /projects/{id}/plan` também traz `links` (`{ id, from_id, to_id, type: blocks | relates }`; `blocks` = from bloqueia to), `settings` (`{ dependency_rule: warn | block }`) e, em cada elemento, `blocked` (depende de elemento ainda aberto).

| Método | Rota | Descrição |
|---|---|---|
| PUT | `/plan/items/{id}/move` | arrastar/mover (`plan.edit`): `{ group_id?, prev_id \| next_id }` — reordena entre os irmãos (sem vizinho = fim); no elemento, `group_id` troca de grupo com os subelementos (histórico só quando muda de grupo); subelemento com outro grupo → `follows_parent`; vizinho que não é irmão → `invalid_option` |
| POST | `/plan/items/{id}/duplicate` | cópia "(cópia)" logo depois do original, com os subelementos, sem as dependências (201) |
| POST | `/projects/{id}/plan/items/bulk` | seleção em massa, até 200, tudo ou nada: `{ ids*, action*: update \| move \| duplicate \| delete }`; `update`: `status_id` (null = em branco), `add_resource_ids`, `remove_resource_ids`; `move`: `group_id` (subelemento → `ids: follows_parent`). Resposta `{ updated \| moved \| duplicated \| deleted }`; id de outro projeto → `ids: invalid_option` |
| POST | `/plan/items/{id}/links` | dependência (`plan.edit`): `{ type*: depends_on \| blocks \| relates, item_id* }` → `item_id`: `self`, `duplicate`, `cycle`, `invalid_option` (201) |
| DELETE | `/plan/links/{id}` | desfaz; 404 `PLAN_LINK_NOT_FOUND` |
| PATCH | `/projects/{id}/plan/settings` | regra do quadro (gestor + `plan.manage`): `{ dependency_rule*: warn \| block }` |
| POST | `/projects/{id}/plan/import` | importação (`plan.edit`), até 500 linhas, tudo ou nada: `{ rows*: [{ group*, name*, parent, status, start_date, end_date, resources[], estimated_hours, actual_hours, duration_days, progress }] }`. Grupo/status/recursos pelo nome; faltando, são criados (grupo e status só com `plan.manage`). Problemas: 400 `VALIDATION_ERROR` com `details.rows` `{ índice: { campo: código } }` (`group`/`status`/`parent`: `invalid_option` = não encontrado). Resposta 201 `{ created: { groups, statuses, resources, items, subitems } }` |

### GP-3 — painel do elemento
Cada elemento do quadro traz `updates` (atualizações não excluídas — contador da linha) e `files` (arquivos das atualizações). Cada atualização traz `files: [PlanFile]` (com `update_id`); excluir a atualização apaga os arquivos dela.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/plan/items/{id}/updates` | quem vê o quadro: `{ updates: [principal { …, replies[] }], capabilities: { post } }` — principais da mais nova para a mais antiga; respostas em ordem |
| POST | `/plan/items/{id}/updates` | publica (quem vê o quadro, projeto aberto — inclusive leitor): JSON `{ content* (≤ 10.000; Markdown; menções `@[Nome](id)`), parent_id }` ou **multipart** com os mesmos campos + `files` (imagens coladas/anexadas: até 10, 20 MB cada, 50 MB no total; tipo pelo conteúdo; tudo ou nada; com arquivo, `content` pode ficar vazio; total → `files: upload_too_large`) (resposta: só na principal → `parent_id: invalid_option`); menção de quem não participa → `content: invalid_mention`. Notifica `plan_mention` (menção) e `plan_reply` (autor da principal) |
| PATCH | `/plan/updates/{id}` | edita (só o autor): `{ content* }`; menção nova notifica |
| DELETE | `/plan/updates/{id}` | exclui (autor ou gestor): exclusão lógica; 404 `PLAN_UPDATE_NOT_FOUND` |
| GET | `/plan/items/{id}/mention-candidates` | participantes ativos do projeto |
| POST | `/plan/updates/{id}/files` | o autor anexa mais à atualização (multipart `files`, mesmos limites) |
| GET | `/plan/files/{id}/file` | download protegido (confere acesso; `nosniff`; CSP `sandbox`; imagem aparece, o resto baixa); 404 `PLAN_FILE_NOT_FOUND` |
| DELETE | `/plan/files/{id}` | quem enviou ou o gestor |
| GET | `/plan/items/{id}/history` | histórico do elemento (quem vê o quadro) |

Notificações (`GET /notifications`) passam a trazer `task` **ou** `plan_item` (`{ id, project_id, name, project_name }`); tipos novos `plan_mention` e `plan_reply`. Auditoria: `plan_item.update_added/update_edited/update_deleted` e `plan_item.file_added/file_deleted` no elemento.

### GP-5 — colunas personalizadas
`GET /projects/{id}/plan` traz `columns: [{ id, name, type, settings, position }]`, em cada elemento `custom: { coluna: valor }` e, nos totais, `custom_sums: { coluna: soma }` das numéricas. O valor da célula vai no `PATCH /plan/items/{id}` (ou no `POST` de criação): `{ custom: { coluna: valor | null } }` — só em elemento (`custom: subitems_not_supported`), só colunas do quadro (`custom: invalid_option`), validado pelo tipo (`invalid_type`, `invalid_date`, `invalid_option`, `invalid_url`, `too_long`, `too_large`; pessoa de fora → `not_member`).

| Método | Rota | Descrição |
|---|---|---|
| POST | `/projects/{id}/plan/columns` | adiciona (gestor): `{ name* (≤ 60), type* (text \| number \| date \| checkbox \| dropdown \| people \| link), settings }` — `settings` da lista `{ options: [{ id?, name, color }] }` (até 30, sem nome repetido → `settings: duplicate_option`), do número `{ unit }` (≤ 8); acima de 30 colunas → `columns: too_many` |
| PATCH | `/plan/columns/{id}` | renomeia/edita as opções (gestor); opção removida limpa os valores que a usavam; 404 `PLAN_COLUMN_NOT_FOUND` |
| POST | `/plan/columns/{id}/type` | altera o tipo (gestor): `{ type*, settings, dry_run }` — com `dry_run` devolve `{ converted, lost }` sem gravar; sem, converte e devolve a coluna |
| POST | `/plan/columns/{id}/duplicate` | duplica com os valores (gestor) |
| DELETE | `/plan/columns/{id}` | exclui a coluna e os valores (gestor) → `{ deleted, values }` |

Auditoria no projeto: `plan_column.created/updated/type_changed/duplicated/deleted`; no elemento, `plan_item.updated` com `cf:<nome da coluna>` (opção e pessoa pelo nome).

### GP-4 — visões e gestão
`GET /projects/{id}/plan` passa a trazer `summary` (totais do quadro inteiro: Bateria e Esforço do Cronograma), `settings.baseline_at` e, em cada elemento, `baseline_start`/`baseline_end`.

| Método | Rota | Descrição |
|---|---|---|
| PUT | `/projects/{id}/plan/baseline` | o gestor salva a linha de base (cronograma atual dos elementos): `{ saved_at, items }` |
| DELETE | `/projects/{id}/plan/baseline` | o gestor limpa a linha de base |
| GET | `/projects/{id}/plan/journal` | diário (quem vê o quadro): `{ entries: [{ id, entry_date, content, author, capabilities: { edit, delete } }], capabilities: { create } }`, do dia mais recente |
| POST | `/projects/{id}/plan/journal` | registra (`plan.edit` + colaborador): `{ entry_date* (AAAA-MM-DD), content* (≤ 5.000) }` |
| PATCH/DELETE | `/plan/journal/{id}` | o autor ou o gestor; 404 `PLAN_JOURNAL_NOT_FOUND` |
| GET | `/projects/{id}/plan/issues` | problemas: `{ issues: [{ id, number, opened_on, description, state, owner, resolved_on, created_by, capabilities }], capabilities: { create } }` |
| POST | `/projects/{id}/plan/issues` | abre (`plan.edit` + colaborador): `{ opened_on*, description* (≤ 2.000), state (in_progress \| pending \| resolved; padrão pending), owner_id (participante → senão `owner_id: not_member`) }` |
| PATCH | `/plan/issues/{id}` | atualiza (quem edita o quadro); `resolved` guarda `resolved_on` |
| DELETE | `/plan/issues/{id}` | quem abriu ou o gestor; 404 `PLAN_ISSUE_NOT_FOUND` |
| GET | `/projects/{id}/plan/report?tz_offset=` | relatório (quem vê o quadro; `tz_offset` em minutos, −840..840): `{ today, summary, schedule, effort, resources, groups, health: { level, factors: [{ key, level, value, … }] } }` — ver regras §14 |

Auditoria no projeto: `plan_journal.created/updated/deleted`, `plan_issue.created/updated/deleted`, `plan_settings.baseline_saved/baseline_cleared`.

Regra `block`: trocar o status (edição, massa) para uma etiqueta que **inicia** (Em andamento/Em revisão, vindo de A fazer/Bloqueado/em branco) ou **conclui** um elemento que depende de outro ainda aberto → 409 `PLAN_DEPENDENCY_PENDING` com `details.items` (nomes). Auditoria: `plan_item.duplicated/linked/unlinked` no elemento; `plan_item.imported` e `plan_settings.updated` no projeto.

## Endpoints — Expansão Onda 2 (Documentação)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/docs/spaces` | espaços que a pessoa lê (`docs.view` + visibilidade), com `page_count` e `capabilities` |
| POST | `/docs/spaces` | `docs.manage` (espaço de projeto: gestor/dono): `{ key*, name*, description, icon, color, project_id, visibility*: company\|project }`; nasce com a página inicial publicada (v1). `DOC_SPACE_KEY_IN_USE`; `visibility: project_required` sem projeto |
| GET | `/docs/spaces/{key}` | espaço pela **chave** + árvore `pages` (`id, parent_id, title, status, position, has_draft, is_home, updated_at`; rascunhos só para quem edita) + `capabilities` |
| PATCH/DELETE | `/docs/spaces/{id}` | configurar (`name, description, icon, color, visibility`) / excluir com páginas, versões e arquivos (quem gerencia) |
| POST | `/docs/spaces/{id}/pages` | `docs.edit`: `{ title*, parent_id }` → página em rascunho; `DOC_PAGE_TOO_DEEP` (8 níveis) |
| GET/DELETE | `/docs/pages/{id}` | página (conteúdo **publicado**, `version`, `ancestors`, `children`, `draft` pendente para quem edita, `capabilities`) / excluir com subpáginas (`{ deleted }`; `DOC_PAGE_IS_HOME`) |
| GET/PUT/DELETE | `/docs/pages/{id}/draft` | rascunho para edição (ou o publicado) / salvar `{ title*, content }` (higienizado; `{ saved_at }`) / descartar |
| POST | `/docs/pages/{id}/publish` | publica o rascunho ou `{ title, content }` enviados → próxima versão |
| PUT | `/docs/pages/{id}/move` | `{ parent_id, prev_id \| next_id }` (sem vizinho = fim); `DOC_PAGE_CYCLE`, `DOC_PAGE_TOO_DEEP`, `DOC_PAGE_IS_HOME` |
| GET | `/docs/pages/{id}/versions` · `/versions/{n}` | versões publicadas (mais recente primeiro) / conteúdo de uma versão (`DOC_VERSION_NOT_FOUND`) |
| POST | `/docs/pages/{id}/versions/{n}/restore` | publica o conteúdo da versão `n` como a próxima |
| POST | `/docs/pages/{id}/files` | multipart `files` (até 10, 20 MB cada, tipo conferido pelo conteúdo) → `{ id, name, kind: image\|document, mime, size, url }` |
| GET | `/docs/files/{id}` | arquivo para quem vê a página: imagens em linha, demais como anexo; `nosniff` + CSP sandbox |
| GET | `/docs/search?q=` | título e conteúdo publicado dos espaços visíveis, sem acento/maiúsculas (2–100 caracteres; até 30) com `snippet` |
| GET | `/docs/recent` | 10 últimas publicações dos espaços visíveis |

Conteúdo: JSON do editor (TipTap/ProseMirror). Blocos aceitos: `paragraph`, `heading` (1–4), `blockquote`, `bulletList`, `orderedList`, `listItem`, `taskList`/`taskItem` (`checked`), `codeBlock` (`language`), `horizontalRule`, `hardBreak`, `image` (`src` de `/api/v1/docs/files/{id}`, `alt`, `title`, `width` 25/50/75/100), `table`/`tableRow`/`tableHeader`/`tableCell` (`colspan`, `rowspan`, `colwidth`), `callout` (`tone` info/success/warning/danger), `tableOfContents`. Marcações: `bold`, `italic`, `underline`, `strike`, `code`, `highlight`, `link` (`href` http(s)/mailto/`/docs/…`/arquivo). O resto é removido; erros de conteúdo em `content`: `invalid_content`, `too_deep`, `too_large`, `too_long`.

## Endpoints — Configurador geral
| Método | Rota | Descrição |
|---|---|---|
| GET | `/platform` | **público**: `{ name, logo_light_url, logo_dark_url, favicon_url }` (endereços com `?v=` que muda a cada troca) |
| GET | `/platform/branding/{slot}` | **público**: `logo_light`, `logo_dark` ou `favicon`; `nosniff` + CSP sandbox; 404 sem imagem |
| GET | `/settings/platform` | `platform.manage`: `{ values, defaults, limits, retention_options, branding: { slot: { name, mime, size } \| null }, updated_at }` |
| PATCH | `/settings/platform` | `platform.manage`, parcial: `audit_retention_months` (1, 3, 6, 12, 24, 0 = sempre), `lockout_threshold` (3–20), `lockout_base_minutes` (1–60), `lockout_max_minutes` (≥ inicial; `below_base`), `password_min_length` (8–64), `password_require_mixed_case`, `password_require_symbol`, `platform_name` (até 40). Erros por campo: `too_small`, `too_large`, `invalid_type`, `invalid_option`, `required`, `too_long`, `unknown_field`. `dry_run: true` → `{ dry_run, audit_to_delete }` sem gravar |
| POST/DELETE | `/settings/platform/branding/{slot}` | `platform.manage`: multipart `file` (PNG, JPG, WebP, SVG sem conteúdo ativo; ICO só no `favicon`; até 1 MB) → configurações; erros em `file`: `required`, `empty_file`, `file_too_large`, `unsupported_type`, `type_mismatch`, `unsafe_svg`; `slot`: `invalid_slot` / remover |
| POST | `/settings/platform/purge-audit` | `platform.manage`: aplica a retenção agora → `{ removed }` (ou `{ removed: 0, skipped: true }` com "manter sempre") |
| GET | `/auth/password-policy` | quem está logado: `{ min_length, max_length, require_letters_numbers, require_mixed_case, require_symbol }` |

Senhas (`POST /users`, `POST /users/{id}/password`, `POST /auth/password`) seguem a política: além de `too_short`, `too_long` e `weak_password`, podem voltar `needs_mixed_case` e `needs_symbol`. O bloqueio de login (`ACCOUNT_LOCKED`) segue as tentativas e os tempos configurados. Auditoria: `platform_settings.update` (antes/depois), `platform_settings.branding_update/branding_remove` e `audit_log.purge` (rotina diária às 03:45 ou "Limpar agora").

## Tokens de API
Além do cookie de sessão (navegador), a API aceita **token de API pessoal**: `Authorization: Bearer kb_pat_…` (criado em Minha conta → Tokens de API). Com o token, o cookie é ignorado e o header de CSRF não é exigido. Token inválido, vencido, revogado ou de pessoa desativada → 401 `API_TOKEN_INVALID`. Operações de navegador (criar/revogar tokens, trocar senha, sair, sessões) → 403 `TOKEN_NOT_ALLOWED`.

```bash
curl -H "Authorization: Bearer kb_pat_..." https://kamban.empresa.com/api/v1/tasks?perPage=50
```

| Método | Rota | Descrição |
|---|---|---|
| GET/POST | `/auth/tokens` | os meus tokens (sem o valor) / criar (`api_tokens.create`): `{ name*, expires_in_days*: 30\|90\|365\|0 }` → resposta com `token` (só aqui); `API_TOKEN_LIMIT` (20 ativos) |
| DELETE | `/auth/tokens/{id}` | revogar um meu; de outra pessoa → 404 `API_TOKEN_NOT_FOUND` |
| GET/DELETE | `/settings/api-tokens[/{id}]` | `integrations.manage`: todos os tokens (com `user`) / revogar qualquer um |

Auditoria: `api_token.created` (nome, prefixo, prazo — nunca o valor) e `api_token.revoked`.

## Tempo real
Conexão SSE do próprio PocketBase em `/api/realtime` (fora de `/api/v1`): o `GET` abre o fluxo e o primeiro evento, `PB_CONNECT`, traz o `clientId`; o `POST /api/realtime` `{ clientId, subscriptions }` define os tópicos e exige o **cookie de sessão** e o header `X-Requested-With: kamban` (401 sem sessão, 403 sem o header ou se o `clientId` for de outra pessoa).

- Tópicos: `project:{id}` (só projetos que a pessoa vê) e `user:{id}` (só o dela); qualquer outro (inclusive assinaturas de coleção do PocketBase) é descartado sem erro.
- Evento: nome = tópico; dados `{ collection, action: create|update|delete, id, project_id, task_id, item_id }` — só identificadores. Coleções: tarefas, comentários, anexos, relações, sprints, marcos, projeto e membros, todo o quadro da Gestão e notificações.

## Endpoints — Webhooks
| Método | Rota | Descrição |
|---|---|---|
| GET/POST | `/settings/webhooks` | `integrations.manage`: lista (sem o segredo) / cria `{ name*, url*, events*, active }` → resposta com `secret` (só aqui). Erros em `url`: `invalid_url`, `insecure_url`, `blocked_host`, `too_long`; em `events`: `required`, `invalid_option` |
| GET | `/settings/webhooks/events` | catálogo `{ events, groups }` (assinar `grupo.*` = todos do grupo) |
| PATCH/DELETE | `/settings/webhooks/{id}` | edita (parcial; religar zera as falhas) / exclui com as entregas; `WEBHOOK_NOT_FOUND` |
| POST | `/settings/webhooks/{id}/rotate-secret` | novo segredo → `{ secret }` |
| POST | `/settings/webhooks/{id}/test` | envia `webhook.ping` na hora → a entrega (`status`, `response_status`, `error`, `duration_ms`) |
| GET | `/settings/webhooks/{id}/deliveries` | 50 entregas mais recentes |
| POST | `/settings/webhook-deliveries/{id}/redeliver` | reenvia agora, do zero; `WEBHOOK_DELIVERY_NOT_FOUND` |

Corpo de cada `POST`: `{ id, event, occurred_at, actor: { id }, entity: { type, id }, data, previous }`. Cabeçalhos: `X-Kamban-Event`, `X-Kamban-Delivery`, `X-Kamban-Timestamp` (segundos) e `X-Kamban-Signature: sha256=<hex>` = HMAC-SHA256 do texto `"{timestamp}.{corpo}"` com o segredo. Para conferir: recalcule com o corpo **cru** recebido, compare em tempo constante e recuse timestamps com mais de 5 minutos. Auditoria: `webhook.created/updated/deleted/secret_rotated` e `webhook.disabled` (automático). Rotina `kamban_webhooks` a cada minuto.

## Endpoints — E-mail (integrações)
| Método | Rota | Descrição |
|---|---|---|
| GET/PATCH | `/settings/email` | `integrations.manage`: `{ values: { enabled, host, port, username, tls, sender_name, sender_address, app_url }, has_password }`. PATCH parcial; ligado exige `host`, `sender_address`, `app_url` (`required`); `password` vazia mantém, `null` remove; erros `invalid_format`, `invalid_email`, `invalid_url`, `too_small`/`too_large` (porta), `unknown_field` |
| POST | `/settings/email/test` | envia na hora (para quem pediu ou `{ to }`) → `{ sent, to }`; `EMAIL_NOT_CONFIGURED` (409), `EMAIL_SEND_FAILED` (502, `details.reason`) |
| GET | `/settings/email/outbox` | `{ counts: { pending, sent, failed }, recent: [...] }` (20 mais recentes; sem o corpo) |
| POST | `/settings/email/outbox/flush` | envia a fila agora → `{ sent, failed, retrying }` (`busy` se a rotina já está enviando; `skipped` com o envio desligado) |
| POST | `/auth/password-reset/request` | **público**: `{ email }` → `{ requested: true }` sempre |
| GET | `/auth/password-reset/check?token=` | **público**: `{ valid, state: valid\|used\|expired\|invalid, purpose: reset\|invite, name, policy }` |
| POST | `/auth/password-reset/confirm` | **público**: `{ token, password }` → `{ changed, purpose }`; `RESET_TOKEN_INVALID` (400); `password` pela política |
| POST | `/users/{id}/invite` | `users.create`: reenvia o convite; `USER_ALREADY_ACTIVE` (409), `EMAIL_NOT_CONFIGURED` |

`POST /users` aceita `send_invite: true` (sem `password`; exige o envio ligado). `PATCH /users/{id}` aceita `email_notifications` (a própria pessoa), e o usuário tem `email_notifications` na resposta. `GET /platform` ganhou `password_reset` (envio de e-mail ligado). Auditoria: `email_settings.update` (sem a senha; `password_changed`), `email_settings.test_sent`, `auth.password_reset_requested`, `auth.password_reset`, `auth.invite_accepted`, `user.invited`. Rotina `kamban_email_outbox` a cada minuto.

## Exemplo
```bash
curl -c jar -X POST http://127.0.0.1:8090/api/v1/auth/login \
  -H 'Content-Type: application/json' -H 'X-Requested-With: kamban' \
  -d '{"email":"admin@kamban.local","password":"***"}'
curl -b jar 'http://127.0.0.1:8090/api/v1/users?perPage=10&sort=-created_at'
```

## Próximos endpoints (diretriz §26)
todos os módulos do MVP já têm API; novas rotas seguem as mesmas convenções.
