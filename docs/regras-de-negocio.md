# Regras de negócio — fluxo de trabalho

Como as tarefas andam no BLYD Sync: status, datas de início e conclusão, transições, limite WIP e Kanban.
Quem pode fazer cada ação está em [permissions.md](permissions.md); as decisões técnicas, em [decisions.md](decisions.md) (ADR-011 e ADR-015).

## 1. Status e categorias

Os status são **globais** (valem para todos os projetos) e configurados em **Configurações → Status**: nome, cor, ordem (a ordem das colunas do Kanban), padrão, ativo, limite WIP e transições permitidas.

Cada status pertence a uma **categoria**, que diz ao sistema o que aquela etapa significa:

| Categoria | Significado | Exemplos no fluxo padrão |
|---|---|---|
| Backlog | ideia ou pedido ainda não planejado | Backlog |
| A fazer | planejada, aguardando início | Triagem, Análise, Priorizado |
| Em andamento | em execução | Desenvolvimento, Homologação, Produção |
| Concluída | encerrada com entrega | Concluído |
| Cancelada | encerrada sem entrega | Cancelado |

O **tipo** da tarefa (Bug, Melhoria…) não influencia o andamento: ele define apenas os campos da tarefa.

## 2. Início e conclusão da tarefa

Não existe botão "iniciar" ou "concluir": a tarefa é iniciada ou concluída **ao mudar de status**, arrastando o card no Kanban ou escolhendo o status na tarefa. O sistema preenche as datas sozinho, pela categoria do status de destino:

| A tarefa entra num status da categoria… | Efeito |
|---|---|
| **Em andamento** | grava **Iniciada em** — só na primeira vez; não é apagada depois |
| **Concluída** ou **Cancelada** | grava **Concluída em**; se ainda não havia início, grava **Iniciada em** também |
| **Backlog**, **A fazer** ou **Em andamento**, vindo de uma encerrada (reabrir) | limpa **Concluída em** (Iniciada em permanece) |
| Criada direto num status | mesmas regras (criada em "Concluído" já nasce iniciada e concluída) |

As datas aparecem em **Propriedades** da tarefa e toda troca de status fica no **histórico** (quem, quando, de → para).

Para mudar o que conta como "iniciada" ou "concluída", altere a **categoria** do status em Configurações → Status. Exemplo: se "Produção" já significa entrega, coloque-o na categoria Concluída. Atenção à ordem: mover de um status encerrado para um aberto (ex.: de "Concluído" para "Produção", que no padrão é Em andamento) **reabre** a tarefa.

## 3. Transições permitidas

Cada status pode restringir para onde a tarefa vai a partir dele (campo **Pode ir para**):

- vazio = pode ir para **qualquer** status;
- preenchido = só para os status listados (permanecer no mesmo status sempre é possível).

A regra vale em **toda** troca de status — no Kanban, na página da tarefa, no painel lateral e pela API (erro `TRANSITION_NOT_ALLOWED`). No Kanban, durante o arraste, as colunas proibidas aparecem esmaecidas.

Na tarefa (formulário **Editar**, troca rápida na página da tarefa e no painel do Kanban), a lista de status mostra **só o status atual e os destinos permitidos** (ex.: "Redesenvolver" que só vai para "Homologação" lista apenas os dois). Se o status atual não tem nenhum destino configurado, **todos** aparecem. Na criação, todos aparecem.

## 4. Limite WIP

Cada status pode ter um **limite WIP** (máximo de tarefas na coluna; vazio ou 0 = sem limite). O limite é um **alerta**, não um bloqueio:

- a contagem aparece como `3/5` no cabeçalho da coluna: amarela no limite, vermelha acima dele;
- ao mover uma tarefa para uma coluna que passa do limite, aparece um aviso — o time decide se segue.

## 5. Kanban

- Colunas = status **ativos**, na ordem configurada. A ordem dos cards dentro da coluna é manual (arrastar) e vale para todos.
- Colunas das categorias Concluída/Cancelada mostram as 30 tarefas encerradas mais recentes; as demais mostram tudo.
- Mover um card é uma troca de status: segue as seções 2 a 4, notifica o responsável e o criador e grava o histórico. Reordenar dentro da mesma coluna não gera histórico.
- Criação rápida (+ na coluna): a tarefa nasce no status da coluna. Se o tipo tiver campo obrigatório sem valor padrão, a criação continua no formulário completo.
- Filtros, busca e raias (por responsável, prioridade ou tipo) só mudam a visualização.
- Leitor do projeto e projeto arquivado: veem o quadro e comentam, mas não arrastam nem criam.

## 6. Planejamento (backlog e sprints)

### O que aparece no Planejamento
A tela **Planejamento** de cada projeto (menu **Planejamento** ou "Abrir planejamento" na página do projeto; antes chamada "Backlog") lista **tudo que ainda não foi encerrado**:

| Categoria do status | Aparece no Planejamento? |
|---|---|
| Backlog (ideias, pedidos) | sim |
| A fazer (já analisadas/priorizadas — ex.: Triagem, Análise, Priorizado) | sim |
| Em andamento (ex.: Desenvolvimento, Redesenvolver, Homologação) | sim |
| Concluída, Cancelada | não (acompanhe no Kanban) |

O que decide é a **categoria** do status (Configurações → Status), não o nome: "Produção" marcado como Concluída fica fora; marcado como Em andamento, aparece. O filtro de status lista os mesmos status.

Cada linha mostra o status atual, a prioridade, o prazo, a estimativa e o responsável. Filtros (responsável, tipo, prioridade, tag, status) e busca só mudam a visualização.

### Priorização
- A ordem da lista é a **prioridade do time**: arraste pela alça (⋮⋮) para cima ou para baixo. A ordem vale para todos e é a mesma ordem das colunas no Kanban.
- Outras ordenações (prioridade, mais recentes, prazo, maior estimativa) servem para consulta; nelas o arraste fica desligado.
- Reordenar não gera histórico; trocar de sprint gera.

### Sprints
- Uma **sprint** agrupa as tarefas planejadas para um período: nome, objetivo e datas de início/fim (opcionais; o fim não pode ser antes do início).
- Situação: **Planejada → Ativa → Encerrada** (dá para voltar de Ativa para Planejada).
- **Quem organiza:** o gestor do projeto (ou quem tem `projects.view_all`) cria, edita, inicia, encerra, exclui e **ordena** as sprints (Subir/Descer). A ordem vale para todo o time.
- **Colocar tarefas na sprint:** arrastando a tarefa para o grupo da sprint, pelo menu da tarefa ("Planejar na sprint"), em lote (selecionando várias) ou no campo **Sprint** do formulário da tarefa. Qualquer pessoa que pode editar a tarefa pode planejá-la. A sprint precisa ser do mesmo projeto e não estar encerrada.
- A tarefa pode ter sprint em qualquer status; no Planejamento aparecem só as que ainda não foram encerradas. No Kanban há filtro por sprint.
- **Encerrar a sprint:** as tarefas dela que **não** foram concluídas nem canceladas voltam para o grupo **Sem sprint** (com registro no histórico de cada uma); as encerradas continuam registradas na sprint.
- **Excluir a sprint:** as tarefas continuam existindo, apenas ficam sem sprint (com histórico).
- Sprint aqui é **planejamento**: não há velocidade, burndown nem compromisso formal.

### Mover para outro status
- Pelo menu da tarefa (**Mover para**) ou em lote. Os destinos oferecidos são os status ativos, não encerrados, diferentes do atual e **permitidos pelo fluxo** (seção 3).
- Ir para um status "Em andamento" ganha **Iniciada em** (seção 2); a tarefa continua no Planejamento até ser concluída ou cancelada.
- Em lote, tarefas cujo fluxo não permite o destino escolhido são puladas e avisadas.

### Criação
- **Nova tarefa** no Planejamento nasce no status padrão (em geral, "Backlog"); o **+** de uma sprint cria a tarefa já planejada nela.
- Tipos com campo obrigatório sem valor padrão continuam no formulário completo (como no Kanban).

### Permissões no Planejamento
| Ação | Quem |
|---|---|
| Ver | quem vê as tarefas do projeto (inclusive leitor) |
| Priorizar, mover de status, planejar na sprint | quem edita tarefas no projeto (gestor, membro, dono) |
| Criar tarefa | quem cria tarefas no projeto |
| Criar/editar/ordenar/encerrar/excluir sprints | gestor do projeto, dono ou `projects.view_all` |
| Projeto arquivado | somente leitura |

## 7. Relacionamentos, subtarefas e fork

Tudo fica na aba **Relações** da tarefa (com a contagem no título da aba).

### Tipos de relação
Uma relação liga duas tarefas e aparece **nas duas**, cada uma do seu ponto de vista:

| Criada em A como… | Em A aparece | Em B aparece |
|---|---|---|
| A **bloqueia** B | Bloqueia B | Bloqueada por A |
| A **depende de** B | Depende de B | Dependência de A |
| A **relacionada a** B | Relacionada a B | Relacionada a A |
| A **é duplicado de** B | Duplicado de B | Duplicado em A |

