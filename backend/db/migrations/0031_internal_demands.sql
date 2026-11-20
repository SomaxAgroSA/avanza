-- Demandas internas (regras de negócio §45, ADR-057): tarefas sem projeto, pedidas a uma pessoa (o
-- responsável), que as distribui à equipe dela. Para reaproveitar tudo o que as tarefas já têm (comentários,
-- histórico, anexos, notificações e a numeração DEM-1, DEM-2…), as demandas moram num projeto de sistema
-- oculto: `projects.kind = 'demands'`. Projeto de sistema não tem dono (é do sistema), não aparece em lista
-- nenhuma de projetos e ninguém o abre, edita, arquiva ou exclui pela API (domain/project.js#resolveAccess).
-- Idempotente: pode rodar de novo sem duplicar nada; a aplicação recria a caixa se ela sumir (importação).

-- '' = projeto comum; 'demands' = caixa das demandas internas (um só por tipo)
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS "idx_projects_kind_system" ON "projects" ("kind") WHERE "kind" <> '';

-- o projeto de sistema não tem dono; os comuns continuam obrigados a ter
ALTER TABLE "projects" ALTER COLUMN "owner_id" DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_projects_owner_or_system' AND conrelid = 'projects'::regclass) THEN
    ALTER TABLE "projects" ADD CONSTRAINT "chk_projects_owner_or_system" CHECK ("owner_id" IS NOT NULL OR "kind" <> '');
  END IF;
END $$;

-- Campos da demanda na tarefa:
-- - demand_status: '' = tarefa de projeto; senão o passo do fluxo (unassigned → assigned → in_progress →
--   to_validate → done), validado pela aplicação (domain/demand.js);
-- - demand_owner_id: o Responsável (quem recebeu o pedido; fixo); `assignee_id` continua sendo quem executa;
-- - demand_past_assignees: quem já esteve atribuído (continua vendo a demanda depois de passá-la).
-- O prazo da demanda usa o `due_date` que já existe (timestamptz), agora com a hora escolhida.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "demand_status" text NOT NULL DEFAULT '';
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "demand_owner_id" text REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "demand_past_assignees" text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS "idx_tasks_demand_owner" ON "tasks" ("demand_owner_id", "demand_status") WHERE "demand_status" <> '';
CREATE INDEX IF NOT EXISTS "idx_tasks_demand_reporter" ON "tasks" ("reporter_id", "demand_status") WHERE "demand_status" <> '';
CREATE INDEX IF NOT EXISTS "idx_tasks_demand_assignee" ON "tasks" ("assignee_id", "demand_status") WHERE "demand_status" <> '';

-- A caixa das demandas: chave DEM (ou a primeira livre da lista, se um projeto comum já usa DEM).
DO $$
DECLARE
  candidate text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "projects" WHERE "kind" = 'demands') THEN
    FOREACH candidate IN ARRAY ARRAY['DEM', 'DEMINT', 'DEMANDAS', 'DEMANDA', 'DEMSYS'] LOOP
      IF NOT EXISTS (SELECT 1 FROM "projects" WHERE "key" = candidate) THEN
        INSERT INTO "projects" ("id", "name", "key", "kind", "description", "icon", "cover", "status", "priority", "owner_id", "created_by")
        VALUES ('sysdemands00001', 'Demandas internas', candidate, 'demands', '', 'inbox', 'slate', 'active', 'medium', NULL, NULL);
        EXIT;
      END IF;
    END LOOP;
  END IF;
END $$;
