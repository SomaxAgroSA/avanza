# Diretriz de Desenvolvimento — Plataforma de Gestão de Projetos, Backlog e Kanban

> Documento de referência obrigatória do projeto. Versão inicial: 2026-09-28.

---

## 1. Objetivo do projeto

Aplicação web moderna de gestão de projetos, tarefas, backlog e Kanban, inspirada conceitualmente em Bitrix24, Linear, Jira, Plane e similares. Escopo inicial:

- Gerenciamento de projetos
- Gerenciamento de tarefas
- Backlog
- Kanban completo
- Tipos de tarefas configuráveis
- Campos personalizados por tipo de tarefa
- Usuários
- Perfis e permissões
- Histórico/auditoria
- Relacionamento entre tarefas
- Fork/duplicação de tarefas
- Anexos e gerenciamento de imagens
- Relatórios e indicadores
- API REST pronta para integrações
- Interface extremamente moderna, responsiva e intuitiva
- Tema claro e escuro

Deve crescer depois sem reescrever a arquitetura. Não é só um quadro Kanban: é o núcleo de uma futura plataforma corporativa de gestão de demandas.

**Expansão autorizada (2026-09-30):** além do MVP, o usuário autorizou **Gestão de projetos com timeline/portfólio** (estilo Monday.com) e **Documentação / Base de conhecimento com FAQ** (estilo Confluence/SharePoint), em ondas — plano, decisões e escopo de cada onda em [roadmap-expansao.md](roadmap-expansao.md). Nada além do que estiver lá sem nova autorização. **Onda 1 (Timeline) concluída em 2026-09-30:** início planejado na tarefa (≤ prazo), timeline por projeto (arrastar/esticar barras, teclado, dependências com conflito, sprints, marcos do gestor, "Sem datas"); regras em regras-de-negocio.md §12. **Onda 2 (Documentação) concluída em 2026-09-30:** espaços (empresa ou projeto, chave, ícone/cor), árvore de páginas (8 níveis, arrastar/Mover…), editor rico TipTap no design system (aviso, tabela, imagem, arquivo, sumário, menu "/"; conteúdo JSON higienizado no servidor), rascunho autossalvo, publicação com versões e restauração, busca sem acento; permissões `docs.view/edit/manage`; regras em regras-de-negocio.md §13. **Gerenciamento de Projetos (diretriz própria em diretriz_feature_gerenciamento_projetos.md) — GP-1 concluída em 2026-09-30:** módulo **à parte das tarefas**, na aba **Gerenciamento** do projeto (a aba Tarefas continua sendo a lista de tarefas): quadro estilo Monday com grupos/subgrupos numerados 1.0/2.1 (gestor), **elementos e subelementos** com etiquetas próprias de status (com categoria) e de recurso por projeto, cronograma, esforço, duração (calculada pelo cronograma ou informada), progresso (concluído = 100, subelementos ponderados pelo trabalho, ou manual), edição direta nas células, totais no rodapé e colunas configuráveis (`AppBoardTable`); permissões `plan.view/edit/manage`; regras em regras-de-negocio.md §14. **GP-2 concluída em 2026-09-30:** arrastar elementos/subelementos/grupos, filtros (barra, pessoa, por coluna), ordenar, agrupar por status/recurso/mês, seleção em massa, duplicar, dependências com regra do quadro (só sinalizar ou impedir iniciar/concluir) e importação de CSV. **GP-3 concluída em 2026-09-30:** painel lateral do elemento (contador na linha, link `?item=`) com atualizações em conversa (respostas, @menções que notificam) com imagens/arquivos colados (Ctrl+V), arrastados ou anexados na própria atualização (sem aba Arquivos; também nos comentários das tarefas), histórico e detalhes; notificações apontam para tarefa ou elemento. **GP-4 concluída em 2026-09-30:** visões Cronograma (Gantt, linha de base, exportar, Bateria, Esforço), Kanban por status, Gestão (Diário e Problemas) e Relatórios com a saúde do projeto (pior fator, sempre com os fatores). **GP-5 concluída em 2026-10-01:** colunas personalizadas do quadro (texto, número com soma, data, caixa, lista, pessoa, link) — o gestor adiciona/renomeia/duplica/altera o tipo (com prévia)/exclui; quem edita preenche; regras §14. Fases GP-1 a GP-5 concluídas. Desde 2026-10-01 o módulo é o item **Gestão de projetos** do menu lateral (`/project-management/:projeto`), fora da página do projeto.

