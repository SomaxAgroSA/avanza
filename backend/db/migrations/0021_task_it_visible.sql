-- Tarefa visível para TI (regras de negócio §36): o Responsável TI do projeto vê as tarefas marcadas,
-- além das atribuídas a ele. As tarefas que já existem ficam desmarcadas. Índice parcial: as consultas
-- de visibilidade procuram só as marcadas.
ALTER TABLE "tasks" ADD COLUMN "it_visible" boolean NOT NULL DEFAULT false;
CREATE INDEX "idx_tasks_it_visible" ON "tasks" ("project_id") WHERE "it_visible";
