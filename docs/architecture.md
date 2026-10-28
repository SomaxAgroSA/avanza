# Arquitetura

> Referência: [diretriz-desenvolvimento.md](diretriz-desenvolvimento.md) §2–§4, §29. Decisões em [decisions.md](decisions.md) (backend atual: [ADR-044](decisions.md#adr-044--o-pocketbase-sai-api-em-node-sobre-o-supabase-uma-edição-só)).

## Visão geral

```
┌──────────────────────────── navegador ────────────────────────────┐
│  web/ (React + TypeScript)                                        │
│  presentation ──▶ domain (interfaces) ◀── data (HTTP) ──▶ ApiClient│
└───────────────────────────────┬───────────────────────────────────┘
                                │ /api/v1  (cookie HttpOnly + X-Requested-With)
┌───────────────────────────────▼───────────────────────────────────┐
│  backend/ (Node 24 + Fastify 5)                                   │
│  http (rotas/handler) ──▶ application (casos de uso)              │
│                              │                                    │
│                         domain (regras puras)                     │
│                              │ portas (interfaces)                │
│                  infrastructure (repositórios SQL, Storage)       │
│                              │                                    │
│          Supabase: Postgres 17 (esquema avanza) + Storage         │
└───────────────────────────────────────────────────────────────────┘
```

- **API-first**: o frontend só conversa com `/api/v1` (e o tempo real em `/api/realtime`). Só a API acessa o banco, pela conexão direta do Postgres; as tabelas têm RLS ligado e nenhum privilégio para `anon`/`authenticated`, então a API REST do Supabase não enxerga nada — ver [security.md](security.md).
- Em produção a API serve o build do frontend (`backend/public`) na mesma origem; em desenvolvimento o Vite faz proxy de `/api`.

## Backend (`backend/`)

```
backend/
├── db/migrations/           # esquema, cadastros iniciais, RLS, lixeira do Storage, gatilhos do tempo real (.sql)
├── src/
│   ├── server.js            # ponto de entrada: confere a configuração, migra, sobe HTTP, tempo real e rotinas
│   ├── core/                # erros, envelope de resposta, validação, paginação (puros)
│   ├── domain/              # regras de negócio puras: RBAC, sessão, usuário, catálogo de permissões
│   ├── application/         # casos de uso (assíncronos), auditoria, presenters (DTO), portas (ports.js)
│   ├── infrastructure/      # config (env), database (pool/transações), migrate, storage, secrets, adapters,
│   │                        # jobs/cron/locks, realtime (LISTEN), repositories/*.js (SQL), container
│   ├── mcp/                 # MCP para o Claude: protocolo JSON-RPC, validação dos argumentos, catálogo de
│   │                        # ferramentas (adaptador dos casos de uso, como as rotas)
│   └── http/                # server (Fastify), route-table + routes, handler (envelope, CSRF, sessão),
│                            # files, rate-limit, realtime (SSE), mcp (transporte de /api/mcp), OpenAPI
├── tests/
│   ├── unit/                # domínio + aplicação com fakes em memória (node --test)
│   ├── db/                  # repositórios e gatilhos contra o Postgres do Supabase local
│   ├── api/                 # ponta a ponta contra a API real (esquema e bucket isolados)
│   └── support/             # fakes e harness (db-harness, server-harness, SMTP, SSE)
└── scripts/                 # setup, dev, start, create-admin, demo, import-pocketbase, testes de carga
```

Regras de dependência (de fora para dentro):

| Camada | Pode depender de | Nunca depende de |
|---|---|---|
| `domain` | `core` | banco, HTTP, application |
| `application` | `domain`, `core`, portas (`application/ports.js`) | banco, HTTP |
| `infrastructure` | tudo acima + `pg`, Storage, nodemailer (`database.js` é o único que conhece o `pg`) | `http` |
| `http` | `application` via container, `mcp` | regras de negócio |
| `mcp` | `application` via container (recebido no contexto), `domain` (só listas de valores para os esquemas), `core` | HTTP, banco, regras de negócio |

**Código assíncrono**: casos de uso e repositórios devolvem Promises. Os fakes dos testes unitários também (um `await` esquecido falha no teste), e o ESLint proíbe callback `async` em `forEach`/`filter`/`some`/`every`/`find`/`sort`/`reduce` (a Promise não seria esperada) — use `for...of` ou `Promise.all`.

**Transações**: casos de uso recebem `unitOfWork.run(fn)`; a implementação usa `db.transaction` (`infrastructure/database.js`), que guarda a conexão aberta no contexto assíncrono (AsyncLocalStorage): toda consulta dentro dela — inclusive de repositórios montados fora — usa a mesma conexão, e transações aninhadas juntam-se à de fora. Operação + auditoria são gravadas atomicamente; `detached` consulta por fora (o que precisa valer mesmo se a transação for desfeita). Arquivos vão para o Storage antes do commit; `guardStorage` põe a chave na lixeira (`storage_trash`) por fora e a tira dentro da transação, então uploads de gravações desfeitas também são apagados pela rotina.

**Esquema**: migrations SQL numeradas em `backend/db/migrations`, aplicadas em ordem ao subir (`infrastructure/migrate.js`, registro em `schema_migrations`, trava para várias instâncias). Tabelas e colunas mantêm os nomes das collections do PocketBase — ver [database.md](database.md).

**Rotinas**: `infrastructure/jobs.js` confere a cada minuto as expressões cron (`cron.js`); as que mexem em dados rodam com `pg_try_advisory_lock` (`locks.js`), então com várias instâncias só uma executa.

**Trocar o banco ou o Storage**: reescrever `infrastructure/`. `domain/` e `application/` não mudam — as portas estão em `application/ports.js` (foi assim que o backend saiu do PocketBase).

## Frontend (`web/`)

A estrutura `lib/` da diretriz foi mapeada para `src/` preservando as camadas:

```
web/src/
├── app/            # composition root: container (ApiClient, repositórios, QueryClient), router, App
├── core/           # config, errors (AppError), networking (ApiClient), i18n, theme, storage, utils
├── domain/         # entidades, permissões, regras de RBAC para a UI, paginação, validação (zod), interfaces de repositório
├── data/           # DTOs (snake_case), mappers, repositórios HTTP
├── presentation/
│   ├── components/ # Design System (App*) — ver design-system.md
│   ├── layouts/    # AppShell, PageHeader
│   ├── navigation/ # nav-items (fonte única), Sidebar, CommandPalette
│   ├── common/     # hooks transversais (tema, hotkey, media query, erros, DI)
│   └── state/      # ui-store (Zustand)
├── features/       # auth, dashboard, users, settings (perfis/permissões), account, preferences, errors
└── test/           # setup e utilitários de teste
```

- A UI depende apenas das **interfaces** em `domain/repositories.ts`; as implementações HTTP são injetadas por `RepositoriesContext` (testes injetam fakes).
- O ESLint proíbe `fetch` em `presentation/` e `features/`.

### Estado (diretriz §29)

| Tipo | Onde | Exemplos |
|---|---|---|
| Server State | TanStack Query | usuários, perfis, `auth/me` |
| Session State | `features/auth/session.ts` (query `auth/me`) + `session-store.ts` | usuário atual, motivo do fim da sessão |
| UI State | `presentation/state/ui-store.ts` (Zustand, persistido) | tema, sidebar, paleta aberta |
| Domain State | entidades mapeadas pelos repositórios | `User`, `Role` |

Estratégia de cache: `staleTime` 30s; listas usam `keepPreviousData` na paginação; erros 4xx não são repetidos; mutações invalidam as chaves afetadas; logout e sessão expirada limpam todo o cache.

## Tempo real
- **Servidor:** gatilhos `notify_change` nas tabelas de `domain/realtime.js#WATCHED` (migration `0006_realtime.sql`) avisam o canal `realtime_<esquema>` com os identificadores da mudança; o Postgres só entrega depois do commit. Cada instância da API escuta o canal numa conexão dedicada (`infrastructure/realtime.js`), monta o aviso uma vez (`application/realtime.js#eventFor`, projeto descoberto pela tarefa quando preciso) e o entrega às conexões SSE que assinam o tópico. `http/realtime.js` serve `/api/realtime` no mesmo protocolo do PocketBase (`PB_CONNECT` + `POST` das assinaturas), confere a sessão do cookie e o CSRF e deixa só os tópicos autorizados. A rotina `realtime-keepalive` manda um sinal de vida a cada 3 min (proxies derrubam conexões paradas).
- **Web:** `core/realtime/realtime-client.ts` (uma conexão `EventSource` por aba, assinaturas com contagem, reconexão), injetado por `RealtimeContext`; `useLiveProject(id)` / `useLiveNotifications(id)` (`presentation/common/use-live.ts`) traduzem cada aviso nas chaves do cache a invalidar (`domain/realtime.ts`), agrupadas em 250 ms e no máximo uma busca a cada 2,5 s por tela; `useLiveRefetchInterval` deixa a consulta periódica em 5 min com o tempo real ligado e `useRealtimeResync` (no AppShell) busca de novo as telas abertas ao reconectar.

## MCP (Claude)
`POST /api/mcp` (`http/mcp.js`): confere `Origin`, a versão do protocolo e o token de API (`apiTokens.authenticate`), monta o mesmo `ctx` das rotas (`authMethod: 'token'`) e entrega a mensagem a `mcp/protocol.js`, que valida os argumentos (`mcp/schema.js`) e chama a ferramenta (`mcp/tools.js`) — que só delega para o caso de uso do contêiner. Ver [api.md](api.md#mcp-conectar-o-claude) e o ADR-045.

## Fluxo de uma requisição

1. `ApiClient` envia `X-Correlation-Id`, `X-Requested-With: kamban` (mutações) e o cookie de sessão.
2. `http/server.js` (Fastify): limite por IP (`rate-limit.js`) antes de ler o corpo, limite do corpo por rota (`route-table.js`) e multipart; erros da plataforma (429, 413, JSON inválido, rota inexistente em `/api/`) saem no envelope padrão. Toda resposta leva os cabeçalhos de segurança; o frontend, a CSP e o fallback da SPA para `index.html`.
3. `handler.handle`: correlation id → CSRF → sessão (`auth.authenticate`, cookie ou `Bearer`) → caso de uso → `{ data, meta, error }`.
4. Caso de uso valida entrada, aplica RBAC/regras de domínio, grava via `unitOfWork` com auditoria.
5. Erros de aplicação viram `{ error: { code, message, details } }`; erros inesperados viram `INTERNAL_ERROR` sem vazar detalhes e são logados com o correlation id.
