# Segurança

> Diretriz §27, §28 e §32. Toda regra aqui tem teste unitário ou de API correspondente (ver [testing.md](testing.md)).

## Superfície exposta
- Apenas `/api/v1` (e o tempo real em `/api/realtime`) é usada pela aplicação; o MCP para o Claude fica em `/api/mcp` (só com token de API); qualquer outro caminho em `/api/` responde 404 no envelope (teste de API).
- Só a API fala com o banco, pela conexão direta do Postgres. Todas as tabelas do esquema `avanza` têm **RLS ligado sem nenhuma política** e nenhum privilégio para os papéis `anon`/`authenticated` (migration `0004_lockdown.sql`): a API REST (PostgREST) e o Realtime do Supabase não leem nem gravam nada, mesmo que alguém exponha o esquema por engano (teste de banco). O Supabase Studio é administrativo: em produção, restrinja o acesso ao painel e às credenciais do projeto.

## Autenticação e sessão
- Senhas: bcrypt (custo 10, `KAMBAN_BCRYPT_COST`; hashes vindos do PocketBase são verificados como estão). Política: 10–72 caracteres, com letras e números (validada no backend e no formulário).
- Falha de login responde `INVALID_CREDENTIALS` genérico (não revela se o e-mail existe) e gera auditoria `auth.login_failed`.
- Conta desativada: só informa `ACCOUNT_DISABLED` depois da senha correta; desativar revoga todas as sessões na hora.
- **Bloqueio progressivo de conta (Fase 9, [ADR-020](decisions.md#adr-020--bloqueio-progressivo-por-conta-com-chave-anônima)):** 5 falhas de login para o mesmo e-mail (em 24 h) bloqueiam novas tentativas por 5 min; a cada 5 novas falhas o tempo dobra (10, 20, 40) até 60 min. Vale também para e-mails inexistentes (não revela quais existem). Durante o bloqueio a API responde `429 ACCOUNT_LOCKED` com `retry_after_seconds`, sem conferir a senha, e a tentativa bloqueada não conta. Login correto zera o contador. As tentativas ficam em `login_attempts` pelo SHA-256 do e-mail normalizado (nunca o e-mail em claro) e são limpas todo dia às 03:30 (mais de 24 h). Auditoria `auth.login_locked` para contas existentes. Complementa o rate limit por IP.
- Sessão opaca ([ADR-004](decisions.md#adr-004--sessão-opaca-em-cookie-httponly)):
  - token aleatório de 48 caracteres; banco guarda só o SHA-256;
  - cookie `kb_session`: `HttpOnly`, `SameSite=Strict`, `Path=/api/`, `Secure` em produção;
  - expiração absoluta: 12h (comum) ou 30 dias ("lembrar-me"); inatividade: 120 min (comum); renovação deslizante para persistentes;
  - cookie inválido/expirado é limpo automaticamente e a API responde `SESSION_EXPIRED`;
  - o frontend verifica a sessão a cada 5 min e ao focar a janela, limpa o cache e volta ao login.
- Variáveis: `KAMBAN_SESSION_TTL_HOURS`, `KAMBAN_SESSION_REMEMBER_DAYS`, `KAMBAN_SESSION_IDLE_MINUTES`, `KAMBAN_SESSION_TOUCH_SECONDS`.

## CSRF, XSS e cabeçalhos
- CSRF: `SameSite=Strict` + header `X-Requested-With: kamban` obrigatório em mutações (inclusive no login).
- XSS: React escapa a saída; nenhum `dangerouslySetInnerHTML`; nenhum token acessível ao JavaScript.
- CSP no frontend servido pela API (`FRONTEND_CSP` em `http/server.js`, nos arquivos do build e no fallback da SPA): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'none'; object-src 'none'…` (`'unsafe-inline'` em estilos é exigido por atributos `style` dos componentes; scripts inline não são usados — o tema inicial é aplicado por `public/theme-init.js`).
- Também no frontend: `Referrer-Policy`, `Permissions-Policy` e `X-Frame-Options: DENY`; em toda resposta, `X-Content-Type-Options: nosniff` e `X-Frame-Options` (`SAMEORIGIN` fora do frontend). API com `Cache-Control: no-store`.
- Redirecionamento pós-login só aceita caminhos internos (`safeRedirect`, contra open redirect).

## Autorização (RBAC) e IDOR
- Toda rota verifica permissão no backend; a UI só esconde/desabilita.
- Ordem de verificação: usuário autenticado → permissão → existência → regras de domínio.
- Recursos de outros usuários (ex.: sessões) respondem **404**, não 403 (não confirmam existência).
- Anti-escalonamento: ninguém concede permissões que não tem, atribui perfil com permissões que não tem, altera o próprio perfil ou mexe no SUPER_ADMIN (sem ser SUPER_ADMIN). Ver [permissions.md](permissions.md).
- **Membro limitado (Responsável TI, regras §33) falha fechado:** o papel `it` deixa `canView` falso, então toda leitura do projeto responde 404 sem precisar de um filtro em cada rota; só abrem o resumo, a ficha (com a seção) e as tarefas visíveis a ele (`scopedAccess`). A mesma regra está no SQL da lista geral e dos relatórios, nas notificações, nas menções e no tempo real. A varredura `tests/api/it-owner.test.js` confere rota por rota e ferramenta por ferramenta do MCP (ADR-051).
- **Seções do projeto (§35):** ficha, histórico, gerenciamento de membros e o "no informe" respondem `FORBIDDEN` sem a seção — a tela também bloqueia pelo endereço.

## Entrada e saída
- Validação declarativa em todas as rotas; campos desconhecidos são ignorados (lista explícita de campos aceitos).
- Ordenação só por whitelist; filtros via parâmetros vinculados (`$1`, `$2`… do `pg`); nomes de tabela e coluna vêm só do código e passam por `ident` (`infrastructure/sql.js`) — sem SQL concatenado com entrada do usuário.
- Corpo JSON ≤ 1 MB; JSON inválido → `BAD_REQUEST`.
- Erros inesperados nunca expõem mensagem interna; são logados com correlation id.

## Anexos e conteúdo do usuário (Fase 4)
- **Tipo real pelo conteúdo, nunca só pela extensão:** `domain/attachment.js` lê os primeiros bytes (assinaturas PNG/JPEG/GIF/WebP/PDF/ZIP/OLE; texto só sem bytes nulos) e exige que batam com a extensão. Texto que na verdade é HTML/XML/SVG (ex.: página com script salva como `.txt`) também é recusado pelo domínio (antes, essa segunda barreira era do PocketBase).
- **Proibidos** (anexos e arquivos do projeto, mesma validação): SVG, HTML, executáveis e qualquer tipo fora da lista. Até 20 MB por arquivo; uma requisição de upload por arquivo (limite de corpo 21 MB).
- **Nome seguro:** só o nome base, sem caminhos nem caracteres de controle, até 150 caracteres.
- **Download protegido:** os arquivos ficam num bucket **privado** do Supabase Storage, que só o servidor acessa (chave secreta); o arquivo só sai por `/api/v1/attachments/{id}/file` (ou `/api/v1/project-files/{id}/file`, arquivos do projeto), que confere o acesso ao projeto (404 para quem não vê). Resposta com `X-Content-Type-Options: nosniff`, CSP `sandbox` e `Cache-Control: private, no-store`; `?download=1` força download.
- **Foto do usuário:** só PNG, JPG ou WebP até 2 MB, tipo pelo conteúdo (sem SVG); servida só a quem está autenticado por `/api/v1/users/{id}/avatar`, com nosniff e CSP `sandbox` (cache privado de 1 dia: o endereço muda a cada troca). Envia e remove a própria pessoa ou quem tem `users.edit` (Super Admin só por Super Admin).
- **Markdown seguro:** descrições e comentários são renderizados como elementos React (`AppMarkdown`), sem HTML cru; links só `http(s)`. Campos URL também só `http(s)`.
- **Menções:** o servidor aceita só pessoas ativas com acesso ao projeto.
- **Notificações:** só chegam a quem continua com acesso ao projeto e está ativo; cada pessoa lê e marca apenas as suas (as de outra pessoa respondem 404). O texto exibido é guardado na notificação; clicar abre a tarefa, que confere o acesso de novo.

## Rate limiting
Limites por IP (`http/rate-limit.js`, antes de ler o corpo): login 10/min; `/api/v1/` 600/min; `/api/` 300/10s. Respostas `429 RATE_LIMITED` no envelope padrão, com `Retry-After`. Ajustável por `KAMBAN_RATE_LIMITS` (JSON, mesmo formato das regras que o PocketBase usava). A contagem é por instância da API; atrás de proxy, defina `KAMBAN_TRUSTED_PROXY` para contar pelo IP real.

## Segredos e configuração
- Nenhum segredo no código ou no frontend. Configuração por variáveis de ambiente (`backend/.env`, não versionado — modelo em `.env.example`).
- A chave secreta do Supabase (`KAMBAN_SUPABASE_SECRET_KEY`) e a conexão do Postgres ficam só no servidor; nunca vão ao navegador, ao histórico ou aos logs.
- Segredos guardados no banco (hoje: a senha do SMTP) são cifrados com AES-256-GCM e a `KAMBAN_SECRET_KEY` (`infrastructure/secrets.js`), obrigatória em produção.
- O super administrador é criado por `npm run create-admin` a partir de `KAMBAN_ADMIN_*` (a senha não passa pela linha de comando).
- Logs sem senhas/tokens; o user agent é truncado.

## Produção (checklist)
- [ ] HTTPS obrigatório (proxy reverso) e `KAMBAN_ENV=production` (cookie `Secure`).
- [ ] `KAMBAN_TRUSTED_PROXY` com o IP do proxy, para o IP real (rate limit e auditoria).
- [ ] `KAMBAN_SECRET_KEY` definida, com cópia guardada em lugar seguro; chave secreta do Supabase só no servidor.
- [ ] Conexão do Postgres com TLS (`KAMBAN_DB_SSL=require`, ou `verify-full` com a CA).
- [ ] Acesso ao Supabase Studio restrito; backup do banco **e** do Storage ([deployment.md](deployment.md#backup-e-restauração)).
- [ ] `npm run check` e `npm run e2e` verdes no build que será publicado.
- [ ] (Opcional) Antivírus para anexos (ex.: ClamAV no proxy de upload) — os anexos já têm tipo conferido pelo conteúdo, limite de tamanho e download protegido.

## Verificações automatizadas (Fase 9)
- **Varredura de segurança** (`tests/api/security-sweep.test.js`): lê todas as rotas registradas em `http/route-table.js` e exige **401 sem sessão** em todas (exceto as públicas), **CSRF** em todas as mutações, nenhum dado fora de `/api/v1` (como a antiga API genérica do PocketBase) e os cabeçalhos de segurança. `tests/db/database.test.js` confere que `anon`/`authenticated` não leem nem gravam nada no esquema. Rota nova entra na varredura sozinha.
- **Catálogo de auditoria** (`tests/unit/audit-catalog.test.js`): toda ação gravada em `audit_logs` precisa de rótulo nos três idiomas e aparecer no filtro da auditoria.
- **Bloqueio de conta** (`tests/unit/application-lockout.test.js`, `tests/api/lockout.test.js`).
- **Dependências:** `npm audit` sem vulnerabilidades na raiz, em `web/` e em `backend/` (2026-09-30).
- **Navegador** ([testing.md](testing.md#ponta-a-ponta-fase-9)): fluxos do MVP, leitor sem edição, sessão encerrada em outro lugar e varredura de acessibilidade.

## Configurador geral
- **Bloqueio de login e política de senha configuráveis** com limites que não deixam desligar a proteção (mínimo de 3 tentativas; senha de 8+ caracteres sempre com letras e números; teto do bloqueio ≥ tempo inicial). A política de senha vale em criação, redefinição e troca; o bcrypt continua limitando a 72 caracteres.
- **Imagens da identidade** (logo/ícone): até 1 MB, tipo conferido pelo conteúdo (PNG, JPEG, WebP, ICO); **SVG** só sem conteúdo ativo — recusado se tiver `<script>`, atributos `on*`, `foreignObject`/`iframe`/`embed`/`object`, `DOCTYPE`/`ENTITY`, `javascript:`, `@import` ou referências externas (só âncoras `#` e `data:image/`). Servidas com `X-Content-Type-Options: nosniff` e `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` (segunda barreira se aberto direto no navegador); na tela entram por `<img>`, que não executa script.
- **Rotas públicas novas:** só `GET /api/v1/platform` (nome e endereços) e as imagens — sem dados de configuração. Rotas públicas **não limpam** o cookie de uma sessão inválida (só as protegidas, que respondem `SESSION_EXPIRED`): a identidade carrega junto com o `/auth/me`, e limpar antes faria a tela perder o aviso "Sua sessão expirou". A varredura de segurança (`security-sweep.test.js`) as trata como públicas; todo o resto continua exigindo sessão.
- **Retenção do histórico:** limpeza diária com registro da própria limpeza; encurtar o prazo exige confirmação na tela com a contagem do que sairá.

## E-mail e links de senha
- **Links de uso único:** token aleatório de 48 caracteres; só o **hash** vai para o banco (`auth_tokens`). Redefinição vale 60 minutos; convite, 7 dias; usar ou pedir outro invalida. Confirmar a nova senha **encerra todas as sessões** e libera o bloqueio de login.
- **Sem enumeração de contas:** o pedido de redefinição responde sempre `{ requested: true }`, exista ou não a conta, esteja ou não ativa; no máximo 3 pedidos por conta por hora (além do rate limit por IP).
- **Sem envenenamento de link:** os links usam o **endereço da plataforma configurado**, nunca o `Host` da requisição.
- **Senha do SMTP:** só escrita — nunca volta na API nem vai para o histórico. Fica cifrada em repouso (`email_settings.password_secret`, AES-256-GCM com a `KAMBAN_SECRET_KEY`).
- **Fila sem segredos guardados:** o corpo do e-mail (que pode ter um link) é apagado depois de enviado ou desistido; a lista da fila mostra só destinatário, tipo, assunto e situação.
- **Conteúdo:** todo texto vindo de pessoas é escapado no HTML do e-mail.

## Tokens de API
- Valor `kb_pat_` + 40 caracteres aleatórios. A autenticação usa o **hash**; o valor fica também **cifrado** (AES-256-GCM com `KAMBAN_SECRET_KEY`, como a senha do SMTP) para o dono ver de novo pelo navegador (ADR-046) — um vazamento só do banco não revela tokens sem a chave do servidor. Ver de novo: só o dono, só com sessão do navegador (um token não revela outro nem a si mesmo), nunca revogado (vencido pode: não autentica), e fica no histórico. O histórico guarda nome, prefixo e prazo, nunca o valor.
- `Authorization: Bearer` não usa cookie, então não há CSRF a proteger: o header de CSRF é dispensado só nesse caso, e com o token o cookie é ignorado (não dá para combinar os dois).
- O token herda as permissões do perfil atual a cada chamada; pessoa desativada, token vencido ou revogado → 401 imediato.
- Um token vazado não consegue se perpetuar: não cria outros tokens, não troca a senha nem mexe nas sessões (`TOKEN_NOT_ALLOWED`). Revogar está em Minha conta e, para o Admin, em Integrações.

## MCP (Claude)
- `/api/mcp` aceita **só** `Authorization: Bearer` (token de API); o cookie é ignorado, então não há CSRF. As ferramentas chamam os mesmos casos de uso da API: RBAC, acesso por projeto (sem acesso = `*_NOT_FOUND`), validação e auditoria iguais; nenhuma ferramenta de administração (usuários, perfis, configurações, tokens).
- **DNS rebinding:** requisição com `Origin` diferente do host pedido é recusada (403); como o acesso exige o token (que um site não tem), uma página maliciosa não consegue chamar as ferramentas.
- **Entrada:** argumentos conferidos contra o esquema de cada ferramenta (tipos, listas, tamanhos e campos desconhecidos) antes do caso de uso, que valida de novo as regras. Erros inesperados voltam como `INTERNAL_ERROR` sem detalhes e vão para o log com a ferramenta e o correlation id.
- **Instruções injetadas:** o texto de tarefas e comentários chega ao modelo como dado; o que o Claude pode fazer está limitado às permissões da pessoa, e excluir/arquivar pedem confirmação explícita (anotação `destructiveHint` + orientação no `initialize`). Clientes como o Claude Code pedem aprovação por ferramenta — recomende manter a aprovação para as que alteram dados.

## Webhooks
- **Só para quem administra** (`integrations.manage`): um webhook recebe eventos de todos os projetos.
- **SSRF:** endereço https obrigatório em produção; metadados da nuvem (`169.254.0.0/16`, `metadata.google.internal`), link-local e `0.0.0.0` sempre recusados; a própria máquina (`localhost`, `127.*`, `::1`) e http só fora de produção ou com `KAMBAN_WEBHOOKS_ALLOW_INSECURE=true`. Credenciais no endereço são recusadas. Redirecionamentos não são seguidos (um 3xx poderia levar a um endereço interno). Limitação conhecida: um nome de domínio que resolva para um IP interno não é bloqueado (a validação olha o endereço, sem resolver o DNS) — por isso o recurso é restrito a administradores. Tempo limite de 10 s por envio.
- **Autenticidade:** cada envio é assinado com HMAC-SHA256 (`X-Kamban-Signature`) sobre `timestamp.corpo`; o receptor deve conferir a assinatura e recusar timestamps antigos (proteção contra repetição). O segredo aparece uma vez e pode ser trocado a qualquer momento.
- **Conteúdo:** a carga é o que o histórico já guarda (sem senhas nem tokens).

## Tempo real
- Assinar tópicos (`POST /api/realtime`) exige a sessão do cookie e o header de CSRF; a conexão fica presa à pessoa (outra sessão não reaproveita o `clientId`). Tópicos só de projetos visíveis e do próprio usuário; o resto é descartado.
- Os avisos carregam só identificadores; o conteúdo sempre vem da API, com as permissões. Limitação conhecida: quem perde o acesso a um projeto com a tela aberta ainda pode receber os identificadores das mudanças até a conexão ser refeita — nunca o conteúdo.
- Os avisos saem dos gatilhos do banco por `LISTEN/NOTIFY` e só a API os escuta; o Realtime do Supabase não é usado e não enxerga as tabelas (sem privilégios para `anon`/`authenticated`).