**Configurador geral (2026-10-01) ✅:** Configurações → Geral, permissão própria `platform.manage` (só Admin por padrão): nome/logo/ícone públicos (`GET /platform`), política de senha (mínimo 8–64, letras e números sempre; maiúsculas/minúsculas e símbolo opcionais), bloqueio de login (3–20 tentativas, tempo que dobra até o teto) e retenção do histórico (1–24 meses ou sempre; limpeza diária, prévia ao encurtar). Limites seguros no domínio `domain/platform-settings.js`; regras em regras-de-negocio.md §15; ADR-034.

**E-mail (2026-10-01) ✅:** Configurações → Integrações (`integrations.manage`): SMTP configurado no app (tabela `email_settings`, senha cifrada com a chave do servidor), fila `email_outbox` (rotina a cada minuto, novas tentativas, corpo apagado após envio), "Esqueci minha senha" e convite por links de uso único (`auth_tokens`, só o hash; sem revelar contas; com o e-mail desligado, o botão do login orienta a contatar o administrador) e notificações também por e-mail (preferência em Minha conta). Regras §16; ADR-035.

**Tokens de API (2026-10-01) ✅:** Minha conta → Tokens de API (`api_tokens.create`, Admin/Gestor): `Authorization: Bearer kb_pat_…` (sem cookie nem CSRF), só o hash guardado, valor mostrado uma vez, permissões do perfil atual a cada chamada, sem criar tokens/trocar senha/sessões com token; Admin revoga em Integrações. Regras §17; ADR-036.

**Webhooks (2026-10-01) ✅:** Integrações → Webhooks (`integrations.manage`): catálogo público de eventos (nomes do histórico; `grupo.*`), entrega criada no próprio `auditRepository.record` (decorador `withWebhooks`), fila `webhook_deliveries` com rotina por minuto, POST assinado (HMAC-SHA256 de `timestamp.corpo`), novas tentativas 1/5/30/120/720 min, desligamento após 20 falhas, SSRF (https; metadados bloqueados; http/loopback só fora de produção). Regras §18; ADR-037.

**Tempo real (2026-10-01) ✅:** SSE servido pela API (`/api/realtime`, protocolo herdado do PocketBase) com tópicos `project:{id}`/`user:{id}`; assinatura pela sessão + CSRF (`http/realtime.js`); avisos só com identificadores saindo dos gatilhos do banco depois do commit (`LISTEN/NOTIFY`); web invalida o cache (`useLiveProject`, `useLiveNotifications`; no máximo uma busca a cada 2,5 s por tela; polling de 5 min com o tempo real ligado; ressincroniza ao reconectar). Regras §19; ADR-039.

**Desempenho e duas edições (2026-10-01):** fase 0 ✅ (pool de 60 VMs do JS, quadro do Kanban com consulta enxuta, polling como rede de segurança, limite de 2,5 s por tela; vazão útil 3×). Edições **Local** (PocketBase no instalador, sem configuração) e **Supabase** (URL + chave secreta + conexão do Postgres; Cloud ou auto-hospedado), escolhidas na instalação e travadas. Plano em plano-migracao-supabase.md; ADR-040 — **revisto pelo ADR-044** (abaixo).

**Supabase no lugar do PocketBase (2026-10-28):** uma edição só — API em Node (Fastify) com os mesmos `domain/` e `application/` (casos de uso assíncronos), repositórios SQL sobre o Postgres do Supabase, arquivos no Storage (bucket privado, servidos pela API), rotinas com trava do Postgres, tempo real SSE com `LISTEN/NOTIFY` (o web não mudou), autenticação própria; dados do PocketBase migrados por `npm run import:pocketbase`. Andamento em plano-migracao-supabase.md §0; ADR-044.

## 2. Princípios fundamentais (obrigatórios)

Clean Architecture; SOLID; TDD; componentização; baixo acoplamento; alta coesão; reutilização máxima; separação clara entre domínio, aplicação, infraestrutura e apresentação; segurança desde o início; API-first; responsividade; acessibilidade; UX consistente; código legível e documentado; testes automatizados; **nenhuma regra de negócio importante diretamente na UI**.

Desenvolver como produto real, não protótipo descartável.

## 3. Stack e tecnologias

**Banco de dados: Supabase** (Postgres + Storage), desde 2026-10-28 (ADR-044), com a API própria em Node (Fastify). O MVP nasceu no PocketBase (simplicidade, SQLite, baixa complexidade operacional); a troca reescreveu só a infraestrutura e o HTTP — domínio e casos de uso ficaram, apenas passando a assíncronos.

