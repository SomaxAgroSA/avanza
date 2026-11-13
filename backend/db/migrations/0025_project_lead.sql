-- Responsável do projeto: quem leva o projeto adiante (dono ou membro). É só informação — não muda
-- permissão nenhuma (quem administra continua sendo o dono). Se o usuário sair, fica vazio.
ALTER TABLE "projects" ADD COLUMN "lead_id" text REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX "idx_projects_lead" ON "projects" ("lead_id") WHERE "lead_id" IS NOT NULL;

-- Carga inicial (aprovada no protótipo de 13/11/2026): quem tem mais tarefas abertas atribuídas no projeto
-- (entre o dono e os membros; empate → mais tarefas em andamento); sem tarefas atribuídas, o dono.
-- A carga não conta como edição do projeto: a data de atualização de cada um fica como estava.
ALTER TABLE "projects" DISABLE TRIGGER "trg_projects_updated";
UPDATE "projects" p SET "lead_id" = COALESCE((
  SELECT t."assignee_id"
  FROM "tasks" t
  JOIN "task_statuses" s ON s."id" = t."status_id"
  WHERE t."project_id" = p."id"
    AND t."assignee_id" IS NOT NULL
    AND s."category" NOT IN ('done', 'cancelled')
    AND (t."assignee_id" = p."owner_id" OR EXISTS (SELECT 1 FROM "project_members" m WHERE m."project_id" = p."id" AND m."user_id" = t."assignee_id"))
  GROUP BY t."assignee_id"
  ORDER BY count(*) DESC, count(*) FILTER (WHERE s."category" = 'in_progress') DESC, t."assignee_id" ASC
  LIMIT 1
), p."owner_id");
ALTER TABLE "projects" ENABLE TRIGGER "trg_projects_updated";
