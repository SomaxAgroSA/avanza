# Como contribuir · Contributing

Obrigado por querer ajudar! Este guia mostra como preparar o ambiente, as regras do projeto e o que esperamos de um pull request. *English summary at the end.*

## Antes de começar

- Leia o [código de conduta](CODE_OF_CONDUCT.md).
- Para mudanças grandes (módulo novo, troca de biblioteca, mudança de modelo de dados), **abra uma issue antes** para combinar o caminho.
- Vulnerabilidades **não** vão em issue pública: veja [SECURITY.md](SECURITY.md).

## Ambiente

Requisitos: **Node 22+**, Docker com o **Supabase CLI** (Supabase local; no macOS sem Docker Desktop, o Colima) e um navegador Chromium (Edge ou Chrome) para os testes de ponta a ponta.

```bash
npm install                                  # raiz (ferramentas dos testes E2E)
supabase start                               # Supabase local (no macOS com Colima: colima start antes)
cd backend && npm install && npm run setup   # dependências + backend/.env a partir do `supabase status`
cd ../web && npm install && cd ..
# defina KAMBAN_ADMIN_EMAIL / KAMBAN_ADMIN_PASSWORD em backend/.env
npm --prefix backend run create-admin
npm run dev                                  # API :8090 + web :5173
npm --prefix backend run demo                # opcional: dados de demonstração (com o dev rodando)
```

> Windows: rode a partir do caminho com a letra da unidade em maiúscula (ex.: `E:\KAMBAN`); com `e:\` o Vitest carrega módulos em dobro.

## Arquitetura em uma página

- **Backend** (`backend/`): API em Node (Fastify) sobre o Supabase (Postgres + Storage). Camadas `core → domain → application → infrastructure → http`; `domain` e `application` são CommonJS puros (casos de uso assíncronos), testados com `node --test`. Só `infrastructure` fala com o banco (SQL com `pg`) e o Storage. Esquema em migrations SQL numeradas (`backend/db/migrations`; tabela nova com RLS ligado).
- **Web** (`web/`): React 19 + TypeScript estrito + Vite. Camadas `app · core · domain · data · presentation · features`; telas usam repositórios via `useRepositories()` (nada de `fetch` em `features`/`presentation`).
- Regras de negócio ficam no servidor (e, quando a tela precisa, espelhadas em `web/src/domain`); **nenhuma regra na UI**.
- Detalhes em [docs/architecture.md](docs/architecture.md) e nas decisões ([docs/decisions.md](docs/decisions.md)).

## Regras do projeto

- **TDD:** teste primeiro (unitário, de API ou de interface); pronto = testes + lint + tipos passando.
- **Design system:** use os componentes `App*` de `@/presentation/components`; nada de widget nativo do navegador (ex.: `<input type="date">`). Listagens com `AppDataTable`; criar/editar em `AppDialog`; visualizar em `AppDrawer`.
- **Cores** só por tokens do tema (`web/src/styles/index.css`); claro e escuro com contraste AA.
- **Textos** nunca fixos: chaves de i18n nos três idiomas (pt-BR, en, es) — o teste de locales exige as mesmas chaves.
- **API:** envelope `{ data, meta, error }`, snake_case, códigos de erro estáveis; mutação exige o cabeçalho `X-Requested-With: kamban`. Rota nova → atualize `backend/src/http/openapi.js` e `docs/api.md`.
- **Permissões:** o servidor sempre valida (catálogo em `domain/permissions.js` e `web/src/domain/permissions.ts`).
- **Auditoria:** toda mutação relevante grava em `audit_logs` na mesma transação, sem dados sensíveis.
- **Regras de negócio novas:** documente em [docs/regras-de-negocio.md](docs/regras-de-negocio.md), em linguagem funcional.
- **Avisos ao usuário:** sempre via `notify` (React-Toastify).

## Verificações

| Comando (raiz) | O que roda |
|---|---|
| `npm run check` | lint, tipos e todos os testes (unitários, interface, banco e API contra o Supabase local) |
| `npm run e2e` | build + ponta a ponta no navegador (fluxos, acessibilidade em 4 modos, responsividade) |

Para o E2E fora do Windows, use o Chrome: `KAMBAN_E2E_CHANNEL=chrome npm run e2e`.

## Pull requests

- Um assunto por PR, com descrição do **porquê** e de como testar.
- Inclua/atualize testes e documentação.
- Mensagens de commit em português ou inglês, no imperativo ("Adiciona…", "Add…").
- A integração contínua precisa passar.

---

## English summary

Thanks for contributing! Requirements: **Node 22+**, Docker with the **Supabase CLI** (local Supabase; on macOS without Docker Desktop, Colima) and a Chromium browser (Edge or Chrome) for end-to-end tests. Setup is the block above (`supabase start`, `npm install`, `npm run setup` in `backend/` to create `backend/.env`, set the admin variables, `create-admin`, `npm run dev`; optional `npm --prefix backend run demo` for sample data).

Ground rules: test first (TDD); business rules live on the server, never in the UI; use the `App*` design-system components and theme tokens; every user-facing string goes through i18n in pt-BR, en and es; new API routes update the OpenAPI document; relevant mutations write to the audit log in the same transaction. Run `npm run check` (lint, types, unit, UI, database and API tests) and `npm run e2e` (use `KAMBAN_E2E_CHANNEL=chrome` outside Windows) before opening a pull request. Report vulnerabilities privately — see [SECURITY.md](SECURITY.md).
