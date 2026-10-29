-- Painel executivo (regras de negócio §26): permissão própria e a data em que cada elemento da Gestão
-- de projetos foi concluído (para "o que já foi feito" no período).

INSERT INTO "permissions" ("id", "code", "module", "description")
SELECT 'execdashboard01', 'executive.view', 'executive', ''
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "code" = 'executive.view');

-- Admin (e Super Admin) começam com a permissão; os demais perfis, pela matriz de perfis.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT substr(md5(r."id" || p."id"), 1, 15), r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."code" IN ('SUPER_ADMIN', 'ADMIN') AND p."code" = 'executive.view'
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" x WHERE x."role_id" = r."id" AND x."permission_id" = p."id");

ALTER TABLE "plan_items" ADD COLUMN "completed_at" timestamptz(3);

-- Elementos já concluídos: a última alteração é a melhor aproximação da conclusão.
ALTER TABLE "plan_items" DISABLE TRIGGER "trg_plan_items_updated";
ALTER TABLE "plan_items" DISABLE TRIGGER "trg_plan_items_realtime";
UPDATE "plan_items" i SET "completed_at" = i."updated"
FROM "plan_statuses" s
WHERE s."id" = i."status_id" AND s."category" = 'done';
ALTER TABLE "plan_items" ENABLE TRIGGER "trg_plan_items_updated";
ALTER TABLE "plan_items" ENABLE TRIGGER "trg_plan_items_realtime";

-- Daqui em diante, o banco marca a conclusão ao entrar numa etiqueta "concluído" (qualquer caminho:
-- edição, ações em massa, importação) e limpa ao sair dela.
CREATE FUNCTION plan_item_completed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."status_id" IS NOT DISTINCT FROM OLD."status_id" THEN
    NEW."completed_at" := OLD."completed_at";
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM "plan_statuses" WHERE "id" = NEW."status_id" AND "category" = 'done') THEN
    NEW."completed_at" := clock_timestamp();
  ELSE
    NEW."completed_at" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_plan_items_completed" BEFORE INSERT OR UPDATE ON "plan_items" FOR EACH ROW EXECUTE FUNCTION plan_item_completed();
