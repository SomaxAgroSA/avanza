-- Seções do projeto por perfil (regras de negócio §35): o que a pessoa vê dentro de cada projeto em que
-- entra — Ficha, Histórico, Membros e Informe. Todo perfil que já via projetos (`projects.view`) recebe
-- as quatro, para nada mudar até o administrador desligar alguma no Controle de acesso (idempotente).
INSERT INTO "permissions" ("id", "code", "module", "description")
SELECT v."id", v."code", 'projects', ''
FROM (VALUES
  ('prjsectcharter1', 'projects.charter'),
  ('prjsecthistory1', 'projects.history'),
  ('prjsectmembers1', 'projects.members'),
  ('prjsectreport01', 'projects.report')
) AS v("id", "code")
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = v."code");

INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT substr(md5(holder."role_id" || p."id"), 1, 15), holder."role_id", p."id"
FROM "role_permissions" holder
JOIN "permissions" seen ON seen."id" = holder."permission_id" AND seen."code" = 'projects.view'
CROSS JOIN "permissions" p
WHERE p."code" IN ('projects.charter', 'projects.history', 'projects.members', 'projects.report')
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" x WHERE x."role_id" = holder."role_id" AND x."permission_id" = p."id");
