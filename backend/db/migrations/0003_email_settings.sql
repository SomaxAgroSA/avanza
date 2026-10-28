-- Configuração do e-mail (SMTP, remetente e endereço do app), antes guardada nas configurações internas
-- do PocketBase (smtp + meta). Uma linha só. A senha do SMTP fica cifrada pela API (AES-256-GCM com a
-- chave do servidor, KAMBAN_SECRET_KEY) — nunca em texto puro no banco.
CREATE TABLE "email_settings" (
  "id" text PRIMARY KEY DEFAULT 'default' CHECK ("id" = 'default'),
  "enabled" boolean NOT NULL DEFAULT false,
  "host" text NOT NULL DEFAULT 'smtp.example.com',
  "port" integer NOT NULL DEFAULT 587,
  "username" text NOT NULL DEFAULT '',
  "password_secret" text NOT NULL DEFAULT '',
  "tls" boolean NOT NULL DEFAULT false,
  "sender_name" text NOT NULL DEFAULT 'Support',
  "sender_address" text NOT NULL DEFAULT 'support@example.com',
  "app_url" text NOT NULL DEFAULT 'http://localhost:8090',
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER "trg_email_settings_updated" BEFORE UPDATE ON "email_settings" FOR EACH ROW EXECUTE FUNCTION touch_updated();
INSERT INTO "email_settings" ("id") VALUES ('default');
