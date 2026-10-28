-- Arquivos do projeto (regras de negócio §22): documentos e imagens ligados ao projeto, fora das tarefas.
-- O arquivo fica no Storage em "project_files/<id>/<arquivo>"; apagar o registro (inclusive em cascata, ao
-- excluir o projeto) manda a chave para a lixeira do Storage, e a mudança avisa o tópico do projeto.
CREATE TABLE "project_files" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  "file" text NOT NULL DEFAULT '',
  "name" text NOT NULL DEFAULT '',
  "mime" text NOT NULL DEFAULT '',
  "kind" text NOT NULL DEFAULT '',
  "size" integer NOT NULL DEFAULT 0,
  "uploaded_by" text REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX "idx_project_files_project" ON "project_files" (project_id, created);
ALTER TABLE "project_files" ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER "trg_project_files_trash" AFTER DELETE OR UPDATE ON "project_files" FOR EACH ROW EXECUTE FUNCTION trash_files('file');
CREATE TRIGGER "trg_project_files_realtime" AFTER INSERT OR UPDATE OR DELETE ON "project_files" FOR EACH ROW EXECUTE FUNCTION notify_change('project_id', '', '', '');
