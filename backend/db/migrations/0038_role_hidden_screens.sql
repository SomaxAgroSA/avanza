-- "O que aparece" por perfil (ajuste 25/11/2026, regras §48, ADR-062), escolhido em Controle de acesso → Perfis:
-- um mecanismo só para esconder partes da tela (submenus, listas, caixas, visões, abas, blocos, filtros e botões) e
-- dizer onde cada módulo abre. Só a tela: nenhuma permissão muda e a API continua validando tudo como antes.
-- hidden_screens: as partes ESCONDIDAS, chaves '<grupo>.<item>' do catálogo (domain/screens.js); [] = tudo visível.
-- screen_starts: "Abre em" { grupo: item } dos grupos que têm escolha; sem a chave, o primeiro visível.
--
-- Absorve os ajustes de tela que já existiam, convertendo o que está gravado (o perfil continua vendo o mesmo):
--   projects_lists (0037) → projects.lists.*; ongoing_view (0028) → projects.ongoing_views.* (+ "Abre em" Direção
--   quando eram as duas); tasks_list (0034) 'hidden' → tasks.screens.list, 'mine' → tasks.scopes.all;
--   tasks_hidden_boxes (0035) e tasks_all_box (0034) → tasks.boxes.*; tasks_start (0034) → "Abre em" tasks.screens
--   e tasks.boxes. Perfil sem caixa nenhuma: sem a Caixa de entrada (com a Lista) ou só Recebidas (sem a Lista),
--   como a tela já fazia. As colunas antigas ficam como estavam (sem uso), para voltar atrás sem perder nada.
--
-- Idempotente: as colunas novas e a conversão só acontecem uma vez (na segunda vez, nada muda).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'roles' AND column_name = 'hidden_screens'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE "roles" ADD COLUMN "hidden_screens" jsonb NOT NULL DEFAULT '[]'::jsonb;
  ALTER TABLE "roles" ADD COLUMN "screen_starts" jsonb NOT NULL DEFAULT '{}'::jsonb;

  UPDATE "roles" AS r
  SET "hidden_screens" = c.hidden, "screen_starts" = c.starts
  FROM (
    SELECT
      b.id,
      to_jsonb(array_remove(ARRAY[
        -- listas do menu Projetos: só quando há ao menos uma conhecida gravada ('' = as quatro)
        CASE WHEN b.lists_known AND NOT ('all' = ANY (b.lists)) THEN 'projects.lists.all' END,
        CASE WHEN b.lists_known AND NOT ('ongoing' = ANY (b.lists)) THEN 'projects.lists.ongoing' END,
        CASE WHEN b.lists_known AND NOT ('finished' = ANY (b.lists)) THEN 'projects.lists.finished' END,
        CASE WHEN b.lists_known AND NOT ('archived' = ANY (b.lists)) THEN 'projects.lists.archived' END,
        -- Em andamento: '' = só Gestão; 'executive' = só Direção e gerência; 'both' = as duas
        CASE WHEN b.ongoing_view = 'executive' THEN 'projects.ongoing_views.management' END,
        CASE WHEN b.ongoing_view NOT IN ('executive', 'both') THEN 'projects.ongoing_views.executive' END,
        -- Tarefas: a Lista e a Caixa de entrada
        CASE WHEN b.tasks_list = 'hidden' THEN 'tasks.screens.list' END,
        CASE WHEN b.no_box AND b.tasks_list <> 'hidden' THEN 'tasks.screens.inbox' END,
        CASE WHEN b.tasks_list = 'mine' THEN 'tasks.scopes.all' END,
        -- caixas (sem caixa nenhuma e sem a Lista: fica só Recebidas)
        CASE WHEN NOT b.no_box AND 'received' = ANY (b.boxes) THEN 'tasks.boxes.received' END,
        CASE WHEN (NOT b.no_box AND 'assigned' = ANY (b.boxes)) OR (b.no_box AND b.tasks_list = 'hidden') THEN 'tasks.boxes.assigned' END,
        CASE WHEN (NOT b.no_box AND 'requested' = ANY (b.boxes)) OR (b.no_box AND b.tasks_list = 'hidden') THEN 'tasks.boxes.requested' END,
        CASE WHEN (NOT b.no_box AND b.tasks_all_box = 'hidden') OR (b.no_box AND b.tasks_list = 'hidden') THEN 'tasks.boxes.all' END
      ]::text[], NULL)) AS hidden,
      jsonb_strip_nulls(jsonb_build_object(
        'projects.ongoing_views', CASE WHEN b.ongoing_view = 'both' THEN 'executive' END,
        'tasks.screens', CASE WHEN b.tasks_start <> '' AND NOT (b.no_box AND b.tasks_list <> 'hidden') THEN 'inbox' END,
        'tasks.boxes', CASE b.tasks_start
          WHEN 'inbox' THEN 'received'
          WHEN 'inbox_assigned' THEN 'assigned'
          WHEN 'inbox_requested' THEN 'requested'
          WHEN 'inbox_all' THEN 'all'
        END
      )) AS starts
    FROM (
      SELECT
        id,
        COALESCE(ongoing_view, '') AS ongoing_view,
        COALESCE(tasks_start, '') AS tasks_start,
        COALESCE(tasks_list, '') AS tasks_list,
        COALESCE(tasks_all_box, '') AS tasks_all_box,
        string_to_array(COALESCE(projects_lists, ''), ',') AS lists,
        string_to_array(COALESCE(projects_lists, ''), ',') && ARRAY['all', 'ongoing', 'finished', 'archived'] AS lists_known,
        string_to_array(COALESCE(tasks_hidden_boxes, ''), ',') AS boxes,
        (COALESCE(tasks_all_box, '') = 'hidden' AND string_to_array(COALESCE(tasks_hidden_boxes, ''), ',') @> ARRAY['received', 'assigned', 'requested']) AS no_box
      FROM "roles"
    ) AS b
  ) AS c
  WHERE c.id = r.id;
END $$;
