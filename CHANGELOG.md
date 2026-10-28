# Changelog

Todas as mudanças relevantes do projeto ficam aqui. Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versões seguem o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- **Tempo real:** Kanban, Planejamento, Timeline, quadro da Gestão de projetos, página do projeto, página da tarefa e o sino de notificações se atualizam sozinhos quando alguém muda algo (sem recarregar).
- **Webhooks** (Configurações → Integrações → Webhooks): avisos assinados (HMAC-SHA256) para outros sistemas a cada evento do catálogo (tarefas, projetos, comentários, quadro, documentação…), com novas tentativas, desligamento automático, teste e reenvio.
- **Tokens de API** pessoais (Minha conta → Tokens de API): acesso à API com `Authorization: Bearer`, prazo opcional, valor mostrado uma vez, revogação pela pessoa ou pelo Admin (Integrações).
- **E-mail** (Configurações → Integrações, permissão `integrations.manage`): servidor SMTP com teste e fila de envio; "Esqueci minha senha" no login; convite de usuário por e-mail (a pessoa cria a própria senha); notificações também por e-mail, que cada pessoa liga ou desliga em Minha conta.
- **Configurador geral** (Configurações → Geral, permissão `platform.manage`): nome, logo (claro/escuro) e ícone da plataforma; política de senha; bloqueio de login; retenção do histórico de auditoria com limpeza diária, prévia ao encurtar e "Limpar agora".
- **Servidor na rede local no macOS** (`scripts/mac/avanza.sh`): sobe o Avanza a cada login numa cópia em `~/Avanza`, reinicia se cair e mostra o endereço de acesso para a equipe; `atualizar` leva as mudanças do repositório sem tocar nos dados.
- Pacote de publicação open source: licença Apache-2.0, NOTICE, guia de contribuição, código de conduta, política de segurança, integração contínua (GitHub Actions), imagem Docker com docker-compose e dados de demonstração (`npm run demo`).

### Alterado
- **Backend novo: Node + Supabase no lugar do PocketBase** (ADR-044). A API `/api/v1`, o tempo real e as telas continuam iguais; os dados ficam no Postgres do Supabase (Cloud, auto-hospedado ou local em Docker) e os arquivos no Storage. Quem já usava continua logado: `npm run import:pocketbase` traz usuários, senhas, sessões, tokens, histórico, arquivos e o SMTP do PocketBase. A senha do SMTP agora fica cifrada no banco (`KAMBAN_SECRET_KEY`).
- **A plataforma agora se chama Avanza** — "Sincronize projetos, tarefas e equipes." — com logos novos (tema claro, tema escuro e ícone do navegador). Identificadores técnicos (`kb_session`, `KAMBAN_*`, `X-Kamban-*`, tokens `kb_pat_`) foram mantidos para não quebrar instalações e integrações.
- **Nova identidade visual (Somax):** paleta verde no lugar da violeta, em tema claro e escuro, logo novo (símbolo de barras de progresso) no menu, no login e no ícone do navegador, e fontes Figtree e Plus Jakarta Sans. **Tela de login nova:** capa com o gradiente verde, a proposta, o que o produto faz e o rodapé "© Avanza · SomaxAgro"; no celular a capa fica compacta acima do formulário. A capa mantém a prévia animada do quadro (flutua devagar, com o "ao vivo" pulsando), parada para quem pede menos movimento. Contraste AA conferido nas telas (alguns tons do guia foram escurecidos levemente para isso).
- A Gestão de projetos virou item próprio do menu lateral (`/project-management`), fora da página do projeto; links antigos (`?tab=plan`) redirecionam.
- **Tela de login remodelada:** painel com a proposta do produto e uma prévia do quadro; "Esqueci minha senha" sempre visível — sem e-mail configurado, orienta a falar com o administrador.
- **Desempenho:** o servidor sobe com 60 VMs do JavaScript (`KAMBAN_HOOKS_POOL`; o padrão do PocketBase é 15), o quadro do Kanban usa uma consulta mais leve, as consultas periódicas viram rede de segurança (5 min) quando o tempo real está ligado e as atualizações ao vivo fazem no máximo uma busca a cada 2,5 s por tela. No teste de carga a vazão útil triplicou (~200 pessoas simultâneas). **Atenção:** o servidor usa mais memória — reserve 2 GB (ou diminua `KAMBAN_HOOKS_POOL`).

### Corrigido
- **Tipo de tarefa com campo de arquivo/imagem obrigatório não deixava criar a tarefa** (erro 400): o anexo só pode ser enviado depois que a tarefa existe. Agora esses campos não são exigidos na criação; passam a ser exigidos nas edições e mudanças de status seguintes. Na edição e no "Preencha para mover", o campo ganhou **Enviar arquivo/imagem** (antes só dava para escolher entre anexos já enviados, e sem anexo a tarefa não mudava de status), e campos do tipo projeto passaram a listar os projetos também nesses dois lugares.
- **Muitas pessoas conectadas deixavam o servidor lento:** cada aba aberta com o tempo real prendia VMs do JavaScript por causa de middlewares globais; com algumas dezenas de abas o pool acabava e as respostas passavam de segundos (500 leitores da documentação: 47 s). Os middlewares agora ficam só nas rotas da API e na rota do frontend, e um sinal de vida a cada 3 min evita que o PocketBase derrube as conexões paradas a cada 5 min. Com 500 leitores e 10 pessoas trabalhando: p95 de 44 ms.
- **Versão e copyright** no rodapé do menu lateral (a versão vem do `package.json` no build; com o menu recolhido, só a versão).
- **Kanban:** ao passar o mouse, a borda do cartão acende na cor da marca com um halo suave (animação de 200 ms); o cartão sendo arrastado fica destacado.
- **Planejamento mais rápido:** o backlog usa a mesma consulta enxuta do Kanban e o formulário de tarefa não busca dados enquanto está fechado.
- Relatórios da Gestão de projetos: o nome do recurso não fica mais cortado (o detalhe de pendentes e horas foi para uma linha própria).

## [0.1.0] — 2026-10-01

Primeira versão.

### Adicionado
- **Fundação:** sessão segura em cookie HttpOnly, RBAC configurável (perfis e matriz de permissões), usuários, auditoria consultável, bloqueio progressivo de login, API própria `/api/v1` com OpenAPI, design system com tema claro/escuro, pt-BR/en/es, command palette (Ctrl/⌘+K).
- **Projetos:** membros com papéis (gestor, membro, leitor), arquivar, transferir posse, histórico.
- **Tipos de tarefa e campos personalizados:** 17 tipos de campo, obrigatoriedade por status, tipos traduzidos.
- **Tarefas:** formulário dinâmico por tipo, tags, checklist, comentários com @menções e imagens coladas, anexos com verificação do tipo real, relacionamentos (bloqueia/depende/relaciona/duplica), subtarefas e fork, notificações.
- **Kanban** com limite WIP e transições permitidas; **Planejamento** com sprints; **Timeline** das tarefas com marcos.
- **Relatórios** com indicadores clicáveis.
- **Documentação:** espaços, páginas com editor rico, versões e busca.
- **Gestão de projetos** (à parte das tarefas): quadro estilo Monday com grupos numerados, elementos e subelementos, etiquetas de status e recurso, filtros, arrastar, seleção em massa, dependências, importação CSV, painel do elemento (atualizações, @menções, imagens), visões Cronograma (linha de base, exportação), Kanban, Gestão (diário e problemas), Relatórios com a saúde do projeto e colunas personalizadas.
