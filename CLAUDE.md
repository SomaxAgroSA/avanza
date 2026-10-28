# Avanza — Plataforma de Gestão de Projetos, Backlog e Kanban

> Nome do produto: **Avanza** ("Sincronize projetos, tarefas e equipes."), desde 2026-10-27; antes BLYD Sync (2026-10-01) e KAMBAN. A pasta, os pacotes npm e os identificadores técnicos continuam `kamban`/`KAMBAN` (cookie `kb_session`, `X-Requested-With: kamban`, tokens `kb_pat_`, variáveis `KAMBAN_*`, cabeçalhos `X-Kamban-*`) para não quebrar sessões, tokens e instalações — ADR-038 e ADR-042. Logos padrão em `web/public/brand` (originais em `assets/`).

A diretriz completa e obrigatória está em [docs/diretriz-desenvolvimento.md](docs/diretriz-desenvolvimento.md). Consulte a seção relevante antes de alterar qualquer módulo. Documentação técnica em [docs/](docs/) (comece por [architecture.md](docs/architecture.md)). Regras de negócio do fluxo (status, início/conclusão, transições, WIP, Kanban, backlog) em [regras-de-negocio.md](docs/regras-de-negocio.md) — manter atualizado a cada regra nova.

## Stack (ver docs/decisions.md)

- **Frontend** `web/`: React 19 + TypeScript estrito + Vite, React Router 8, TanStack Query 5, TanStack Table 9 (API v9: `useTable` + `tableFeatures`), Zustand, Radix UI, Tailwind 4, i18next, react-hook-form + zod.
- **Backend** `backend/`: PocketBase 0.40.4 (binário em `backend/bin`) + hooks JS em `backend/pb_hooks`. API própria `/api/v1`; a API genérica do PocketBase fica bloqueada.
- **Git liberado (2026-09-30):** repositório local (branch `main`); commitar ao concluir cada etapa verificada; remoto/push só quando o usuário pedir. Nunca versionar `.env`, `pb_data`, binário ou builds (`.gitignore`).

## Comandos

| Raiz | |
|---|---|
| `npm run dev` | API :8090 + web :5173 |
| `npm run check` | lint + tipos + todos os testes |
| `npm run build` | build do web em `backend/pb_public` |
| `npm run e2e` | build + testes de ponta a ponta no navegador (Edge) |
| `npm run demo` | dados de demonstração (projeto DEMO) no servidor do `backend/.env` |
| `npm run screenshots` | build + imagens do README (`docs/images`) num PocketBase isolado |

Open source sob **Apache-2.0** (ADR-033): README pt-BR + `README.en.md`, CHANGELOG (atualizar a cada mudança visível), Docker (`Dockerfile`, `docker-compose.yml`) e CI em `.github/workflows/ci.yml`.

Backend: `npm test` (unitários), `npm run test:api` (PocketBase real isolado), `npm run lint`, `npm run create-admin`.
Web: `npm test`, `npm run typecheck`, `npm run lint`.
Windows: rode a partir de `E:\KAMBAN` (letra maiúscula). Com o diretório como `e:\KAMBAN`, o Vitest carrega módulos em dobro e todos os arquivos falham com "failed to find the current suite".

## Regras essenciais

