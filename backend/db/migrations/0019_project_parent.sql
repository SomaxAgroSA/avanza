-- Projeto pai e subprojetos (regras de negócio §34): `projects.parent_id` NULL = projeto sem pai (todos
-- os que já existem). Um só nível — o pai não tem pai e o filho não tem filhos — validado na aplicação
-- (domain/project.js#parentIssue). Excluir o pai solta os subprojetos (SET NULL; o gatilho de tempo real
-- de `projects` avisa cada filho atualizado).
ALTER TABLE "projects" ADD COLUMN "parent_id" text;
ALTER TABLE "projects" ADD CONSTRAINT "fk_projects_parent_id" FOREIGN KEY ("parent_id") REFERENCES "projects" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "projects" ADD CONSTRAINT "chk_projects_parent_not_self" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
CREATE INDEX "idx_projects_parent" ON "projects" ("parent_id") WHERE "parent_id" IS NOT NULL;