- Não dá para relacionar a tarefa com ela mesma nem repetir a mesma relação (em "relacionada" e "duplicado" o sentido não importa).
- **Sem ciclos de espera:** bloqueios e dependências formam uma fila de "vem antes". Se A bloqueia B e B bloqueia C, C não pode bloquear A (nem A depender de C) — a tarefa acabaria esperando por ela mesma.
- **Bloqueada:** uma tarefa aparece com o selo **Bloqueada** (no cabeçalho, nas listas, no Kanban e no Planejamento) enquanto algo que a bloqueia — ou de que ela depende — **não estiver concluído ou cancelado**. É um aviso: não impede mover a tarefa.
- Relações entre projetos diferentes são permitidas, mas só são vistas por quem enxerga os dois projetos.
- Criar e desfazer ficam no histórico das **duas** tarefas.

### Subtarefas (pai e filho)
- Uma tarefa pode ter subtarefas: criadas na hora (título; mesmo projeto e tipo do pai) ou vinculando uma tarefa existente ("Vincular existente" / "tem como subtarefa…"). Também dá para tornar a tarefa aberta subtarefa de outra ("é subtarefa de…").
- Pai e subtarefa são sempre do **mesmo projeto**; não há ciclo (a tarefa não pode ser "avó" de si mesma) e há um limite de **5 níveis**.
- O pai mostra o progresso: **"X de Y subtarefas concluídas"** (concluídas = categoria Concluída ou Cancelada).
- A subtarefa mostra "Subtarefa de …" no cabeçalho.
- **Excluir o pai não exclui as subtarefas:** elas ficam soltas, com registro no histórico de cada uma. Concluir o pai com subtarefas abertas é permitido (o progresso mostra o que falta).

### Fork
- **Fork** cria uma nova tarefa a partir de outra, guardando a origem: a nova mostra "Fork de …" e a origem lista seus forks. O histórico registra nos dois lados.
- No momento do fork a pessoa escolhe o título, o projeto de destino (onde ela trabalha) e **o que copiar**:

| Item | Copiado por padrão? | Observação |
|---|---|---|
| Descrição | sim | |
| Tags | sim | |
| Campos do tipo | sim | campos de imagem/arquivo só junto com os anexos |
| Checklist | sim | os itens voltam a ficar **pendentes** |
| Anexos | não | os arquivos são copiados (a cópia é independente) |
| Relações com outras tarefas | não | a relação passa a existir também com o fork |

- Nunca são copiados: subtarefas, comentários, sprint, responsável e histórico. O fork nasce no status inicial (padrão) com a mesma prioridade e o mesmo tipo.
- Se a origem for excluída, o fork continua existindo (só perde a referência "Fork de").

### Permissões
| Ação | Quem |
|---|---|
| Ver relações | quem vê a tarefa |
| Relacionar / desfazer | `tasks.link` + trabalha no projeto (gestor, membro, dono) |
| Criar subtarefa | quem cria tarefas no projeto |
| Vincular/soltar subtarefa, definir pai | quem edita a tarefa |
| Fork | `tasks.fork` + trabalha no projeto de origem e pode criar no projeto de destino |
| Leitor / projeto arquivado | só consulta |

## 8. Relatórios e indicadores

Os números são calculados na hora a partir das tarefas reais (nada é digitado à mão) e a tela **sempre mostra o período considerado** e quando o cálculo foi feito.

### Quais tarefas entram
- As dos projetos que a pessoa **vê** (onde é membro/dono, ou todos com `projects.view_all`).
- Projetos **arquivados ficam de fora** — a não ser que o projeto arquivado seja escolhido no filtro de projeto.
- Filtros: projeto, responsável (inclusive "Minhas tarefas" e "Sem responsável"), tipo, prioridade e status. O estado dos filtros fica no endereço da página (dá para compartilhar o link).

### Período
- Atalhos: últimos 7, 30 (padrão) ou 90 dias, este mês, ou datas escolhidas (até 366 dias). Os dias são contados no **fuso de quem está vendo** (do início do primeiro dia ao fim do último).

### Situação atual ("agora" — não depende do período)
| Indicador | Definição |
|---|---|
| Abertas | status nas categorias Backlog, A fazer ou Em andamento (a dica separa backlog e a fazer) |
| Em andamento / No backlog | status nessa categoria |
| Bloqueadas | abertas com algo que as bloqueia (ou de que dependem) ainda aberto (seção 7) |
| Atrasadas | abertas com prazo **antes de hoje** (vencer hoje ainda não é atraso) |
| Bugs críticos | abertas do tipo com chave **BUG** na **prioridade mais alta** (a primeira da lista de prioridades); o nome da prioridade aparece na dica |

### No período
| Indicador | Definição |
|---|---|
| Criadas | data de criação dentro do período |
| Concluídas / Canceladas | data de encerramento dentro do período e categoria atual Concluída / Cancelada (reabrir tira a tarefa da conta) |
| Tempo até concluir (lead time) | média, das concluídas no período, do tempo entre a criação e a conclusão |
| Tempo em execução (cycle time) | média, das concluídas no período que passaram por "em andamento", do tempo entre o início e a conclusão |
| Resolução de bugs | tempo até concluir, só dos bugs concluídos no período |

- Cada média mostra **de quantas tarefas** foi calculada; sem nenhuma, aparece "—". Até 48 h o tempo aparece em horas; acima disso, em dias.

### Evolução e recortes
- **Criadas × concluídas** por dia (ou por semana em períodos acima de 62 dias).
- **Recorte** por status, prioridade, tipo, responsável ou projeto: total, abertas, atrasadas e bloqueadas (agora) e criadas, concluídas e tempo médio (no período). Ordenado pelas que têm mais abertas.
- **Atrasadas:** lista das abertas vencidas (da mais antiga, até 50), com acesso ao painel da tarefa.

### Dashboard
Mostra a situação atual e os últimos 30 dias (criadas, concluídas, tempo até concluir e a evolução), com o período à vista e o link "Ver relatórios".

### Detalhamento (clicar no indicador)
- Todo card de indicador — nos Relatórios e no Dashboard — é **clicável**: abre um painel com as tarefas que formam aquele número, com o **mesmo período, filtros e regras de acesso**. A quantidade listada é sempre a do card.
- Ao passar o mouse (ou focar pelo teclado), o card mostra **o que o indicador mede** e o convite "Ver tarefas".
- Ordem da lista: situação atual = há mais tempo abertas primeiro; atrasadas = prazo mais antigo primeiro; criadas = mais recentes primeiro; concluídas, canceladas e tempos = encerradas mais recentemente primeiro.
- Nos indicadores de tempo, cada tarefa mostra a **própria duração** (a média do card é a média dessas durações).
- Na lista, "Visualizar" abre o painel da tarefa.
- No gráfico de evolução, passar o mouse sobre um dia (ou semana) mostra as quantidades de criadas e concluídas.

### Permissões
Ver relatórios e indicadores exige `reports.view` (todos os perfis padrão têm). Os números respeitam o acesso aos projetos: ninguém vê contagens de projetos que não enxerga.

## 9. Acesso à conta

### Bloqueio por tentativas de login
- Depois de **5 senhas erradas** para o mesmo e-mail (dentro de 24 h), novas tentativas ficam **bloqueadas por 5 minutos**. Se os erros continuarem, a cada 5 novas falhas o tempo dobra (10, 20, 40 minutos), até o máximo de **60 minutos**.
- Enquanto está bloqueada, a tela de login avisa por quanto tempo esperar; a senha nem é conferida e essas tentativas não contam.
- Entrar com a senha correta (depois do bloqueio) **zera** a contagem.
- A regra vale igualmente para e-mails que não existem, para não revelar quais contas existem.
- O bloqueio de conta existente fica registrado na auditoria ("Login bloqueado por excesso de tentativas"). Além dele, há o limite de tentativas por endereço de rede (rate limit).

## 10. Campos obrigatórios por status

Cada tipo de tarefa define, campo a campo, **quando** ele precisa estar preenchido (Configurações → Tipos de tarefa → Campos do tipo):

| Configuração do campo | Quando é exigido |
|---|---|
| **Obrigatório** ligado | sempre — em qualquer status, inclusive ao criar |
| **Obrigatório nos status** (ex.: Análise, Desenvolvimento) | só quando a tarefa está (ou vai ficar) em um desses status |
| nenhum dos dois | nunca (opcional) |
| campo **oculto** | nunca (não aparece no formulário) |

