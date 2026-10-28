# Execução e implantação

> Backend atual: API em Node (Fastify) sobre o **Supabase** — Postgres para os dados e Storage para os arquivos ([ADR-044](decisions.md#adr-044--o-pocketbase-sai-api-em-node-sobre-o-supabase-uma-edição-só)). Todo servidor precisa de um Supabase: Cloud, auto-hospedado ou o local em Docker.

## Jeito mais rápido: Docker
```bash
cp .env.docker.example .env      # Supabase (conexão do Postgres, URL, chave secreta), KAMBAN_SECRET_KEY e o administrador
docker compose up -d             # imagem node:24-alpine com a API, as migrations e o web compilado
```
Abra http://localhost:8090. A imagem roda como o usuário `node`; ao subir cria/atualiza o super administrador (se `KAMBAN_ADMIN_*` estiverem definidas), aplica as migrations e cria o bucket privado. Não há volume: os dados ficam no Supabase. Health check embutido (`GET /api/v1/health`).

- **HTTPS:** em produção, ponha um proxy com HTTPS na frente (Caddy, Nginx, Traefik) — o cookie de sessão é `Secure`. Em `http://localhost` os navegadores aceitam.
- **Dados de demonstração:** com o servidor no ar, `npm --prefix backend run demo` (no repositório, com `backend/.env` apontando para ele) cria o projeto DEMO.
- Sem Docker, siga os passos abaixo.

## Requisitos
- Node.js ≥ 22 (desenvolvido e publicado com 24) e npm.
- Um Supabase. Em desenvolvimento, o local: Docker (no macOS, o **Colima** — sem administrador nem licença do Docker Desktop) + **Supabase CLI** (no Mac do mantenedor, ambos em `~/.local/bin`).

## Primeira execução (desenvolvimento)
```bash
# 1. Supabase local, na raiz do repositório (configuração em supabase/config.toml)
colima start                     # macOS sem Docker Desktop
supabase start                   # Studio :54323 · API/Storage :54321 · Postgres :54322 · Mailpit :54324

# 2. dependências e configuração local
cd backend && npm install && npm run setup && cd ..   # setup cria backend/.env com os dados do `supabase status`
cd web && npm install && cd ..
# defina KAMBAN_ADMIN_EMAIL e KAMBAN_ADMIN_PASSWORD em backend/.env

# 3. super administrador (aplica as migrations antes)
npm --prefix backend run create-admin

# 4. subir tudo (API em :8090 e web em :5173)
npm run dev
```
Acesse http://localhost:5173. Depois de reiniciar a máquina: `colima start` e `supabase start`. O Mailpit (http://127.0.0.1:54324) recebe e-mails de teste se o SMTP for apontado para ele.

### Usuário root (SUPER_ADMIN) e painel do banco
- **SUPER_ADMIN da aplicação:** defina `KAMBAN_ADMIN_EMAIL`, `KAMBAN_ADMIN_PASSWORD` e `KAMBAN_ADMIN_NAME` em `backend/.env` e rode `npm --prefix backend run create-admin`. Se o e-mail já existir, nome e senha são atualizados e o perfil SUPER_ADMIN é garantido.
- **Painel do banco:** o **Supabase Studio** (local: http://127.0.0.1:54323; Cloud: o painel do projeto), esquema `avanza`. Não há superusuário à parte nem painel `/_/` (era do PocketBase).

## Build de produção
```bash
npm run build                  # gera backend/public
```
A API serve o frontend e a API na mesma origem (SPA com fallback para `index.html` e CSP aplicada por `http/server.js`). `KAMBAN_PUBLIC_DIR` troca a pasta.

Antes de publicar: `npm run check` (lint, tipos, unitários, banco e API) e `npm run e2e` (gera o build e roda os testes de ponta a ponta no navegador contra ele). Checklist de produção em [security.md](security.md#produção-checklist).

## Produção
```bash
cd backend && npm ci --omit=dev
KAMBAN_ENV=production npm start          # lê o backend/.env; ou node src/server.js com as variáveis no ambiente
```
- **Conexão do Postgres** (`KAMBAN_DATABASE_URL`): direta ou pelo Supavisor em modo **sessão** (porta 5432). O modo transação (6543) não serve: a API usa `search_path` por conexão, `LISTEN` e travas. TLS com `KAMBAN_DB_SSL=require` ou `verify-full` (+ `KAMBAN_DB_CA_FILE` com a CA da empresa).
- **Storage:** `KAMBAN_SUPABASE_URL` e `KAMBAN_SUPABASE_SECRET_KEY` (`sb_secret_…` ou `service_role`; só o servidor usa). O bucket (`KAMBAN_STORAGE_BUCKET`, padrão `avanza-files`) é criado privado ao subir.
- **`KAMBAN_SECRET_KEY`** (obrigatória em produção): cifra a senha do SMTP no banco. Gere uma vez (`openssl rand -base64 32`) e guarde — trocar exige salvar o SMTP de novo.
- Opcionais: `KAMBAN_DB_SCHEMA` (padrão `avanza`), `KAMBAN_DB_POOL` (conexões por instância, padrão 10, mais uma dedicada ao tempo real), `KAMBAN_RATE_LIMITS`, `KAMBAN_BCRYPT_COST` (padrão 10). Lista completa em `backend/.env.example`.
- Ao subir, a API confere a configuração (não sobe se faltar algo), aplica as migrations pendentes e prepara o bucket.
- Coloque um proxy reverso com **HTTPS** (Caddy/Nginx) na frente e defina `KAMBAN_TRUSTED_PROXY` (IPs/sub-redes do proxy) para enxergar o IP real (rate limit e auditoria).
- **Várias instâncias** atrás de um balanceador funcionam: migrations e rotinas usam travas do Postgres (só uma executa), e o tempo real chega a todas pelo `LISTEN/NOTIFY`. As conexões SSE ficam na memória da instância: o `POST /api/realtime` precisa cair na mesma instância do `GET` (afinidade de sessão no balanceador). O rate limit é contado por instância (o total por IP pode chegar a N vezes o configurado).
- Health check: `GET /api/v1/health` (200 ok / 503 degradado).

## Servidor na rede local (macOS)
Para a equipe usar o Avanza a partir de um Mac, sem Docker Desktop: defina `KAMBAN_HTTP=0.0.0.0:8090` no `backend/.env` (mantenha `KAMBAN_ENV=development` — em produção o cookie é `Secure` e o login não funciona por `http://` na rede) e rode no repositório:
```bash
scripts/mac/avanza.sh instalar    # copia o servidor para ~/Avanza e sobe a cada login, mostrando o endereço
scripts/mac/avanza.sh atualizar   # depois de mudar o código: build, cópia e reinício
scripts/mac/avanza.sh endereco    # mostra de novo o endereço de acesso
scripts/mac/avanza.sh migrar      # uma vez: leva os dados do PocketBase (~/Avanza/backend/pb_data) para o Supabase
scripts/mac/avanza.sh status | remover
```
O LaunchAgent sobe o Colima e o Supabase local (precisam estar em `~/.local/bin` ou no `PATH`) e depois a API. O servidor roda numa cópia fora de Documentos (`AVANZA_DIR`, padrão `~/Avanza`) porque o macOS não deixa programas iniciados no login lerem essa pasta; o `.env` da cópia nunca é sobrescrito (só ganha as variáveis do Supabase que faltarem; esquema `avanza` e bucket `avanza-files`). Os dados ficam no Supabase local (volumes do Docker no Colima). Logs em `~/Library/Logs/Avanza`. A conexão é HTTP sem criptografia: use só em rede interna confiável.

- **Nome na rede:** enquanto o servidor está no ar, o Mac anuncia `avanza.local` (Bonjour/mDNS; `AVANZA_NOME` troca o nome) apontando para o IP do Wi-Fi, e refaz o anúncio se o IP mudar. macOS, iPhone e Windows 10+ resolvem nomes `.local` na mesma rede; redes com isolamento de clientes ou multicast bloqueado só funcionam pelo IP. Com `KAMBAN_HTTP=0.0.0.0:80` (o macOS deixa usar a porta 80 sem administrador) o endereço fica `http://avanza.local`; `KAMBAN_HTTP_REDIRECT=0.0.0.0:8090` mantém os links antigos com `:8090` (redireciona para o mesmo host na porta nova). Ajuste também o endereço do app em Configurações → Integrações (links dos e-mails).
- **Só a API aparece na rede:** o script grava uma regra do Lima (`~/.colima/_lima/_config/override.yaml`) que deixa as portas dos contêineres em `127.0.0.1` — sem ela o Colima publicaria o Postgres (senha padrão) e o Studio do Supabase local para toda a rede.
- **Ao ligar o Mac:** o LaunchAgent roda no login da conta. Para subir sem ninguém entrar, ative o login automático da conta (Ajustes → Usuários; pede administrador e não funciona com FileVault ligado).

## Migrar dados do PocketBase
```bash
npm --prefix backend run import:pocketbase -- --from /caminho/pb_data --dry-run   # só lê e mostra o que copiaria
npm --prefix backend run import:pocketbase -- --from /caminho/pb_data             # copia
```
Com o `backend/.env` apontando para o Supabase de destino e o PocketBase parado. Copia todas as tabelas mantendo ids e datas, as senhas (bcrypt), os hashes das sessões e dos tokens (quem estava logado continua; integrações seguem funcionando), os arquivos para o Storage e o SMTP (senha cifrada com `KAMBAN_SECRET_KEY`), e confere as contagens no fim. Recusa um destino com dados, a não ser com `--replace` (apaga o que houver). O `pb_data` não é alterado.

## Backup e restauração
Os dados ficam no Supabase: as tabelas no esquema `avanza` do Postgres e os arquivos no bucket do Storage — os dois precisam entrar no backup.
- **Supabase Cloud:** backups diários do banco (conforme o plano) e, como adicional, PITR (restauração para qualquer momento). Os arquivos do Storage não entram nesses backups (o banco só guarda os metadados): copie o bucket periodicamente (ex.: pela API S3 do Storage).
- **Auto-hospedado ou local:** `pg_dump` do banco (ao menos os esquemas `avanza` e `storage`) e cópia do armazenamento de arquivos do Storage (o volume ou o S3 configurado), feitos juntos.
- **Restaurar:** volte o banco e os arquivos do mesmo momento e suba a API (as migrations que faltarem rodam sozinhas).
- Teste a restauração de vez em quando num ambiente separado.

## Atualizar para uma versão nova
1. Leia o [CHANGELOG](../CHANGELOG.md) (mudanças que pedem atenção ficam em destaque).
2. **Faça um backup** (acima).
3. Docker: `git pull && docker compose up -d --build`. Sem Docker: `git pull`, `npm ci` em `backend/` e `web/`, `npm run build` e reinicie a API.
4. As migrations rodam sozinhas ao subir (uma instância por vez); acompanhe os logs e confira `GET /api/v1/health`.

## E-mail
- Configure em **Configurações → Integrações → E-mail** (servidor SMTP, remetente e o **endereço público da plataforma**, usado nos links) e use "Enviar e-mail de teste". Os e-mails saem por uma fila em até 1 minuto.
- A configuração fica na tabela `email_settings`, com a senha do SMTP cifrada (AES-256-GCM) pela `KAMBAN_SECRET_KEY`. Guarde a chave: sem ela a senha não abre e é preciso informá-la de novo.

## Webhooks
- Em produção os webhooks só aceitam `https://` e não chamam a própria máquina. Numa intranet sem TLS, libere com `KAMBAN_WEBHOOKS_ALLOW_INSECURE=true` (consciente do risco). Os envios saem por uma rotina a cada minuto; o servidor precisa alcançar os endereços cadastrados.

## Observabilidade
- Logs estruturados em JSON na saída padrão (pino, do Fastify), com `correlationId`, método, caminho e status nos erros da API, e o resultado das rotinas quando fazem algo.
- Toda resposta traz `X-Correlation-Id`; o frontend mostra a referência em estados de erro para o suporte localizar o log.
- Auditoria de negócio em `audit_logs`.
