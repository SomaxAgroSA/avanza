-- Empresas do grupo (regras de negócio §46, ADR-058): cadastro da plataforma (Configurações → Empresas).
-- Nome único sem diferença de maiúsculas/minúsculas (`name_key` = nome em minúsculas, gravado pela
-- aplicação, domain/company.js); sigla opcional em maiúsculas. Não se exclui: desativa-se (`active`), e a
-- inativa continua nos registros que já a usam (RESTRICT). Lista global como as áreas: não entra no tempo
-- real; mudar a empresa de um projeto ou de uma demanda já avisa pelos gatilhos de `projects` e `tasks`.
-- Idempotente: pode rodar de novo sem duplicar nada.
CREATE TABLE IF NOT EXISTS "companies" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL DEFAULT '',
  "name_key" text NOT NULL DEFAULT '',
  "short_code" text NOT NULL DEFAULT '',
  "active" boolean NOT NULL DEFAULT true,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_companies_name_key" ON "companies" ("name_key");
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS "trg_companies_updated" ON "companies";
CREATE TRIGGER "trg_companies_updated" BEFORE UPDATE ON "companies" FOR EACH ROW EXECUTE FUNCTION touch_updated();

-- Projeto: a empresa dele (os antigos começam sem; obrigatória ao criar quando há empresa ativa).
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "company_id" text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_projects_company_id' AND conrelid = 'projects'::regclass) THEN
    ALTER TABLE "projects" ADD CONSTRAINT "fk_projects_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "idx_projects_company" ON "projects" ("company_id") WHERE "company_id" IS NOT NULL;

-- Tarefa: só a demanda interna (caixa de sistema) guarda empresa; a tarefa de projeto herda a do projeto.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "company_id" text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_company_id' AND conrelid = 'tasks'::regclass) THEN
    ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_company_id" FOREIGN KEY ("company_id") REFERENCES "companies" (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "idx_tasks_company" ON "tasks" ("company_id") WHERE "company_id" IS NOT NULL;
