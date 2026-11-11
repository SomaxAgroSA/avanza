# Perfis e permissões (RBAC)

> Diretriz §7. Decisão em [ADR-005](decisions.md#adr-005--catálogo-de-permissões-definido-pelo-sistema-matriz-configurável).

## Modelo
- **Catálogo** (definido pelo sistema): `backend/src/domain/permissions.js`, espelhado em `web/src/domain/permissions.ts`.
- **Matriz perfil × permissão** (configurável): tabela `role_permissions`, editada em *Configurações → Controle de acesso* (abas Por pessoa, Perfis e Permissões por perfil — regras §35; `/settings/roles` e `/settings/permissions` redirecionam).
- **Perfis**: 5 de sistema (não excluíveis) + perfis personalizados (*Controle de acesso → Perfis*).

## Catálogo
| Módulo | Permissões |
|---|---|
| projects | `projects.view`, `projects.create`, `projects.edit`, `projects.delete`, `projects.view_all` (desde a migration 1790000003); seções do projeto `projects.charter`, `projects.history`, `projects.members`, `projects.report` (regras §35, migration `0020_project_sections.sql`) |
| tasks | `tasks.view`, `tasks.create`, `tasks.edit`, `tasks.delete`, `tasks.assign`, `tasks.fork`, `tasks.link` |
| kanban | `kanban.view` |
| users | `users.view`, `users.create`, `users.edit`, `users.disable` |
| reports | `reports.view` |
| audit | `audit.view` (desde a migration 1790000002) |
| docs | `docs.view`, `docs.edit`, `docs.manage` (expansão Onda 2, migration 1790000019) |
| settings | `settings.manage`, `permissions.manage`, `platform.manage` (Configurador geral, migration 1790000027), `integrations.manage` (e-mail, webhooks e tokens, migration 1790000028), `api_tokens.create` (migration 1790000029) |

## Matriz inicial (seed)
| Permissão | SUPER_ADMIN | ADMIN | MANAGER | MEMBER | VIEWER |
|---|:-:|:-:|:-:|:-:|:-:|
| projects.view | ✓ | ✓ | ✓ | ✓ | ✓ |
| projects.create / edit | ✓ | ✓ | ✓ | | |
| projects.delete | ✓ | ✓ | | | |
| projects.view_all | ✓ | ✓ | | | |
| projects.charter / history / members / report (seções) | ✓ | ✓ | ✓ | ✓ | ✓ |
| tasks.view | ✓ | ✓ | ✓ | ✓ | ✓ |
| tasks.create / edit / assign / fork / link | ✓ | ✓ | ✓ | ✓ | |
| tasks.delete | ✓ | ✓ | ✓ | | |
| kanban.view | ✓ | ✓ | ✓ | ✓ | ✓ |
| users.view | ✓ | ✓ | ✓ | | |
| users.create / edit / disable | ✓ | ✓ | | | |
| reports.view | ✓ | ✓ | ✓ | ✓ | ✓ |
| audit.view | ✓ | ✓ | | | |
| settings.manage / permissions.manage | ✓ | ✓ | | | |
| platform.manage | ✓ | ✓ | | | |
| integrations.manage | ✓ | ✓ | | | |
| api_tokens.create | ✓ | ✓ | ✓ | | |
| docs.view | ✓ | ✓ | ✓ | ✓ | ✓ |
| docs.edit | ✓ | ✓ | ✓ | ✓ | |
| docs.manage | ✓ | ✓ | ✓ | | |

SUPER_ADMIN possui tudo **implicitamente** (a verificação não consulta a matriz).

## Regras (backend: `domain/rbac.js`, `domain/user.js`)
1. Alterar permissões de perfil exige `permissions.manage`.
2. SUPER_ADMIN é imutável (`ROLE_IMMUTABLE`).
3. Ninguém além do SUPER_ADMIN altera as permissões do próprio perfil (`CANNOT_EDIT_OWN_ROLE`).
4. Só códigos do catálogo são aceitos (`VALIDATION_ERROR`).
5. Não se concede permissão que não se possui (`PRIVILEGE_ESCALATION`).
6. Atribuir perfil a usuário: SUPER_ADMIN só por SUPER_ADMIN; demais perfis só se o ator tiver todas as permissões do perfil.
7. Ninguém desativa a si mesmo (`CANNOT_DISABLE_SELF`); só SUPER_ADMIN altera um SUPER_ADMIN.
8. O próprio usuário edita nome, idioma e tema; perfil e e-mail exigem `users.edit` e não podem ser alterados por ele mesmo.
9. Perfis de sistema e perfis com usuários não podem ser excluídos (`ROLE_IMMUTABLE`, `ROLE_IN_USE`).
10. Mudanças valem na próxima requisição (o principal é recarregado a cada requisição).

A UI replica essas regras apenas para desabilitar controles e explicar o motivo (`web/src/domain/rbac.ts`).

## Acesso por projeto (Fase 2)
A permissão global é necessária, mas não suficiente: também conta o vínculo com o projeto.

| Ação | Exige |
|---|---|
| Ver projeto | `projects.view` **e** (membro, dono ou `projects.view_all`) — caso contrário 404; o **Responsável TI** só abre o projeto e o resumo (`/brief`) — o resto do projeto é 404 para ele (§33) |
| Ver as seções Ficha, Histórico, Membros, Informe | ver o projeto **e** `projects.charter` / `projects.history` / `projects.members` / `projects.report` (o dono sempre) — sem a seção, a ficha e o histórico respondem `FORBIDDEN` (§35); o Responsável TI só pode ganhar a Ficha (leitura) |
| Editar, arquivar | `projects.edit` **e** (gestor do projeto, dono ou `projects.view_all`) |
| Gerenciar membros (adicionar, trocar papel, remover, candidatos) | o acima **e** a seção Membros (`projects.members`; o dono sempre) |
| Ligar a um projeto pai | poder editar o projeto pai (gestor do pai com `projects.edit`); senão `invalid_option` (§34) |
| Transferir posse | `projects.edit` **e** (dono ou `projects.view_all`) |
| Excluir | `projects.delete` **e** (dono ou `projects.view_all`) **e** projeto arquivado |
| Sair do projeto | ser membro (o dono não sai sem transferir a posse) |
| Ver/baixar arquivos do projeto | ver o projeto |
| Enviar arquivos ao projeto | `tasks.edit` **e** (dono, gestor, membro ou `projects.view_all`) **e** projeto não arquivado |
| Excluir arquivo do projeto | o acima **e** (quem enviou ou gestor) |

Papéis no projeto: **gestor** (administra o projeto), **membro** (trabalha nas tarefas), **leitor** (consulta e comenta; não edita), **Responsável TI** (`it`: só o resumo do projeto e as tarefas atribuídas a ele ou marcadas "Visível para TI", onde age como colaborador sem excluir, reatribuir, criar, relacionar nem fazer fork — §33/§36; dono, gestor e `projects.view_all` nunca ficam limitados). A API devolve `capabilities` em cada projeto (inclusive `sections`) para a interface habilitar só o que é permitido. Regras em `backend/src/domain/project.js` (`resolveAccess`, `assertAccess`, `canSeeSection`) e `backend/src/domain/task.js` (`scopedAccess`).

## Tarefas, comentários e configurações (Fase 4)
Regras em `backend/src/domain/task.js`.

| Ação | Exige |
|---|---|
| Ver tarefa (e histórico) | `tasks.view` **e** ver o projeto — caso contrário `TASK_NOT_FOUND` (404) |
| Criar / editar tarefa, checklist e tags da tarefa | `tasks.create` / `tasks.edit` **e** colaborar no projeto (dono, gestor, membro ou `projects.view_all`); o **leitor** do projeto não edita |
| Atribuir responsável | `tasks.assign` **e** colaborar no projeto; o responsável precisa colaborar no projeto (leitor não pode ser responsável) |
| Excluir tarefa | `tasks.delete` **e** (gestor do projeto, `projects.view_all` ou autor da tarefa) |
| **Comentar** | ver a tarefa — **qualquer pessoa com acesso ao projeto, inclusive o leitor** (regra do produto, diretriz §18) |
| Editar comentário | ser o autor |
| Excluir comentário | ser o autor **ou** gestor do projeto / `projects.view_all` (exclusão lógica) |
| Anexar arquivo no comentário | ser o autor do comentário (vale para o leitor); remover: autor ou gestor |
| Mencionar (@) | a pessoa mencionada precisa ter acesso ao projeto e estar ativa (o Responsável TI só nas tarefas visíveis a ele; quando é ele quem escreve, só quem já aparece na tarefa — §33) |
| Marcar "Visível para TI" (`PUT /tasks/{id}/it-visible`) | regra de editar a tarefa (o Responsável TI não marca) — §36 |
| Ligar/desligar no informe (`PUT /tasks/{id}/report`) | regra de editar a tarefa **e** a seção Informe (`projects.report`) — §35 |
| Status, prioridades, áreas, tags, tipos e campos | ler: `settings.manage` ou `tasks.view`; alterar: `settings.manage` |
| Área responsável da tarefa (`PUT /tasks/{id}/area`) / do projeto | regra de editar a tarefa / o projeto (não exige os obrigatórios do status) |
| Biblioteca de ícones | ver: qualquer autenticado (os seletores de ícone usam); importar e remover: `settings.manage` |

Projeto arquivado: tudo fica somente leitura (inclusive comentários). A API devolve `capabilities` (`edit`, `delete`, `assign`, `comment`) em cada tarefa e (`edit`, `delete`) em cada comentário.

## Adicionando uma permissão nova
1. Incluir o código em `domain/permissions.js` (backend) e `domain/permissions.ts` (frontend) + traduções em `permissions.codes`.
2. Criar migration que insere o registro em `permissions` e, se preciso, em `role_permissions` para os perfis padrão.
3. Verificar a permissão no caso de uso (`rbac.assertCan`) com teste.
4. Atualizar esta página.

## Kanban (Fase 5)
| Ação | Exige |
|---|---|
| Ver o quadro | `kanban.view` **e** acesso ao projeto (mesma regra de ver tarefas) — caso contrário 404 |
| Mover card | mesma regra de editar a tarefa (`tasks.edit` + colaborador no projeto, projeto não arquivado) **e** transição permitida pelo status de origem |
| Criar pelo quadro | mesma regra de criar tarefa (`tasks.create` + colaborador) |
| Limite WIP e transições | configurados em Status (`settings.manage`) |

O leitor vê o quadro, abre os cards e comenta, mas não arrasta nem cria (o quadro vem com `capabilities.move/create = false`). O quadro se configura em Configurações → Estados (`settings.manage`: WIP e transições); a antiga `kanban.manage` saiu em 2026-11-11 (migration 0022) por não ser verificada.

## Backlog e sprints (Fase 6)
| Ação | Exige |
|---|---|
| Ver o backlog | `tasks.view` **e** acesso ao projeto |
| Priorizar, planejar na sprint, mover de status | regra de editar a tarefa (`tasks.edit` + colaborador, projeto não arquivado); mover respeita as transições |
| Criar/editar/ordenar/encerrar/excluir sprints | `projects.edit` **e** gestor/dono do projeto (ou `projects.view_all`), projeto não arquivado |

Detalhes funcionais em [regras-de-negocio.md](regras-de-negocio.md#6-backlog-e-sprints).

## Quadro do projeto (Gerenciamento de Projetos, GP-1)
Módulo **Gerenciamento de projetos** no catálogo: `plan.view`, `plan.edit`, `plan.manage`.

| Ação | Exige |
|---|---|
| Ver o quadro | acesso ao projeto **e** `plan.view` |
| Criar/editar/mover/excluir elementos e subelementos; criar/editar etiquetas de recurso | `plan.edit` **e** dono, gestor ou membro do projeto (ou `projects.view_all`), projeto não arquivado |
| Mover (arrastar), duplicar, seleção em massa, dependências e importar elementos | `plan.edit` **e** dono, gestor ou membro do projeto (ou `projects.view_all`), projeto não arquivado |
| Painel do elemento: publicar e responder atualizações | ver o quadro (acesso ao projeto + `plan.view`, inclusive leitor), projeto não arquivado; editar só o autor; excluir o autor ou o gestor (`plan.manage`) |
| Painel do elemento: colar/anexar imagem ou arquivo na atualização | quem publica (ver o quadro, projeto aberto — inclusive leitor); depois, só o autor; excluir: o autor ou o gestor; baixar: quem vê o quadro |
| Visões Cronograma, Kanban, Gestão e Relatórios (ver) | ver o quadro (acesso ao projeto + `plan.view`, inclusive leitor) |
| Datas no Cronograma, status no Kanban, registrar no diário, abrir/atualizar problema | `plan.edit` **e** colaborador, projeto não arquivado |
| Editar/excluir registro do diário | o autor (com `plan.edit`) ou o gestor (`plan.manage`) |
| Excluir problema | quem abriu (com `plan.edit`) ou o gestor (`plan.manage`) |
| Salvar/limpar a linha de base do Cronograma | `plan.manage` **e** gestor/dono |
| Colunas personalizadas: adicionar, renomear/editar opções, alterar tipo, duplicar, excluir | `plan.manage` **e** gestor/dono, projeto não arquivado |
| Colunas personalizadas: preencher as células | `plan.edit` **e** colaborador (como as demais células) |
| Grupos (criar, renomear, subgrupo, mover/arrastar, duplicar, excluir); etiquetas de status; excluir etiqueta de recurso; regra de dependências; criar grupos e status na importação | `plan.manage` **e** gestor/dono do projeto (ou `projects.view_all`), projeto não arquivado |

Registro de projeto invisível responde 404 (`PROJECT_NOT_FOUND`, `GROUP_NOT_FOUND`, `PLAN_*_NOT_FOUND`). Detalhes funcionais em [regras-de-negocio.md](regras-de-negocio.md#14-quadro-de-gerenciamento-do-projeto-gerenciamento-de-projetos--fase-gp-1).

## Relacionamentos, subtarefas e fork (Fase 7)
| Ação | Exige |
|---|---|
| Ver relações | ver a tarefa; o outro lado só aparece se também for visível |
| Relacionar / desfazer | `tasks.link` **e** colaborador no projeto (desfazer: em qualquer um dos lados) |
| Subtarefa (criar / vincular / soltar) | `tasks.create` para criar; editar a tarefa filha para vincular/soltar (mesmo projeto) |
| Fork | `tasks.fork` **e** colaborador no projeto de origem **e** `tasks.create` + colaborador no destino |

Detalhes em [regras-de-negocio.md](regras-de-negocio.md#7-relacionamentos-subtarefas-e-fork).

## Relatórios (Fase 8)
| Ação | Exige |
|---|---|
| Relatórios e indicadores do dashboard | `reports.view`; contagens só dos projetos visíveis (`projects.view` + vínculo, ou `projects.view_all`) |

## Documentação (expansão — Onda 2)
Permissão global **e** regra do espaço (`domain/docs.js` → `spaceAccess`):

| Ação | Exige |
|---|---|
| Ler espaço/página publicada, arquivos, versões, busca | `docs.view` **e** (espaço da empresa **ou** acesso ao projeto do espaço) — caso contrário 404 |
| Ver rascunhos; criar, editar, publicar, mover, excluir páginas; enviar arquivos; restaurar versão | `docs.edit` **e** (espaço da empresa **ou** colaborador do projeto — leitor do projeto não) |
| Criar, configurar e excluir espaço | `docs.manage` **e** (espaço da empresa **ou** gestor/dono do projeto) |

## Configurador geral
- `platform.manage` cobre a **segurança e a identidade da plataforma** (bloqueio de login, política de senha, retenção do histórico, nome, logo e ícone) — separada de `settings.manage`, que cobre a configuração das tarefas (tipos, campos, status, tags) e pode ser delegada a quem cuida do processo.
- Concedida por padrão só ao Admin (migration 1790000027, idempotente). As regras anti-escalonamento valem como em toda permissão: só concede quem a possui.
- A identidade (`GET /platform` e as imagens) é pública; `GET /auth/password-policy` exige só estar logado.

## Integrações
- `integrations.manage` cobre o **envio de e-mail** (servidor, teste, fila), os **webhooks** (que recebem eventos de todos os projetos — por isso só para quem administra) e a lista/revogação dos **tokens de API de todos**. Concedida por padrão só ao Admin (migration 1790000028).
- Reenviar convite exige `users.create`. As rotas de "Esqueci minha senha" são públicas (quem esqueceu não tem sessão), sem revelar contas.

## Tokens de API
- `api_tokens.create`: criar os próprios tokens (Admin e Gestor por padrão; dá para conceder a outros perfis na matriz). Listar e revogar os próprios não exige permissão — quem perdeu a permissão ainda consegue revogar os que criou.
- O token não tem permissões próprias: em cada chamada valem as do perfil atual da pessoa (o RBAC é o mesmo da sessão).
