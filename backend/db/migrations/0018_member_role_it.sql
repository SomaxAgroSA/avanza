-- Responsável TI (regras de negócio §33): `project_members.role` passa a aceitar `it`, validado pela
-- aplicação (domain/project.js#MEMBER_ROLES), como os demais papéis — a coluna é texto livre desde a
-- migração do PocketBase. Os membros que já existem mantêm o papel; nada a converter.
--
-- Índice para as consultas de visibilidade que separam o papel `it` (lista geral de tarefas e
-- relatórios: "projetos em que a pessoa é membro sem ser Responsável TI").
CREATE INDEX "idx_project_members_user_role" ON "project_members" ("user_id", "role");
