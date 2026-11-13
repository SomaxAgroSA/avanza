-- Responsável pelo desenvolvimento: quem executa a parte técnica do projeto (o responsável do projeto
-- continua sendo quem faz a gestão). É só informação — não muda permissão nenhuma. Se o usuário sair, fica vazio.
ALTER TABLE "projects" ADD COLUMN "dev_lead_id" text REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX "idx_projects_dev_lead" ON "projects" ("dev_lead_id") WHERE "dev_lead_id" IS NOT NULL;

-- Carga inicial (pedido da coordenação em 13/11/2026): quem tem mais tarefas abertas atribuídas no projeto,
-- sem contar o responsável do projeto (entre o dono e os membros gestor/membro; empate → mais tarefas em
-- andamento); ninguém → vazio. A carga não conta como edição: a data de atualização dos projetos fica como estava.
ALTER TABLE "projects" DISABLE TRIGGER "trg_projects_updated";
UPDATE "projects" p SET "dev_lead_id" = (
  SELECT t."assignee_id"
  FROM "tasks" t
  JOIN "task_statuses" s ON s."id" = t."status_id"
  WHERE t."project_id" = p."id"
    AND t."assignee_id" IS NOT NULL
    AND t."assignee_id" IS DISTINCT FROM p."lead_id"
    AND s."category" NOT IN ('done', 'cancelled')
    AND (
      t."assignee_id" = p."owner_id"
      OR EXISTS (SELECT 1 FROM "project_members" m WHERE m."project_id" = p."id" AND m."user_id" = t."assignee_id" AND m."role" IN ('manager', 'member'))
    )
  GROUP BY t."assignee_id"
  ORDER BY count(*) DESC, count(*) FILTER (WHERE s."category" = 'in_progress') DESC, t."assignee_id" ASC
  LIMIT 1
);
ALTER TABLE "projects" ENABLE TRIGGER "trg_projects_updated";