- **A regra vale para o status em que a tarefa vai ficar.** Ao criar, editar ou mudar de status, a tarefa precisa ter preenchidos os campos exigidos nesse status. Exemplo: se "Parecer do analista" é exigido em Análise, a tarefa só entra em Análise com o parecer preenchido.
- **Vale para toda mudança de status:** arrastar no Kanban, "Mover para" no Planejamento, troca rápida de status na tarefa, formulário completo e API.
- **Preencher e mover:** quando falta algum campo, a tela abre um pop-up só com os campos que faltam; ao salvar, grava os valores e aplica a mudança de status. Cancelar deixa a tarefa onde estava.
- **Enquanto a tarefa está num status que exige o campo, ele não pode ser apagado.** Voltando para um status que não exige, pode.
- **Não é cumulativo:** se o campo precisa continuar preenchido nos status seguintes, marque-os também (ex.: Análise, Desenvolvimento e Homologação).
- **Configuração nova vale na próxima alteração:** tarefas que já estavam num status quando a exigência foi criada passam a precisar do campo na próxima vez que forem salvas nesse status.
- Status excluído sai automaticamente da lista do campo.
- A **pré-visualização** do tipo tem "Validar como no status", que mostra (com *) o que é exigido em cada status; o formulário da tarefa marca os obrigatórios conforme o status escolhido.
- A criação rápida do Kanban leva ao formulário completo quando a coluna exige campos sem valor padrão.
- O histórico do tipo registra onde cada campo é exigido (ex.: "Parecer do analista (Análise, Desenvolvimento)").

## 11. Tipos de tarefa traduzidos

- O **nome e a descrição** de cada tipo de tarefa podem ter tradução para **inglês** e **espanhol** (Configurações → Tipos de tarefa → Editar → Traduções).
- O texto principal do tipo é o **original em português** e continua editável como sempre. As traduções são opcionais: **em branco, a tela mostra o original**.
- Ao trocar o idioma, os tipos aparecem traduzidos **em todo o sistema** — configurações, formulários e filtros, listas de tarefas, Kanban, Planejamento, detalhe da tarefa e relatórios (inclusive o recorte por tipo e a definição de "bug").
- Os **8 tipos padrão** já vêm traduzidos (ex.: Documentação → Documentation / Documentación; Bug → Bug / Error). Se a empresa tinha alterado o nome ou a descrição de um tipo padrão, aquele texto não recebe a tradução pronta — fica para preencher.
- **Não são traduzidos:** títulos, descrições e comentários das tarefas (texto escrito pelas pessoas) e o **histórico**, que guarda o nome do tipo como era no momento (em português).
- Alterar as traduções de um tipo fica registrado no histórico do tipo.

## 12. Timeline do projeto (expansão — Onda 1)

> Desde 2026-10-01 (pedido do usuário) a Timeline das tarefas fica só no menu **Timeline**; a página do projeto não tem mais essa aba — o cronograma do projeto é o **Cronograma** da Gestão de projetos (§14, item do menu). Links antigos (`?tab=timeline`) abrem o Cronograma.

### Datas da tarefa
- Além do **Prazo**, a tarefa tem **Início planejado**. O início não pode ser depois do prazo (no mesmo dia pode). Vale ao criar, editar e mover na timeline — inclusive quando só uma das datas muda (a outra, já salva, é considerada).
- Na timeline, a tarefa ocupa **do início ao prazo** (dias inteiros). Com só uma das datas, aparece como uma barra de um dia. Sem nenhuma, fica na lista **Sem datas**.

### O que a timeline mostra
- Todas as tarefas do projeto (até 2.000; acima disso, as primeiras pela numeração, com aviso), agrupadas por **sprint** (padrão), responsável, status, tipo ou sem grupos; grupos recolhíveis.
- A barra tem a cor do **status**, mostra o **progresso** (subtarefas; sem subtarefas, o checklist) e ganha contorno vermelho quando está **atrasada** (aberta com prazo antes de hoje).
- **Dependências** ("bloqueia" e "depende de") viram setas de quem vem antes para quem vem depois. **Conflito** = a tarefa começa antes do prazo da tarefa de que depende (começar no mesmo dia do prazo é permitido): a seta fica vermelha tracejada e a barra ganha um alerta. É só um aviso — nada é reprogramado sozinho.
- **Sprints** com datas aparecem como faixas no topo; **marcos**, como losangos com linha tracejada; **hoje**, como linha e destaque na régua. Escalas: dias, semanas (padrão), meses e trimestres; a escolha, o agrupamento e "Ocultar encerradas" ficam lembrados.
- Filtros e busca iguais aos do Kanban (responsável, tipo, prioridade, sprint, tag).

### Mudar datas na timeline
- **Arrastar a barra** move início e prazo juntos; **puxar a ponta esquerda** muda só o início; **a direita**, só o prazo (uma ponta não passa da outra).
- **Teclado:** com a barra focada, setas movem um dia; Shift + setas mudam o prazo; Alt + setas mudam o início; Enter abre a tarefa. A gravação acontece após uma breve pausa.
- **Tarefa sem datas:** arraste da lista "Sem datas" para o dia desejado — ela começa nesse dia e dura pela **estimativa** (8 horas por dia; mínimo 1 dia). Ou use **Datas** para escolher início e prazo.
- Quem move: quem pode **editar a tarefa** (leitor só consulta). Cada mudança vai para o histórico da tarefa.
- Clicar na barra abre o painel da tarefa.

### Marcos
- Entregas-chave do projeto: **nome, data, descrição e situação** (pendente ou atingido).
- Criar, editar e excluir: **gestor ou dono** do projeto (mesma regra das sprints; projeto arquivado não aceita). Todos que veem o projeto veem os marcos.
- Tudo fica no **histórico do projeto** ("Marco criado/alterado/excluído").

## 13. Documentação (expansão — Onda 2)

### Espaços
- Um **espaço** reúne as páginas de um assunto, área ou projeto: nome, **chave** (2 a 10 letras/números, começando por letra, única; não muda depois), descrição, ícone e cor.
- **Quem lê:** toda a empresa (qualquer pessoa com permissão de ler documentação) ou **só os membros de um projeto**. Um espaço só de membros precisa estar ligado a um projeto; o projeto é escolhido na criação e não muda.
- Criar e configurar espaço: quem tem a permissão de **gerenciar documentação**; num espaço de projeto, também é preciso ser **gestor ou dono** do projeto. Excluir o espaço apaga as páginas, as versões e os arquivos (com confirmação).
- Todo espaço nasce com a **página inicial** já publicada (título = nome do espaço; conteúdo = a descrição). A página inicial não pode ser movida nem excluída e fica sempre no topo da árvore.

### Páginas e árvore
- A árvore e as ações do espaço (configurar, "Nova página") ficam na **coluna do espaço**, à esquerda, separada da página. Como o menu principal, ela se **recolhe** numa faixa de ícones pelo botão **Recolher painel** (rodapé da coluna) e volta pelo mesmo lugar (**Expandir painel**); a escolha fica lembrada. No celular não há coluna: o botão **Páginas do espaço**, no topo da página, abre o mesmo conteúdo num painel lateral.
- As páginas formam uma **árvore** de até **8 níveis** (página → subpáginas). Não é permitido colocar uma página dentro de uma subpágina dela mesma.
- **Mover:** arrastando na árvore (parte de cima da linha = antes; de baixo = depois; meio = vira subpágina) ou pelo menu **Mover…**, que coloca a página no fim das subpáginas da nova página-mãe. Destinos proibidos nem acendem.
- **Excluir** uma página exclui também as subpáginas, as versões e os arquivos delas; a confirmação diz quantas subpáginas vão junto.
- Criar, editar, mover e excluir páginas: quem tem a permissão de **editar documentação** (num espaço de projeto, quem **colabora** no projeto — leitor do projeto só lê).

### Rascunho e publicação
- Página nova nasce como **rascunho**: só quem edita a vê (na árvore aparece em itálico, com marcador). Leitores só enxergam páginas publicadas — uma página invisível responde "não encontrada".
- Enquanto se edita, o **rascunho é salvo sozinho** pouco depois de parar de digitar ("Rascunho salvo às…"). O rascunho é **um só por página** e compartilhado entre quem edita; se outra pessoa mexeu por último, o editor avisa.
- **Publicar** grava o conteúdo como a **próxima versão** (1, 2, 3…) e é o que os leitores veem. Numa página já publicada, **descartar o rascunho** volta para a versão publicada.
- **Histórico de versões:** cada versão guarda título, conteúdo, autor e data. **Restaurar** uma versão publica o conteúdo dela como a próxima versão (nada do histórico se perde).
- O histórico de auditoria registra criação, publicação, movimentação, exclusão e restauração de páginas e as mudanças dos espaços; salvar rascunho não gera histórico.

