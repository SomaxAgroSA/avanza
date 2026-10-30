<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="web/public/brand/avanza/avanza-logo-oscuro.svg" />
    <img src="web/public/brand/avanza/avanza-logo-claro.svg" width="260" alt="Avanza" />
  </picture>
</p>

<p align="center"><strong>Sincronize projetos, tarefas e equipes.</strong><br />Plataforma de gestão de projetos da SomaxAgro.</p>

**Plataforma open source para o time trabalhar e para o projeto ser gerido no mesmo lugar.** Tarefas, Kanban e sprints para o dia a dia; um quadro de gestão no estilo Monday (fases, cronograma com linha de base e saúde do projeto) para quem coordena; documentação no estilo Confluence para registrar o que se aprende. Um único binário, sem serviços externos, em português, inglês e espanhol.

[English](README.en.md) · [Licença Apache-2.0](LICENSE) · [Changelog](CHANGELOG.md) · [Como contribuir](CONTRIBUTING.md)

![Quadro da Gestão de projetos](docs/images/gestao-quadro.png)

## Dois modelos de trabalho, lado a lado

| | **Tarefas** (o time) | **Gestão de projetos** (quem coordena) |
|---|---|---|
| Para quê | Executar: o que fazer, quem faz, em que status está | Planejar e acompanhar: fases, entregas, prazos, riscos |
| Onde fica | Menus **Tarefas**, **Kanban**, **Planejamento** e **Timeline** | Menu **Gestão de projetos** |
| Unidade | Tarefa com tipo, campos personalizados e fluxo de status | Elemento (e subelementos) dentro de grupos numerados (1.0, 2.1…) |
| Regras | Transições permitidas, campos obrigatórios por status, limite WIP | Etiquetas livres de status e recurso por projeto, dependências com regra configurável |

Os dois ficam no mesmo **projeto** (mesmos membros e permissões), mas não se misturam: mover uma tarefa não mexe no cronograma da gestão, e vice-versa.

## O que já tem

**Tarefas e fluxo**
- Tipos de tarefa com formulário próprio e **17 tipos de campo** personalizado (texto, número, data, seleção, pessoa, URL…); tipos traduzidos.
- Fluxo de status configurável, **transições permitidas**, **campos obrigatórios por status** (pede o preenchimento ao mover) e **limite WIP** por coluna.
- Kanban com arrastar, raias e criação rápida; Planejamento com **sprints** e backlog; Timeline das tarefas com marcos.
- Comentários com **@menções** e **imagens coladas** (Ctrl+V), anexos com verificação do tipo real do arquivo, checklist, tags, relacionamentos (bloqueia, depende, duplica), subtarefas, fork e notificações.

**Gestão de projetos**
- Quadro com grupos e subgrupos numerados, elementos e subelementos, edição direto na célula, arrastar, seleção em massa, filtros, agrupar e importar CSV.
- **Colunas personalizadas** (texto, número com soma no rodapé, data, caixa, lista, pessoa, link) com troca de tipo e prévia do que se perde.
- Painel do elemento com atualizações, @menções, imagens coladas e histórico.
- Visões **Cronograma** (Gantt com dependências, **linha de base** e exportação), **Kanban**, **Gestão** (diário de bordo e registro de problemas) e **Relatórios** com a **saúde do projeto** (prazos, progresso, parados, esforço, problemas).

**Documentação**
- Espaços e páginas com editor rico (tabelas, avisos, imagens coladas), rascunho automático, versões com restauração, árvore de páginas e busca.

**Plataforma**
- **RBAC configurável** (perfis e matriz de permissões, com regras contra escalonamento) e papéis por projeto (gestor, membro, leitor).
- **Auditoria** consultável de toda mutação relevante; histórico em cada tarefa, elemento e projeto.
- **Relatórios** com indicadores clicáveis; dashboard pessoal.
- Sessão segura (cookie HttpOnly, proteção CSRF, CSP, bloqueio progressivo de login, sessões ativas).
- **API REST documentada** (`/api/v1`, OpenAPI) — a mesma que a interface usa —, com **tokens de API** pessoais (`Authorization: Bearer`) para scripts e integrações.
- **Configurador geral:** nome, logo e ícone da plataforma, política de senha, bloqueio de login e retenção do histórico.
- **E-mail:** "Esqueci minha senha", convite de usuário e notificações por e-mail (SMTP com fila e novas tentativas).
- **Tempo real:** quadros, tarefas e notificações se atualizam sozinhos quando alguém muda algo.
- **Webhooks** assinados (HMAC) para avisar outros sistemas a cada evento, com novas tentativas e histórico de entregas.
- Tema claro e escuro, celular e desktop, acessibilidade verificada (axe) em todas as telas, command palette (Ctrl/⌘+K).

<table>
  <tr>
    <td><img src="docs/images/gestao-cronograma.png" alt="Cronograma com linha de base" /></td>
    <td><img src="docs/images/gestao-relatorios.png" alt="Saúde do projeto" /></td>
  </tr>
  <tr>
    <td><img src="docs/images/kanban.png" alt="Kanban das tarefas" /></td>
    <td><img src="docs/images/documentacao.png" alt="Documentação" /></td>
  </tr>
