# Plano de migração: PocketBase → Supabase

> **Situação (2026-10-28): o PocketBase sai de vez** (ADR-044, revê o ADR-040). Uma edição só: API em
> Node sobre o Supabase. As seções 2 e 8 (duas edições, escolha e trava) ficam como histórico; a
> arquitetura alvo (seção 6) e o mapeamento continuam valendo. Andamento na seção 0.
> Base das estimativas: o código atual (backend com 12,6 mil linhas de domínio/aplicação e 9,2 mil de
> infraestrutura/HTTP/migrations) e o teste de carga `npm --prefix backend run load`.

## 0. Andamento da substituição (branch `migracao-supabase`)

Ambiente local: Docker pelo **Colima** (sem administrador e sem a licença do Docker Desktop) e o
**Supabase CLI** (`supabase start` na raiz do repositório; Studio em http://127.0.0.1:54323, Postgres em
`127.0.0.1:54322`). Depois de reiniciar a máquina: `colima start` e `supabase start`.

| Etapa | Entrega | Pronto quando |
|---|---|---|
| A. Ambiente | Docker (Colima) + Supabase local + `supabase/config.toml` | ✅ 2026-10-28 |
| B. Casos de uso assíncronos | código em `backend/src` (sai de `pb_hooks/src`), `async/await` em `application/`, testes unitários com `await` | testes unitários verdes |
| C. Esquema Postgres | migrations SQL (`backend/db/migrations`) com os nomes das collections, cadastros iniciais e o executor de migrations | esquema sobe no Supabase local |
| D. Repositórios SQL | infraestrutura nova sobre `pg` (transação por `unitOfWork`, consultas em lote) | testes de repositório verdes |
| E. Servidor Node | Fastify com `/api/v1` (envelope, CSRF, cookie, limites, OpenAPI), arquivos no Storage, e-mail, rotinas com trava, tempo real SSE (`LISTEN/NOTIFY`), frontend com os cabeçalhos de segurança | suíte de API (contrato) verde |
| F. Dados e operação | ETL do `pb_data` (SQLite → Postgres, arquivos → Storage), scripts (`npm run dev`, `scripts/mac/avanza.sh`), Docker, CI, documentação | E2E verde e a equipe migrada |

## 1. Resumo

- **Edição Local (PocketBase):** um instalador com tudo dentro; nada a configurar além do nome e do administrador. Depois da fase 0 aguenta **~200 pessoas trabalhando ao mesmo tempo** (equipes de até ~10 pessoas por quadro) num servidor parecido com um notebook i5 de 12 threads — antes eram 60 a 90.
- **Edição Supabase:** para quem precisa de mais. A empresa aponta para o seu Supabase (na nuvem ou **auto-hospedado na própria infraestrutura**) e o PocketBase local é ignorado. A API passa a rodar em várias instâncias e o banco aceita gravações em paralelo: meta de **milhares de pessoas simultâneas**, com backup contínuo e réplicas.
- **A edição é escolhida antes de começar a usar** e fica travada; mudar depois só pela migração Local → Supabase (seção 8), num sentido só.
- **Esforço da edição Supabase:** **11 a 16 semanas** para 1 pessoa sênior (7 a 10 com 2). Domínio e casos de uso são reaproveitados; reescrevem-se a infraestrutura, a camada HTTP e o esquema do banco. O web não muda (mesma API `/api/v1` e o mesmo tempo real).
- **Quando:** a edição Local atende já; vale fazer a Supabase quando a previsão passar de ~200 pessoas simultâneas, quando houver venda como SaaS com vários clientes, exigência de alta disponibilidade/réplicas ou quando o login corporativo (SSO) for retomado.

## 2. Duas edições, escolhidas na instalação

| | **Local** | **Supabase** |
|---|---|---|
| Para quem | equipes pequenas e médias, uma máquina | uso robusto, várias instâncias, alta disponibilidade |
| O que vai no pacote | instalador com PocketBase + API (hooks) + web | instalador ou imagem Docker com a API (Node) + web — o banco, os arquivos e o backup são do Supabase da empresa |
| O que a empresa informa | **nada** (o assistente pede só nome da plataforma, administrador e porta) | a conexão com o Supabase (abaixo) |
| Dados | pasta local (`pb_data`), com backup diário automático | Postgres + Storage do Supabase |
| Capacidade | ~200 pessoas simultâneas | milhares |