A arquitetura deve **impedir acoplamento excessivo ao banco**:
- Toda comunicação com o banco passa por abstrações/repositórios (`infrastructure/`; só `database.js` conhece o driver).
- Nada de SQL, cliente do Postgres ou do Storage espalhado pela aplicação.
- Criar interfaces como `Repository`, `DataSource`, `ApiClient`, `AuthService`, `StorageService` — para permitir trocar de banco ou de serviço sem reescrever o domínio.

## 4. Arquitetura (Clean Architecture)

```
lib/
├── core/
│   ├── constants/ errors/ exceptions/ extensions/ helpers/
│   ├── networking/ security/ storage/ theme/ utils/ validators/
├── domain/
│   ├── entities/ enums/ repositories/ usecases/
├── data/
│   ├── datasources/ dtos/ mappers/ repositories/ services/
├── presentation/
│   ├── common/ components/ layouts/ navigation/ pages/ widgets/ state/
└── features/
    ├── auth/ dashboard/ projects/ tasks/ backlog/ kanban/ users/
    ├── permissions/ task_types/ custom_fields/ reports/ audit/ settings/
```

A estrutura pode ser adaptada ao framework, mas a separação arquitetural deve ser preservada.

## 5. TDD

RED (teste falhando) → GREEN (implementação mínima) → REFACTOR (código limpo).

Priorizar testes para: regras de negócio, use cases, validações, permissões, autenticação, transições de status, manipulação de tarefas, fork, relacionamentos, campos personalizados, filtros, ordenação, paginação, indicadores, API.

Uma funcionalidade **não** está concluída só porque a interface funciona.

## 6. Modelo de domínio

### 6.1 Usuário
Campos: `id, name, email, avatar, status, role_id, created_at, updated_at, last_login_at`.
Requisitos: ativar/desativar, avatar, controle de acesso, histórico, último acesso, controle de sessão, associação a projetos.

## 7. Perfis de acesso (RBAC)

Perfis iniciais: `SUPER_ADMIN, ADMIN, MANAGER, MEMBER, VIEWER`.

Permissões **configuráveis** (nunca codificadas na interface). Exemplos:
```
projects.view  projects.create  projects.edit  projects.delete
tasks.view  tasks.create  tasks.edit  tasks.delete  tasks.assign  tasks.fork  tasks.link
kanban.view
users.view  users.create  users.edit  users.disable
reports.view
settings.manage  permissions.manage
```
O administrador configura o que cada perfil pode fazer.

## 8. Projetos

Campos: `id, name, key, description, icon, cover, status, priority, owner_id, start_date, due_date, created_at, updated_at, archived_at`.
Exemplos: CRM, AGB, INTEGRAÇÕES, SAP, PROJETOS INTERNOS.
Cada projeto pode ter: Kanban, backlog, tarefas, membros, tipos de tarefa, campos personalizados, status, prioridades, relatórios.

## 9. Tipos de tarefa (recurso central)

Administrador cria tipos. Exemplos: BUG, DESENVOLVIMENTO, MELHORIA, ADEQUAÇÃO, NOVA FUNCIONALIDADE, INTEGRAÇÃO, SUPORTE, DOCUMENTAÇÃO. Cada tipo tem configuração própria:

- **BUG:** Ambiente, Versão, Severidade, Passos para reprodução, Resultado esperado, Resultado atual, Evidências, Cliente afetado, Módulo.
- **DESENVOLVIMENTO:** Requisito, Critérios de aceite, Estimativa, Tecnologia, Branch, Pull Request, Versão alvo.
- **MELHORIA:** Problema atual, Proposta, Benefício esperado, Impacto, Área solicitante, Critérios de aceite.

Esses campos **não podem ser fixos no código** — são configuráveis pelo administrador.

**Obrigatoriedade por status (nova diretriz, pedido do usuário em 2026-09-30):** a obrigatoriedade de cada campo do tipo não é fixa — além de "Obrigatório" (exigido em todos os status, inclusive na criação), o administrador escolhe **em quais status** o campo passa a ser exigido (ex.: em Análise, "Parecer do analista"; em Desenvolvimento, "Branch"). Regra: ao criar, editar ou mudar de status, a tarefa precisa ter preenchidos os campos exigidos **no status em que vai ficar**; campo oculto nunca é exigido. Toda mudança de status (quadro, planejamento, troca rápida, formulário e API) segue a regra; na tela, quando faltar algo, abre-se o preenchimento só dos campos que faltam e a mudança é aplicada em seguida. O formulário e a pré-visualização do tipo marcam como obrigatórios os campos do status escolhido. Detalhes: [regras-de-negocio.md](regras-de-negocio.md) e ADR-023.

