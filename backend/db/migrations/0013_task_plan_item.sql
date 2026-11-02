-- Tarefa ligada a um elemento da Gestão de projetos (regras de negócio §28, ADR-050): a Gestão é o plano
-- macro e as tarefas a execução; o elemento com tarefas ligadas tira delas o progresso. Excluir o
-- elemento desliga as tarefas (continuam existindo, sem elemento).
ALTER TABLE "tasks" ADD COLUMN "plan_item_id" text REFERENCES "plan_items" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX "idx_tasks_plan_item" ON "tasks" ("plan_item_id") WHERE "plan_item_id" IS NOT NULL;
