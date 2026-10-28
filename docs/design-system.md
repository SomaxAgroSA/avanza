# Design System

> Diretriz §20–§22. Código em `web/src/presentation/components/` (importar sempre de `@/presentation/components`).

**Regra:** nenhuma feature cria versão própria destes componentes, e nenhum controle nativo do navegador é usado com aparência padrão (ex.: `input type=date`) — tudo segue o tema do app. Se faltar algo, evolua o componente do design system.

## Fundamentos
- **Tokens** em `web/src/styles/index.css` (OKLCH), expostos ao Tailwind via `@theme inline`: `bg`, `surface`, `surface-2/3`, `border`, `fg`, `muted`, `subtle`, `primary(-hover/-fg/-soft)`, `success/warning/danger/info(-soft)`, `ring`, `overlay`. Componentes nunca usam cores literais.
- **Tema:** Light, Dark e System (classe `.dark` no `<html>`). `public/theme-init.js` aplica antes da primeira pintura; `useThemeSync` acompanha o sistema. A preferência é salva localmente e no perfil do usuário.
- **Gradientes** com moderação: `bg-brand-gradient` (marca, login, destaques) e `bg-subtle-gradient` (cards especiais, dashboard).
- **Tipografia:** Inter Variable (self-hosted). **Raios:** 6/8/12/16 px. **Sombras:** `shadow-card`, `shadow-float`.
- **Movimento:** animações curtas (150–220 ms) e respeito a `prefers-reduced-motion`.
- **Acessibilidade:** primitivos Radix (foco, teclado, ARIA), `focus-visible` em tudo, rótulos obrigatórios em botões de ícone, "Pular para o conteúdo", tabelas com `caption`, `aria-sort` e estados `aria-busy`.

## Componentes disponíveis (Fase 1)
| Componente | Uso |
|---|---|
| `AppButton` | variantes `primary`, `secondary`, `ghost`, `soft`, `danger`, `link`; `loading`, ícones, `asChild` |
| `AppIconButton` | botão de ícone com `label` obrigatório (vira tooltip e nome acessível) |
| `AppTextField` | rótulo, obrigatório (*), dica, erro, ícone, senha com mostrar/ocultar |
| `AppSelect` | select acessível (Radix); `SELECT_ALL` para "todos"; `prefix` (ex.: bolinha de cor) e, com `onCreateOption(texto) => Promise<valor>`, vira lista com busca e item "Adicionar “texto”" (a nova opção fica escolhida) |
| `AppCheckbox` | com estado indeterminado |
| `AppTextarea` | texto longo simples (o editor rico vem depois) |
| `AppDatePicker` | data (somente dia, AAAA-MM-DD): digitação com máscara no formato do idioma (dd/mm/aaaa) + botão que abre o `AppCalendar`; limpar, mín./máx. |
| `AppCalendar` | calendário próprio (sem controle nativo): navegação por mês, seleção rápida de mês/ano, Hoje/Limpar, teclado completo (setas, PageUp/PageDown, Home/End, Enter), semana e nomes conforme o idioma |
| `AppFormField` | estrutura comum de campo (use ao criar novos inputs) |
| `AppDialog`, `AppDrawer`, `AppConfirmDialog` | pop-up centralizado (criação/edição: `size="xl"`/`"2xl"`, cabeçalho e ações fixos, corpo com rolagem, `closeOnOutsideClick={false}`; `tall` = quase a altura da tela, para conteúdo que cresce, como as opções de um campo), painel lateral (Visualizar), confirmação destrutiva |
| `AppCard`, `AppBadge`, `AppAvatar`, `AppTooltip`, `AppKbd` | apresentação |
| `AppDropdown` | menu com itens, checkbox, separador e rótulo |
| `AppEmptyState`, `AppErrorState`, `AppSkeleton`, `AppLoading` | estados |
| `AppToaster` + `notify` | toasts **React-Toastify** no canto superior direito: `success`, `error`, `info`, `warning` (com **desfazer** opcional) e `promise` (pendente → sucesso/erro). Nunca chame a biblioteca direto nas features |
| `AppBreadcrumb`, `AppTabs` | navegação |
| `AppSearch` | busca com debounce (300 ms; Enter aplica na hora) |
| `AppFilterBar` | barra padrão de busca/filtros/ações |
| `AppPagination` | contador "x–y de N", tamanho de página, anterior/próxima |
| `AppDataTable` + `useDataTableState` | ver abaixo |
| `AppCommandPalette` | paleta genérica (a global está em `presentation/navigation/CommandPalette.tsx`, Ctrl/⌘+K: criar projeto/tarefa, buscar tarefa (resultados com código e título, em todos os projetos visíveis) e usuário, projetos, navegação e preferências) |

