-- "Fixar para mim" na Lista de tarefas (regras de negócio §55, ADR-068): ao lado da fixação para todos (§50,
-- `task_pins`), cada pessoa fixa as tarefas que quer ver no topo da SUA Lista. Preferência pessoal e privada:
-- ninguém mais vê nem sabe; não entra no histórico da tarefa nem avisa o tempo real (a tabela não tem gatilho de
-- `notify_change`). Fixa quem vê a tarefa; no máximo 10 por pessoa (domain/task.js#MAX_PERSONAL_PINNED, conferido
-- sob trava na aplicação); a mais recente fica primeiro.
-- Uma linha por tarefa e pessoa (chave composta); apagar a tarefa ou a pessoa apaga a fixação (cascata).
--
-- "O que aparece" (§48): o item "Fixar" das ações da linha (`tasks.row_actions.pin`) passa a ser "Fixar para
-- todos" e ganha o irmão `tasks.row_actions.pin_mine` ("Fixar para mim"). Para cada perfil continuar vendo o
-- mesmo, quem tinha o "Fixar" escondido fica com os dois escondidos. A conversão só roda junto com a criação da
-- tabela (uma vez): rodar o arquivo de novo não muda nada, nem desfaz o que o perfil escolheu depois.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'task_personal_pins') THEN
    RETURN;
  END IF;

  CREATE TABLE "task_personal_pins" (
    "task_id" text NOT NULL,
    "user_id" text NOT NULL,
    "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY ("task_id", "user_id")
  );

  UPDATE "roles"
  SET "hidden_screens" = "hidden_screens" || '["tasks.row_actions.pin_mine"]'::jsonb
  WHERE "hidden_screens" ? 'tasks.row_actions.pin'
    AND NOT ("hidden_screens" ? 'tasks.row_actions.pin_mine');
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_task_personal_pins_task_id' AND conrelid = 'task_personal_pins'::regclass) THEN
    ALTER TABLE "task_personal_pins" ADD CONSTRAINT "fk_task_personal_pins_task_id" FOREIGN KEY ("task_id") REFERENCES "tasks" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_task_personal_pins_user_id' AND conrelid = 'task_personal_pins'::regclass) THEN
    ALTER TABLE "task_personal_pins" ADD CONSTRAINT "fk_task_personal_pins_user_id" FOREIGN KEY ("user_id") REFERENCES "users" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;
-- a Lista e a contagem do limite procuram pelas fixadas de uma pessoa, a mais recente primeiro
CREATE INDEX IF NOT EXISTS "idx_task_personal_pins_user" ON "task_personal_pins" ("user_id", "created" DESC);
ALTER TABLE "task_personal_pins" ENABLE ROW LEVEL SECURITY;
