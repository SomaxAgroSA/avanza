-- Documentação vinculada às tarefas: uma página pode estar ligada a várias tarefas e uma tarefa a várias
-- páginas (de qualquer espaço que a pessoa lê). O vínculo sai junto quando a página ou a tarefa é
-- excluída; quem criou o vínculo vira NULL se o usuário sair. Não entra no tempo real: a tela da
-- tarefa e a da página releem a lista ao abrir.
CREATE TABLE "doc_page_tasks" (
  "id" text PRIMARY KEY,
  "page_id" text NOT NULL REFERENCES "doc_pages" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  "task_id" text NOT NULL REFERENCES "tasks" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  "created_by" text REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX "idx_doc_page_tasks_pair" ON "doc_page_tasks" ("page_id", "task_id");
CREATE INDEX "idx_doc_page_tasks_task" ON "doc_page_tasks" ("task_id");
ALTER TABLE "doc_page_tasks" ENABLE ROW LEVEL SECURITY;