### Adicionados na Fase 3
| Componente | Uso |
|---|---|
| `AppSwitch` | interruptor liga/desliga (Radix), com rótulo e descrição; tamanhos `sm`/`md` |
| `AppMultiSelect` | seleção múltipla em combobox com busca (sem acentos/maiúsculas), chips removíveis e teclado (setas; Enter na busca escolhe a opção igual ou cria); `onCreateOption` como no `AppSelect` (a nova entra selecionada) |
| `AppTimeField` | hora (HH:mm) com máscara, sem controle nativo |
| `AppSortableList` + `AppDragHandle` | lista reordenável (dnd-kit): mouse, toque e **teclado** (espaço pega/solta, setas movem, Esc cancela), anúncios para leitor de tela traduzidos |

Formulário dinâmico: `features/task-config/CustomFieldInput.tsx` renderiza qualquer campo personalizado pelo tipo (o mesmo componente será usado nas tarefas na Fase 4).

### Adicionados na Fase 4
| Componente | Uso |
|---|---|
| `AppMarkdown` | Markdown simples e **seguro** (negrito, itálico, riscado, código, listas, links http(s), menções) — gera elementos React, nunca HTML cru |
| `AppFileDrop` | área de envio: arrastar e soltar ou escolher (seletor nativo oculto, botão acessível) |
| `AppImageViewer` | visualizador em tela cheia: zoom (+/−, ajustar), navegação (setas), contador, download, Esc fecha |
| `AppMentionTextarea` | texto com menções: "@" abre a lista de pessoas filtrando ao digitar (setas, Enter/Tab, Esc; clique); Ctrl/⌘+Enter envia |

Da feature, reutilizáveis no Kanban: `LookupBadge` (status/prioridade), `TagBadge`/`TagList`, `TaskIndicators` (checklist e comentários), `TaskCode`, `DueDate`, `CustomFieldValue`.

`useDataTableState` aceita `filters` e `columnVisibility` iniciais (ex.: tarefas abrem só com as abertas).

### Kanban (`AppKanban.tsx`)
| Componente | Uso |
|---|---|
| `AppKanbanColumnHeader` | cabeçalho da coluna: nome, faixa na cor do status, contagem (`3/5` com WIP; amarelo no limite, vermelho acima) e ações (ex.: "+") |
| `AppKanbanDropZone` | área de cards de uma coluna/raia; destaque quando o card está sobre ela e aparência "bloqueada" (tracejada e esmaecida) quando a transição não é permitida |
| `AppKanbanCard` | casca do card (fantasma durante o arraste, cópia inclinada que segue o ponteiro, cursor conforme permissão) |

O arrastar e soltar do quadro (dnd-kit, vários contêineres raia × coluna) fica em `features/kanban/KanbanBoard`: mouse, toque (segurar 200 ms) e teclado (Espaço pega/solta, setas movem, Esc cancela; Enter abre o card), com anúncios traduzidos. A área com rolagem horizontal é `relative` para que textos `sr-only` não alarguem a página.

### Timeline (`AppTimeline.tsx`)
Gantt genérico (usado na Timeline das tarefas e no Cronograma do quadro): régua de dois níveis (`headerTiers` de `domain/timeline.ts`), grupos recolhíveis, barras (cor, progresso, atraso, conflito) que se arrastam e se esticam pelas pontas, setas de dependência que contornam as barras, faixas (sprints), marcos (losangos clicáveis), linha e célula de hoje, fins de semana. Área com rolagem própria (cabeçalho e coluna da esquerda fixos). Teclado nas barras (setas / Shift / Alt / Enter) com anúncio para leitor de tela; `onDropExternal` recebe itens arrastados de fora (`TIMELINE_DRAG_TYPE`). Opcionais: `baseline` na barra (traço fino da linha de base) e `summary` no grupo (período do grupo no cabeçalho).