### Conteúdo
- Editor visual com barra de ferramentas e atalho **"/"**: títulos (4 níveis), negrito, itálico, sublinhado, tachado, marca-texto, código, links, listas, lista de verificação, citação, bloco de código, **avisos** (informação, sucesso, atenção, perigo), **tabelas** (linhas/colunas, cabeçalho, mesclar), **imagens** (enviar, colar ou arrastar; largura 25/50/75/100%), **arquivos** (viram link para download), divisor e **sumário**. A leitura mostra também "Nesta página" com os títulos.
- **Sumário:** não tem texto próprio — lista sozinho os **títulos** da página (Título 1 a 4), na ordem e com recuo por nível, e se atualiza a cada edição; clicar num item rola até o título. Texto comum não entra. Sem nenhum título, na edição o bloco explica como criar um (seletor "Texto" da barra, "/" ou começar a linha com `##` e espaço) e oferece **Adicionar título** (cria um Título 2 logo abaixo); na leitura, um sumário sem títulos não aparece.
- **Segurança:** o servidor limpa tudo o que chega — só os blocos e formatações acima, **links** apenas http(s), e-mail ou páginas da documentação, **imagens** apenas de arquivos enviados à própria documentação. Nunca há HTML livre.
- **Arquivos:** até 10 por envio e 20 MB cada; o tipo é conferido pelo conteúdo (um arquivo que finge ser imagem é recusado). Quem vê a página vê os arquivos dela; imagens abrem no navegador, os demais baixam.

### Busca e recentes
- A busca procura no **título e no conteúdo publicado** dos espaços que a pessoa lê, **sem diferenciar acentos nem maiúsculas** (2 a 100 caracteres; até 30 resultados), mostrando um trecho com o termo destacado.
- "Atualizadas recentemente" lista as 10 últimas publicações dos espaços visíveis.

## 14. Quadro de gerenciamento do projeto (Gerenciamento de Projetos — fase GP-1)

> Diretriz própria: [diretriz_feature_gerenciamento_projetos.md](diretriz_feature_gerenciamento_projetos.md). O quadro fica em **Gestão de projetos**, item próprio do menu lateral (`/project-management/:projeto`, com o seletor de projeto e lembrando o último aberto), no estilo Monday — à parte das tarefas, para ficar clara a diferença (desde 2026-10-01; antes era a aba "Gerenciamento" do projeto, e os links antigos `?tab=plan` levam para lá). A visão geral do projeto tem o atalho "Abrir a gestão do projeto".

### Módulo à parte das tarefas
- O quadro organiza a **gestão do projeto** — fases e atividades como reuniões, alinhamentos, entregas e aprovações — com **status, recursos, cronograma, esforço, duração e progresso próprios**.
- **Não tem vínculo com as tarefas**: a aba **Tarefas** do projeto continua sendo a lista de tarefas; nada do quadro muda tarefas, Kanban, Planejamento ou relatórios, e vice-versa.

### Grupos
- O quadro se organiza em **grupos** (fases) com nome e cor, em até **2 níveis**: grupo (1.0, 2.0…) e subgrupo (2.1, 2.2…). A **numeração é automática**, pela ordem. O subgrupo aparece com o título do pai: "2.0 Planejamento | 2.1 Plano do Projeto".
- Uma fase que só tem subgrupos (sem elementos próprios) aparece como um cabeçalho, com o menu dela; os subgrupos vêm logo abaixo.
- Criar, renomear, mudar a cor, adicionar subgrupo, reordenar (**Mover para cima/baixo**), **duplicar** e excluir grupos: **gestor ou dono** do projeto.
- **Duplicar** cria a cópia logo depois do original ("(cópia)" no nome), com os subgrupos, elementos e subelementos, com os mesmos valores.
- **Excluir** um grupo apaga ele, os subgrupos e os elementos deles; a confirmação diz quantos subgrupos e elementos saem. O histórico fica registrado.
- **Recolher** um grupo mostra uma linha de resumo com os totais alinhados às colunas; recolher a fase recolhe os subgrupos. **Expandir tudo / Recolher tudo** na barra. O que ficou recolhido é lembrado (por pessoa, no navegador).

### Elementos e subelementos
- **Elemento** = uma linha do grupo (ex.: "Reunião de kickoff"). Criar pela linha **+ Adicionar elemento** (Enter cria e já deixa pronto para o próximo) ou pelo botão **Criar elemento** (entra no primeiro grupo com o nome em edição). Novos elementos entram no fim do grupo.
- **Subelemento** = item dentro do elemento, **um nível só**, na subtabela que abre pela seta ao lado do nome (com a quantidade) ou por **Adicionar subelemento** no menu do elemento. Subelemento fica sempre no grupo do elemento.
- **Mover para outro grupo…** (menu do elemento) leva o elemento para o fim do grupo escolhido, com os subelementos.
- **Excluir** o elemento apaga também os subelementos (a confirmação diz quantos).
- **Tudo se edita direto na célula**: nome (clicar, Enter/sair confirma, Esc cancela), status, cronograma, recursos e números. Sem permissão, as células só mostram.

### Colunas
| Coluna | Elemento | Subelemento |
|---|---|---|
| Nome | Elemento | Subelemento |
| Status | etiqueta (bloco colorido) | etiqueta |
| Cronograma | intervalo de datas (1º clique = início, 2º = fim; "N dias selecionados") | intervalo |
| Recursos | etiquetas de recurso (várias) | — |
| Responsável | — | pessoa do projeto |
| Data | — | uma data |
| Esforço estimado / Trabalho (h) | horas (até 2 casas; vírgula ou ponto) | horas |
| Realizado (h) | — | horas |
| Duração | dias | — |
| Progresso | barra 0–100% | barra 0–100% |

- Cada coluna tem um menu (**…** no cabeçalho): **ordenar** crescente/decrescente (vazios sempre no fim), **recolher**, **ocultar** e **mover** para a esquerda/direita. Dá para **arrastar o cabeçalho** para reordenar e **redimensionar** pela borda (ou setas no teclado). Tudo vale para todos os grupos e fica lembrado por pessoa; **Colunas** mostra de volta as ocultas e restaura o padrão.
- A coluna do nome fica fixa ao rolar para o lado (em telas médias e maiores); o quadro ocupa a largura toda.
- A busca procura no nome (sem acento/maiúsculas): mostra o elemento que casa com todos os subelementos, ou o elemento com os subelementos que casam (já aberto).

### Etiquetas de status
- Cada projeto tem as **suas** etiquetas de status do quadro (não são os status das tarefas). Um projeto novo começa com: Planejado, Em progresso, Confirmar, Parado e Feito (no idioma de quem abre o quadro pela primeira vez).
- Cada etiqueta tem nome, cor e **categoria** (A fazer, Em andamento, Em revisão, Bloqueado, Concluído, Cancelado). A categoria define os cálculos: **Concluído conta 100%** e **Cancelado não entra** no progresso.
- **Editar etiquetas** (no seletor de status ou em **… → Etiquetas de status**): **gestor ou dono**. Excluir uma etiqueta deixa **em branco** os elementos que a usavam (a confirmação diz quantos).

### Etiquetas de recurso
- Recursos são **papéis ou pessoas** envolvidas (ex.: Gerente de Projetos, Cliente, Consultor), próprios do projeto; o elemento pode ter até **20**.
- No seletor: **Criar ou localizar etiquetas** — digitar filtra; se não existir, **Criar "…"**. O nome não se repete no projeto (sem diferenciar acentos/maiúsculas).
- Criar e renomear/mudar a cor: quem edita o quadro. **Excluir**: gestor ou dono — a etiqueta sai de todos os elementos.

### Duração e cronograma
- Com cronograma, a **duração** é calculada: dias corridos do início ao fim, contando os dois (uma data só = 1 dia); a célula mostra "Calculada pelo cronograma".
- Sem cronograma, a duração pode ser **informada** (0 a 3.650 dias). O fim não pode ser antes do início.

### Progresso
- Etiqueta da categoria **Concluído = 100%**.
- Elemento **com subelementos** (não cancelados): **Σ(trabalho × progresso) / Σ(trabalho)** dos subelementos; se nenhum tiver trabalho, a **média**.
- Sem subelementos: o progresso **informado** (0 a 100, clicando na barra); sem ele, 0%. Progresso calculado (por subelementos ou concluído) não se digita — passar o mouse mostra de onde veio.

### Totais do grupo (rodapé)
Sobre os elementos do grupo (sem subelementos): **barra de distribuição dos status**, **período** (menor início → maior fim), **soma do esforço estimado**, **soma das durações** e **progresso** ponderado pelo esforço (sem esforço, a média; cancelados fora). Os mesmos totais aparecem no grupo recolhido.

### Permissões
| Ação | Quem |
|---|---|
| Ver o quadro | quem vê o projeto (inclusive leitor) + `plan.view` |
| Criar/editar/mover/excluir elementos e subelementos; criar e editar etiquetas de recurso | dono, gestor ou membro do projeto + `plan.edit` |
| Grupos (inclusive arrastar); etiquetas de status; excluir etiqueta de recurso; regra de dependências; criar grupos e status na importação | gestor ou dono + `plan.manage` |
| Publicar e responder atualizações | quem vê o quadro (inclusive leitor) |
| Editar atualização | o autor |
| Excluir atualização ou arquivo de outra pessoa | gestor ou dono + `plan.manage` (a sua: quem publicou/enviou) |
| Colar/anexar imagem ou arquivo | quem publica a atualização (inclusive leitor); depois, só o autor |
| Ver Cronograma, Kanban, Gestão e Relatórios | quem vê o quadro (inclusive leitor) |
| Mudar datas no Cronograma e status no Kanban; registrar no diário; abrir e atualizar problemas | dono, gestor ou membro do projeto + `plan.edit` |
| Editar/excluir registro do diário de outra pessoa; excluir problema aberto por outra pessoa; salvar ou limpar a linha de base | gestor ou dono + `plan.manage` (o seu registro/problema: quem criou) |
| Adicionar, renomear, duplicar, alterar o tipo e excluir colunas personalizadas | gestor ou dono + `plan.manage` |
| Preencher as colunas personalizadas | dono, gestor ou membro do projeto + `plan.edit` |
| Projeto arquivado | somente leitura |

