-- Áreas responsáveis (regras de negócio §32): lista configurável (Configurações → Áreas) com as mesmas
-- colunas de status e prioridades, mas sem padrão — tarefa e projeto podem ficar sem área (NULL; o que já
-- existe fica sem área). A área em uso não sai (RESTRICT): desativa-se. Lista global como status e
-- prioridades (sem projeto): não entra no tempo real; mudar a área de uma tarefa ou projeto já avisa
-- pelos gatilhos de `tasks` e `projects`. A carga inicial é DADO editável pelo administrador.
CREATE TABLE "areas" (
  "id" text PRIMARY KEY,
  "key" text NOT NULL DEFAULT '',
  "name" text NOT NULL DEFAULT '',
  "description" text NOT NULL DEFAULT '',
  "color" text NOT NULL DEFAULT '',
  "order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT false,
  "is_default" boolean NOT NULL DEFAULT false,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX "idx_areas_key" ON "areas" ("key");
CREATE INDEX "idx_areas_order" ON "areas" ("order");
ALTER TABLE "areas" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "trg_areas_updated" BEFORE UPDATE ON "areas" FOR EACH ROW EXECUTE FUNCTION touch_updated();

INSERT INTO "areas" ("id", "key", "name", "color", "order", "is_active", "is_default") VALUES
  ('ly78ktqbjoegdof', 'INTELIGENCIA', 'Inteligencia Estratégica', 'violet', 0, true, false),
  ('legis27jcufecxq', 'TI', 'Dpto. TI', 'blue', 1, true, false),
  ('wt9p0cp49y8kw2b', 'DESARROLLO', 'Desarrollo e Innovación', 'indigo', 2, true, false),
  ('bm47fotiw9k1t13', 'MARKETING', 'Marketing', 'pink', 3, true, false),
  ('d2t38hl71fi6fge', 'CONTABILIDAD', 'Contabilidad', 'teal', 4, true, false),
  ('n1n9g7fyl5htd2l', 'ADMINISTRACION', 'Administración', 'gray', 5, true, false),
  ('qw8mporjdw7nnrk', 'FERTILIZANTES', 'Fertilizantes', 'green', 6, true, false),
  ('3740l2lsjh548ux', 'LOGISTICA', 'Logística', 'orange', 7, true, false),
  ('nveqbfuia6n2pbp', 'SUPPLY', 'Supply', 'amber', 8, true, false),
  ('ii4lkqvkbgp5ynu', 'COMEX', 'Comex', 'blue', 9, true, false),
  ('2x4jo4xvc7oi8il', 'CREDITOS', 'Créditos', 'red', 10, true, false);

ALTER TABLE "tasks" ADD COLUMN "area_id" text;
ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_area_id" FOREIGN KEY ("area_id") REFERENCES "areas" (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX "idx_tasks_area" ON "tasks" ("area_id") WHERE "area_id" IS NOT NULL;

ALTER TABLE "projects" ADD COLUMN "area_id" text;
ALTER TABLE "projects" ADD CONSTRAINT "fk_projects_area_id" FOREIGN KEY ("area_id") REFERENCES "areas" (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX "idx_projects_area" ON "projects" ("area_id") WHERE "area_id" IS NOT NULL;
