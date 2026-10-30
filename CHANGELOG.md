# Changelog

Todas as mudanças relevantes do projeto ficam aqui. Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versões seguem o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- **Ficha do projeto** (página do projeto → aba Ficha): objetivo geral e objetivos, funcionalidades, escopo (inclui / não inclui) e resultados esperados, com completude e resumo. Funcionalidades avançam sozinhas pelas tarefas vinculadas; objetivos, pelos vínculos; resultados têm partida, meta, prazo, frequência e série de medições (registradas por quem edita ou pelo responsável), com situação "no caminho / atrasado / cumprido" e aviso de "sem medição". API `/projects/{id}/charter` e `/charter-items/{id}`.
- **Informe do projeto** (página do projeto → aba Informe): capa, indicadores, cronograma com fases e marcos, avanço por fase, linha do tempo dia a dia, tarefas e próximos passos, com prévia na tela e "Baixar PDF"; período, data de corte, fases (grupo da Gestão de projetos) e seções escolhidos por quem monta. Na aba Tarefas, um botão por linha escolhe o que sai no informe (`PUT /tasks/{id}/report`, filtro `in_report`).
- **Linha do tempo do projeto** (página do projeto → Histórico): os registros do Diário, os marcos e as tarefas pela data em que aconteceram, do mais antigo ao mais recente e agrupados por dia; a auditoria (o que foi gravado e quando) continua logo abaixo, em "Alterações registradas no sistema".
- **Tempo real:** Kanban, Planejamento, Timeline, quadro da Gestão de projetos, página do projeto, página da tarefa e o sino de notificações se atualizam sozinhos quando alguém muda algo (sem recarregar).
- **Webhooks** (Configurações → Integrações → Webhooks): avisos assinados (HMAC-SHA256) para outros sistemas a cada evento do catálogo (tarefas, projetos, comentários, quadro, documentação…), com novas tentativas, desligamento automático, teste e reenvio.
- **Tokens de API** pessoais (Minha conta → Tokens de API): acesso à API com `Authorization: Bearer`, prazo opcional, valor mostrado uma vez, revogação pela pessoa ou pelo Admin (Integrações).
- **E-mail** (Configurações → Integrações, permissão `integrations.manage`): servidor SMTP com teste e fila de envio; "Esqueci minha senha" no login; convite de usuário por e-mail (a pessoa cria a própria senha); notificações também por e-mail, que cada pessoa liga ou desliga em Minha conta.
- **Configurador geral** (Configurações → Geral, permissão `platform.manage`): nome, logo (claro/escuro) e ícone da plataforma; política de senha; bloqueio de login; retenção do histórico de auditoria com limpeza diária, prévia ao encurtar e "Limpar agora".
- Pacote de publicação open source: licença Apache-2.0, NOTICE, guia de contribuição, código de conduta, política de segurança, integração contínua (GitHub Actions), imagem Docker com docker-compose e dados de demonstração (`npm run demo`).

### Alterado
- **A plataforma agora se chama BLYD Sync** — "Sincronize projetos, tarefas e equipes." — com logos novos (tema claro, tema escuro e ícone do navegador). Identificadores técnicos (`kb_session`, `KAMBAN_*`, `X-Kamban-*`, tokens `kb_pat_`) foram mantidos para não quebrar instalações e integrações.
- A Gestão de projetos virou item próprio do menu lateral (`/project-management`), fora da página do projeto; links antigos (`?tab=plan`) redirecionam.
- **Tela de login remodelada:** painel com a proposta do produto e uma prévia do quadro; "Esqueci minha senha" sempre visível — sem e-mail configurado, orienta a falar com o administrador.
- **Desempenho:** o servidor sobe com 60 VMs do JavaScript (`KAMBAN_HOOKS_POOL`; o padrão do PocketBase é 15), o quadro do Kanban usa uma consulta mais leve, as consultas periódicas viram rede de segurança (5 min) quando o tempo real está ligado e as atualizações ao vivo fazem no máximo uma busca a cada 2,5 s por tela. No teste de carga a vazão útil triplicou (~200 pessoas simultâneas). **Atenção:** o servidor usa mais memória — reserve 2 GB (ou diminua `KAMBAN_HOOKS_POOL`).

### Corrigido
- **Histórico:** a situação dos marcos aparecia sem tradução ("done", "pending"); agora mostra "alcançado"/"pendente" no idioma da pessoa.
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