### Escolha e trava
1. Na primeira execução, o assistente pergunta a edição. A escolha fica gravada na configuração do servidor e no próprio banco (registro da instalação: edição e identificador).
2. **Trava:** se a configuração e o banco discordarem (ex.: alguém trocou o modo com dados já criados), a API **não sobe** e explica o motivo — nunca abre um banco vazio por engano nem grava em dois lugares.
3. **Mudar depois:** só "Migrar para o Supabase" (a migração da seção 8), de Local para Supabase. Não há sincronização entre os dois bancos nem volta automática.

### O que a empresa informa no modo Supabase

Só **URL e chave** não bastam: a API precisa de uma **conexão direta com o Postgres**. A API REST do Supabase (PostgREST) não faz uma transação com várias gravações, e toda alteração do Avanza grava os dados e o histórico na mesma transação (além das travas das rotinas).

| Campo | Obrigatório | Para quê | Supabase Cloud | Auto-hospedado (Docker do Supabase) |
|---|---|---|---|---|
| **Endereço do Supabase** (URL) | sim | arquivos (Storage) | Project Settings → API → Project URL | `SUPABASE_PUBLIC_URL` / `API_EXTERNAL_URL` (o Kong), ex.: `https://supabase.empresa.com` |
| **Chave secreta** (`service_role` ou `sb_secret_…`) | sim | ler e gravar os arquivos nos buckets privados | Project Settings → API Keys | `SERVICE_ROLE_KEY` do `.env` |
| **Conexão do Postgres** | sim | dados, transações, travas das rotinas e avisos do tempo real (`LISTEN/NOTIFY`) | Connect → *Session pooler* (porta 5432) ou conexão direta | Supavisor em modo sessão (`postgres://postgres.<tenant>:<senha>@host:5432/postgres`) ou a porta do banco |
| **Certificado da autoridade (CA)** | se a empresa usa CA própria | conexão TLS verificada (`sslmode=verify-full`) | Database Settings → SSL → baixar o certificado | o CA interno da empresa |
| Esquema | não (padrão `avanza`) | separar as tabelas quando o banco é compartilhado | — | — |
| Bucket | não (padrão `avanza-files`) | criado sozinho, privado | — | — |
| Chave pública + segredo do JWT | só se optar pelo Realtime do Supabase (ver seção 6) | o navegador conectar no Realtime | Project Settings → API Keys / JWT Keys | `ANON_KEY` / `JWT_SECRET` |

- **"Testar conexão" no assistente**, antes de gravar: versão do Postgres (≥ 15), permissão para criar o esquema e as tabelas, TLS válido, Storage acessível com a chave (grava, lê e apaga um arquivo de teste) e relógio do servidor. Só então roda as migrations e cria o administrador.
- **Usuário do banco dedicado** (recomendado): um papel `avanza_app` com acesso só ao esquema `avanza`, em vez do `postgres`.
- **Segredos:** ficam só no servidor (arquivo de configuração com acesso restrito à conta do serviço; no Windows, cifrado com a proteção de dados do sistema). Nunca vão ao navegador, ao histórico ou aos logs; a tela mostra só que estão definidos. Trocar = editar, testar de novo e reiniciar.
- O **e-mail (SMTP)** continua configurado dentro do app (Configurações → Integrações), igual nas duas edições.

## 3. Capacidade (medida)

Teste de carga `backend/scripts/load-test.js`: PocketBase isolado, 30 pessoas, projeto com 400 tarefas e quadro da Gestão com 60 elementos; mistura de chamadas parecida com o uso real (30% Kanban, 20% lista de tarefas, 15% tarefa, 10% sino, 10% quadro da Gestão, 5% comentários, 10% gravações). Servidor e gerador de carga na mesma máquina (i5-1235U, 12 threads, 16 GB) — resultado conservador.

Vazão (req/s) e p95 por número de requisições simultâneas:

| Configuração | 5 | 10 | 20 | 40 |
|---|---|---|---|---|
| Antes: pool 15 (padrão do PocketBase) | 39,5 · 0,36 s | 23,1 · 1,0 s | 17,4 · 2,8 s | 15,3 · 5,9 s |
| Fase 0, só o quadro enxuto (pool 15) | 50,0 · 0,35 s | 25,8 · 0,92 s | 15,3 · 3,0 s | 16,5 · 5,5 s |
| Fase 0 (pool 60 + quadro enxuto), ainda com middlewares globais | 56,6 · 0,21 s | 75,6 · 0,30 s | 74,8 · 0,52 s | 37,9 · 4,2 s |
| **Fase 0 completa (+ middlewares fora do caminho global)** | **59,8 · 0,21 s** | **73,7 · 0,29 s** | **72,2 · 0,54 s** | **61,7 · 1,8 s** |