## 10. Campos personalizados (custom fields genéricos)

Tipos: Texto, Textarea, Número, Decimal, Boolean, Data, Data/Hora, Seleção, Multi-seleção, Usuário, Usuários, Projeto, URL, Email, Telefone, Imagem, Arquivo.

Atributos: `id, name, label, type, required, default_value, options, order, visible, searchable, filterable, sortable, created_at, updated_at`.

Admin pode: criar, editar, remover, reordenar, tornar obrigatório/opcional, definir valor padrão, opções, visibilidade, se aparece no Kanban, se pode ser usado em filtros.

## 11. Tarefas

Campos: `id, task_number, title, description, project_id, task_type_id, status_id, priority_id, creator_id, assignee_id, reporter_id, parent_task_id, created_at, updated_at, started_at, completed_at, due_date, estimated_hours, actual_hours`.
Suporta: tags, checklist, comentários, anexos, imagens, relacionamentos, dependências, subtarefas, histórico, campos personalizados.

**Início e conclusão (pela categoria do status, não pelo tipo):** cada status tem uma categoria (backlog, a fazer, em andamento, concluída, cancelada). A tarefa é iniciada/concluída ao mudar de status: entrar em "em andamento" grava `started_at` (só a primeira vez); entrar em "concluída"/"cancelada" grava `completed_at` (e `started_at`, se vazio); reabrir limpa `completed_at`. Toda troca de status respeita as transições permitidas e vai para o histórico. Detalhes: [regras-de-negocio.md](regras-de-negocio.md).

## 12. Fork de tarefas

```
TASK-001
  ├── Fork → TASK-002
  └── Fork → TASK-003
```
- Preserva a origem em `forked_from_task_id`.
- Histórico registra: "TASK-001 forkou TASK-002".
- Definir claramente se o fork copia: descrição, anexos, tags, campos personalizados, checklist, relacionamentos — **comportamento configurável**.

## 13. Relacionamento entre tarefas

Tipos: Relacionado a, Bloqueia, Bloqueado por, Duplicado de, Duplicado em, Depende de, Dependência, Pai, Filho, Fork de.
Modelo `task_relations`: `id, source_task_id, target_task_id, relation_type, created_by, created_at`.
Evitar relacionamentos circulares quando não permitidos pela regra de negócio.

**Implementação (Fase 7):** gravados só `relates`, `blocks`, `duplicates` e `depends_on` (os inversos são a mesma relação vista do outro lado); Pai/Filho = `parent_task_id` (mesmo projeto, sem ciclo, até 5 níveis; excluir o pai solta as filhas); Fork de = `forked_from_task_id`. Bloqueios e dependências não formam ciclo; "Bloqueada" = bloqueador ainda aberto (aviso, não impede mover). Fork: cópia escolhida na hora (padrão: descrição, tags, campos e checklist com itens pendentes; anexos e relações opcionais). Regras completas em [regras-de-negocio.md](regras-de-negocio.md).

## 14. Kanban (completo e configurável)

Recursos: colunas configuráveis, drag & drop, WIP limit, swimlanes, ordenação, filtros, busca, agrupamento, quick add, criar/mover tarefa, alterar responsável/prioridade/status, atualização otimista, tempo real quando possível.

Fluxo exemplo: BACKLOG → TRIAGEM → ANÁLISE → PRIORIZADO → DESENVOLVIMENTO → HOMOLOGAÇÃO → PRODUÇÃO → CONCLUÍDO.

Admin pode: criar/editar/excluir/reordenar coluna, alterar nome, definir WIP, cor, comportamento e **transições permitidas**.

Regras: colunas = status ativos na ordem configurada; o limite WIP é alerta (não bloqueia); transições não permitidas são recusadas em qualquer troca de status (quadro, tarefa ou API). Ver [regras-de-negocio.md](regras-de-negocio.md).

## 15. Backlog

Visão própria: lista, priorização, drag & drop, filtros, ordenação, busca, estimativa, prioridade, sprint/ciclo futuro, responsável, tipo. Permitir transformar item em tarefa ativa.

