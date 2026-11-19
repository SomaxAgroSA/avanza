-- Módulos da documentação (regras de negócio §42, ADR-054): lista da empresa (ex.: Marketing, Finanças)
-- para organizar os espaços na tela inicial da Documentação. O módulo não muda quem lê nem quem edita.
-- Nome único sem diferença de maiúsculas, acentos e espaços (name_key, calculada pela aplicação).
-- Excluir o módulo deixa os espaços dele "Sem módulo" (module_id volta a NULL). Não entra no tempo real.
CREATE TABLE "doc_modules" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL DEFAULT '',
  "name_key" text NOT NULL DEFAULT '',
  "color" text NOT NULL DEFAULT '',
  "position" integer NOT NULL DEFAULT 0,
  "created_by" text REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX "idx_doc_modules_name" ON "doc_modules" ("name_key");
CREATE TRIGGER "trg_doc_modules_updated" BEFORE UPDATE ON "doc_modules" FOR EACH ROW EXECUTE FUNCTION touch_updated();
ALTER TABLE "doc_modules" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "doc_spaces" ADD COLUMN "module_id" text REFERENCES "doc_modules" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX "idx_doc_spaces_module" ON "doc_spaces" ("module_id");
