-- Tarefas por perfil, caixas da Caixa de entrada (ajuste 24/11/2026): o perfil escolhe quais caixas aparecem.
-- tasks_hidden_boxes: as caixas pessoais escondidas, separadas por vírgula e na ordem da tela
-- ('received', 'assigned', 'requested'); '' = todas visíveis (como antes). A caixa Todas segue em tasks_all_box.
-- tasks_start (0034) ganha 'inbox_assigned' e 'inbox_requested' (lista fechada em domain/permissions.js#TASK_VIEWS).
ALTER TABLE "roles" ADD COLUMN "tasks_hidden_boxes" text NOT NULL DEFAULT '';
