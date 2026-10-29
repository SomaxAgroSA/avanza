-- Preferências por pessoa (regras de negócio §27): hoje, o configurador do filtro de projetos de cada
-- tela ("project_filter.<tela>"). Uma linha por pessoa e chave; some junto com a pessoa.
CREATE TABLE "user_preferences" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  "key" text NOT NULL,
  "value" jsonb NOT NULL,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX "idx_user_preferences_key" ON "user_preferences" ("user_id", "key");
ALTER TABLE "user_preferences" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "trg_user_preferences_updated" BEFORE UPDATE ON "user_preferences" FOR EACH ROW EXECUTE FUNCTION touch_updated();
