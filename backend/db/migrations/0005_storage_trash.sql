-- Arquivos que saem do banco vão para a lixeira do Storage: o PocketBase apagava o arquivo junto com o
-- registro (inclusive nas exclusões em cascata — ex.: apagar um projeto leva os anexos das tarefas). Aqui
-- um gatilho guarda a chave ("<tabela>/<id>/<arquivo>") e a rotina "storage-trash" apaga do Storage. Se a
-- transação for desfeita, a entrada na lixeira também é — nenhum arquivo em uso é apagado.
CREATE TABLE "storage_trash" (
  "key" text PRIMARY KEY,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE "storage_trash" ENABLE ROW LEVEL SECURITY;

-- TG_ARGV: colunas de arquivo da tabela. Na exclusão, todas; na alteração, as que mudaram de valor.
CREATE FUNCTION trash_files() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  col text;
  old_name text;
  new_name text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    old_name := to_jsonb(OLD) ->> col;
    IF TG_OP = 'UPDATE' THEN
      new_name := to_jsonb(NEW) ->> col;
    ELSE
      new_name := NULL;
    END IF;
    IF old_name IS NOT NULL AND old_name <> '' AND old_name IS DISTINCT FROM new_name THEN
      INSERT INTO storage_trash ("key") VALUES (TG_TABLE_NAME || '/' || OLD.id || '/' || old_name) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "trg_attachments_trash" AFTER DELETE OR UPDATE ON "attachments" FOR EACH ROW EXECUTE FUNCTION trash_files('file');
CREATE TRIGGER "trg_doc_files_trash" AFTER DELETE OR UPDATE ON "doc_files" FOR EACH ROW EXECUTE FUNCTION trash_files('file');
CREATE TRIGGER "trg_plan_item_files_trash" AFTER DELETE OR UPDATE ON "plan_item_files" FOR EACH ROW EXECUTE FUNCTION trash_files('file');
CREATE TRIGGER "trg_platform_settings_trash" AFTER DELETE OR UPDATE ON "platform_settings" FOR EACH ROW EXECUTE FUNCTION trash_files('logo_light', 'logo_dark', 'favicon');