</table>

## Identidade visual

O Avanza usa a identidade da Somax: verde como cor principal, o símbolo de cinco barras de progresso e as fontes Figtree (texto) e Plus Jakarta Sans (títulos).

| Token | Cor | Uso |
|---|---|---|
| `--av-brand-primary` | `#00843D` verde Somax | botões, links, item ativo do menu |
| `--av-brand-accent` | `#8DC63F` verde-limão | destaques; links e item ativo no tema escuro |
| `--av-brand-ink` | `#1E2B24` verde quase preto | texto e fundos escuros (capa do login) |

- Logos e ícones: [web/public/brand/avanza](web/public/brand/avanza) — logo completo (claro e escuro), só o símbolo, ícone do app e favicon, em SVG.
- Tokens de cor: [web/src/styles/index.css](web/src/styles/index.css); nada de cores literais nos componentes.
- Os identificadores técnicos herdados do BLYD Sync (`kamban`, `kb_session`, `KAMBAN_*`, tokens `kb_pat_`) continuam iguais para não quebrar sessões, tokens e instalações.

## Experimente em 2 minutos (Docker)

```bash
git clone <url-do-repositório> kamban && cd kamban
cp .env.docker.example .env      # defina KAMBAN_ADMIN_EMAIL e KAMBAN_ADMIN_PASSWORD
docker compose up -d
```

Abra http://localhost:8090 e entre com o e-mail e a senha do `.env`. Os dados ficam no volume `kamban_data`. Produção (HTTPS, backup, atualização): [docs/deployment.md](docs/deployment.md).

**Dados de demonstração:** com o servidor no ar, `npm run demo` (no repositório, com `backend/.env` apontando para o servidor) cria o projeto **DEMO** — tarefas, sprint, quadro de gestão completo, colunas personalizadas, diário, problemas, linha de base e um espaço de documentação — e duas pessoas de exemplo (`carla.demo@blydsync.local` e `rafael.demo@blydsync.local`, senha `DemoBlydSync2026` ou a de `KAMBAN_DEMO_PASSWORD`). Rodar de novo não duplica nada.

## Desenvolvimento

Requisitos: Node.js 22 ou mais novo.

```bash
cd backend && npm install && npm run setup && cd ..   # dependências + binário do PocketBase
cd web && npm install && cd ..
cp backend/.env.example backend/.env                  # defina KAMBAN_ADMIN_EMAIL / KAMBAN_ADMIN_PASSWORD
npm --prefix backend run create-admin                 # cria o super administrador
npm run dev                                           # API :8090 + web :5173
```

Abra http://localhost:5173.

| Comando (raiz) | O que faz |
|---|---|
| `npm run dev` | API e web juntos, com recarga do web |
| `npm run check` | lint, tipos e todos os testes (unitários, componentes e API num PocketBase isolado) |
| `npm run e2e` | build + testes de ponta a ponta no navegador (Edge ou Chrome), com acessibilidade e responsividade |
| `npm run build` | build do web em `backend/pb_public` (servido pelo PocketBase) |
| `npm run demo` | dados de demonstração no servidor do `backend/.env` |
| `npm run screenshots` | regera as imagens deste README a partir dos dados de demonstração |

**Stack:** React 19 + TypeScript + Vite, TanStack Query/Table, Radix UI, Tailwind 4 e i18next no web; [PocketBase](https://pocketbase.io) 0.40 (Go + SQLite) com hooks em JavaScript no backend, organizados em Clean Architecture (domínio puro testado com `node --test`). Detalhes em [docs/architecture.md](docs/architecture.md).

## Evoluções futuras

- **Login corporativo (SSO):** OAuth/OIDC (Microsoft, Google) e, depois, LDAP.

Ideias e prioridades são discutidas nas issues — veja [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentação

| | |
|---|---|
| [Arquitetura](docs/architecture.md) | camadas, dependências, fluxo de requisição, estado |
| [Regras de negócio](docs/regras-de-negocio.md) | status, transições, WIP, obrigatórios, Kanban, backlog, gestão |
| [API](docs/api.md) | convenções, envelope, erros, endpoints (OpenAPI em `/api/v1/openapi.json`) |
| [Banco de dados](docs/database.md) | collections, índices, auditoria |
| [Segurança](docs/security.md) | sessão, CSRF, CSP, RBAC, rate limit |
| [Permissões](docs/permissions.md) | catálogo, matriz, regras anti-escalonamento |
| [Design System](docs/design-system.md) | tokens, componentes, DataTable |
| [Testes](docs/testing.md) | estratégia e comandos |
| [Implantação](docs/deployment.md) | Docker, produção, backup e atualização |
| [Decisões](docs/decisions.md) | ADRs |

## Licença

[Apache License 2.0](LICENSE) — use, modifique e distribua, inclusive comercialmente, mantendo os avisos de licença e o [NOTICE](NOTICE). Vulnerabilidades: siga a [política de segurança](SECURITY.md), sem issue pública.
