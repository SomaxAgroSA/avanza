# Banco de dados (Postgres do Supabase)

> Migrations SQL em `backend/db/migrations/`, aplicadas em ordem quando a API sobe (registro em `schema_migrations`, trava contra duas instâncias migrando juntas). Toda alteração de esquema é um **novo arquivo numerado** (nunca editar um já aplicado em produção); tabela nova precisa de `ENABLE ROW LEVEL SECURITY`.

Esquema `avanza` (`KAMBAN_DB_SCHEMA`; os arquivos não qualificam nomes e rodam pelo `search_path`). Tabelas e colunas mantêm os nomes das collections do PocketBase ([ADR-044](decisions.md#adr-044--o-pocketbase-sai-api-em-node-sobre-o-supabase-uma-edição-só)): `created`/`updated` ([ADR-006](decisions.md#adr-006--campos-de-data-do-pocketbase-createdupdated)), ids de 15 caracteres `[a-z0-9]` gerados pela API. Convenções: texto vazio é `''` e número vazio é `0` (não `NULL`); relação vazia é `NULL`, com chave estrangeira (cascata, `SET NULL` ou `RESTRICT` como antes; todas `DEFERRABLE INITIALLY IMMEDIATE` para a importação adiar a checagem); datas em `timestamptz(3)`; JSON em `jsonb`; `updated` mantido pelo gatilho `touch_updated`. Todas as tabelas têm **RLS ligado sem políticas** e nenhum privilégio para `anon`/`authenticated`: o acesso é só pela API ([ADR-003](decisions.md#adr-003--api-própria-apiv1-api-genérica-do-pocketbase-bloqueada)).

Os tipos abaixo são os lógicos, herdados das collections: `select` é `text` validado pelo domínio; `relation` é `text` com chave estrangeira (ou `jsonb` com a lista de ids, quando múltipla); `file` é `text` com o nome guardado no Storage (chave `<tabela>/<id>/<nome>` no bucket privado); `date` é `timestamptz(3)`. As seções seguem as fases em que cada tabela nasceu; as migrations citadas (`1790000xxx_*.js`) são as do PocketBase (histórico) — no Postgres, o esquema todo está em `0001_schema.sql` e os cadastros iniciais em `0002_seed.sql`.

## Tabelas — Fase 1

### `users` (auth, estendida)
| Campo | Tipo | Observações |
|---|---|---|
| id, email, password_hash | | e-mail único sem diferenciar maiúsculas; senha em bcrypt (a API confere) |
| name | text | |
| avatar | file | exposição via rota protegida em fase futura |
| status | select `active`/`disabled` | obrigatório |
| role_id | relation → roles | obrigatório, sem cascade |
| last_login_at | date | |
| locale | select `pt-BR`/`en`/`es` | preferência do usuário |
| theme | select `light`/`dark`/`system` | preferência do usuário |
| created, updated | date | `updated` pelo gatilho |

Índices: `role_id`, `status`, `name` (+ índice único em `lower(email)`).

### `roles`
`code` (text, único, `^[A-Z][A-Z0-9_]{1,31}$`), `name`, `description`, `is_system` (bool), `created`, `updated`. Perfis de sistema: SUPER_ADMIN, ADMIN, MANAGER, MEMBER, VIEWER.

### `permissions`
`code` (único, ex.: `tasks.edit`), `module`, `description`. Populada pelo seed a partir de `src/domain/permissions.js`.

### `role_permissions`
`role_id` → roles (cascade), `permission_id` → permissions (cascade). Índice único `(role_id, permission_id)`, índice em `permission_id`.

### `sessions`
| Campo | Observações |
|---|---|
| user_id → users | cascade |
| token_hash | SHA-256 do token (único) — o token puro nunca é gravado |
| ip, user_agent | user agent truncado em 512 |
| remember | sessão persistente |
| expires_at, last_seen_at, revoked_at | ver política em [security.md](security.md#sessão) |

Índices: `token_hash` (único), `user_id`, `expires_at`.

### `audit_logs` (imutável)
`entity_type`, `entity_id`, `action`, `old_value` (json), `new_value` (json), `user_id` → users (sem cascade), `ip`, `user_agent`, `correlation_id`, `created`.
Índices: `(entity_type, entity_id)`, `entity_id`, `user_id`, `created`.
Nenhuma rota edita ou exclui registros. Senhas e tokens nunca entram em `old_value`/`new_value` (coberto por testes).

Ações registradas na Fase 1: `auth.login`, `auth.login_failed`, `auth.logout`, `auth.session_revoked`, `auth.password_changed`, `user.created`, `user.updated`, `user.disabled`, `user.enabled`, `user.password_reset`, `role.created`, `role.updated`, `role.permissions_updated`, `role.deleted`.
Consulta: `GET /api/v1/audit-logs` (`audit.view`) e `GET /api/v1/users/{id}/history`; tela *Configurações → Auditoria* e aba *Histórico* do usuário.

## Tabelas — Fase 2

### `projects`
| Campo | Tipo | Observações |
|---|---|---|
| name | text (≤120) | |
| key | text (≤10) | **único**, `^[A-Z][A-Z0-9]{1,9}$`, imutável (prefixo das tarefas) |
| description | text (≤10000) | |
| icon, cover | text | chaves de uma lista fechada (ícone e gradiente da capa); upload de imagem de capa virá com anexos (Fase 4) |
| status | select | `planning`, `active`, `paused`, `completed`, `cancelled` |
| priority | select | `low`, `medium`, `high`, `critical` |
| owner_id, created_by | relation → users | sem cascade |
| start_date, due_date | date | somente dia (meia-noite UTC) |
| archived_at | date | vazio = ativo; preenchido = arquivado (somente leitura) |

Índices: `key` (único), `owner_id`, `status`, `archived_at`, `name`.

### `project_members`
`project_id` → projects (cascade), `user_id` → users (cascade), `role` (`manager`, `member`, `viewer`). Índice único `(project_id, user_id)` e índice em `user_id`. O dono sempre tem uma linha com papel `manager`.

Ações de auditoria: `project.created`, `project.updated`, `project.archived`, `project.unarchived`, `project.deleted`, `project.owner_changed`, `project.member_added`, `project.member_role_changed`, `project.member_removed`, `project.member_left`.

## Tabelas — Fase 3 (tipos de tarefa e campos personalizados)

Migration `1790000004_task_config.js`. Ver [ADR-010](decisions.md#adr-010--campos-personalizados-como-biblioteca-reutilizável).

### `custom_fields` (biblioteca de campos)
| Campo | Tipo | Observações |
|---|---|---|
| name | text (≤40) | **único**, `^[a-z][a-z0-9_]{1,39}$`, imutável (usado na API e em filtros) |
| label | text (≤80) | rótulo exibido |
| type | select | `text`, `textarea`, `number`, `decimal`, `boolean`, `date`, `datetime`, `select`, `multiselect`, `user`, `users`, `project`, `url`, `email`, `phone`, `image`, `file` — imutável |
| description | text (≤255) | texto de ajuda do formulário |
| config | json | por tipo: `max_length` (texto), `min`/`max` (números), `decimals` 0–6 (decimal), `allow_create_options` (seleção: opções adicionadas pela tarefa; só gravado quando ligado) |
| default_value | json | no formato do tipo; em seleção guarda o(s) id(s) das opções marcadas como padrão |
| searchable, filterable, sortable | bool | só valem quando o tipo suporta (ver `TYPE_INFO` em `domain/custom-field.js`) |

Índices: `name` (único), `type`. Exclusão bloqueada enquanto algum tipo usa o campo (`FIELD_IN_USE`).

### `custom_field_options`
`field_id` → custom_fields (cascade), `label` (≤60, único por campo sem diferenciar maiúsculas), `color` (paleta fechada), `order`, `is_active`. Índice em `field_id`. Opções em uso devem ser **desativadas**, não removidas. Opção adicionada pela tarefa (`POST /custom-fields/{id}/options`) entra no fim, sob trava do campo (`FOR NO KEY UPDATE`), sem duplicar rótulo (sem diferenciar maiúsculas e acentos).

### `task_types`
`key` (≤30, **único**, `^[A-Z][A-Z0-9_]{1,29}$`, imutável), `name` (≤60), `description`, `icon`, `color`, `order`, `is_active`. Índices: `key` (único), `order`. Exclusão só sem tarefas (`TASK_TYPE_IN_USE`); em uso, desativar. `translations` (JSON `{ en: { name, description }, es: {…} }`, migration `1790000017_task_type_translations.js`, que já traduz os 8 tipos padrão quando o texto ainda é o original): o nome/descrição do registro são o original em pt-BR.

### `task_type_fields`
`task_type_id` → task_types (cascade), `field_id` → custom_fields (cascade), `order`, `required` (exigido em todos os status), `visible`, `show_on_card`, `required_status_ids` (JSON com IDs de status em que o campo passa a ser exigido — migration `1790000016_required_by_status.js`). Índice único `(task_type_id, field_id)` e índice em `field_id`. Campo oculto nunca é obrigatório nem aparece no card.

Seed: 21 campos e 8 tipos (`BUG` com 9 campos, `DESENVOLVIMENTO` 7, `MELHORIA` 6; `ADEQUACAO`, `NOVA_FUNCIONALIDADE`, `INTEGRACAO`, `SUPORTE`, `DOCUMENTACAO` sem campos).

Ações de auditoria: `task_type.created`, `task_type.updated`, `task_type.deleted`, `task_type.reordered`, `task_type.fields_updated`, `custom_field.created`, `custom_field.updated`, `custom_field.deleted`.

## Tabelas — Fase 4 (tarefas)

### `task_statuses` e `task_priorities` (migration `1790000005_workflow.js`)
`key` (único, imutável), `name`, `description`, `color`, `order`, `is_active`, `is_default` (exatamente um, sempre ativo). Só status: `category` (`backlog`, `todo`, `in_progress`, `done`, `cancelled`). Seed: fluxo da diretriz §14 (Backlog → … → Concluído, + Cancelado) e prioridades Crítica/Alta/Média (padrão)/Baixa. Ver [ADR-011](decisions.md#adr-011--status-e-prioridades-globais-com-categoria).

### `tasks` (migration `1790000006_tasks.js`)
| Campo | Tipo | Observações |
|---|---|---|
| project_id | relation → projects | cascade (excluir projeto arquivado remove as tarefas) |
| number, code | number, text | número sequencial por projeto; `code` = `CHAVE-N` (único) |
| title, description | text | ≤200 / ≤50000 (Markdown simples) |
| task_type_id, status_id, priority_id | relation | obrigatórias, sem cascade (itens em uso não podem ser excluídos) |
| creator_id, assignee_id, reporter_id | relation → users | |
| parent_task_id | relation → tasks | subtarefas (Fase 7) |
| due_date, started_at, completed_at | date | início/conclusão derivados da categoria do status |
| estimated_hours, actual_hours | number | 0 = não informado |
| checklist | json | `[{ id, text, done }]`, até 100 itens (migration 1790000007) |

Índices: `(project_id, number)` único, `code` único, `status_id`, `priority_id`, `task_type_id`, `assignee_id`, `creator_id`, `created`, `due_date`, `parent_task_id`.

### `task_custom_values`
Um registro por (tarefa, campo) — índice único. `value` (json, valor original) + cópias indexadas `value_text`, `value_number`, `value_date`, `value_bool` para busca, filtro e ordenação (índices `(field_id, value_*)`).

### `tags`, `task_tag_relations`, `comments` (migration `1790000007_task_collaboration.js`)
- `tags`: `name`, `name_key` (único; minúsculas sem acento), `color`.
- `task_tag_relations`: `(task_id, tag_id)` único; cascade dos dois lados.
- `comments`: `task_id` (cascade), `user_id`, `content` (≤10000, Markdown + menções `@[Nome](id)`), `mentions` (json com IDs), `edited_at`, `deleted_at` (exclusão lógica). Índices `(task_id, created)` e `user_id`.

### `attachments` (migration `1790000008_attachments.js`)
`task_id` (cascade), `file` (no Storage, até 20 MB, tipos permitidos pelo domínio), `name` (nome seguro), `mime` e `kind` (`image`/`document`, decididos pelo conteúdo), `size`, `uploaded_by`, `created`. Índice `(task_id, created)`. Campos personalizados de imagem/arquivo guardam IDs de anexos da própria tarefa.

Ações de auditoria (entidade `task`): `task.created`, `task.updated`, `task.deleted`, `comment.added`, `comment.edited`, `comment.deleted`, `attachment.added`, `attachment.deleted`; e `status.*`, `priority.*`, `tag.*` nas respectivas entidades.

### `attachments.comment_id` (migration `1790000009`)
Anexo de comentário (vazio = anexo da tarefa). Índice em `comment_id`.

### `notifications` (migration `1790000010_notifications.js`)
`user_id` (cascade), `type` (`mention`, `assigned`, `comment`, `status_changed`, `due_soon`, `overdue`), `task_id` (cascade), `actor_id` (vazio em lembretes), `data` (json: código/título da tarefa, trecho do comentário, status, prazo), `dedupe_key` (índice único por pessoa quando preenchido — lembretes não se repetem), `read_at`, `created`. Índice `(user_id, read_at, created)`.

## Fase 5 — Kanban (migration `1790000011_kanban.js`)
- `task_statuses.wip_limit` (number, 0 = sem limite) e `task_statuses.allowed_next` (json: IDs de status de destino; vazio = qualquer).
- `tasks.position` (number, passo 1024): ordem do card na coluna; ao mover, fica entre os vizinhos e a coluna é renumerada quando não há espaço. Índice `(project_id, status_id, position)`. Tarefas existentes receberam `number × 1024`.

## Fase 6 — Backlog e sprints (migrations `1790000012` e `1790000013`)
- `sprints`: `project_id` (cascade), `name`, `goal`, `start_date`, `end_date` (dia), `state` (`planned`, `active`, `closed`), `order` (ordem manual), `created_by`, `created`, `updated`. Índice `(project_id, state)`.
- `tasks.sprint_id` (relação opcional, sem cascata: excluir a sprint pela API tira a sprint das tarefas com histórico). Índice em `sprint_id`.
- A 1790000012 nasceu como "ciclos"; a 1790000013 renomeia `cycles`/`cycle_id` para `sprints`/`sprint_id` em bancos que já a tinham aplicado (e ajusta o histórico antigo). Em bancos novos a 12 já cria `sprints`.
- A ordem do Backlog usa `tasks.position` (Fase 5); a priorização renumera juntas as tarefas dos status planejáveis quando não há espaço entre vizinhos.

## Fase 7 — Relacionamentos (migration `1790000014_task_relations.js`)
- `task_relations`: `source_task_id` e `target_task_id` (cascade: somem com qualquer uma das tarefas — a API registra antes no histórico do outro lado), `relation_type` (`relates`, `blocks`, `duplicates`, `depends_on`), `created_by`, `created`. Índice único `(source, target, type)` e índice por destino.
- `tasks.forked_from_task_id`: origem do fork (relação opcional, sem cascata — fica vazia se a origem for excluída).
- Subtarefas usam `tasks.parent_task_id` (Fase 4); ao excluir o pai, a API solta as filhas antes (com histórico).

## Fase 8 — Relatórios
Sem tabelas novas: os relatórios leem `tasks` com uma consulta enxuta (só as colunas usadas nos cálculos) e `task_relations` para "bloqueadas". Os índices existentes por projeto/status atendem os filtros.

## Cadastros iniciais (`0002_seed.sql`)
- Permissões, perfis e matriz, status, prioridades, campos, tipos de tarefa (com as traduções) e a configuração geral — os mesmos que as migrations do PocketBase criavam.
- Rate limit e logs não ficam no banco: limites por IP no código (`infrastructure/config.js`, ajustáveis por `KAMBAN_RATE_LIMITS`) e logs na saída da API.

## Próximas tabelas (diretriz §31)
nenhuma pendente até a Fase 8 (relatórios usam os dados existentes).

## Expansão — Onda 1 (timeline) — migration `1790000018_timeline.js`

### `tasks.start_date`
Início planejado (dia puro, meia-noite UTC). Índice `(project_id, start_date)`. Regra: não pode passar de `due_date` (validada na aplicação).

### `project_milestones`
`project_id` → projects (cascade), `name` (≤120), `description` (≤1000), `due_date` (obrigatório, dia puro), `state` (`pending` | `done`), `created_by`. Índice `(project_id, due_date)`. Auditoria no projeto: `milestone.created/updated/deleted`.

## Expansão — Onda 2 (documentação) — migration `1790000019_docs.js`
Concede `docs.view/edit/manage` aos perfis (ADMIN e MANAGER: as três; MEMBER: ver e editar; VIEWER: ver) sem sobrescrever matrizes já ajustadas.

### `doc_spaces`
`key` (única, `^[A-Z][A-Z0-9]{1,9}$`), `name` (≤80), `description` (≤500), `icon`, `color`, `project_id` → projects (cascade, opcional), `visibility` (`company` | `project`), `home_page_id`, `created_by`.

### `doc_pages`
`space_id` → doc_spaces (cascade), `parent_id` (texto; raiz = vazio), `title`, `position` (passo 1024), `status` (`draft` | `published`), `content` (JSON publicado, até 3 MB), `content_text` (texto para trechos), `search_text` (título + texto sem acento/minúsculas), `version`, `published_at`, `published_by`, `draft` (JSON), `draft_title`, `draft_by`, `draft_at`, `created_by`. Índices por espaço/pai/posição.

### `doc_page_versions`
`page_id` → doc_pages (cascade), `version`, `title`, `content`, `author`; única `(page_id, version)`.

### `doc_files`
`space_id`, `page_id` → doc_pages (cascade), `file` (Storage), `name`, `mime`, `kind` (`image` | `document`), `size`, `uploaded_by`. Download só por `/api/v1/docs/files/{id}`, para quem vê a página.

## Gerenciamento de Projetos — GP-1 (quadro) — migrations `1790000020_project_plan.js` e `1790000021_plan_items.js`
Módulo à parte das tarefas: nenhuma coluna em `tasks` (a `1790000021` remove `group_id`, `plan_position`, `progress`, `progress_set` e `resource_ids` que a primeira versão tinha criado).

### `project_groups`
`project_id` → projects (cascade), `parent_id` (texto; raiz = vazio; até 2 níveis), `name` (≤120), `color` (paleta), `position` (passo 1024), `created_by`. Índice `(project_id, parent_id, position)`.

### `plan_statuses`
Etiquetas de status do quadro, por projeto: `project_id` → projects (cascade), `name` (≤40), `color`, `category` (`todo`, `in_progress`, `review`, `blocked`, `done`, `canceled`), `position`.

### `plan_resources`
Etiquetas de recurso por projeto: `project_id` → projects (cascade), `name` (≤60), `name_key` (sem acento/minúsculas; único com `project_id`), `color`.

### `plan_items`
Elementos e subelementos: `project_id` → projects (cascade), `group_id` → project_groups (cascade), `parent_id` (subelemento; 1 nível), `name` (≤255), `status_id` (texto; vazio = em branco), `start_date`, `end_date`, `due_date`, `owner_id` → users, `resource_ids` → plan_resources (até 20), `metrics` (JSON: `estimated_hours`, `actual_hours`, `duration_days` — ausente/null ≠ 0), `progress` (0–100) + `progress_set` (manual), `position`, `created_by`.

A migration `1790000021` também concede `plan.view/edit/manage` aos perfis padrão (ADMIN e MANAGER: todas; MEMBER: ver e editar; VIEWER: ver).

### GP-2 — migration `1790000022_plan_links.js`
- `plan_item_links`: `project_id` → projects (cascade), `from_id` e `to_id` → plan_items (cascade: excluir o elemento apaga as ligações), `type` (`blocks` = from bloqueia to; `relates`), `created_by`. Índice único `(from_id, to_id, type)`.
- `plan_settings`: uma por projeto (`project_id` único, cascade) com `dependency_rule` (`warn` | `block`); sem registro = `warn`.

### GP-3 — migration `1790000023_plan_collaboration.js`
- `plan_item_updates`: `project_id` e `item_id` (cascade), `parent_id` (resposta; um nível), `author_id`, `content` (≤ 10.000), `mentions` → users (até 20), `edited_at`, `deleted_at` (exclusão lógica). Índices `(item_id, created)` e `(project_id)`.
- `plan_item_files`: `project_id` e `item_id` (cascade), `file` (Storage, até 20 MB, tipos permitidos), `name`, `mime`, `kind` (`image` | `document`), `size`, `uploaded_by`.
- `notifications`: `task_id` deixa de ser obrigatório; novos `plan_item_id` → plan_items (cascade) e `project_id` → projects (cascade); tipos `plan_mention` e `plan_reply`.

### Imagens na atualização — migration `1790000024_plan_update_files.js`
- `plan_item_files.update_id` → plan_item_updates (cascade) + índice: o arquivo pertence à atualização em que foi colado/anexado (a aba Arquivos do painel saiu). Arquivos enviados antes pela aba ficam guardados, sem atualização.

### GP-4 — migration `1790000025_plan_management.js`
- `plan_settings`: `baseline` (JSON `{ saved_at, items: { id: { start, end } } }`, linha de base do Cronograma) e `issue_seq` (sequência dos problemas: o número não se repete).
- `plan_journal`: `project_id` (cascade), `entry_date` (dia), `content` (≤ 5.000), `author_id`. Índice `(project_id, entry_date)`.
- `plan_issues`: `project_id` (cascade), `number` (único por projeto), `opened_on`, `description` (≤ 2.000), `state` (`in_progress` | `pending` | `resolved`), `owner_id`, `resolved_on`, `created_by`. Índice único `(project_id, number)`.

### GP-5 — migration `1790000026_plan_columns.js`
- `plan_columns`: `project_id` (cascade), `name` (≤ 60), `type` (`text` | `number` | `date` | `checkbox` | `dropdown` | `people` | `link`), `settings` (JSON: opções da lista com id/nome/cor; unidade do número), `position`, `created_by`. Índice `(project_id, position)`.
- `plan_items.custom` (JSON `{ coluna: valor }`): valores das colunas personalizadas no elemento (excluir/alterar a coluna reescreve os valores na mesma transação).

## Configurador geral (migration 1790000027)
- `platform_settings` — **registro único**: `values` (JSON só com o que foi alterado; o que falta usa o padrão do domínio `domain/platform-settings.js`), `files` (JSON com nome, tipo e tamanho de cada imagem) e os arquivos `logo_light`, `logo_dark`, `favicon` (no Storage, até 1 MB; servidos só por `/api/v1/platform/branding/{slot}`). Se o registro sumir, é recriado vazio.
- Permissão `platform.manage` criada e concedida ao Admin.
- **Retenção do histórico:** a rotina diária `audit-retention` (03:45) apaga de `audit_logs` o que é anterior ao corte, em lotes de 1.000 (índice `idx_audit_created`), e grava `audit_log.purge`.

## E-mail (migration 1790000028)
- `email_settings` (`0003_email_settings.sql`; antes, nas configurações internas do PocketBase) — **linha única** (`id = 'default'`): `enabled`, `host`, `port`, `username`, `password_secret` (senha cifrada pela API com AES-256-GCM e a `KAMBAN_SECRET_KEY`; nunca em texto puro), `tls`, `sender_name`, `sender_address`, `app_url`.
- `email_outbox` — fila de saída: `to`, `kind` (notification, password_reset, invite, test), `subject`, `html`, `text` (apagados depois de enviar ou desistir), `status` (pending, sent, failed), `attempts`, `last_error`, `next_attempt_at`, `sent_at`; índice `(status, next_attempt_at, created)`.
- `auth_tokens` — links de uso único: `user_id` (cascade), `purpose` (reset, invite), `token_hash` (único; o token em si nunca é gravado), `expires_at`, `used_at`.
- `users.email_notifications_off` — a pessoa desligou as notificações por e-mail.
- Permissão `integrations.manage` criada e concedida ao Admin.

## Tokens de API (migration 1790000029)
- `api_tokens`: `user_id` (cascade), `name`, `token_hash` (único — o valor nunca é gravado), `prefix` (início visível, ex.: `kb_pat_ab12`), `expires_at` (vazio = sem prazo), `last_used_at`/`last_used_ip` (gravados no máximo a cada 5 minutos), `revoked_at`.
- Permissão `api_tokens.create` criada e concedida ao Admin e ao Gestor.

## Webhooks (migration 1790000030)
- `webhooks`: `name`, `url`, `events` (JSON: eventos do catálogo ou `grupo.*`), `secret` (segredo de assinatura — guardado para assinar; nunca sai na API depois da criação), `active`, `created_by`, `last_status`, `last_delivery_at`, `consecutive_failures`.
- `webhook_deliveries`: `webhook_id` (cascade), `event`, `payload` (JSON), `status` (pending, success, failed), `attempts`, `response_status`, `response_body` (até 1.000), `error`, `duration_ms`, `next_attempt_at`, `delivered_at`; índices `(status, next_attempt_at, created)` e `(webhook_id, created)`. Encerradas saem depois de 30 dias.
- O histórico (`auditRepository.record`) enfileira as entregas na mesma transação (`infrastructure/repositories/webhooks.js`, `withWebhooks`).

## Supabase (migrations `0004` a `0007`)
- `0004_lockdown.sql`: RLS em todas as tabelas e `REVOKE` de `anon`/`authenticated` no esquema — a API REST e o Realtime do Supabase não enxergam nada. O dono das tabelas (o usuário da API) não passa pelo RLS.
- `storage_trash` (`0005_storage_trash.sql`): `key` + `created`. O gatilho `trash_files` em `attachments`, `project_files`, `doc_files`, `plan_item_files` e `platform_settings` guarda a chave do arquivo de cada linha apagada ou com arquivo trocado (inclusive nas exclusões em cascata); se a transação for desfeita, a entrada também é. A rotina `storage-trash` apaga do Storage o que tem mais de 10 min. Uploads de gravações desfeitas entram pelo mesmo caminho (`guardStorage`).
- `0006_realtime.sql`: gatilho `notify_change` nas tabelas acompanhadas (`domain/realtime.js#WATCHED`) — avisa o canal `realtime_<esquema>` com tabela, ação, id e os vínculos (projeto, tarefa, elemento, pessoa); o Postgres entrega depois do commit e cada instância da API repassa às conexões SSE.
- `0007_project_files.sql`: `project_files` — arquivos do projeto fora das tarefas (regras §22): `project_id` (cascade), `file` (nome guardado no Storage, chave `project_files/<id>/<file>`), `name`, `mime`, `kind` (`image`/`document`), `size`, `uploaded_by` (set null), `created`; índice `(project_id, created)`; RLS ligado, gatilhos da lixeira do Storage e do tempo real (tópico do projeto).