- Nenhum erro em nenhum nível: a plataforma **fica lenta, mas não falha**.
- O gargalo é a **execução do JavaScript do PocketBase**: cada requisição ocupa uma VM do pool (mais uma por middleware em JS no caminho) e cada registro gravado que o tempo real observa ocupa outra. Com o pool esgotado o PocketBase cria VMs na hora (recarregando todos os módulos) e a vazão **cai** em vez de estabilizar. Com 60 VMs prontas a vazão útil **triplica** (23 → 75 req/s com p95 ≤ 0,5 s).
- Acima de ~20 requisições simultâneas as **gravações fazem fila** (o SQLite aceita uma por vez, e com a CPU disputada cada gravação segura a vez por mais tempo): editar tarefa e comentar passam de 1 s. Esse é o limite que a edição Supabase remove.
- Quadro do Kanban com 400 cartões, sem concorrência: **98 → 77 ms** com a consulta enxuta (só as colunas do cartão, sem montar o registro completo). As outras chamadas ficam em 15–30 ms.
- Memória com 60 VMs: ~90 MB parado e pico de ~950 MB com 80 requisições simultâneas — reservar **2 GB** para o servidor.

### Cenário: equipe pequena + muitos leitores da documentação

`npm --prefix backend run load:docs`: **10 pessoas trabalhando** (Kanban, listas, Gestão, gravações, com pausa de 1–3 s) e **500 leitores logados** abrindo páginas da documentação (árvore do espaço + página + 2 imagens de ~40 KB), cada um com a conexão do tempo real aberta e a conferência da sessão e do sino a cada 5 min. 510 conexões do tempo real abertas o tempo todo.

| Leitores abrem uma página a cada | Páginas/s | Vazão | p95 (tudo) | Abrir uma página (p95) | Antes da correção dos middlewares |
|---|---|---|---|---|---|
| ~60 s (uso esperado) | 8,3 | 59,9 req/s | **44 ms** | 77 ms | p50 de **47 s** e 3 GB de memória |
| ~30 s (2×) | 16,7 | 89,0 req/s | **46 ms** | 78 ms | — |
| ~15 s (4×) | 33,3 | satura (~70 req/s; p50 0,4 s, cauda de dezenas de segundos) | — | — | — |

- Com o uso esperado sobra **folga de ~3×** nesta máquina (que ainda divide a CPU com o gerador de carga); memória de pico ~715 MB.
- A equipe de 10 pessoas não sente os leitores: Kanban p95 ≤ 120 ms, editar tarefa ≤ 250 ms.
- **Limites por IP** (Configurações do PocketBase → Rate limits; padrão: 600 chamadas/min por IP na API e 10 logins/min): numa rede local cada computador tem o seu IP e não há problema. **Atrás de proxy reverso**, configure o *Trusted proxy* (cabeçalho `X-Forwarded-For`) para o servidor enxergar o IP real; se as pessoas chegarem de fato por um IP só (NAT/VPN), aumente os limites — senão os leitores recebem 429.
- Os leitores precisam de conta (perfil Leitor). O **link público** da documentação (planejado) dispensaria a conta, o login e a conexão do tempo real para quem só lê.

**De requisições para pessoas** (uma pessoa com a tela aberta e trabalhando):

| Origem das chamadas | Antes | Depois da fase 0 |
|---|---|---|
| Kanban se atualizava a cada 15 s | 0,07 req/s | 0,003 (só rede de segurança a cada 5 min com o tempo real ligado) |
| Sino a cada 30 s | 0,03 req/s | 0,003 |
| Ações próprias (uma a cada ~30 s, ~3 chamadas cada) | 0,10 req/s | 0,10 req/s |
| Atualizações ao vivo (cada mudança de um colega faz cada tela aberta buscar de novo) | 0,1 a 1,5 req/s — crescia com o quadrado da equipe no mesmo quadro | **no máximo 0,4 por tela** (uma busca a cada 2,5 s) |

| Cenário | Antes (pool 15) | Depois da fase 0 |
|---|---|---|
| Equipes de até ~10 pessoas por quadro (o comum) | **60 a 90 pessoas simultâneas** | **~200** |
| Um projeto grande com 30+ pessoas no mesmo quadro | **15 a 25 no mesmo quadro** | **~60 a 90** |
| Pessoas cadastradas (10–30% conectadas ao mesmo tempo) | ~300 a 600 | ~700 a 2.000 |

