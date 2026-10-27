# Execução e implantação

## Jeito mais rápido: Docker
```bash
cp .env.docker.example .env      # defina KAMBAN_ADMIN_EMAIL e KAMBAN_ADMIN_PASSWORD
docker compose up -d             # imagem com o PocketBase, os hooks, as migrations e o web compilado
```
Abra http://localhost:8090. A imagem cria/atualiza o super administrador ao subir (se as variáveis estiverem definidas), aplica as migrations e guarda os dados no volume `kamban_data` (`/pb_data`). Não precisa de Node no servidor. Health check embutido (`GET /api/v1/health`).

- **HTTPS:** em produção, ponha um proxy com HTTPS na frente (Caddy, Nginx, Traefik) — o cookie de sessão é `Secure`. Em `http://localhost` os navegadores aceitam.
- **Dados de demonstração:** com o servidor no ar, `npm --prefix backend run demo` (no repositório, com `backend/.env` apontando para ele) cria o projeto DEMO.
- Sem Docker, siga os passos abaixo.

## Requisitos
- Node.js ≥ 22 (desenvolvido com 24) e npm.
- Binário do PocketBase 0.40.4 (`npm run setup` baixa para `backend/bin`).

## Primeira execução (desenvolvimento)
```bash
# 1. dependências
cd backend && npm install && npm run setup && cd ..
cd web && npm install && cd ..

# 2. configuração local
cp backend/.env.example backend/.env   # defina KAMBAN_ADMIN_EMAIL e KAMBAN_ADMIN_PASSWORD

# 3. super administrador (aplica as migrations antes)
npm --prefix backend run create-admin

# 4. subir tudo (API em :8090 e web em :5173)
npm run dev
```
Acesse http://localhost:5173.

