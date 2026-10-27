# Diretriz de Desenvolvimento — Gerenciamento de Projetos (quadro do projeto)

> Revisada em 2026-09-30 a partir das telas de referência (Monday.com) enviadas pelo usuário.
> Substitui a versão anterior, que dava a entender que as **tarefas** seriam os itens do plano. **Não são.**
> Atualização (2026-10-01, pedido do usuário): o módulo saiu da aba do projeto e virou o item **Gestão de projetos** do menu lateral (`/project-management/:projeto`), para deixar clara a diferença em relação às tarefas. Onde este texto fala em "aba Gerenciamento", leia "Gestão de projetos".

## 1. Objetivo

Implementar dentro do projeto um **módulo de gerenciamento** (aba **Gerenciamento**), no estilo de um quadro do Monday:
fases do projeto (ex.: *1.0 Iniciação*, *2.0 Planejamento*) com as **atividades de gestão** de cada fase — reuniões,
alinhamentos, aprovações, entregas — cada uma com status, cronograma, recursos, esforço estimado, duração e progresso.

A experiência deve ser **bonita, simples, rápida, organizada, editável direto na tela** e adequada para projetos com
muitos elementos.

## 2. Regras principais

1. **Módulo à parte das tarefas.** O quadro tem entidades próprias (grupos, elementos, subelementos, etiquetas).
   Tarefas continuam na aba **Tarefas** do projeto, como sempre foram; **nenhum campo do quadro vai para a tarefa** e
   nenhum status de tarefa é usado no quadro.
2. **Não recriar a aplicação.** Reutilizar autenticação, RBAC, layout, design system (`App*`), notificações (`notify`),
   i18n, auditoria, API `/api/v1` e padrões de teste. Componentes novos entram no design system, genéricos.
3. **Regras no servidor.** Numeração, duração, progresso e totais são calculados no domínio (`domain/plan.js`); a tela
   só apresenta.
4. **Mesma fonte para todas as visões.** Quadro principal, Cronograma, Kanban e relatórios leem os mesmos elementos:
   mudar o status no Kanban é mudar o status do elemento no quadro.

## 3. Conceitos

| Conceito | O que é |
|---|---|
| **Quadro** | O plano de gestão de um projeto (um por projeto). |
| **Grupo** | Fase ou seção do plano, com nome e cor. Até 2 níveis: grupo (*2.0 Planejamento*) e subgrupo (*2.1 Plano do Projeto*). Numeração automática pela ordem. |
| **Elemento** | Item de gestão dentro de um grupo (ex.: *Reunião inicial com o patrocinador*). |
| **Subelemento** | Item dentro de um elemento (um nível), com colunas próprias (responsável, data, trabalho, realizado). |
| **Etiqueta de status** | Status do quadro, por projeto: nome, cor e **categoria** (planejado, em progresso, confirmar/revisão, parado/bloqueado, feito, cancelado). Um elemento pode ficar **em branco** (sem status). |
| **Etiqueta de recurso** | Papel ou equipe alocada (ex.: *Gerente de Projetos*, *Cliente*, *Consultor*), por projeto. Não é usuário do sistema. |

Status iniciais do quadro (editáveis): **Planejado** (azul), **Em progresso** (laranja), **Confirmar** (rosa),
**Parado** (vermelho), **Feito** (verde).

## 4. Estrutura do módulo

```text
Menu lateral › Gestão de projetos › (projeto)
├── Quadro principal   (tabela por grupo — foco desta diretriz)
├── Cronograma         (Gantt dos elementos + indicadores)
├── Kanban             (colunas = etiquetas de status)
└── Gestão             (Diário do projeto + Gestão dos problemas)
```

## 5. Quadro principal

### 5.1 Barra de ações
```text
[ Criar elemento ▾ ]  Pesquisar  Pessoa  Filtro ▾  Ordenar  Ocultar  Agrupar por  …        [ Recolher/Expandir tudo ]
     └ Criar grupo de elementos
     └ Importar elementos
```

### 5.2 Grupos
- Cada grupo aparece como um bloco: **título na cor do grupo** (subgrupo: *"2.0 Planejamento | 2.1 Plano do Projeto"*),
  tabela com **borda lateral na cor do grupo**, linha **"+ Adicionar elemento"** e **rodapé de totais**.
- Grupo raiz sem elementos próprios (só subgrupos) não mostra tabela vazia — só os subgrupos.
- **Recolhido**, o grupo vira uma linha compacta: título, *"N elementos"* e os totais alinhados às colunas.
- Ações do grupo: renomear, mudar cor, novo subgrupo, mover para cima/baixo (e arrastar), duplicar com os elementos,
  recolher/expandir, excluir (com confirmação e contagem).
- No fim do quadro: **"Adicionar novo grupo"**.

