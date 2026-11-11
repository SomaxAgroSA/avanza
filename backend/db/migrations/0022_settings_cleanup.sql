-- Limpeza das configurações repetidas (2026-11-11). Nada do que já foi digitado se perde.
--
-- 1) O campo "Estimativa (horas)" repetia a estimativa nativa da tarefa (tasks.estimated_hours): o valor
--    passa para a estimativa nativa quando ela está vazia. Os valores do campo continuam gravados.
UPDATE "tasks" AS t
SET "estimated_hours" = v."value_number"
FROM "task_custom_values" AS v
JOIN "custom_fields" AS f ON f."id" = v."field_id"
WHERE f."name" = 'estimativa'
  AND v."task_id" = t."id"
  AND v."value_number" > 0
  AND t."estimated_hours" = 0;

-- 2) "Severidade" (repetia a Prioridade), "Estimativa (horas)" (repetia a estimativa nativa) e "Área
--    solicitante" (texto livre que repetia as Áreas) saem dos tipos de tarefa. Os campos e os valores ficam
--    na biblioteca (Configurações → Campos personalizados), para consulta ou para excluir depois.
DELETE FROM "task_type_fields"
WHERE "field_id" IN (SELECT "id" FROM "custom_fields" WHERE "name" IN ('severidade', 'estimativa', 'area_solicitante'));

-- 3) A permissão "Configurar Kanban" (kanban.manage) não era verificada em lugar nenhum: o Kanban se
--    configura em Configurações → Estados (settings.manage).
DELETE FROM "role_permissions" WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "code" = 'kanban.manage');
DELETE FROM "permissions" WHERE "code" = 'kanban.manage';
