-- Tarefas por perfil (ajuste 23/11/2026), escolhido em Controle de acesso → Perfis: o que a pessoa vê ao entrar
-- em Tarefas, sem mudar o que ela pode fazer (isso continua nas permissões do perfil).
-- tasks_start: '' = Lista (como antes); 'inbox' = Caixa de entrada; 'inbox_all' = Caixa de entrada, caixa Todas.
-- tasks_list: '' = todas as que a pessoa pode ver (como antes); 'mine' = só as dela; 'hidden' = sem a Lista.
-- tasks_all_box: '' = caixa Todas visível (para quem tem projects.view_all, como antes); 'hidden' = sem ela.
-- Listas fechadas no domínio (domain/permissions.js#TASK_VIEWS).
ALTER TABLE "roles" ADD COLUMN "tasks_start" text NOT NULL DEFAULT '';
ALTER TABLE "roles" ADD COLUMN "tasks_list" text NOT NULL DEFAULT '';
ALTER TABLE "roles" ADD COLUMN "tasks_all_box" text NOT NULL DEFAULT '';
