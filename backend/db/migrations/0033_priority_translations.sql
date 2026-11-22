-- Prioridades com nome por idioma (pedido da coordenação, 22/11/2026): como os tipos de tarefa
-- (domain/content-locale.js), `name` continua sendo o original (pt-BR) e `translations` guarda
-- { en: { name }, es: { name } }; o que faltar usa o original. A API devolve o nome no idioma da tela.
-- As prioridades padrão ganham as traduções pela chave (o nome não muda: o pt-BR de cada uma — Crítica,
-- Alta, Média, Baixa — é o próprio nome), só quando ainda não têm nenhuma. Idempotente.
ALTER TABLE "task_priorities" ADD COLUMN IF NOT EXISTS "translations" jsonb;

UPDATE "task_priorities" SET "translations" = '{"en": {"name": "Critical"}, "es": {"name": "Crítica"}}'::jsonb
  WHERE "key" = 'CRITICA' AND ("translations" IS NULL OR "translations" = '{}'::jsonb);
UPDATE "task_priorities" SET "translations" = '{"en": {"name": "High"}, "es": {"name": "Alta"}}'::jsonb
  WHERE "key" = 'ALTA' AND ("translations" IS NULL OR "translations" = '{}'::jsonb);
UPDATE "task_priorities" SET "translations" = '{"en": {"name": "Medium"}, "es": {"name": "Media"}}'::jsonb
  WHERE "key" = 'MEDIA' AND ("translations" IS NULL OR "translations" = '{}'::jsonb);
UPDATE "task_priorities" SET "translations" = '{"en": {"name": "Low"}, "es": {"name": "Baja"}}'::jsonb
  WHERE "key" = 'BAIXA' AND ("translations" IS NULL OR "translations" = '{}'::jsonb);