### Conteúdo rico (`rich-text/`)
`AppRichTextEditor` (editor não controlado: `defaultValue`, `onChange` com o JSON, `onUpload` para imagens/arquivos colados, arrastados ou escolhidos) e `AppRichTextView` (leitura; links `/docs/…` navegam na aplicação via `onNavigate`, externos abrem em outra aba com `noopener`). Mesmo conjunto de extensões nos dois (`extensions.ts`) — só o que o servidor aceita: títulos 1–4, listas, checklist, citação, código, **avisos** (`callout`, tom que se troca pelo ícone), tabelas, imagem com largura, sumário (`tableOfContents`) e marca-texto. Barra de ferramentas acessível (`role="toolbar"`, botões com `aria-pressed`; os menus devolvem o foco ao texto), menu **"/"** filtrável sem acento, link por diálogo (Ctrl/⌘ + K). O **sumário** (`tableOfContents`) lê os títulos do próprio documento (sem conteúdo salvo); vazio, explica e oferece "Adicionar título" na edição e some na leitura. Estilos do conteúdo na classe `.kb-rich` (`styles/index.css`, só tokens). Importe de `@/presentation/components/rich-text` (fora do índice geral): o TipTap vai no chunk `vendor-editor`, carregado só nas telas de documentação. `scrollToHeading` rola até um título (o "Nesta página").

### Quadro em grupos (`board/AppBoardTable.tsx`)
Tabela de grupo estilo Monday (quadro de gerenciamento): faixa colorida à esquerda (`accent`), 1ª coluna fixa ao rolar para o lado (a partir de 640 px), cabeçalho com menu por coluna (**ordenar**, **recolher**, **ocultar**, **mover** para a esquerda/direita), **arrastar o cabeçalho** para reordenar, **redimensionar** pela borda (mouse ou setas; duplo clique volta ao padrão), linha de adicionar (`addRow`), linha extra abaixo da linha (`renderExpanded`, ex.: subtabela `nested`), rodapé de totais por coluna (`footer`) e modo **recolhido** (uma linha com `collapsedSummary` e os totais alinhados). Ocupa a largura toda: uma coluna vazia no fim absorve a sobra. O estado das colunas vem de `useBoardColumns(storageKey, defs)` — ordem, larguras, ocultas, recolhidas e ordenação, compartilhadas por todas as tabelas do quadro e lembradas por pessoa; `AppBoardColumnsMenu` mostra de volta as ocultas e restaura o padrão. Linhas **arrastáveis** (`sortable: { containerId, disabled, handleLabel }`, com dnd-kit; o `DndContext` fica com quem usa e a tabela vira também área de soltar quando vazia) — a alça chega à 1ª célula por `cell(row, { dragHandle })`; **seleção** destacada (`isRowSelected`), conteúdo antes do rótulo da 1ª coluna (`headerLead`, ex.: marcar todos) e **Filtrar** no menu da coluna (`onFilter`), itens extras no fim do menu da coluna (`menuExtra`, ex.: renomear/duplicar/excluir coluna personalizada) e conteúdo no fim do cabeçalho (`headerTrail`, ex.: o "+" de adicionar coluna); `useBoardColumns().placeAfter(id, afterId)` guarda a posição de uma coluna que ainda vai aparecer. Listagens planas e paginadas continuam no `AppDataTable`.

### Edição em linha, painel flutuante e intervalo de datas
- `AppInlineEdit`: texto que vira campo ao clicar (Enter ou sair confirmam, Esc cancela; `onCommit` devolve `false` para manter o valor); fora da edição é um botão.
- `AppPopover`: painel flutuante (Radix Popover) com nome acessível, `children` pode receber `close`; usado nos seletores de célula (status, cronograma, recursos, responsável, data) e nas cores das etiquetas. `dismissOnFocusOutside={false}` quando o painel é aberto por outro menu (que devolve o foco ao próprio botão ao fechar).
- `AppRangeCalendar`: calendário de intervalo sobre o `AppCalendar` (que ganhou `rangeEnd` para destacar os dias entre as pontas): 1º clique marca um dia, 2º fecha o intervalo em qualquer ordem; rodapé "N dias selecionados" e "Limpar".
- Blocos de status com texto branco usam `optionSolid(cor)` (contraste AA nos dois temas); chips suaves seguem `optionTint` + `optionText`.

### Painel lateral pela esquerda
`AppDrawer` aceita `side="left"` para navegação (ex.: árvore de páginas da documentação no celular); o padrão continua sendo a direita (detalhes).