**Sprints (autorizado pelo usuário em 2026-09-30):** o planejamento usa **Sprint** (não "ciclo") e a tela se chama **Planejamento** (não "Backlog"; a categoria/status "Backlog" continuam). Ela lista **tudo que ainda não foi encerrado** — status das categorias backlog, a fazer e em andamento; concluídas e canceladas ficam fora (decide a categoria, não o nome) — para priorizar e organizar em sprints; o gestor do projeto cria, ordena, inicia, encerra e exclui sprints; ao encerrar, o que não terminou volta ao backlog sem sprint. Sprint é só planejamento (sem velocidade/burndown). Regras completas em [regras-de-negocio.md](regras-de-negocio.md).

## 16. Imagens e anexos

Por tarefa: upload de imagem e documentos, preview, download, exclusão, metadados, data, usuário que enviou.
Imagens: preview, zoom, galeria, navegação, lazy loading, compressão quando apropriado, validação de MIME type, limite de tamanho, proteção contra upload malicioso. **Nunca confiar apenas na extensão do arquivo.**

## 17. Histórico / Auditoria

Toda alteração relevante gera histórico (ex.: "Natan alterou prioridade: Média → Alta", "Status alterado: Desenvolvimento → Homologação").
Modelo `audit_logs`: `id, entity_type, entity_id, action, old_value, new_value, user_id, ip, user_agent, created_at`.
Histórico **imutável** para usuários comuns.

## 18. Comentários

Campos: `id, task_id, user_id, content, created_at, updated_at, deleted_at`.
Recursos: Markdown ou editor rico, menções, anexos, edição, exclusão conforme permissão, histórico.

**Regras definidas pelo responsável pelo produto (2026-09-28):**
- **Quem comenta:** qualquer usuário com acesso ao projeto pode comentar nas tarefas, **inclusive com papel de leitor (visualizador)**. Comentar não exige permissão de edição da tarefa. Projeto arquivado continua somente leitura.
- **Menções com @:** ao digitar `@` no comentário, abre uma lista com as pessoas que têm acesso ao projeto (filtrando enquanto digita, como WhatsApp/Instagram). A pessoa escolhida aparece destacada no texto (ex.: **@Carla Mendes**). Só é possível mencionar quem tem acesso ao projeto; o servidor valida.
- **Histórico:** comentários adicionados, editados e excluídos — e as pessoas mencionadas — aparecem no histórico da tarefa.
- As menções alimentam as notificações internas quando o módulo de notificações existir (§41: evento "menção").

## 19. DataTables

Um único componente DataTable reutilizável, mesmo padrão visual/comportamental em todo o sistema.
Obrigatório: paginação, contador total, ordenação, filtro por coluna, busca global, seleção de colunas, redimensionamento e colunas fixáveis quando aplicável, estado persistido de filtros e ordenação, loading, empty state, error state, ações por linha (**Visualizar, Editar, Excluir, Mais**).
"Visualizar" abre drawer lateral ou modal de detalhes, sem navegar para outra página.

**Implementação (autorizado pelo usuário em 2026-09-30):** "Visualizar" abre `AppDrawer`; **criar e editar abrem pop-up centralizado** (`AppDialog` grande, `xl`/`2xl`), com ações fixas, rolagem interna, colunas no desktop e sem fechar por clique fora. Ver ADR-021.

## 20. UX/UI

Nível profissional. Inspiração (sem copiar): Linear, Plane, Jira, Bitrix24, Notion, GitHub, Vercel, Microsoft Fluent UI. Identidade visual própria.
Princípios: interface limpa, poucos elementos desnecessários, hierarquia visual forte, feedback imediato, navegação previsível, responsividade, atalhos de teclado, menos cliques, ações contextuais, empty states úteis, skeleton loading, toasts, confirmações só quando necessárias, undo quando possível.

## 21. Tema

Design system próprio. Temas: Light, Dark, System. Cores consistentes. Gradientes com moderação (header, cards especiais, dashboard, backgrounds decorativos, destaques). Evitar aparência "neon".

## 22. Design System — componentes reutilizáveis

`AppButton, AppIconButton, AppTextField, AppSelect, AppMultiSelect, AppDatePicker, AppDateRangePicker, AppDialog, AppDrawer, AppCard, AppBadge, AppAvatar, AppTooltip, AppDropdown, AppDataTable, AppPagination, AppKanban, AppKanbanCard, AppKanbanColumn, AppFileUploader, AppImageViewer, AppRichTextEditor, AppEmptyState, AppErrorState, AppSkeleton, AppLoading, AppToast, AppConfirmDialog, AppBreadcrumb, AppTabs, AppFilterBar, AppSearch, AppCommandPalette`

