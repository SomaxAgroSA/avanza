-- Avisar sobre uma página da Documentação (regras de negócio §47, ADR-060): quem edita a página escolhe
-- quem deve olhá-la; cada pessoa recebe uma notificação (sino + e-mail) e fica registrado quando ela abriu
-- a página. `doc_page_notices` guarda um aviso por pessoa e envio (com o "O que olhar" opcional);
-- `opened_at` é gravado na primeira vez que a pessoa abre a página depois do aviso.
-- Idempotente: pode rodar de novo sem duplicar nada.
CREATE TABLE IF NOT EXISTS "doc_page_notices" (
  "id" text PRIMARY KEY,
  "page_id" text NOT NULL,
  "user_id" text NOT NULL,
  "actor_id" text,
  "note" text NOT NULL DEFAULT '',
  "opened_at" timestamptz(3),
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_doc_page_notices_page_id' AND conrelid = 'doc_page_notices'::regclass) THEN
    ALTER TABLE "doc_page_notices" ADD CONSTRAINT "fk_doc_page_notices_page_id" FOREIGN KEY ("page_id") REFERENCES "doc_pages" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_doc_page_notices_user_id' AND conrelid = 'doc_page_notices'::regclass) THEN
    ALTER TABLE "doc_page_notices" ADD CONSTRAINT "fk_doc_page_notices_user_id" FOREIGN KEY ("user_id") REFERENCES "users" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_doc_page_notices_actor_id' AND conrelid = 'doc_page_notices'::regclass) THEN
    ALTER TABLE "doc_page_notices" ADD CONSTRAINT "fk_doc_page_notices_actor_id" FOREIGN KEY ("actor_id") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "idx_doc_page_notices_page" ON "doc_page_notices" ("page_id", "created");
CREATE INDEX IF NOT EXISTS "idx_doc_page_notices_unopened" ON "doc_page_notices" ("user_id", "page_id") WHERE "opened_at" IS NULL;
ALTER TABLE "doc_page_notices" ENABLE ROW LEVEL SECURITY;

-- Notificação que aponta para uma página da Documentação (tipo `doc_shared`).
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "doc_page_id" text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notifications_doc_page_id' AND conrelid = 'notifications'::regclass) THEN
    ALTER TABLE "notifications" ADD CONSTRAINT "fk_notifications_doc_page_id" FOREIGN KEY ("doc_page_id") REFERENCES "doc_pages" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "idx_notifications_doc_page" ON "notifications" ("user_id", "doc_page_id") WHERE "doc_page_id" IS NOT NULL;