### Histórico
- Elementos: criação, cada mudança (nome, grupo, status, datas, responsável, recursos, esforço, realizado, duração, progresso), dependências, atualizações (publicada, editada, excluída), arquivos (enviado, excluído) e exclusão, com os nomes legíveis (não ids). Aparece na aba Histórico do painel do elemento.
- Grupos e etiquetas: no histórico do projeto.

### Arrastar e soltar (GP-2)
- Pela alça (⋮⋮, ao passar o mouse): **elementos** reordenam no grupo e vão para **outro grupo** (com os subelementos; grupo vazio também recebe); **subelementos** reordenam só dentro do próprio elemento; **grupos** reordenam pelo título — a fase leva os subgrupos junto e os subgrupos reordenam dentro da fase. Aviso "Elemento movido." / "Grupo movido.".
- Durante o arraste o destino abre espaço; operação inválida (subelemento para outro elemento, subgrupo para outra fase) não acontece. Teclado: espaço/Enter pega e solta, setas movem, Esc cancela; também há **Mover para cima/baixo** e **Mover para outro grupo…** no menu do elemento.
- O arraste fica desligado com ordenação, busca, filtro ou agrupamento diferente de "Grupo" (a ordem da tela não é a do quadro). Reordenar não gera histórico; mudar de grupo gera.

### Busca, pessoa, filtros, ordenação e agrupamento (GP-2)
- **Filtro** (combinável; o botão mostra "Filtros (N)"): status (inclusive em branco), recursos (inclusive sem recurso), grupo (a fase inclui os subgrupos), período do cronograma (elementos cujo cronograma cruza o período), progresso (não iniciado 0% · em andamento 1–99% · concluído 100%), só atrasados (fim do cronograma já passou e não está concluído/cancelado) e dependências (com dependência pendente · com dependências). Campos diferentes somam (E); valores do mesmo campo alternam (OU). **Filtrar** no menu da coluna abre o filtro já na parte dela.
- **Pessoa**: mostra só os elementos com subelementos de quem é responsável — e só esses subelementos, com a subtabela aberta.
- Com busca/filtro, grupos sem resultado somem e os **totais do rodapé passam a ser os dos elementos visíveis** (mesma fórmula). "Nenhum elemento corresponde aos filtros selecionados." + limpar.
- **Ordenar** (barra ou menu da coluna) vale dentro de cada grupo; vazios sempre no fim.
- **Agrupar por** (independente dos filtros, lembrado por pessoa): grupo (padrão), status (na ordem das etiquetas; em branco no fim), recurso (o elemento aparece em cada recurso; sem recurso no fim) ou cronograma por mês (sem cronograma no fim). Nos agrupamentos não há ações de grupo, linha de adicionar nem arraste; os totais são os da seção.

### Seleção em massa (GP-2)
- A caixa de cada elemento (e "marcar todos" no cabeçalho do grupo) abre a barra **"N selecionados"**: mudar o **status**, **acrescentar ou tirar** um recurso de todos, **mover** para um grupo, **duplicar** e **excluir** (com confirmação e a contagem de subelementos). Até 200 por vez.
- **Tudo ou nada**: se um elemento não puder receber a ação (ex.: regra de dependência), nenhum muda. Cada elemento alterado ganha o próprio registro no histórico.

### Duplicar (GP-2)
- Elemento ou subelemento: a cópia ("(cópia)") entra **logo depois do original**, com os mesmos valores e, no elemento, os subelementos. As dependências não são copiadas.

### Dependências (GP-2)
- Coluna **Dependência**: um elemento **depende de** outro (o outro o **bloqueia**) ou é **relacionado** a ele. "A depende de B" e "B bloqueia A" são a mesma ligação vista dos dois lados. Não vale ligar a ele mesmo, repetir a ligação nem fechar um **ciclo** de bloqueio.
- **Dependência pendente** = depende de elemento ainda aberto (nem concluído nem cancelado): a célula fica destacada com ⚠.
- **Regra do quadro** (gestor ou dono; ... → Regra de dependências): **só sinalizar** (padrão — mostra o aviso, deixa mudar o status) ou **impedir iniciar ou concluir** — levar o elemento para uma etiqueta Em andamento/Em revisão (vindo de A fazer/Bloqueado/em branco) ou Concluído fica bloqueado com *"Este elemento possui uma dependência pendente."*; o status volta ao anterior. Mudar para Bloqueado ou Cancelado continua livre.
- Excluir um elemento desfaz as ligações dele. Criar e desfazer ligações: quem edita o quadro; ficam no histórico do elemento.

### Importar elementos (GP-2)
- **Criar elemento ▾ → Importar elementos**: planilha **CSV** (no Excel: Salvar como → CSV; ponto e vírgula ou vírgula), até 500 linhas. Há uma **planilha modelo** para baixar, no idioma de quem usa.
- Uma linha por elemento; com **Subelemento** preenchido, a linha é subelemento do **Elemento** da mesma linha (no mesmo grupo — da planilha ou já existente). Colunas reconhecidas pelo nome nos três idiomas (Grupo, Elemento, Subelemento, Status, Início, Fim, Recursos, Esforço estimado, Realizado, Duração, Progresso); dá para trocar o que cada coluna preenche ou ignorá-la.
- Datas no formato do idioma (dd/mm/aaaa; mm/dd/aaaa em inglês) ou AAAA-MM-DD; números com vírgula ou ponto ("2 h", "50%").
- Grupo, status e recursos pelo **nome** (sem diferenciar acentos/maiúsculas; o grupo também pelo título numerado "1.0 Iniciação"). O que não existe é **criado** — grupos e etiquetas de status só pelo gestor/dono; recursos por quem edita.
- **Tudo ou nada**: a tela aponta **linha e coluna** de cada problema e só importa quando não há nenhum. Um registro no histórico do projeto com as quantidades criadas.

### Painel do elemento (GP-3)
- O ícone de conversa ao lado do nome (elemento ou subelemento) abre o **painel lateral** sem sair do quadro, com as abas **Atualizações**, **Histórico** e **Detalhes**. O ícone mostra o **contador** de atualizações (as excluídas não contam). O endereço guarda o elemento aberto (`?item=…&panel=…`): dá para compartilhar o link, e as notificações abrem direto nele.
- **Atualizações**: texto com **negrito**, *itálico*, listas e links; **@menção** de quem participa do projeto (a pessoa é **notificada**). A conversa mostra as principais da mais nova para a mais antiga, cada uma com as **respostas** (um nível, em ordem de chegada); responder avisa o autor da principal. Quem vê o quadro publica e responde — inclusive o leitor, como nos comentários das tarefas. O **autor edita** a sua (menção nova também notifica); o **autor ou o gestor exclui** — a atualização fica como "removida" (autor e data) e as respostas continuam.
- **Imagens e arquivos na própria atualização** (não há aba Arquivos): na nova atualização ou na resposta, **cole** um print (Ctrl+V), **arraste** para o campo ou use **Anexar**. Antes de publicar aparecem em miniatura (imagens) ou pelo nome, e cada um sai pelo X. A imagem colada ganha um nome legível ("imagem-colada-20260930-140509.png"). Com imagem/arquivo, o **texto pode ficar vazio**.
  - Até 10 por vez, 20 MB cada e 50 MB no total; o tipo é conferido pelo conteúdo (como nos anexos das tarefas); fotos grandes são reduzidas antes do envio. O texto e os arquivos são gravados juntos: se um arquivo for recusado, nada é publicado.
  - Quem publica anexa (inclusive o leitor, na sua atualização); o autor também anexa depois, ao editar. Imagens abrem no visualizador; documentos baixam. O autor ou o gestor exclui o arquivo; excluir a atualização apaga os arquivos dela. Quem vê o quadro baixa.
  - Texto copiado continua colando como texto (o Excel manda junto uma imagem da seleção, que é ignorada).
  - Nos **comentários das tarefas** também dá para colar e arrastar imagens (lá o texto continua obrigatório).
- **Histórico**: tudo o que mudou no elemento — campos, dependências, atualizações e arquivos —, com quem e quando.
- **Detalhes**: resumo dos campos (status, cronograma, recursos ou responsável/data, esforço, duração, progresso, subelementos e dependências). A edição continua nas células do quadro.
- Projeto arquivado: o painel fica só para leitura.