**Nenhuma feature deve criar versões duplicadas desses componentes.**

## 23. Command Palette

Global, atalho **CTRL + K**. Permite: buscar tarefa, criar tarefa, abrir projeto, buscar usuário, ir para backlog, ir para Kanban, abrir configurações.

## 24. Dashboard

Indicadores: total de tarefas, backlog, em andamento, bloqueadas, concluídas, atrasadas, bugs críticos, tempo médio de conclusão, tarefas por prioridade/tipo/responsável/projeto.
Derivados de dados reais e consistentes. **Sempre deixar claro o período considerado.**

## 25. Relatórios

Iniciais: por status, prioridade, tipo, usuário, projeto; bugs; atrasadas; tempo médio de resolução; lead time; cycle time.
Filtros: projeto, período, responsável, tipo, prioridade, status.

**Implementação (Fase 8):** `GET /api/v1/reports` (período explícito e fuso da pessoa; padrão 30 dias; definições devolvidas junto). Escopo = projetos visíveis, sem arquivados (salvo se escolhidos). "Agora": abertas, backlog, a fazer, em andamento, bloqueadas, atrasadas, bugs críticos (tipo BUG + prioridade mais alta). "No período": criadas, concluídas, canceladas, lead time, cycle time e resolução de bugs (médias com amostra). Recortes por status/prioridade/tipo/responsável/projeto, série criadas × concluídas e lista de atrasadas. Definições completas em [regras-de-negocio.md](regras-de-negocio.md).

**Indicadores interativos (autorizado pelo usuário em 2026-09-30):** todo card de indicador (Relatórios e Dashboard) é clicável e abre as tarefas por trás do número (`GET /api/v1/reports/tasks`, mesma regra da contagem — a lista sempre bate com o card); ao passar o mouse, o card explica o que mede. Ver ADR-022.

## 26. API REST (documentada)

Endpoints:
```
/api/v1/auth  /api/v1/users  /api/v1/roles  /api/v1/permissions
/api/v1/projects  /api/v1/tasks  /api/v1/task-types  /api/v1/custom-fields
/api/v1/statuses  /api/v1/priorities  /api/v1/comments  /api/v1/attachments
/api/v1/relations  /api/v1/audit-logs  /api/v1/reports
```
Requisitos: versionamento, autenticação, autorização, paginação, ordenação, filtros, busca, validação, tratamento de erros, logs, rate limiting quando aplicável, OpenAPI/Swagger.

Formato de resposta consistente:
```json
{ "data": {}, "meta": {}, "error": null }
```
Erro:
```json
{ "data": null, "meta": {}, "error": { "code": "TASK_NOT_FOUND", "message": "Task not found", "details": {} } }
```

## 27. Segurança (em todas as etapas)

HTTPS em produção; tokens seguros; expiração de sessão; refresh token quando aplicável; logout; controle de sessão; RBAC; validação de entrada; sanitização; proteção contra XSS, CSRF (quando aplicável) e IDOR; rate limiting; controle de upload; MIME validation; limite de tamanho; auditoria; menor privilégio; sem secrets no código; variáveis de ambiente; logs sem dados sensíveis. **Nunca API keys ou secrets no frontend.**

**Implementação (Fase 9):** bloqueio progressivo de conta (5 falhas → 5 min, dobrando até 60 min; também para e-mails inexistentes; `429 ACCOUNT_LOCKED`), varredura automática de todas as rotas (401 sem sessão, CSRF, API genérica fechada, cabeçalhos), catálogo de auditoria testado, `npm audit` limpo e testes de ponta a ponta no navegador (fluxos do MVP + acessibilidade WCAG AA em claro/escuro, desktop/celular). Ver [security.md](security.md) e [testing.md](testing.md).

## 28. Sessão web

Login, logout, expiração, renovação, persistência configurável, detecção de sessão inválida, redirecionamento automático, proteção de rotas, controle de sessões ativas quando suportado, limpeza de sessão.

## 29. Estado da aplicação

Gerenciamento consistente, separando **UI State, Domain State, Server State, Session State**. Evitar estado global desnecessário. Cache e sincronização com estratégia clara.

## 30. Performance

Paginação no backend, lazy loading, debounce em pesquisas, cache quando apropriado, compressão de imagens, evitar rebuilds desnecessários, virtualização de listas grandes, consultas eficientes, índices no banco, carregamento sob demanda.