## 4. Fase 0 — ganhos rápidos no PocketBase ✅ (2026-10-01)

1. ✅ **Pool de VMs maior:** `serve --hooksPool=60` em `npm run dev`, nos testes, na imagem Docker e no guia de implantação (`KAMBAN_HOOKS_POOL` ajusta; `backend/scripts/env.js`).
2. ✅ **Consulta periódica só como rede de segurança:** com o tempo real ligado, o Kanban e o sino buscam a cada 5 minutos; sem ele (ou caindo), voltam aos 15 s / 30 s. Ao reconectar, a tela busca de novo o que está aberta (os avisos do intervalo se perderam) — `useLiveRefetchInterval` e `useRealtimeResync` em `web/src/presentation/common/use-live.ts`.
3. ✅ **Atualizações ao vivo controladas:** no máximo uma busca a cada 2,5 s por tela; a primeira depois de um tempo quieto continua saindo em 250 ms.
4. ✅ **Kanban leve:** consulta enxuta das colunas do cartão (`listForBoard`); as colunas de encerramento já mostravam só as 30 mais recentes. O formato da resposta não mudou (contrato da API preservado).
5. ✅ **Nova linha de base** no teste de carga (seção 3; o aquecimento agora passa por todas as VMs do pool).
6. ✅ **Nada de middleware em JS global** (achado no cenário com 500 leitores): no PocketBase um middleware em JS segura uma VM durante todo o `e.next()` — inclusive nas conexões do tempo real, abertas por horas. Os dois middlewares globais (envelope de erros e cabeçalhos do frontend) faziam **cada requisição ocupar 3 VMs** e **cada aba logada prender 2**; com algumas dezenas de abas o pool acabava. Agora o envelope fica em cada rota da API (`apiRoute` em `main.pb.js`) e os cabeçalhos na rota própria do frontend (`GET /{path...}`, servindo o `--publicDir`): 2 VMs por requisição e nenhuma presa pelo tempo real. Regressão em `tests/api/capacity.test.js`.
7. ✅ **Sinal de vida do tempo real** a cada 3 min (`kamban_realtime_keepalive`): o PocketBase fecha a conexão após 5 min sem mensagens, e cada reconexão refazia as assinaturas e as buscas da tela.
8. ✅ **Planejamento (backlog)** com a mesma consulta enxuta do quadro (400 tarefas: ~250 → ~170 ms) e o formulário de tarefa, montado nas telas, sem buscar sprints, tipo, membros e anexos enquanto está fechado.

## 5. O que muda e o que fica (edição Supabase)

| Camada | Hoje | No Supabase | Esforço |
|---|---|---|---|
| `domain/` (4,2 mil linhas) | CommonJS puro | **igual** | nenhum |
| `application/` (8,4 mil linhas) | casos de uso síncronos (JSVM) | **mesmos casos de uso, assíncronos** (`async/await` nas 250 chamadas a repositório) | médio, mecânico |
| `core/` | erros, validação, paginação | igual | nenhum |
| `infrastructure/` (3,7 mil linhas) | repositórios sobre `$app`, arquivos, mailer, `$http` | **reescrita**: Postgres, Supabase Storage, nodemailer, fetch, node:crypto | alto |
| `http/` + `main.pb.js` (3,2 mil linhas) | rotas do PocketBase, ganchos, cron | **servidor Node** (Fastify) com as mesmas rotas `/api/v1`, envelope, CSRF, cookie, limites e o mesmo tempo real (SSE) | alto |
| `pb_migrations/` (31) | collections do PocketBase | **migrations SQL** | médio |
| Web | `/api/v1` + SSE | **igual** (o tempo real continua SSE servido pela API) | nenhum |
| Testes | unitários (fakes), API num PocketBase real, E2E | unitários iguais (com `await`); **a suíte de API vira contrato** e roda contra as duas edições; E2E igual | médio |

O contrato da API não muda — telas, tokens de API (`kb_pat_`), webhooks, links de e-mail e integrações continuam funcionando. Os **ids são preservados** (texto de 15 caracteres), então nada que já foi compartilhado quebra.

## 6. Arquitetura alvo da edição Supabase

