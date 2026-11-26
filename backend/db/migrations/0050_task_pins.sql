-- Tarefas fixadas no topo da Lista de tarefas (regras de negócio §50, ADR-064): uma tarefa fixada sobe, para
-- todas as pessoas, ao grupo "Fixadas" da Lista (respeitando os filtros de quem olha). Fixa e desafixa quem pode
-- editar a tarefa; no máximo 10 fixadas ao mesmo tempo (domain/task.js#MAX_PINNED, conferido sob trava na
-- aplicação); a mais recente fica primeiro. Tabela própria (e não colunas em `tasks`) para que fixar não renove o
-- "updated" da tarefa (a ordem "movidas mais recentes" da Lista) nem dispare o tempo real da tarefa.
-- Uma linha por tarefa fixada; apagar a tarefa tira a fixação (cascata); apagar quem fixou deixa a fixação sem
-- autor (SET NULL). Idempotente: pode rodar de novo sem duplicar nada.
CREATE TABLE IF NOT EXISTS "task_pins" (
  "task_id" text PRIMARY KEY,
  "pinned_by" text,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_task_pins_task_id' AND conrelid = 'task_pins'::regclass) THEN
    ALTER TABLE "task_pins" ADD CONSTRAINT "fk_task_pins_task_id" FOREIGN KEY ("task_id") REFERENCES "tasks" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_task_pins_pinned_by' AND conrelid = 'task_pins'::regclass) THEN
    ALTER TABLE "task_pins" ADD CONSTRAINT "fk_task_pins_pinned_by" FOREIGN KEY ("pinned_by") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "idx_task_pins_created" ON "task_pins" ("created" DESC);
ALTER TABLE "task_pins" ENABLE ROW LEVEL SECURITY;