## 31. Banco de dados (tabelas)

```
users, roles, permissions, role_permissions, projects, project_members,
task_types, custom_fields, task_type_fields, custom_field_options, tasks,
task_custom_values, task_statuses, task_priorities, task_tags, tags,
task_tag_relations, task_relations, comments, attachments, audit_logs,
notifications, sessions
```
Índices para campos consultados com frequência, ex.:
- `tasks`: project_id, status_id, assignee_id, creator_id, task_type_id, priority_id, created_at, due_date
- `audit_logs`: entity_id, user_id, created_at

Não criar campos redundantes sem justificativa.

## 32. Integridade dos dados

Toda operação crítica valida: existência do registro, permissão, estado atual, consistência, relações, ownership, integridade referencial lógica.
Ex.: um usuário não pode mover tarefa para "Produção" só por conhecer o ID do status. O backend verifica: **Usuário → Permissão → Projeto → Tarefa → Transição permitida**.

## 33. Observabilidade

Logs estruturados, erros rastreáveis, Correlation ID, auditoria, monitoramento, métricas, health check da API.

## 34. Internacionalização

Idiomas: **pt-BR, es, en**. Nenhum texto de interface hardcoded em componentes (ex.: `i18n.t('tasks.create')`). Idioma configurável pelo usuário.

**Cadastros traduzidos (pedido do usuário em 2026-09-30):** os **tipos de tarefa** têm nome e descrição traduzíveis para en/es; o original (pt-BR) continua editável e é usado quando falta tradução. A API devolve os tipos no idioma do `Accept-Language` enviado pelo app (que acompanha o idioma da tela) e trocar o idioma rebusca os dados. Os 8 tipos padrão já vêm traduzidos. Conteúdo das tarefas e histórico não são traduzidos. Regras em [regras-de-negocio.md](regras-de-negocio.md) §11; ADR-024.

## 35. Responsividade

Desktop, notebook, tablet, mobile web. Prioridade: Desktop > Tablet > Mobile. No mobile, Kanban com navegação horizontal e interação touch.

## 36. Navegação

```
Dashboard
Projetos (Todos | Meus projetos | Arquivados)
Planejamento (backlog e sprints)
Kanban
Tarefas
Relatórios
Usuários
Configurações (Tipos de tarefa | Campos personalizados | Status | Prioridades | Tags | Perfis | Permissões)
```

## 37. Fluxo principal

Login → Dashboard → Selecionar projeto → Backlog → Criar tarefa → Selecionar tipo → Sistema carrega campos específicos → Salvar → Tarefa entra no backlog → Mover para Kanban → Atribuir responsável → Desenvolvimento → Homologação → Conclusão.

## 38. UX de criação de tarefas

Formulário dinâmico: ao selecionar BUG/MELHORIA/DESENVOLVIMENTO, exibe os campos do tipo. Troca de tipo atualiza a UI sem recarregar a página. Campos obrigatórios identificados visualmente.

## 39. Quick Add

No Kanban: "+ Criar tarefa" abre modal/drawer compacto com Título, Tipo, Responsável, Prioridade; demais dados completados depois.

## 40. Detalhes da tarefa

Drawer lateral amplo ou página de detalhes:
```
Header: Número, Tipo, Status, Prioridade, Responsável, Ações
Descrição
Campos personalizados
Checklist
Relacionamentos
Anexos / Imagens
Comentários
Histórico
```
O usuário não deve perder o contexto do Kanban.

## 41. Notificações

Preparar arquitetura. Eventos: tarefa atribuída, menção, comentário, mudança de status, prazo próximo, prazo vencido, tarefa bloqueada. Inicialmente só notificação interna.

## 42. Controle de qualidade (antes de considerar módulo pronto)

- **Funcional:** fluxo principal, validações, permissões, erros tratados.
- **Visual:** desktop, tablet, mobile, light, dark.
- **Segurança:** sem acesso indevido, sem exposição de dados, upload seguro, rotas protegidas.
- **Performance:** paginação, loading, cache, sem consultas desnecessárias.
- **Testes:** unitários, integração, widget/UI, API, regras de autorização.

## 43. Critérios de aceite do MVP