```
Navegador ──HTTPS──► API Avanza (Node + Fastify, N instâncias, sem estado)
   │                     │  domain + application (os mesmos de hoje)
   │                     │  infrastructure: Postgres · Storage · e-mail · HTTP · cripto
   │                     ├──► Postgres do Supabase (esquema avanza; RLS "nega tudo"; só a API acessa)
   │                     ├──► Supabase Storage (bucket privado: anexos, documentação, quadro, marca)
   │                     └──► Worker (mesmo código): fila de e-mails, webhooks, lembretes, retenção
   │                            (uma execução por vez com pg_try_advisory_lock)
   └──SSE (tempo real)──► a própria API: avisos via LISTEN/NOTIFY do Postgres, repassados a cada instância
```

- **Tempo real, recomendado:** a API continua servindo o SSE de hoje (mesmos tópicos `project:{id}` / `user:{id}`, mesmas permissões). Gatilhos no banco fazem `NOTIFY` depois do commit e cada instância repassa aos seus navegadores. Vantagens: **o web não muda**, a empresa não precisa configurar o Realtime do Supabase nem informar chave pública e segredo do JWT, e funciona igual no Supabase auto-hospedado. Exige uma conexão em modo sessão para o `LISTEN`.
- **Alternativa:** Realtime do Supabase (Broadcast em canais privados), com a API emitindo um JWT curto para o navegador e políticas em `realtime.messages`. Só se houver motivo (ex.: muitos milhares de conexões ao mesmo tempo).
- **Autenticação, fase 1:** continua a nossa (cookie `kb_session`, sessões, bloqueio, política de senha, tokens de API).
- **Autenticação, fase 2 (opcional):** Supabase Auth para ganhar **SSO** (OAuth com Microsoft/Google; SAML). As senhas atuais já são bcrypt e podem ser importadas.

### Mapeamento PocketBase → Supabase/Node

| PocketBase | Destino |
|---|---|
| Collections e campos | tabelas Postgres no esquema `avanza`; JSON → `jsonb`; múltiplas relações → tabelas de ligação ou `text[]`; datas → `timestamptz`; chaves estrangeiras e índices explícitos |
| `$app.runInTransaction` (unitOfWork) | transação Postgres (`BEGIN … COMMIT`) na mesma conexão |
| Campos de arquivo protegidos | Supabase Storage (bucket privado), servidos pela API (mantém nosniff, CSP sandbox e conferência de permissão) |
| `onRecordAfter*Success` → tempo real | gatilhos `AFTER INSERT/UPDATE/DELETE` com `pg_notify` (o aviso sai no commit) → SSE da API |
| Decorador do histórico → webhooks | igual, na infraestrutura nova (mesma transação) |
| `cronAdd` + trava em `$app.store()` | worker Node com `pg_try_advisory_lock` |
| Configurações SMTP do PocketBase | tabela de configurações; senha do SMTP cifrada (Supabase Vault ou chave do servidor) |
| `$app.newMailClient()` | nodemailer |
| `$http.send` / `$security.hs256` | `fetch` / `node:crypto` |
| Rate limit do PocketBase | middleware na API (com várias instâncias, contador no Postgres) |
| Painel `/_/` do PocketBase | Supabase Studio (só administradores técnicos) |

## 7. Fases e estimativa da edição Supabase (1 pessoa sênior)

| Fase | Entrega | Pronto quando | Estimativa |
|---|---|---|---|
| 0. Ganhos rápidos ✅ | seção 4 | nova linha de base no teste de carga | feito |
| 1. Preparação | casos de uso assíncronos (com o backend atual ainda no ar via adaptador); suíte de API parametrizada por endereço | todos os testes verdes no PocketBase | 1,5–2 sem. |
| 2. Esquema Postgres | migrations SQL com tipos, FKs, índices, sequência do código da tarefa, RLS "nega tudo" | esquema sobe num Supabase local | 1–1,5 sem. |
| 3. Backend Node | servidor `/api/v1` (envelope, CSRF, cookie, limites, OpenAPI, SSE) e repositórios Postgres — **sem consultas em laço**: o SQLite local esconde o N+1, o Postgres pela rede não | suíte de API verde contra o novo backend | 4–6 sem. |
| 4. Arquivos, e-mail, rotinas, webhooks, tempo real | Storage, nodemailer, worker com travas, gatilhos `pg_notify` + SSE | E2E de e-mail, webhooks e tempo real verdes | 1,5–2 sem. |
| 5. Instalação | assistente com a escolha da edição, "Testar conexão", trava, segredos protegidos | instalar do zero nas duas edições | 3–5 dias |
| 6. Migração dos dados | ETL SQLite → Postgres (ids, senhas bcrypt, sessões e tokens com hash) e arquivos → Storage; conferência de contagens e amostras | 2 ensaios completos numa cópia da produção | 1–1,5 sem. |
| 7. Homologação | carga (meta ≥ 10× a linha de base), varredura de segurança, backup/restauração, acessibilidade | critérios da seção 9 | 1,5–2 sem. |
| 8. Virada (quem já usa a Local) | janela de manutenção, ETL final, troca de endereço, testes de fumaça | plataforma no ar no Supabase | 1–2 dias |
| **Total** | | | **11–16 semanas** (7–10 com 2 pessoas) |