- **Escopo do MVP (exclusivo):** Projetos + Backlog + Tarefas + Kanban + Tipos de tarefa + Campos personalizados + Usuários + RBAC + Anexos/Imagens + Histórico + Relatórios + API. Nada fora disso sem autorização explícita.
- **Expansão autorizada (2026-09-30), em ondas:** Timeline/Portfólio estilo Monday e Documentação/FAQ estilo Confluence (com link público). Plano, decisões e escopo de cada onda em [docs/roadmap-expansao.md](docs/roadmap-expansao.md). Onda 1 (Timeline) ✅ → Onda 2 (Documentação) ✅ → **módulo Gerenciamento de Projetos** (vinculado a Projetos; diretriz obrigatória em [docs/diretriz_feature_gerenciamento_projetos.md](docs/diretriz_feature_gerenciamento_projetos.md), fases GP-1 a GP-5; **GP-1 ✅** — módulo **à parte das tarefas**, item **Gestão de projetos** do menu lateral (`/project-management/:projeto`, `features/plan/ProjectManagementPage.tsx`; antes aba `?tab=plan`, que redireciona): `project_groups`, `plan_items` (elementos/subelementos), `plan_statuses`/`plan_resources` por projeto, `GET /projects/{id}/plan`, `domain/plan.js`, `AppBoardTable` + `useBoardColumns`; nunca acoplar a `tasks`; **GP-2 ✅** — `application/plan-interaction.js` (mover, massa, dependências `plan_item_links` + regra `plan_settings`, importação), visões em `web/src/domain/plan-view.ts`, CSV em `plan-import.ts`; **GP-3 ✅** — painel do elemento `features/plan/ItemPanel.tsx` (`?item=`), `application/plan-collaboration.js`, `plan_item_updates`/`plan_item_files`, notificações com `plan_item_id`; **GP-4 ✅** — visões `?view=` (Cronograma `PlanTimeline` com linha de base em `plan_settings.baseline`, Kanban `PlanKanban`, Gestão `plan_journal`/`plan_issues`, Relatórios `domain/plan-report.js` com a saúde); **GP-5 ✅** — colunas personalizadas `plan_columns` + `plan_items.custom` (`domain/plan-columns.js`, `application/plan-columns.js`, web `custom-cells.tsx`/`column-dialogs.tsx`); GP-1 a GP-5 concluídas).
- **Configurador geral ✅ (2026-10-01):** Configurações → Geral (`platform.manage`): identidade pública, política de senha, bloqueio de login e retenção do histórico; `domain/platform-settings.js` (limites seguros), `application/platform-settings.js`, regras §15, ADR-034. Ordem seguinte: integrações → tempo real → SSO.
- **Integrações (item 4):** **e-mail ✅** (Configurações → Integrações, `integrations.manage`; `application/email.js` + fila `email_outbox` com rotina por minuto; `application/account-links.js` para "Esqueci minha senha"/convite com `auth_tokens`; SMTP de teste `backend/tests/support/smtp-sink.js`; regras §16, ADR-035) → **tokens de API ✅** (`application/api-tokens.js`, Bearer no `http/handler.js` antes do cookie, `assertBrowserSession` nas operações de conta; regras §17, ADR-036) → **webhooks ✅** (`application/webhooks.js`, `infrastructure/webhook-repositories.js` com `withWebhooks` no histórico; receptor HTTP local nos testes; regras §18, ADR-037). Item 4 concluído.
- **Tempo real ✅ (item 5):** SSE do PocketBase com tópicos `project:{id}`/`user:{id}` (`http/realtime.js`, `application/realtime.js`, `infrastructure/realtime.js`, `domain/realtime.js#WATCHED`); web `core/realtime/realtime-client.ts` + `useLiveProject`/`useLiveNotifications` em `presentation/common/use-live.ts`; avisos só com identificadores (a tela busca pela API). Regras §19, ADR-039.
- **Duas edições (decisão do usuário, 2026-10-01), escolhidas na instalação e travadas:** **Local** (PocketBase no instalador, nada a configurar) e **Supabase** (URL + chave secreta + conexão do Postgres; Cloud ou auto-hospedado; tempo real continua SSE pela API). Plano em [docs/plano-migracao-supabase.md](docs/plano-migracao-supabase.md), ADR-040. **Fase 0 de desempenho ✅:** `--hooksPool=60` (`backend/scripts/env.js#serveArgs`, `KAMBAN_HOOKS_POOL`), `listForBoard` enxuto, `useLiveRefetchInterval` (polling de 5 min com o tempo real ligado) + `useRealtimeResync`, no máximo uma busca ao vivo a cada 2,5 s por tela. **Proibido `routerUse` com JS** (ADR-041): o middleware em JS segura uma VM do pool durante todo o `e.next()`, inclusive no SSE — rotas da API usam `apiRoute` (envelope de erros), o frontend tem rota própria `GET /{path...}`, sinal de vida do tempo real a cada 3 min; regressão em `tests/api/capacity.test.js`; cenário `npm --prefix backend run load:docs` (10 trabalhando + 500 leitores: p95 44 ms). Próximo: instalador da edição Local (aguarda o usuário decidir sistemas e HTTP/HTTPS); edição Supabase ainda não iniciada.
- **Login corporativo (SSO):** evolução futura (decisão do usuário, 2026-10-01) — não iniciar sem pedido; decisões pendentes em [docs/roadmap-expansao.md](docs/roadmap-expansao.md#evoluções-futuras).
- **Arquitetura:** Clean Architecture + SOLID. Nenhuma regra de negócio na UI.
  - Backend: `core` → `domain` → `application` (casos de uso, portas) → `infrastructure` (único lugar com `$app`) → `http`. Domínio/aplicação são CommonJS puros testados com `node --test`.
  - JSVM do PocketBase: síncrono, sem `?.`/`??`/`await`; handlers rodam em VMs isoladas → `main.pb.js` só registra rotas e faz `require` dentro do handler.
  - Web: `app` (composition root) · `core` · `domain` (entidades, interfaces de repositório, regras de UI do RBAC, zod) · `data` (DTO/mappers/HTTP) · `presentation` (design system, layouts, navegação) · `features`. UI usa repositórios via `useRepositories()`; `fetch` é proibido em presentation/features.
- **TDD:** RED → GREEN → REFACTOR. Pronto = testes passando + lint + tipos.
- **API:** envelope `{ data, meta, error }`, snake_case, códigos de erro estáveis; mutações exigem `X-Requested-With: kamban`; sessão por cookie HttpOnly `kb_session`. Atualizar `http/openapi.js` e `docs/api.md` a cada rota nova.
- **Permissões:** catálogo em `backend/pb_hooks/src/domain/permissions.js` + `web/src/domain/permissions.ts`; matriz configurável. Backend sempre valida; regras anti-escalonamento em `domain/rbac`.
- **Obrigatoriedade por status:** ao criar/editar/mudar de status, a tarefa precisa dos campos exigidos no status em que vai ficar (`requiredIn` em `domain/task.js`, `isRequiredIn` no web); falta de campo na mudança de status abre "Preencha para mover" (`RequiredFieldsDialog`). Regras em `docs/regras-de-negocio.md` §10.
- **Auditoria:** toda mutação relevante grava `audit_logs` na mesma transação (`unitOfWork`), sem dados sensíveis.
- **Design System:** usar componentes `App*` de `@/presentation/components`; nunca duplicar. Toda listagem usa `AppDataTable` + `useDataTableState`; "Visualizar" abre `AppDrawer`; criar/editar abrem `AppDialog` grande (pop-up, `xl`/`2xl`). Só o `<main>` rola (sem 2ª barra de rolagem).
- **i18n:** pt-BR, es, en — nenhum texto fixo; o teste de locales exige as mesmas chaves nos três. Cadastros traduzidos (hoje: tipos de tarefa): original pt-BR + `translations` en/es; a API localiza pelo `Accept-Language` (`domain/content-locale.js`, `deps.locale`); trocar o idioma rebusca os dados.
- **Tema:** tokens em `web/src/styles/index.css`; nunca cores literais nos componentes. Verde como texto usa `text-primary-text` (lima no escuro, AA); `bg-primary` só para fundos com `text-primary-fg` — ADR-043.
- **Toasts:** sempre via `notify` (React-Toastify, canto superior direito, mín. 3 s). Nunca outra lib.
- **Edições por script:** não usar heredoc do shell com barras invertidas nem `String.replace(a, b)` com `$` em `b` (corrompe regex/código); preferir Edit ou scripts gravados em arquivo com `slice/indexOf`.
- **Fases:** 1 Fundação ✅ → 2 Projetos ✅ → 3 Tipos e campos ✅ → 4 Tarefas ✅ → 5 Kanban ✅ → 6 Backlog ✅ → 7 Relacionamentos ✅ → 8 Relatórios ✅ → 9 Hardening ✅.

## Antes de alterar qualquer módulo (§45)

Entender a arquitetura → identificar o domínio → verificar componentes reutilizáveis → verificar regras existentes → criar/atualizar testes → implementar → rodar testes → lint/análise estática → validar segurança → revisar impacto.

## Definition of Done (§47)

Código + testes passando + lint + análise estática + permissões + segurança + responsividade + light/dark + API (quando aplicável) + auditoria (quando aplicável) + documentação atualizada + sem duplicação + sem regra de negócio na UI + performance.