### 5.3 Colunas do elemento
| Coluna | Conteúdo | Edição direta |
|---|---|---|
| Seleção | caixa de marcação | seleção múltipla |
| **Elemento** | nome; ícone de atualizações (com contador); expandir subelementos | renomear na célula |
| **Status** | bloco colorido com o nome da etiqueta | lista de etiquetas + "Editar etiquetas" |
| **Cronograma** | pílula na cor do grupo: *"jan 26"*, *"jan 26 - 27"*, *"jan 27 - 30"*; vazia = "–" | calendário de intervalo ("N dias selecionados"), limpar |
| **Recursos** | etiquetas; com pouco espaço, *"Consultor +2"* (lista completa ao passar o mouse) | "Criar ou localizar etiquetas", marcar várias, "Editar etiquetas" |
| **Esforço estimado** | horas (ex.: 0,1 · 1,5 · 26) | campo numérico na célula |
| **Duração** | dias | calculada pelo cronograma; sem datas, informada na célula |
| **Progresso** | barra + % | calculado (ver §7) ou informado |
| **Dependência** | elementos de que depende / que bloqueia | seletor de elementos |

### 5.4 Subelementos
- A seta no elemento abre a **sub-tabela** dele, com colunas próprias:
  **Subelemento · Responsável · Status · Data · Cronograma · Trabalho (h) · Realizado (h)** e **"+ Adicionar subelemento"**.
- O elemento mostra quantos subelementos tem; o progresso dele passa a vir dos subelementos.

### 5.5 Colunas (como no Monday)
- **Redimensionar** (arrastar a borda do cabeçalho) e **reordenar** (arrastar o cabeçalho) — vale para todos os grupos.
- **Menu da coluna (…)**: Filtrar, Ordenar (crescente/decrescente), Recolher (coluna estreita), Ocultar, Renomear.
  Em fase futura: Duplicar coluna, Adicionar coluna à direita, Alterar tipo, Excluir (colunas personalizadas).
- Preferências de colunas lembradas por pessoa.

### 5.6 Rodapé de totais do grupo
| Coluna | Total |
|---|---|
| Status | barra com a distribuição das etiquetas (cores, na ordem) |
| Cronograma | pílula com o período do grupo (menor início → maior fim), ex.: *"jan 26 - fev 10"* |
| Esforço estimado | soma (*"4,1 Total"*) |
| Duração | soma das durações (*"10 Total"*) |
| Progresso | barra + % do grupo |

## 6. Edição direta e feedback
- Pequenas alterações **nunca** abrem formulário: tudo na própria célula (popover ou campo).
- Sucesso: ✓ *"Alterações salvas."* · Erro: *"Não foi possível salvar a alteração."* (a célula volta ao valor anterior).
- Atualização otimista: a tela muda na hora; os totais se recalculam na resposta do servidor.

## 7. Regras de cálculo
- **Duração** = dias de calendário do cronograma (início e fim contam; uma data só = 1 dia). Sem cronograma, vale a
  duração informada. Esforço ≠ duração (8 h podem caber em 2 dias).
- **Progresso do elemento**: etiqueta da categoria *feito* → 100%. Com subelementos (não cancelados):
  **Σ(trabalho × progresso) / Σ(trabalho)**; sem trabalho informado, a média. Sem subelementos: o informado; senão 0%.
- **Progresso do grupo**: mesma fórmula sobre os elementos, ponderada pelo esforço estimado.
- **Numeração**: automática pela ordem (1.0, 2.0, 2.1…).
- Zero é valor (*"0"* horas é diferente de em branco).

## 8. Arrastar e soltar
- Elementos: reordenar no grupo, mover entre grupos; subelementos: reordenar dentro do elemento.
- Grupos: reordenar. Durante o arraste: destino destacado, espaço reservado, operações inválidas bloqueadas.
- Alternativa pelo teclado/menu para tudo (mover para cima/baixo, mover para grupo).
- ✓ *"Elemento movido."*

## 9. Filtros, pessoa, ordenação, agrupamento e busca
- **Pesquisar**: nome do elemento/subelemento (sem acento).
- **Pessoa**: responsável dos subelementos.
- **Filtro** (combinável, *"Filtros (3)"*) e filtro **por coluna** (menu da coluna): status, recursos, grupo, período,
  progresso, atrasados, dependências.
- **Ordenar** por qualquer coluna (dentro de cada grupo).
- **Agrupar por** (independente dos filtros): grupo (padrão), status, recurso, cronograma.

## 10. Seleção em massa
*"5 selecionados"* → mudar status, recursos, mover de grupo, duplicar, excluir (com confirmação).

## 11. Dependências
- Tipos: depende de, bloqueia, relacionado.
- **Regra configurável por quadro**: só sinalizar ou impedir iniciar/concluir com dependência pendente
  (*"Este elemento possui uma dependência pendente."*).

## 12. Painel do elemento (atualizações)
- O ícone de atualizações da linha abre um **painel lateral** sem sair do quadro: detalhes, **atualizações** (comentários
  com respostas e **@menções** que notificam), arquivos e **histórico** (quem mudou o quê e quando).
- O contador da linha acompanha as atualizações.

## 13. Cronograma
- **Gantt** dos elementos por grupo (com subgrupos), escala dias/semanas/meses, linha de hoje, linha de base, ajuste
  automático, exportar.
- Indicadores ao lado: **Bateria** (distribuição de status: *"79,7% Feito"*, legenda) e **Esforço estimado (h)** total.