### Formulários: pop-up; consulta: painel lateral
Criar e editar (tarefa, projeto, usuário, campo personalizado…) abre `AppDialog` grande no centro da tela, com as ações sempre visíveis e rolagem só no conteúdo; no desktop o conteúdo se divide em colunas (ex.: tarefa = conteúdo à esquerda, propriedades à direita). Clique fora não fecha (Esc e "Cancelar" sim). "Visualizar" abre `AppDrawer` ([ADR-021](decisions.md#adr-021--criareditar-em-pop-up-visualizar-em-painel-lateral)).

### Uma só área de rolagem
Nas telas internas só o `<main>` rola (ele é `relative`, então elementos absolutos — como tabelas `sr-only` — ficam presos a ele). Se o documento também rolar, aparece uma 2ª barra e a tela "treme" quando um menu/seletor trava a rolagem do `body`. A varredura E2E exige documento sem rolagem em todas as telas; componente com elemento absoluto deve ter um ancestral `relative`.

### Contraste
Tokens de texto garantem AA (4,5:1) sobre os fundos do tema: `text-subtle` (L 0,53 no claro / 0,66 no escuro); selos coloridos usam `optionText` (tokens `--kb-option-fg-*`: escuro no tema claro, claro no escuro); `bg-danger` usa `text-danger-fg`.

### Largura das telas
O conteúdo ocupa **toda a largura disponível** (sem largura máxima no `AppShell`); só o respiro lateral muda por breakpoint. Layouts internos usam grades que crescem (`1fr`, `lg:grid-cols-3` com colunas de conteúdo e laterais), nunca larguras fixas que deixem sobras em telas largas. O Kanban estica as colunas (`minmax(16rem, 1fr)`) e rola na horizontal quando não cabem. Nenhuma tela pode gerar rolagem horizontal da página no celular (390 px).

### Planejamento
A lista do Planejamento (`features/backlog/BacklogList`; rota `/planning`, antiga `/backlog` redireciona) usa a mesma base de arrastar e soltar do Kanban (dnd-kit, vários grupos: sprints e "sem sprint"), com alça por linha (o resto da linha continua clicável e selecionável), grupos recolhíveis e detecção que prefere o item mais próximo (o grupo só recebe o item quando está vazio). `ProjectSwitcher` (features/projects) troca o projeto das visões por projeto (Kanban e Backlog).

### Indicadores e gráficos (`AppCharts.tsx`)
| Componente | Uso |
|---|---|
| `AppStatCard` | indicador: rótulo, valor grande (tom neutro, perigo, alerta ou sucesso), ícone e dica (período, amostra). Com `onSelect` vira botão: destaque ao passar o mouse/focar, `tooltip` (o que o indicador mede) e `actionLabel` ("Ver tarefas") |
| `AppBarList` | distribuição em barras horizontais proporcionais ao maior valor |
| `AppTrendChart` | duas séries em colunas (ex.: criadas × concluídas) com legenda, valores do ponto ao passar o mouse e tabela oculta para leitores de tela |

Todos usam só tokens do tema (`bg-primary`, `bg-success`, `text-danger`…), funcionam em claro/escuro e sem biblioteca de gráficos.

Previstos nas próximas fases: `AppDateRangePicker`.

No celular, `AppBreadcrumb` mostra só a página atual e `AppCard` empilha as ações abaixo do título.

## AppDataTable (padrão de toda listagem)
```tsx
const table = useDataTableState('users', { sort: { id: 'name', direction: 'asc' } })
const users = useUsersList(table.query)          // TanStack Query com keepPreviousData
<AppDataTable
  caption={t('users.title')}
  columns={columns}                              // DataTableColumn<T>[]: id, header, cell, sortable, filter, pinned, size…
  data={users.data?.items ?? EMPTY} total={users.data?.total ?? 0}
  getRowId={(u) => u.id} table={table}
  loading={users.isPending} fetching={users.isFetching} error={…} onRetry={…}
  actions={{ onView, onOpen, onEdit, canEdit, onDelete, canDelete, deleteLabel, more }}
/>
```
Inclui: paginação e ordenação no servidor, contador total, busca global com debounce, filtros por coluna, seleção de colunas, redimensionamento (mouse, toque e teclado), colunas fixas (desktop), estado persistido por tabela (`kamban.table.<id>`), skeleton, vazio (com "limpar filtros"), erro (com referência), ações por linha **Visualizar · Editar · Excluir · Mais**. "Visualizar" abre `AppDrawer` sem sair da página; clicar na linha também abre. Com `onOpen` (projetos e tarefas), o **duplo clique** na linha abre a página completa — o clique simples espera 250 ms para não abrir os dois; no teclado, o "Abrir" do menu da linha.

Constante `EMPTY` fora do componente: evite `?? []` inline (recria os modelos da tabela a cada render).

## Textos
Nenhum texto fixo em componentes: tudo via `t('chave')` (`web/src/core/i18n/locales/*.json`). O teste `locales.test.ts` garante as mesmas chaves em pt-BR, en e es.

### Cabeçalho do projeto
Compacto e em destaque: a capa do projeto em versão mais escura (`coverHeroStyle`, texto `on-cover` com contraste AA em todas as capas), nome grande, chave e selos numa linha, ícone do projeto em marca-d'água e as ações à direita — sobra espaço para as abas (pedido do usuário, 2026-10-01).
