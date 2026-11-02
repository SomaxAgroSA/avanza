-- Ficha do projeto (regras de negócio §30): objetivo geral, objetivos, funcionalidades, escopo (inclui /
-- não inclui) e resultados esperados com a série de medições. Os vínculos com tarefas e com outros itens
-- ficam em jsonb (lista de ids); quem lê ignora os que não existem mais. Tudo sai junto com o projeto,
-- e cada mudança avisa o tópico do projeto (tempo real).
CREATE TABLE "project_charters" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  "objective" text NOT NULL DEFAULT '',
  "updated_by" text REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX "idx_charters_project" ON "project_charters" ("project_id");

CREATE TABLE "charter_items" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  "kind" text NOT NULL DEFAULT '',
  "title" text NOT NULL DEFAULT '',
  "description" text NOT NULL DEFAULT '',
  "position" integer NOT NULL DEFAULT 0,
  "state" text NOT NULL DEFAULT '',
  "owner_id" text REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
  "task_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "link_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "unit" text NOT NULL DEFAULT '',
  "baseline" double precision NOT NULL DEFAULT 0,
  "target" double precision NOT NULL DEFAULT 0,
  -- valor atual = a medição de data mais recente; NULL enquanto não houver medição
  "current" double precision,
  "start_date" timestamptz(3),
  "due_date" timestamptz(3),
  "frequency" text NOT NULL DEFAULT '',
  "measured_at" timestamptz(3),
  "created_by" text REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX "idx_charter_items_project" ON "charter_items" ("project_id", "kind", "position");

CREATE TABLE "charter_measurements" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  "item_id" text NOT NULL REFERENCES "charter_items" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  "value" double precision NOT NULL DEFAULT 0,
  "note" text NOT NULL DEFAULT '',
  "measured_at" timestamptz(3) NOT NULL,
  "created_by" text REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX "idx_charter_measurements_item" ON "charter_measurements" ("item_id", "measured_at");

ALTER TABLE "project_charters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "charter_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "charter_measurements" ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER "trg_project_charters_updated" BEFORE UPDATE ON "project_charters" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_charter_items_updated" BEFORE UPDATE ON "charter_items" FOR EACH ROW EXECUTE FUNCTION touch_updated();

CREATE TRIGGER "trg_project_charters_realtime" AFTER INSERT OR UPDATE OR DELETE ON "project_charters" FOR EACH ROW EXECUTE FUNCTION notify_change('project_id', '', '', '');
CREATE TRIGGER "trg_charter_items_realtime" AFTER INSERT OR UPDATE OR DELETE ON "charter_items" FOR EACH ROW EXECUTE FUNCTION notify_change('project_id', '', '', '');
CREATE TRIGGER "trg_charter_measurements_realtime" AFTER INSERT OR UPDATE OR DELETE ON "charter_measurements" FOR EACH ROW EXECUTE FUNCTION notify_change('project_id', '', '', '');
