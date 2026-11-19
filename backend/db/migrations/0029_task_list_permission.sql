-- Lista de tarefas (regras de negócio §42): permissão própria para o item "Tarefas" do menu e a página
-- /tasks, separada de `tasks.view` (que continua governando as tarefas dentro de cada projeto e a API).
-- Todo perfil que já via tarefas recebe a nova, para nada mudar até o administrador desligar no Controle de
-- acesso (idempotente). O SUPER_ADMIN tem tudo implicitamente.
INSERT INTO "permissions" ("id", "code", "module", "description")
SELECT 'tasklistmenu001', 'tasks.list', 'task_list', ''
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = 'tasks.list');

INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT substr(md5(holder."role_id" || p."id"), 1, 15), holder."role_id", p."id"
FROM "role_permissions" holder
JOIN "permissions" seen ON seen."id" = holder."permission_id" AND seen."code" = 'tasks.view'
CROSS JOIN "permissions" p
WHERE p."code" = 'tasks.list'
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" x WHERE x."role_id" = holder."role_id" AND x."permission_id" = p."id");