Possível: criar usuário; criar perfil; configurar permissões; criar projeto; adicionar membros; criar tipos de tarefa; criar campos personalizados; associar campos a tipos; criar status; criar prioridades; criar/visualizar/editar tarefa; mover tarefa no Kanban; filtrar Kanban; pesquisar tarefas; criar backlog; reordenar backlog; criar subtarefa; criar fork; relacionar tarefas; adicionar comentários; adicionar e visualizar imagens; consultar histórico; filtrar/ordenar/paginar DataTables; visualizar detalhes sem abrir registro; gerar indicadores; consultar relatórios; consumir API; aplicar RBAC; alterar tema; alterar idioma; logout; expirar sessão corretamente.

## 44. Estratégia de desenvolvimento (em fases — nunca tudo de uma vez)

1. **Fundação:** projeto, arquitetura, design system, tema, i18n, autenticação, sessão, RBAC, banco de dados, API, tratamento de erros, logging.
2. **Projetos:** CRUD, membros, permissões, configurações.
3. **Tipos e campos:** tipos de tarefa, campos personalizados, configuração administrativa.
4. **Tarefas:** CRUD, detalhes, comentários, anexos, imagens, histórico.
5. **Kanban:** colunas, drag & drop, WIP, filtros, swimlanes, quick add.
6. **Backlog:** priorização, ordenação, filtros, ciclos futuros.
7. **Relacionamentos:** fork, dependências, relações, subtarefas.
8. **Relatórios:** dashboard, indicadores, relatórios.
9. **Hardening:** segurança, performance, testes, auditoria, UX, responsividade.

## 45. Regra fundamental para a IA de desenvolvimento

Não implementar de maneira improvisada. Antes de alterar qualquer módulo:
1. Entender a arquitetura existente
2. Identificar o domínio afetado
3. Verificar componentes reutilizáveis
4. Verificar regras existentes
5. Criar/atualizar testes
6. Implementar
7. Executar testes
8. Validar lint/análise estática
9. Validar segurança
10. Revisar impacto nos demais módulos

Nunca duplicar componentes reutilizáveis. Nunca colocar regra de negócio na UI. Nunca quebrar funcionalidade existente sem avaliar impacto.

## 46. Regra de documentação

Toda funcionalidade relevante deve ter: descrição, regra de negócio, modelo de dados, API, permissões, testes, critérios de aceite. Manter atualizado:
```
/docs
├── architecture.md
├── database.md
├── api.md
├── security.md
├── permissions.md
├── design-system.md
├── testing.md
├── deployment.md
└── decisions.md
```

## 47. Definition of Done

- [ ] Código implementado
- [ ] Testes implementados
- [ ] Testes passando
- [ ] Lint passando
- [ ] Análise estática passando
- [ ] Permissões validadas
- [ ] Segurança validada
- [ ] Responsividade validada
- [ ] Light mode validado
- [ ] Dark mode validado
- [ ] API validada quando aplicável
- [ ] Auditoria implementada quando aplicável
- [ ] Documentação atualizada
- [ ] Sem duplicação desnecessária
- [ ] Sem regra de negócio na UI
- [ ] Performance validada

## 48. Diretriz final para a IA desenvolvedora

Atuar como engenheiro de software sênior responsável por uma plataforma corporativa.
Prioridades (em ordem): arquitetura, segurança, qualidade, manutenibilidade, testabilidade, reutilização, UX, performance, funcionalidade.

- Não sacrificar arquitetura e segurança para acelerar.
- Não criar soluções temporárias que comprometam a evolução.
- Preferir soluções simples, extensíveis, testáveis e reutilizáveis.
- Sensação de SaaS moderno, profissional e premium. Interface: bonita, limpa, rápida, intuitiva, consistente, responsiva, moderna, profissional. Mínimo de cliques.

Primeira versão concentra-se **exclusivamente** em: Projetos + Backlog + Tarefas + Kanban + Tipos de tarefa + Campos personalizados + Usuários + RBAC + Anexos/Imagens + Histórico + Relatórios + API.

**Não adicionar módulos fora desse escopo sem autorização explícita.**

## 49. Resultado esperado

Ao final do MVP: plataforma funcional capaz de substituir, no escopo inicial, ferramentas tradicionais de backlog e Kanban.

Arquitetura deve permitir adicionar depois (fora do MVP, apenas considerar para evitar retrabalho): Sprint avançada (velocidade, burndown — o planejamento em sprints já faz parte do Backlog, §15), Roadmap, Calendário, Gantt, notificações avançadas, automação, integrações, webhooks, times, SLA, base de conhecimento, chat, dashboard executivo, app mobile, integração com ERP, CRM, GitHub/GitLab, Microsoft Teams, IA para gestão de tarefas.