### Visões do quadro (GP-4)
A Gestão de projetos tem as visões **Quadro principal · Cronograma · Kanban · Gestão · Relatórios** (a escolhida fica no endereço, `?view=`). Todas leem os mesmos elementos: mudar o status no Kanban ou as datas no Cronograma é mudar o elemento do quadro. O painel do elemento abre de qualquer visão.

**Cronograma**
- Gantt dos elementos (não dos subelementos) por grupo, na ordem do quadro; subgrupo com o título da fase ("2.0 Planejamento | 2.1 Plano do Projeto"); o cabeçalho do grupo mostra o período dele. Barra na cor do grupo, com o progresso; atrasado (fim antes de hoje e não encerrado) fica destacado; seta das dependências "bloqueia", tracejada quando o elemento começa antes do fim do que o bloqueia.
- Escala dias, semanas, meses ou trimestres (lembrada por pessoa), linha de hoje, botão **Hoje** e **Ajustar** (escolhe a escala mais detalhada em que o período inteiro cabe na tela).
- Arrastar a barra muda o cronograma; puxar a ponta muda início ou fim; pelo teclado, setas (Shift = fim, Alt = início). Elemento sem datas aparece em **Sem cronograma**: arrastar para o dia ou "Hoje" agenda (dura pelo esforço estimado, 8 h por dia, mínimo 1 dia). Leitor só vê.
- **Linha de base**: o gestor salva a foto do cronograma atual dos elementos (substituir pede confirmação) e pode limpar. Com linha de base, um traço fino sob cada barra mostra o planejado (dá para ocultar) e o nome da barra diz quantos dias o fim andou ("fim 4 dias depois da linha de base").
- **Exportar**: planilha CSV (um elemento por linha, na ordem dos grupos) com grupo, elemento, status, início, fim, duração, esforço, progresso e linha de base; separador e datas no formato do idioma.
- Ao lado: **Bateria** (distribuição das etiquetas de status de todo o quadro e o % na categoria "feito", ex.: "79,7% Feito") e **Esforço estimado (h)** (soma do quadro).

**Kanban**
- Uma coluna por etiqueta de status, na ordem do quadro, com a quantidade ("Feito / 47"), e **Em branco** por último; os cards são os elementos (grupo, nome, cronograma, recursos, progresso e atualizações). Busca pelo nome.
- Arrastar o card para outra coluna (ou "Mover para…" no menu do card, pelo teclado) muda o status do elemento, com a regra de dependências do quadro (com "impedir", o card não sai e o aviso diz de quem depende). Clicar no card abre o painel. Leitor só vê.