### Usuário root (SUPER_ADMIN) e superusuário do painel
- **SUPER_ADMIN da aplicação:** defina `KAMBAN_ADMIN_EMAIL`, `KAMBAN_ADMIN_PASSWORD` e `KAMBAN_ADMIN_NAME` em `backend/.env` e rode `npm --prefix backend run create-admin`. Se o e-mail já existir, nome e senha são atualizados e o perfil SUPER_ADMIN é garantido.
- **Superusuário do painel do PocketBase** (http://127.0.0.1:8090/_/ — acesso direto ao banco): defina também `KAMBAN_SUPERUSER_EMAIL` e `KAMBAN_SUPERUSER_PASSWORD` antes de rodar o mesmo comando.

## Build de produção
```bash
npm --prefix web run build     # gera backend/pb_public
```
O PocketBase serve o frontend e a API na mesma origem (SPA com fallback para `index.html` e CSP aplicada pelos hooks).

Antes de publicar: `npm run check` (lint, tipos, unitários e API) e `npm run e2e` (gera o build e roda os testes de ponta a ponta no navegador contra ele). Checklist de produção em [security.md](security.md#produção-checklist).

## Produção
```bash
KAMBAN_ENV=production ./bin/pocketbase serve \
  --http=127.0.0.1:8090 \
  --dir=/var/lib/kamban/pb_data \
  --hooksDir=./pb_hooks --migrationsDir=./pb_migrations --publicDir=./pb_public \
  --hooksPool=60 \
  --origins=https://kamban.suaempresa.com
```
- **`--hooksPool`** (padrão do PocketBase: 15): VMs do JavaScript prontas para atender. Cada requisição ocupa uma e cada gravação observada pelo tempo real ocupa outra; com o pool esgotado a vazão **cai**. Com 60 a vazão útil triplica no teste de carga ([plano-migracao-supabase.md](plano-migracao-supabase.md#3-capacidade-medida)). `npm run dev`, os testes e a imagem Docker já usam 60 (`KAMBAN_HOOKS_POOL` ajusta).
- Coloque um proxy reverso com **HTTPS** (Caddy/Nginx) na frente e configure *Trusted proxy* no painel.
- Migrations rodam automaticamente no `serve`.
- Backup e atualização: ver abaixo.
- Variáveis: ver `backend/.env.example` e [security.md](security.md).
- Health check: `GET /api/v1/health` (200 ok / 503 degradado).

## Servidor na rede local (macOS)
Para a equipe usar o Avanza a partir de um Mac, sem Docker: defina `KAMBAN_HTTP=0.0.0.0:8090` no `backend/.env` (mantenha `KAMBAN_ENV=development` — em produção o cookie é `Secure` e o login não funciona por `http://` na rede) e rode no repositório:
```bash
scripts/mac/avanza.sh instalar    # copia o servidor para ~/Avanza e sobe a cada login, mostrando o endereço
scripts/mac/avanza.sh atualizar   # depois de mudar o código: build, cópia e reinício
scripts/mac/avanza.sh endereco    # mostra de novo o endereço de acesso
scripts/mac/avanza.sh status | remover
```
O servidor roda numa cópia fora de Documentos (`AVANZA_DIR`, padrão `~/Avanza`) porque o macOS não deixa programas iniciados no login lerem essa pasta; os dados ficam em `~/Avanza/backend/pb_data` e nunca são sobrescritos pelo `atualizar`. Logs em `~/Library/Logs/Avanza`. A conexão é HTTP sem criptografia: use só em rede interna confiável.

## Backup e restauração
Todos os dados (banco SQLite, anexos, imagens e arquivos da documentação) ficam no diretório de dados do PocketBase (`pb_data`; no Docker, o volume `kamban_data`).
- **Backup agendado:** no painel do PocketBase (`/_/` → Settings → Backups) — gera um `.zip` consistente, opcionalmente enviado para S3.
- **Backup manual:** pare o serviço e copie o diretório `pb_data` inteiro (no Docker: `docker compose stop` e copie o volume). Com o serviço no ar, use o backup do painel (a cópia direta do SQLite em uso pode ficar inconsistente).
- **Restaurar:** pare o serviço, troque o `pb_data` pelo do backup e suba de novo (ou "Restore" no painel).
- Teste a restauração de vez em quando num ambiente separado.

## Atualizar para uma versão nova
1. Leia o [CHANGELOG](../CHANGELOG.md) (mudanças que pedem atenção ficam em destaque).
2. **Faça um backup** (acima).
3. Docker: `git pull && docker compose up -d --build`. Sem Docker: `git pull`, `npm ci` em `backend/` e `web/`, `npm --prefix backend run setup` (troca o binário se a versão do PocketBase mudou), `npm run build` e reinicie o `serve`.
4. As migrations rodam sozinhas ao subir; acompanhe os logs e confira `GET /api/v1/health`.

## E-mail
- Configure em **Configurações → Integrações → E-mail** (servidor SMTP, remetente e o **endereço público da plataforma**, usado nos links) e use "Enviar e-mail de teste". Os e-mails saem por uma fila em até 1 minuto.
- Recomendado em produção: subir o PocketBase com `--encryptionEnv=PB_ENCRYPTION_KEY` e definir a variável com 32 caracteres aleatórios — a senha do SMTP (e as demais configurações) ficam cifradas no banco. Guarde a chave: sem ela as configurações não abrem.

## Webhooks
- Em produção os webhooks só aceitam `https://` e não chamam a própria máquina. Numa intranet sem TLS, libere com `KAMBAN_WEBHOOKS_ALLOW_INSECURE=true` (consciente do risco). Os envios saem por uma rotina a cada minuto; o servidor precisa alcançar os endereços cadastrados.

## Observabilidade
- Logs estruturados do PocketBase (painel → Logs), com `correlationId`, método, caminho e status nos erros da API.
- Toda resposta traz `X-Correlation-Id`; o frontend mostra a referência em estados de erro para o suporte localizar o log.
- Auditoria de negócio em `audit_logs`.