## 14. Kanban
- Colunas = etiquetas de status (com contagem, ex.: *"Feito / 47"*), mais *"Em branco"*; cards dos elementos.
- Arrastar o card muda o status do elemento (mesma fonte do quadro).

## 15. Gestão
- **Diário do projeto**: registros datados (ex.: *"01/02/2024 — Reunião de abertura do projeto."*).
- **Gestão dos problemas**: problemas numerados com data, descrição e situação (*Em andamento*, *Pendente*, *Resolvido*).

## 16. Relatórios e indicadores
Resumo (total, feitos, pendentes, atrasados, parados, progresso), cronograma (no prazo, atrasados, sem datas),
esforço (estimado, realizado, restante, desvio), recursos (elementos e esforço por recurso) e grupos (progresso, esforço,
atrasos). **Saúde do projeto** agregada, sempre mostrando os fatores que a compõem.

## 17. Permissões
| Ação | Exige |
|---|---|
| Ver o quadro | acesso ao projeto **e** `plan.view` |
| Criar/editar/excluir elementos e subelementos; criar e editar etiquetas de recursos | `plan.edit` **e** colaborar no projeto (dono, gestor ou membro; leitor não) |
| Grupos (criar, renomear, reordenar, duplicar, excluir) e etiquetas de status | `plan.manage` **e** gestor/dono do projeto |

O servidor sempre valida; projeto arquivado fica só para leitura. Recurso invisível responde 404.

## 18. Histórico
Toda mudança relevante grava auditoria na mesma transação: elementos (criação, status, cronograma, recursos, esforço,
duração, progresso, mudança de grupo, exclusão) e, no projeto, grupos e etiquetas.

## 19. UX/UI
- Design system do Avanza (antes Avanza e KAMBAN), tokens do tema (claro e escuro), contraste AA, textos em pt-BR/en/es.
- Visual limpo e compacto: blocos de status coloridos, pílulas, barras de progresso, ícones discretos, hover suave.
- Telas em largura total; no celular, rolagem horizontal da tabela com a coluna do elemento visível.

## 20. Performance
Uma chamada traz o quadro inteiro; atualização otimista; recolher grupos reduz o que é desenhado; virtualização quando
necessário; busca com debounce; atualizações e histórico sob demanda.

## 21. Estados
- Carregando: esqueleto do quadro. · Vazio: *"Nenhum grupo ainda. Crie o primeiro grupo (ex.: 1.0 Iniciação)."*
- Filtro sem resultado: *"Nenhum elemento corresponde aos filtros selecionados."*
- Erro: *"Não foi possível carregar o quadro."* + *Tentar novamente*.

## 22. Fases de entrega
| Fase | Entrega |
|---|---|
| **GP-1 Base do quadro** | grupos (2 níveis, numeração, cor, recolher com resumo, expandir/recolher tudo, duplicar, excluir, reordenar pelo menu), elementos e subelementos, etiquetas de status e de recursos, edição direta de todas as células, "+ Adicionar elemento/subelemento", rodapé de totais, colunas redimensionáveis/reordenáveis, menu da coluna (ordenar, recolher, ocultar) |
| **GP-2 Interação** | filtros (barra, pessoa e por coluna), agrupar por, arrastar e soltar (elementos, subelementos, grupos), seleção em massa, dependências + regra de bloqueio, importar elementos |
| **GP-3 Colaboração** | painel do elemento: atualizações com respostas e @menções, arquivos, histórico, contador |
| **GP-4 Visões e gestão** | Cronograma (Gantt + Bateria + Esforço), Kanban por status, Gestão (Diário + Problemas), relatórios e saúde do projeto |
| **GP-5 Colunas personalizadas** | adicionar/duplicar/renomear/excluir colunas e alterar tipo |

Cada fase fica funcional, testada (unitário, API, interface, E2E e acessibilidade) e documentada antes da seguinte.

> Situação (2026-10-01): GP-1 a GP-5 concluídas — regras em regras-de-negocio.md §14; decisões ADR-027 a ADR-031.

## 23. Critérios de aceite (GP-1)
- [ ] aba Gerenciamento no projeto; aba Tarefas intacta
- [ ] grupos e subgrupos numerados, com cor, recolher (linha compacta com totais) e expandir/recolher tudo
- [ ] criar elemento pela linha "+ Adicionar elemento" e pelo botão "Criar elemento"
- [ ] status em bloco colorido, com edição de etiquetas
- [ ] cronograma em pílula com seletor de intervalo
- [ ] recursos como etiquetas (criar, localizar, marcar várias)
- [ ] esforço, duração e progresso editáveis na célula, com as regras do §7
- [ ] subelementos em sub-tabela com responsável, status, data, cronograma, trabalho e realizado
- [ ] rodapé de totais por grupo
- [ ] colunas redimensionáveis e reordenáveis; menu da coluna com ordenar, recolher e ocultar
- [ ] permissões, histórico, claro/escuro, celular, acessibilidade e i18n

## 24. Princípio final

> **É um quadro de gestão do projeto, à parte das tarefas, com a organização e a fluidez do Monday — e a identidade
> visual do Avanza.**