**Gestão**
- **Diário do projeto**: registros datados (data + texto, até 5.000 caracteres), do dia mais recente para o mais antigo, com quem registrou. Quem edita o quadro registra; o autor ou o gestor edita e exclui.
- **Gestão dos problemas**: problemas numerados por projeto (#1, #2…; o número não é reaproveitado nem depois de excluir), com data, descrição (até 2.000), responsável (quem participa do projeto) e situação **Em andamento**, **Pendente** (padrão) ou **Resolvido**. Resolver guarda o dia (voltar para aberto limpa). Quem edita o quadro abre e atualiza (a situação muda direto na lista); quem abriu ou o gestor exclui. Problemas em aberto pesam na saúde do projeto.

**Relatórios** (sobre os elementos; cancelados ficam fora das contas; "hoje" no fuso de quem vê)
- **Resumo**: elementos, feitos, pendentes, atrasados, parados (etiqueta da categoria parado/bloqueado ou dependência pendente) e progresso (ponderado pelo esforço, como no rodapé).
- **Cronograma dos pendentes**: no prazo, atrasados e sem datas.
- **Esforço**: estimado, realizado (o do elemento ou, sem ele, a soma dos subelementos), restante (estimado − realizado, mínimo 0) e desvio dos feitos (realizado − estimado, em horas e %).
- **Recursos**: elementos (pendentes) e esforço de cada recurso — elemento com dois recursos conta nos dois; "Sem recurso" por último. **Grupos**: feitos/total, progresso, esforço estimado e realizado e atrasados.
- **Saúde do projeto**: o **pior** dos fatores com dados (Saudável, Atenção, Crítico), sempre mostrando cada fator e o seu valor:

| Fator | Valor | Saudável | Atenção | Crítico |
|---|---|---|---|---|
| Prazos | % dos pendentes com data que estão atrasados | 0% | até 20% | acima de 20% |
| Progresso × planejado | pontos de progresso abaixo do esperado pelo tempo decorrido de cada elemento (ponderado pelo esforço) | até 10 | até 25 | acima de 25 |
| Parados e bloqueados | % dos pendentes parados ou com dependência pendente | 0% | até 10% | acima de 10% |
| Esforço | % do realizado acima do estimado nos feitos | até 10% | até 25% | acima de 25% |
| Problemas em aberto | problemas não resolvidos na Gestão | 0 | 1–2 | 3 ou mais |

Fator sem dados (ex.: nenhum elemento com cronograma) aparece como "Sem dados" e não pesa.

### Colunas personalizadas (GP-5)
- O **gestor** do projeto adiciona colunas ao quadro principal — pelo **"+"** no fim do cabeçalho ou por **"Adicionar coluna à direita"** no menu de qualquer coluna — com nome (até 60) e tipo: **Texto** (até 500), **Número** (com unidade opcional, ex.: "R$"; soma no rodapé do grupo), **Data**, **Caixa de seleção**, **Lista de opções** (até 30 opções com nome e cor, como etiquetas), **Pessoa** (quem participa do projeto) e **Link** (só http/https; abre em outra aba). Até **30 colunas** por quadro.
- As colunas valem para todos os **elementos** do quadro (os subelementos têm as colunas próprias, fixas). Ordem, largura, ocultar e recolher continuam sendo preferência de cada pessoa, como nas colunas fixas; dá para ordenar o quadro pelas colunas personalizadas (menos Pessoa).
- **Quem edita o quadro** preenche as células (na própria célula, como as demais); o valor é conferido pelo tipo (número, data válida, opção que existe, pessoa do projeto, link http/https). Leitor só vê.
- No menu da coluna, o gestor: **renomeia** e edita as **opções** da lista (tirar uma opção limpa os elementos que a usavam — a tela avisa quantos); **duplica** (cópia logo depois, com os mesmos valores); **altera o tipo** — antes de confirmar, mostra quantos valores **convertem** e quantos **se perdem** (texto ↔ número, data e link quando o conteúdo permite; qualquer um → texto; para lista, os textos viram opções; pessoa → nome; caixa → só para caixa); **exclui** (pede confirmação com quantos elementos têm valor).
- Duplicar o elemento ou o grupo leva os valores; o histórico do elemento mostra as mudanças com o nome da coluna ("Custo: 1.200"), e o do projeto, as mudanças nas colunas.

### Próximas fases
As fases GP-1 a GP-5 da diretriz estão concluídas.

## 15. Configurador geral da plataforma

Tela **Configurações → Geral**, só para quem tem a permissão **Configurar a plataforma** (`platform.manage`; por padrão só o Admin — o Super Admin tem tudo). Um único "Salvar alterações" grava o que mudou; cada alteração fica no histórico de auditoria com o antes e o depois.

**Limites seguros** (valem na tela e no servidor): ninguém desliga uma proteção por engano. Enquanto ninguém muda, valem os padrões de sempre.

| Bloco | O que se configura | Limites | Padrão |
|---|---|---|---|
| Identidade | nome da plataforma; logo para tema claro e para tema escuro; ícone da aba do navegador | nome até 40 caracteres; imagens PNG, JPG, WebP ou SVG (ícone também ICO), até 1 MB | "BLYD Sync" e os logos padrão (claro, escuro e ícone do navegador) |
| Senhas | tamanho mínimo; exigir maiúsculas e minúsculas; exigir um símbolo | mínimo de 8 a 64; **letras e números são sempre exigidos** | 10 caracteres, letras e números |
| Bloqueio de login | tentativas erradas antes do bloqueio; tempo inicial; tempo máximo | 3 a 20 tentativas; 1 a 60 min; máximo de 1 a 1.440 min e nunca menor que o inicial | 5 tentativas, 5 min, até 60 min |
| Retenção do histórico | por quanto tempo o histórico de auditoria fica guardado | 1, 3, 6, 12 ou 24 meses, ou "Manter sempre" | 3 meses |

- **Identidade:** nome, logo e ícone aparecem no menu, na tela de login, no título e no ícone da aba. São **públicos** (a tela de login precisa deles); o resto das configurações só quem tem a permissão vê. Sem logo do tema escuro, usa-se o do claro; sem nenhum, a marca padrão. O tipo da imagem é conferido pelo conteúdo; SVG com script, eventos, conteúdo externo ou entidades é recusado. Remover a imagem volta à marca padrão.
- **Senhas:** a política vale para senhas **criadas ou trocadas** a partir da mudança (as atuais continuam valendo). As telas de troca de senha, novo usuário e redefinição mostram as exigências vigentes ("Mínimo de 12 caracteres, com letras e números e um símbolo").
- **Bloqueio de login:** depois de N tentativas erradas a conta fica bloqueada pelo tempo inicial; a cada nova série de N o tempo dobra, até o máximo (regra de §9). Vale na próxima tentativa.
- **Retenção:** a limpeza roda **sozinha todo dia de madrugada** e apaga do histórico o que passou do prazo; a própria limpeza fica registrada (quantos registros saíram e a data de corte), sem dados sensíveis. **Encurtar o prazo pede confirmação** mostrando quantos registros ficam fora do novo prazo. "Limpar agora" aplica a mesma regra na hora (e fica registrado com quem pediu). "Manter sempre" desliga a limpeza.

## 16. E-mail: recuperar senha, convites e notificações

Configurado em **Configurações → Integrações → E-mail** por quem tem **Configurar integrações** (`integrations.manage`; por padrão só o Admin). Desligado (padrão), nada é enviado e as funções abaixo não aparecem.

- **Servidor:** endereço e porta do SMTP, TLS direto (porta 465) ou STARTTLS quando o servidor oferece, usuário e senha, nome e e-mail do remetente e o **endereço da plataforma** — usado nos links (nunca o endereço que veio na requisição). Ligar exige servidor, remetente e endereço. A senha nunca volta para a tela nem para o histórico; em branco mantém a salva, "Remover senha salva" apaga. **Enviar e-mail de teste** manda na hora para quem pediu e mostra o motivo quando o servidor recusa.
- **Fila:** tudo que a plataforma envia entra numa fila, na mesma operação que gerou o e-mail; uma rotina **a cada minuto** envia. Falha tenta de novo em 1, 5, 15 e 60 minutos; depois da 5ª, fica como falha. Depois de enviado (ou desistido), o corpo do e-mail é apagado — links de senha não ficam guardados. A tela mostra a fila (na fila, enviados, com falha, último erro) e "Enviar agora".
- **Esqueci minha senha:** o login **sempre** mostra o botão. **Sem o envio de e-mail ligado**, não há link a pedir: o botão abre, ali mesmo, o aviso **"Contate o administrador para trocar a senha"** (o Admin redefine em Usuários); a página do pedido aberta direto pelo endereço mostra o mesmo aviso, sem formulário. **Com o envio ligado**, leva ao pedido do link: a pessoa informa o e-mail e a resposta é **sempre a mesma** (não revela se há conta). Para conta ativa sai um link que **vale 60 minutos e uma única vez**; pedir de novo invalida o anterior; no máximo **3 pedidos por hora** por conta. A nova senha segue a política vigente (§15), **encerra todas as sessões** da pessoa e libera um eventual bloqueio de login.
- **Convite:** ao criar um usuário com o envio ligado, "Enviar convite por e-mail" já vem marcado e dispensa a senha — a pessoa recebe um link que **vale 7 dias** para criar a dela. "Reenviar convite" (na lista de usuários) existe enquanto a pessoa não entrou; reenviar invalida o link anterior.
- **Notificações por e-mail:** cada notificação (menção, atribuição, comentário, mudança de status, prazo, menção e resposta no quadro da Gestão) também vai por e-mail, no idioma da pessoa e com o link para o item. Cada pessoa liga ou desliga em **Minha conta** (padrão: ligadas).
- Tudo fica no histórico: alteração das configurações (sem a senha), e-mail de teste, pedido e uso do link, convite e aceite.

## 17. Tokens de API

Em **Minha conta → Tokens de API**, quem tem **Criar tokens de API próprios** (`api_tokens.create`; por padrão Admin e Gestor) cria tokens para scripts e integrações usarem a API sem o navegador.

- **Criar:** nome (até 80) e prazo — 30, 90 ou 365 dias, ou sem prazo. O valor (`kb_pat_…`) aparece **uma única vez**, com cópia e um exemplo de uso; depois a lista mostra só o início, a situação (ativo, vencido, revogado), o último uso e o prazo. No máximo 20 tokens ativos por pessoa.
- **Usar:** `Authorization: Bearer kb_pat_…`. O token age como a pessoa, com as **permissões do perfil dela no momento de cada chamada** (mudou o perfil, mudou o que o token pode). Para de valer se vencer, for revogado ou a pessoa for **desativada**.
- **Limites:** com um token não dá para criar ou revogar tokens, trocar a senha, sair ou encerrar sessões — isso só no navegador.
- **Revogar:** a própria pessoa (em Minha conta) ou quem tem **Configurar integrações** (Configurações → Integrações → Tokens de API, que mostra os tokens de todos — ex.: de quem saiu da empresa). Revogar vale na hora e fica no histórico; criar também.

## 18. Webhooks

Em **Configurações → Integrações → Webhooks**, quem tem **Configurar integrações** cadastra endereços de outros sistemas que recebem um aviso quando algo acontece.

- **Cadastro:** nome, endereço que recebe e eventos. O endereço precisa ser **https** (em desenvolvimento/teste, ou liberado de propósito na instalação, aceita http e a própria máquina); endereços de **metadados da nuvem** e link-local são sempre recusados; usuário/senha no endereço não. Os eventos vêm de um **catálogo público** (projetos, tarefas, comentários, anexos, sprints, marcos, elementos do quadro, páginas de documentação, usuários) — por evento ou o grupo inteiro ("Tudo de Tarefas"). Ações fora do catálogo (ex.: login) nunca são enviadas.
- **Envio:** cada ação do catálogo gravada no histórico vira uma entrega para cada webhook ativo que a assina, na mesma operação; uma rotina **a cada minuto** envia um `POST` JSON com `id`, `event`, `occurred_at`, `actor`, `entity`, `data` (o novo) e `previous` (o anterior), e os cabeçalhos `X-Kamban-Event`, `X-Kamban-Delivery`, `X-Kamban-Timestamp` e `X-Kamban-Signature: sha256=<HMAC-SHA256 de "timestamp.corpo" com o segredo>`. Resposta 2xx em até 10 segundos é sucesso.
- **Falhas:** nova tentativa em 1, 5, 30, 120 e 720 minutos; na 6ª falha a entrega fica como falha. **20 tentativas seguidas com falha desligam o webhook** (fica no histórico); religar zera a contagem. Webhook desligado não recebe entregas novas.
- **Segredo:** gerado na criação e mostrado **uma única vez**; "Gerar novo segredo" troca na hora (o antigo deixa de valer). Nunca aparece na lista nem no histórico.
- **Acompanhar:** a lista mostra a situação, as falhas seguidas e a última entrega; "Enviar teste" manda um `webhook.ping` na hora e mostra o resultado; "Visualizar" abre as 50 entregas mais recentes, com a resposta e "Reenviar". Entregas encerradas saem depois de 30 dias.

## 19. Tempo real

Telas abertas se atualizam sozinhas quando alguém muda algo — sem recarregar a página.

- **O que atualiza:** Kanban, Planejamento (backlog e sprints), Timeline, o quadro da Gestão de projetos (todas as visões, painel do elemento, diário e problemas), a página do projeto e a página da tarefa (detalhes, comentários, anexos, relações e histórico); o sino de notificações de cada pessoa.
- **Quem recebe:** só quem pode ver o projeto (membro, dono ou quem vê todos os projetos), e cada pessoa só as próprias notificações. O aviso leva apenas o tipo do que mudou e os identificadores; a tela busca os dados de novo pela API, com as permissões de sempre — nada que a pessoa não poderia ver chega por esse caminho.
- **Quando:** logo depois que a mudança é gravada (de qualquer origem: tela, API com token, importação, rotinas). Vários avisos juntos (ex.: mover um grupo inteiro) viram uma única atualização; com muita gente mexendo ao mesmo tempo, cada tela se atualiza **no máximo uma vez a cada 2,5 s** (a primeira mudança depois de um tempo quieto aparece na hora). Se a própria pessoa estiver salvando algo naquele momento (ex.: soltando um cartão), a atualização espera o salvamento terminar — assim nada "volta" para o estado de antes.
- **Conexão:** uma por aba, aberta quando alguma tela precisa e fechada pouco depois de não precisar. Se cair, a tela continua funcionando e o cabeçalho mostra "Reconectando…" até voltar; ao voltar, as assinaturas são refeitas e a tela busca de novo o que está aberta (os avisos do intervalo se perderam).
- **Consulta periódica:** com o tempo real ligado, o Kanban e o sino só conferem a cada 5 minutos (rede de segurança); sem ele, voltam a conferir a cada 15 s (Kanban) e 30 s (sino).

## 20. Informe do projeto

Página do projeto → aba **Informe**: monta o informe do projeto com os dados da plataforma e baixa em PDF.

- **Quais tarefas entram:** toda tarefa entra por padrão (também as que já existiam). Na aba **Tarefas** do projeto, o botão de informe de cada linha (antes do "Visualizar") tira ou devolve a tarefa; a coluna/filtro **No informe** mostra quais estão fora. Pode mudar quem edita a tarefa; não exige os campos obrigatórios do status e fica no histórico da tarefa ("No informe: Sim → Não").
- **O que o informe mostra:** capa (projeto, início, data de corte e equipe = responsáveis das tarefas do informe), resumo com indicadores (dias corridos e úteis, tarefas concluídas, marcos alcançados, fases encerradas) e cronograma, avanço por fase, marcos, linha do tempo dia a dia (Diário, marcos e tarefas pela data do fato — mesma regra do Histórico), tarefas por situação e próximos passos (marcos pendentes e tarefas abertas pelo prazo). Cada seção pode ser desligada; a numeração acompanha.
- **Fases:** elementos de primeiro nível de um grupo da Gestão de projetos (e dos subgrupos dele), com a etiqueta de status e o progresso do quadro; sem escolha, o primeiro grupo do quadro. Só aparece para quem tem `plan.view`.
- **Período e corte:** "De/Até" recortam tarefas (pela data de início, ou o prazo), marcos e Diário; tarefa sem data só entra sem período. A **data de corte** é o "hoje" do documento: dias, fases em andamento e a linha tracejada do cronograma vão até ela. Tarefas canceladas aparecem na lista, mas não contam no total de tarefas.
- **PDF:** a prévia é o próprio documento A4; "Baixar PDF" abre a impressão do navegador ("Salvar como PDF"), com rodapé e número de página. Título, subtítulo, resumo, observações e opções ficam guardados no navegador de cada pessoa, por projeto.

## 21. Ficha do projeto

Página do projeto → aba **Ficha** (logo depois de Resumo): para que o projeto existe, o que vai entregar, até onde vai e como se mede o sucesso — com o avanço calculado pelo que já está na plataforma.

- **Seções:** **Objetivos** (objetivo geral + objetivos específicos), **Funcionalidades**, **Alcance** (inclui / não inclui) e **Resultados esperados**. A **completude** conta quatro seções: objetivos (objetivo geral ou ao menos um específico), funcionalidades, alcance incluído e resultados.
- **Quem faz o quê:** quem vê o projeto vê a ficha (os dados das tarefas vinculadas só com `tasks.view`). Montar e editar: gestor ou dono do projeto (`projects.edit`, projeto não arquivado), como os marcos. Registrar a **medição** de um resultado: quem edita ou o **responsável** pelo resultado. Responsável = dono ou membro do projeto.
- **Funcionalidade:** vinculada a tarefas do projeto. Avanço = tarefas concluídas / tarefas vinculadas (canceladas não contam). Estado **automático**: nenhuma começou → *Planejada*; alguma em andamento ou concluída → *Em desenvolvimento*; alguma tarefa aberta (nem concluída nem cancelada) com o prazo vencido → *Atrasada*; todas concluídas → *Entregue*. Quem edita pode fixar o estado à mão (inclusive *Cancelada*); "Automático" volta ao cálculo. Tarefa excluída sai do vínculo.
- **Objetivo:** vinculado a funcionalidades e resultados. Estado **automático**: algum resultado ou funcionalidade atrasada → *Em risco*; tudo entregue/cumprido → *Atingido*; algo andando → *Em curso*; senão *Pendente*. Funcionalidades canceladas não contam. Também pode ser fixado à mão.
- **Resultado esperado:** indicador com partida, meta, unidade, início, prazo, frequência de medição e responsável. Cada **medição** (valor, data — hoje ou antes —, comentário) entra na série; a de data mais recente vira o **valor atual**. **Situação:** *Cumprido* (chegou à meta), *No caminho* (no ritmo de uma reta entre a partida no início e a meta no prazo), *Atrasado* (abaixo da reta, ou passou do prazo) ou *Sem dados* (nenhuma medição). Meta abaixo da partida = quanto menos, melhor. **Sem medir:** com frequência semanal (7 dias), mensal (31) ou trimestral (92), passou do intervalo desde a última medição (ou da criação).
- **Histórico:** no projeto — `charter.updated` (objetivo geral), `charter_item.created/updated/deleted/reordered` e `charter_item.measured`.

## 22. Urgência da tarefa (semáforo)

Na aba **Tarefas** (do projeto e da lista geral), a coluna **Urgência** mostra um semáforo por tarefa: 🔴 **Alta**, 🟡 **Média**, 🟢 **Baixa** — ou nenhum (tarefa sem urgência, o padrão, inclusive das que já existiam).

- **Quem muda:** quem edita a tarefa, com um clique na célula (menu com as três opções e "Sem urgência"). Não exige os campos obrigatórios do status e fica no histórico da tarefa ("Urgência: — → Alta").
- **Diferença da prioridade:** a prioridade segue o cadastro de prioridades (ordem de atendimento); a urgência é o sinal rápido de "quanto aperta" para quem olha a lista. As duas convivem.
- **Filtro:** "Urgência" na barra de filtros (Alta, Média, Baixa, Sem urgência); na API, `urgency=high|medium|low|none`.
- **Projetos também têm urgência** (mesmo semáforo): coluna e filtro "Urgência" na lista de Projetos (quem edita o projeto troca com um clique), campo no formulário do projeto, histórico em `project.updated`; na API, `urgency` em `POST/PATCH /projects` (`null` limpa) e filtro `GET /projects?urgency=high|medium|low|none`.
- **Kanban:** filtro "Urgência" na barra e o semáforo no canto de cada cartão com urgência.

## 23. Área responsável

Lista configurável em **Configurações → Áreas** (`settings.manage`), com as mesmas regras de status e prioridades (chave imutável, ordem, cor, ativa/inativa), mas **sem padrão**: tarefa e projeto podem ficar sem área (o padrão, inclusive para o que já existia). Carga inicial: Inteligencia Estratégica, Dpto. TI, Desarrollo e Innovación, Marketing, Contabilidad, Administración, Fertilizantes, Logística, Supply, Comex e Créditos.

- **Tarefas:** coluna **Área** logo depois de Responsável; quem edita a tarefa troca com um clique (não exige os campos obrigatórios do status) e também no formulário. Histórico: `task.updated` com o nome da área.
- **Projetos:** coluna e filtro na lista (quem edita o projeto troca com um clique) e campo no formulário; histórico em `project.updated`.
- **Kanban:** filtro "Área" e o selo da área no cartão.
- **Filtro:** área ou "Sin área" (`area_id=none` na API).
- Só áreas **ativas** podem ser escolhidas; a área inativa continua aparecendo onde já estava. Área em uso por tarefas ou projetos não se exclui (`AREA_IN_USE`): desative.

## 24. Responsável TI

Papel de membro do projeto (`it`, "Responsável TI"), escolhido em Membros ou no Controle de acesso, para quem só precisa saber **o que o projeto precisa dele**.

- **Ao abrir o projeto** vê uma única tela: nome do projeto, objetivo geral da ficha, **as tarefas atribuídas a ele** e os resultados/funcionalidades da ficha sob a responsabilidade dele (`GET /projects/{id}/brief`). Qualquer aba ou endereço do projeto leva a essa tela.
- **Não vê** as demais tarefas, a ficha completa, Kanban, Histórico, Membros, Arquivos, Informe nem a Gestão de projetos daquele projeto: a API responde como se não existissem (`PROJECT_NOT_FOUND`/`TASK_NOT_FOUND`). Na lista geral de Tarefas e nos relatórios aparecem só as tarefas dele.
- **Nas tarefas dele** age como colaborador: muda status, comenta, anexa e preenche campos. Não exclui, não reatribui e não cria tarefas no projeto (`FORBIDDEN`).
- Dono do projeto, gestor e quem tem permissão de ver todos os projetos nunca ficam limitados, mesmo com esse papel.
- O menu lateral segue o perfil global da pessoa; para escondê-lo, use um perfil próprio no Controle de acesso.

## 25. Projeto pai e subprojetos

Um projeto pode **fazer parte de um projeto maior** (o projeto pai), por exemplo um programa que reúne vários projetos. A ligação se escolhe no formulário do projeto (campo **Projeto pai**) ou com **Novo subprojeto**, no Resumo do pai, que já cria o projeto ligado.

- **Um só nível:** o pai não pode ter pai e um projeto com subprojetos não pode virar filho. Também não vale ligar o projeto a ele mesmo nem a um pai arquivado (`parent_id`: `self`, `parent_is_child`, `has_children`, `parent_archived`).
- **Quem liga:** só a um pai que a pessoa pode editar (gestor do pai com `projects.edit`); senão, `invalid_option`.
- **Onde aparece:** o subprojeto mostra o nome do pai acima do título (com link) e na lista de Projetos ("↳ pai"); o pai mostra o card **Subprojetos** no Resumo, com estado e entrega de cada um, e a quantidade na lista.
- **Independência:** cada projeto continua com seus membros, tarefas, ficha e permissões; ser membro do pai **não** dá acesso aos subprojetos.
- **Arquivar ou excluir:** arquivar o pai não mexe nos filhos; excluir o pai solta os subprojetos (ficam sem pai).
- **Histórico:** criação e troca de pai ficam em `project.created`/`project.updated` com o nome do projeto pai.
