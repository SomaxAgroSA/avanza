-- Tempo real (regras de negócio §19): cada gravação numa tabela observada (domain/realtime.js#WATCHED)
-- avisa o canal "realtime_<esquema>" com os identificadores (tabela, ação, id e os vínculos com projeto,
-- tarefa, elemento e pessoa). O Postgres só entrega o aviso depois do commit; cada instância da API
-- escuta o canal e repassa às conexões SSE. TG_ARGV: colunas do projeto, da tarefa, do elemento e da
-- pessoa ('' quando a tabela não tem; 'id' em projects).
CREATE FUNCTION notify_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r jsonb;
  col text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := to_jsonb(OLD);
  ELSE
    r := to_jsonb(NEW);
  END IF;
  PERFORM pg_notify(
    'realtime_' || TG_TABLE_SCHEMA,
    json_build_object(
      'collection', TG_TABLE_NAME,
      'action', CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END,
      'id', r ->> 'id',
      'projectId', NULLIF(r ->> NULLIF(TG_ARGV[0], ''), ''),
      'taskId', NULLIF(r ->> NULLIF(TG_ARGV[1], ''), ''),
      'itemId', NULLIF(r ->> NULLIF(TG_ARGV[2], ''), ''),
      'userId', NULLIF(r ->> NULLIF(TG_ARGV[3], ''), '')
    )::text
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER "trg_tasks_realtime" AFTER INSERT OR UPDATE OR DELETE ON "tasks" FOR EACH ROW EXECUTE FUNCTION notify_change('project_id', '', '', '');
CREATE TRIGGER "trg_comments_realtime" AFTER INSERT OR UPDATE OR DELETE ON "comments" FOR EACH ROW EXECUTE FUNCTION notify_change('', 'task_id', '', '');
CREATE TRIGGER "trg_attachments_realtime" AFTER INSERT OR UPDATE OR DELETE ON "attachments" FOR EACH ROW EXECUTE FUNCTION notify_change('', 'task_id', '', '');
CREATE TRIGGER "trg_task_relations_realtime" AFTER INSERT OR UPDATE OR DELETE ON "task_relations" FOR EACH ROW EXECUTE FUNCTION notify_change('', 'source_task_id', '', '');
CREATE TRIGGER "trg_sprints_realtime" AFTER INSERT OR UPDATE OR DELETE ON "sprints" FOR EACH ROW EXECUTE FUNCTION notify_change('project_id', '', '', '');
CREATE TRIGGER "trg_project_milestones_realtime" AFTER INSERT OR UPDATE OR DELETE ON "project_milestones" FOR EACH ROW EXECUTE FUNCTION notify_change('project_id', '', '', '');
CREATE TRIGGER "trg_projects_realtime" AFTER INSERT OR UPDATE OR DELETE ON "projects" FOR EACH ROW EXECUTE FUNCTION notify_change('id', '', '', '');
CREATE TRIGGER "trg_project_members_realtime" AFTER INSERT OR UPDATE OR DELETE ON "project_members" FOR EACH ROW EXECUTE FUNCTION notify_change('project_id', '', '', '');
CREATE TRIGGER "trg_project_groups_realtime" AFTER INSERT OR UPDATE OR DELETE ON "project_groups" FOR EACH ROW EXECUTE FUNCTION notify_change('project_id', '', '', '');
CREATE TRIGGER "trg_plan_items_realtime" AFTER INSERT OR UPDATE OR DELETE ON "plan_items" FOR EACH ROW EXECUTE FUNCTION notify_change('project_id', '', '', '');
CREATE TRIGGER "trg_plan_statuses_realtime" AFTER INSERT OR UPDATE OR DELETE ON "plan_statuses" FOR EACH ROW EXECUTE FUNCTION notify_change('project_id', '', '', '');
CREATE TRIGGER "trg_plan_resources_realtime" AFTER INSERT OR UPDATE OR DELETE ON "plan_resources" FOR EACH ROW EXECUTE FUNCTION notify_change('project_id', '', '', '');
CREATE TRIGGER "trg_plan_item_links_realtime" AFTER INSERT OR UPDATE OR DELETE ON "plan_item_links" FOR EACH ROW EXECUTE FUNCTION notify_change('project_id', '', '', '');
CREATE TRIGGER "trg_plan_item_updates_realtime" AFTER INSERT OR UPDATE OR DELETE ON "plan_item_updates" FOR EACH ROW EXECUTE FUNCTION notify_change('project_id', '', 'item_id', '');
CREATE TRIGGER "trg_plan_item_files_realtime" AFTER INSERT OR UPDATE OR DELETE ON "plan_item_files" FOR EACH ROW EXECUTE FUNCTION notify_change('project_id', '', 'item_id', '');
CREATE TRIGGER "trg_plan_journal_realtime" AFTER INSERT OR UPDATE OR DELETE ON "plan_journal" FOR EACH ROW EXECUTE FUNCTION notify_change('project_id', '', '', '');
CREATE TRIGGER "trg_plan_issues_realtime" AFTER INSERT OR UPDATE OR DELETE ON "plan_issues" FOR EACH ROW EXECUTE FUNCTION notify_change('project_id', '', '', '');
CREATE TRIGGER "trg_plan_columns_realtime" AFTER INSERT OR UPDATE OR DELETE ON "plan_columns" FOR EACH ROW EXECUTE FUNCTION notify_change('project_id', '', '', '');
CREATE TRIGGER "trg_plan_settings_realtime" AFTER INSERT OR UPDATE OR DELETE ON "plan_settings" FOR EACH ROW EXECUTE FUNCTION notify_change('project_id', '', '', '');
CREATE TRIGGER "trg_notifications_realtime" AFTER INSERT OR UPDATE OR DELETE ON "notifications" FOR EACH ROW EXECUTE FUNCTION notify_change('', 'task_id', '', 'user_id');