## 8. Migração Local → Supabase e virada

1. **Ensaio:** cópia do `pb_data` → ETL → conferência (contagem por tabela, somatórios, amostras de registros e arquivos) → suíte de API e E2E contra a cópia. Repetir até zerar diferenças.
2. **Janela de manutenção** (estimar pelo ensaio; para os volumes de hoje, minutos): a plataforma fica só leitura, roda o ETL final e a conferência.
3. **Virada:** a instalação passa para a edição Supabase; sessões, tokens e webhooks continuam valendo (ids e hashes migrados).
4. **Volta atrás:** o `pb_data` fica parado mas intacto. Se algo falhar **antes de reabrir as gravações**, volta-se à edição Local. Depois de reabrir, não há sincronização reversa — por isso a homologação precisa ser completa.

## 9. Critérios de aceite

- Suítes unitária, de API (contrato, nas duas edições) e E2E verdes; varredura de segurança e de acessibilidade sem regressão.
- Teste de carga: p95 < 1 s com **10× a vazão** da linha de base, sem erros; escalar de 1 para 2 instâncias da API aumenta a vazão.
- Backup com restauração testada e procedimento de virada/volta ensaiado.
- Instalação do zero nas duas edições, com a trava funcionando.
- Documentação (arquitetura, implantação, segurança, decisões) atualizada; ADR registrando a decisão.

## 10. Riscos

| Risco | Mitigação |
|---|---|
| **Dois backends para manter** (PocketBase e Node) dobram o custo de cada funcionalidade | a suíte de API como contrato roda nas duas; a médio prazo, a edição Local passa a usar o mesmo backend Node com SQLite e o PocketBase sai — um backend só |
| Conversão para assíncrono introduzir erros sutis (promessas esquecidas) | fazer na fase 1, ainda no PocketBase, com lint `no-floating-promises` e a suíte completa |
| Consultas em laço (N+1) ficarem lentas com o banco pela rede | repositórios novos com junções e consultas em lote; teste de carga desde o início da fase 3 |
| Diferenças entre SQLite e Postgres (ordenação, comparação de textos, datas) | suíte de API como contrato; ordenações explícitas; colação definida |
| Supabase auto-hospedado com versões ou configurações diferentes | "Testar conexão" confere versão, permissões, TLS e Storage antes de instalar; dependência só de Postgres + Storage (o Realtime do Supabase é opcional) |
| Segredos da conexão vazarem | só no servidor, cifrados, fora de logs e do histórico; usuário do banco com acesso só ao esquema `avanza` |

## 11. Custos (referência — conferir os preços atuais)

- **Edição Local:** nenhum além da máquina (recomendado 2 GB de RAM livres para o servidor).
- **Supabase Cloud:** plano Pro a partir de ~US$ 25/mês, mais computação do banco conforme o tamanho; backup contínuo (PITR) e SSO SAML são adicionais. A API e o worker rodam num serviço de contêineres ou num servidor da empresa.
- **Supabase auto-hospedado:** sem licença, mas exige operar Postgres, backups e os serviços do Supabase.

## 12. Decisões

1. ✅ **Fase 0 agora** (feita em 2026-10-01).
2. ✅ **Duas edições escolhidas na instalação** (decisão do usuário, 2026-10-01): Local sem configuração; Supabase com URL, chave secreta e conexão do Postgres (Cloud ou auto-hospedado).
3. Em aberto — **próximo passo da edição Local:** instalador (sistema: só Windows no início ou também Linux/Docker; rede interna com HTTP ou HTTPS com certificado próprio).
4. Em aberto — **quando iniciar a edição Supabase.**
5. Recomendado — **tempo real pela própria API** (SSE + `LISTEN/NOTIFY`) em vez do Realtime do Supabase.
6. Recomendado — **autenticação própria** na primeira entrega; Supabase Auth junto com o SSO depois.
