-- Esquema do Avanza no Postgres (ADR-044). Gerado em 2026-10-28 a partir das collections do PocketBase
-- (mesmos nomes de tabelas e colunas; ids de 15 caracteres). O executor de migrations aplica no esquema
-- configurado (KAMBAN_DB_SCHEMA, padrão "avanza") via search_path — por isso nada aqui é qualificado.
-- Convenções herdadas: texto vazio é '' (não NULL); números vazios são 0; relação vazia é NULL (com FK);
-- datas vazias são NULL; datas com milissegundos (timestamptz(3), como o PocketBase e a Date do JS);
-- "created"/"updated" com clock_timestamp() (a hora de cada gravação, não a do início da transação).

-- "updated" acompanha cada alteração (o PocketBase fazia isso ao salvar o registro)
CREATE FUNCTION touch_updated() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated := clock_timestamp();
  RETURN NEW;
END;
$$;

-- tabelas
CREATE TABLE "api_tokens" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL,
  "name" text NOT NULL DEFAULT '',
  "token_hash" text NOT NULL DEFAULT '',
  "prefix" text NOT NULL DEFAULT '',
  "expires_at" timestamptz(3),
  "last_used_at" timestamptz(3),
  "last_used_ip" text NOT NULL DEFAULT '',
  "revoked_at" timestamptz(3),
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "attachments" (
  "id" text PRIMARY KEY,
  "task_id" text NOT NULL,
  "file" text NOT NULL DEFAULT '',
  "name" text NOT NULL DEFAULT '',
  "mime" text NOT NULL DEFAULT '',
  "kind" text NOT NULL DEFAULT '',
  "size" integer NOT NULL DEFAULT 0,
  "uploaded_by" text,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "comment_id" text
);

CREATE TABLE "audit_logs" (
  "id" text PRIMARY KEY,
  "entity_type" text NOT NULL DEFAULT '',
  "entity_id" text NOT NULL DEFAULT '',
  "action" text NOT NULL DEFAULT '',
  "old_value" jsonb,
  "new_value" jsonb,
  "user_id" text,
  "ip" text NOT NULL DEFAULT '',
  "user_agent" text NOT NULL DEFAULT '',
  "correlation_id" text NOT NULL DEFAULT '',
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "auth_tokens" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL,
  "purpose" text NOT NULL DEFAULT '',
  "token_hash" text NOT NULL DEFAULT '',
  "expires_at" timestamptz(3),
  "used_at" timestamptz(3),
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "comments" (
  "id" text PRIMARY KEY,
  "task_id" text NOT NULL,
  "user_id" text NOT NULL,
  "content" text NOT NULL DEFAULT '',
  "mentions" jsonb,
  "edited_at" timestamptz(3),
  "deleted_at" timestamptz(3),
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "custom_field_options" (
  "id" text PRIMARY KEY,
  "field_id" text NOT NULL,
  "label" text NOT NULL DEFAULT '',
  "color" text NOT NULL DEFAULT '',
  "order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT false,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "custom_fields" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL DEFAULT '',
  "label" text NOT NULL DEFAULT '',
  "type" text NOT NULL DEFAULT '',
  "description" text NOT NULL DEFAULT '',
  "config" jsonb,
  "default_value" jsonb,
  "searchable" boolean NOT NULL DEFAULT false,
  "filterable" boolean NOT NULL DEFAULT false,
  "sortable" boolean NOT NULL DEFAULT false,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "doc_files" (
  "id" text PRIMARY KEY,
  "space_id" text NOT NULL,
  "page_id" text NOT NULL,
  "file" text NOT NULL DEFAULT '',
  "name" text NOT NULL DEFAULT '',
  "mime" text NOT NULL DEFAULT '',
  "kind" text NOT NULL DEFAULT '',
  "size" integer NOT NULL DEFAULT 0,
  "uploaded_by" text,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "doc_page_versions" (
  "id" text PRIMARY KEY,
  "page_id" text NOT NULL,
  "version" integer NOT NULL DEFAULT 0,
  "title" text NOT NULL DEFAULT '',
  "content" jsonb,
  "author" text,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "doc_pages" (
  "id" text PRIMARY KEY,
  "space_id" text NOT NULL,
  "parent_id" text NOT NULL DEFAULT '',
  "title" text NOT NULL DEFAULT '',
  "position" double precision NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT '',
  "content" jsonb,
  "content_text" text NOT NULL DEFAULT '',
  "search_text" text NOT NULL DEFAULT '',
  "version" integer NOT NULL DEFAULT 0,
  "published_at" timestamptz(3),
  "published_by" text,
  "draft" jsonb,
  "draft_title" text NOT NULL DEFAULT '',
  "draft_by" text,
  "draft_at" timestamptz(3),
  "created_by" text,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "doc_spaces" (
  "id" text PRIMARY KEY,
  "key" text NOT NULL DEFAULT '',
  "name" text NOT NULL DEFAULT '',
  "description" text NOT NULL DEFAULT '',
  "icon" text NOT NULL DEFAULT '',
  "color" text NOT NULL DEFAULT '',
  "project_id" text,
  "visibility" text NOT NULL DEFAULT '',
  "home_page_id" text NOT NULL DEFAULT '',
  "created_by" text,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "email_outbox" (
  "id" text PRIMARY KEY,
  "to" text NOT NULL DEFAULT '',
  "kind" text NOT NULL DEFAULT '',
  "subject" text NOT NULL DEFAULT '',
  "html" text NOT NULL DEFAULT '',
  "text" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT '',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text NOT NULL DEFAULT '',
  "next_attempt_at" timestamptz(3),
  "sent_at" timestamptz(3),
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "login_attempts" (
  "id" text PRIMARY KEY,
  "key" text NOT NULL DEFAULT '',
  "attempted_at" timestamptz(3)
);

CREATE TABLE "notifications" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL,
  "type" text NOT NULL DEFAULT '',
  "task_id" text,
  "actor_id" text,
  "data" jsonb,
  "dedupe_key" text NOT NULL DEFAULT '',
  "read_at" timestamptz(3),
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "plan_item_id" text,
  "project_id" text
);

CREATE TABLE "permissions" (
  "id" text PRIMARY KEY,
  "code" text NOT NULL DEFAULT '',
  "module" text NOT NULL DEFAULT '',
  "description" text NOT NULL DEFAULT '',
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "plan_columns" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "name" text NOT NULL DEFAULT '',
  "type" text NOT NULL DEFAULT '',
  "settings" jsonb,
  "position" double precision NOT NULL DEFAULT 0,
  "created_by" text,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "plan_issues" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "number" integer NOT NULL DEFAULT 0,
  "opened_on" timestamptz(3),
  "description" text NOT NULL DEFAULT '',
  "state" text NOT NULL DEFAULT '',
  "owner_id" text,
  "resolved_on" timestamptz(3),
  "created_by" text,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "plan_item_files" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "item_id" text NOT NULL,
  "file" text NOT NULL DEFAULT '',
  "name" text NOT NULL DEFAULT '',
  "mime" text NOT NULL DEFAULT '',
  "kind" text NOT NULL DEFAULT '',
  "size" integer NOT NULL DEFAULT 0,
  "uploaded_by" text,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "update_id" text
);

CREATE TABLE "plan_item_links" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "from_id" text NOT NULL,
  "to_id" text NOT NULL,
  "type" text NOT NULL DEFAULT '',
  "created_by" text,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "plan_item_updates" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "item_id" text NOT NULL,
  "parent_id" text NOT NULL DEFAULT '',
  "author_id" text,
  "content" text NOT NULL DEFAULT '',
  "mentions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "edited_at" timestamptz(3),
  "deleted_at" timestamptz(3),
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "plan_items" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "group_id" text NOT NULL,
  "parent_id" text NOT NULL DEFAULT '',
  "name" text NOT NULL DEFAULT '',
  "status_id" text NOT NULL DEFAULT '',
  "start_date" timestamptz(3),
  "end_date" timestamptz(3),
  "due_date" timestamptz(3),
  "owner_id" text,
  "resource_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metrics" jsonb,
  "progress" integer NOT NULL DEFAULT 0,
  "progress_set" boolean NOT NULL DEFAULT false,
  "position" double precision NOT NULL DEFAULT 0,
  "created_by" text,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "custom" jsonb
);

CREATE TABLE "plan_journal" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "entry_date" timestamptz(3),
  "content" text NOT NULL DEFAULT '',
  "author_id" text,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "plan_resources" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "name" text NOT NULL DEFAULT '',
  "name_key" text NOT NULL DEFAULT '',
  "color" text NOT NULL DEFAULT '',
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "plan_settings" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "dependency_rule" text NOT NULL DEFAULT '',
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "baseline" jsonb,
  "issue_seq" integer NOT NULL DEFAULT 0
);

CREATE TABLE "plan_statuses" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "name" text NOT NULL DEFAULT '',
  "color" text NOT NULL DEFAULT '',
  "category" text NOT NULL DEFAULT '',
  "position" double precision NOT NULL DEFAULT 0,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "platform_settings" (
  "id" text PRIMARY KEY,
  "values" jsonb,
  "files" jsonb,
  "logo_light" text NOT NULL DEFAULT '',
  "logo_dark" text NOT NULL DEFAULT '',
  "favicon" text NOT NULL DEFAULT '',
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "project_groups" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "parent_id" text NOT NULL DEFAULT '',
  "name" text NOT NULL DEFAULT '',
  "color" text NOT NULL DEFAULT '',
  "position" double precision NOT NULL DEFAULT 0,
  "created_by" text,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "project_members" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "user_id" text NOT NULL,
  "role" text NOT NULL DEFAULT '',
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "project_milestones" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "name" text NOT NULL DEFAULT '',
  "description" text NOT NULL DEFAULT '',
  "due_date" timestamptz(3),
  "state" text NOT NULL DEFAULT '',
  "created_by" text,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "projects" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL DEFAULT '',
  "key" text NOT NULL DEFAULT '',
  "description" text NOT NULL DEFAULT '',
  "icon" text NOT NULL DEFAULT '',
  "cover" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT '',
  "priority" text NOT NULL DEFAULT '',
  "owner_id" text NOT NULL,
  "created_by" text,
  "start_date" timestamptz(3),
  "due_date" timestamptz(3),
  "archived_at" timestamptz(3),
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "role_permissions" (
  "id" text PRIMARY KEY,
  "role_id" text NOT NULL,
  "permission_id" text NOT NULL,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "roles" (
  "id" text PRIMARY KEY,
  "code" text NOT NULL DEFAULT '',
  "name" text NOT NULL DEFAULT '',
  "description" text NOT NULL DEFAULT '',
  "is_system" boolean NOT NULL DEFAULT false,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "sessions" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL,
  "token_hash" text NOT NULL DEFAULT '',
  "ip" text NOT NULL DEFAULT '',
  "user_agent" text NOT NULL DEFAULT '',
  "remember" boolean NOT NULL DEFAULT false,
  "expires_at" timestamptz(3),
  "last_seen_at" timestamptz(3),
  "revoked_at" timestamptz(3),
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "sprints" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "name" text NOT NULL DEFAULT '',
  "goal" text NOT NULL DEFAULT '',
  "start_date" timestamptz(3),
  "end_date" timestamptz(3),
  "state" text NOT NULL DEFAULT '',
  "order" integer NOT NULL DEFAULT 0,
  "created_by" text,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "tags" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL DEFAULT '',
  "name_key" text NOT NULL DEFAULT '',
  "color" text NOT NULL DEFAULT '',
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "task_custom_values" (
  "id" text PRIMARY KEY,
  "task_id" text NOT NULL,
  "field_id" text NOT NULL,
  "value" jsonb,
  "value_text" text NOT NULL DEFAULT '',
  "value_number" double precision NOT NULL DEFAULT 0,
  "value_date" timestamptz(3),
  "value_bool" boolean NOT NULL DEFAULT false
);

CREATE TABLE "task_priorities" (
  "id" text PRIMARY KEY,
  "key" text NOT NULL DEFAULT '',
  "name" text NOT NULL DEFAULT '',
  "description" text NOT NULL DEFAULT '',
  "color" text NOT NULL DEFAULT '',
  "order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT false,
  "is_default" boolean NOT NULL DEFAULT false,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "task_relations" (
  "id" text PRIMARY KEY,
  "source_task_id" text NOT NULL,
  "target_task_id" text NOT NULL,
  "relation_type" text NOT NULL DEFAULT '',
  "created_by" text,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "task_statuses" (
  "id" text PRIMARY KEY,
  "key" text NOT NULL DEFAULT '',
  "name" text NOT NULL DEFAULT '',
  "description" text NOT NULL DEFAULT '',
  "color" text NOT NULL DEFAULT '',
  "order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT false,
  "is_default" boolean NOT NULL DEFAULT false,
  "category" text NOT NULL DEFAULT '',
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "wip_limit" integer NOT NULL DEFAULT 0,
  "allowed_next" jsonb
);

CREATE TABLE "task_tag_relations" (
  "id" text PRIMARY KEY,
  "task_id" text NOT NULL,
  "tag_id" text NOT NULL
);

CREATE TABLE "task_type_fields" (
  "id" text PRIMARY KEY,
  "task_type_id" text NOT NULL,
  "field_id" text NOT NULL,
  "order" integer NOT NULL DEFAULT 0,
  "required" boolean NOT NULL DEFAULT false,
  "visible" boolean NOT NULL DEFAULT false,
  "show_on_card" boolean NOT NULL DEFAULT false,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "required_status_ids" jsonb
);

CREATE TABLE "task_types" (
  "id" text PRIMARY KEY,
  "key" text NOT NULL DEFAULT '',
  "name" text NOT NULL DEFAULT '',
  "description" text NOT NULL DEFAULT '',
  "icon" text NOT NULL DEFAULT '',
  "color" text NOT NULL DEFAULT '',
  "order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT false,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "translations" jsonb
);

CREATE TABLE "tasks" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL,
  "number" integer NOT NULL DEFAULT 0,
  "code" text NOT NULL DEFAULT '',
  "title" text NOT NULL DEFAULT '',
  "description" text NOT NULL DEFAULT '',
  "task_type_id" text NOT NULL,
  "status_id" text NOT NULL,
  "priority_id" text NOT NULL,
  "creator_id" text,
  "assignee_id" text,
  "reporter_id" text,
  "due_date" timestamptz(3),
  "started_at" timestamptz(3),
  "completed_at" timestamptz(3),
  "estimated_hours" double precision NOT NULL DEFAULT 0,
  "actual_hours" double precision NOT NULL DEFAULT 0,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "parent_task_id" text,
  "checklist" jsonb,
  "position" double precision NOT NULL DEFAULT 0,
  "sprint_id" text,
  "forked_from_task_id" text,
  "start_date" timestamptz(3)
);

CREATE TABLE "users" (
  "id" text PRIMARY KEY,
  "password_hash" text NOT NULL DEFAULT '',
  "email" text NOT NULL DEFAULT '',
  "name" text NOT NULL DEFAULT '',
  "avatar" text NOT NULL DEFAULT '',
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "status" text NOT NULL DEFAULT '',
  "role_id" text NOT NULL,
  "last_login_at" timestamptz(3),
  "locale" text NOT NULL DEFAULT '',
  "theme" text NOT NULL DEFAULT '',
  "email_notifications_off" boolean NOT NULL DEFAULT false
);

CREATE TABLE "webhook_deliveries" (
  "id" text PRIMARY KEY,
  "webhook_id" text NOT NULL,
  "event" text NOT NULL DEFAULT '',
  "payload" jsonb,
  "status" text NOT NULL DEFAULT '',
  "attempts" integer NOT NULL DEFAULT 0,
  "response_status" integer NOT NULL DEFAULT 0,
  "response_body" text NOT NULL DEFAULT '',
  "error" text NOT NULL DEFAULT '',
  "duration_ms" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz(3),
  "delivered_at" timestamptz(3),
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "webhooks" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL DEFAULT '',
  "url" text NOT NULL DEFAULT '',
  "events" jsonb,
  "secret" text NOT NULL DEFAULT '',
  "active" boolean NOT NULL DEFAULT false,
  "created_by" text,
  "last_status" integer NOT NULL DEFAULT 0,
  "last_delivery_at" timestamptz(3),
  "consecutive_failures" integer NOT NULL DEFAULT 0,
  "created" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

-- chaves estrangeiras (relações do PocketBase; cascadeDelete → CASCADE, obrigatória → RESTRICT, opcional → SET NULL)
-- DEFERRABLE: a cópia dos dados do PocketBase adia a checagem para o fim da transação
ALTER TABLE "api_tokens" ADD CONSTRAINT "fk_api_tokens_user_id" FOREIGN KEY ("user_id") REFERENCES "users" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "attachments" ADD CONSTRAINT "fk_attachments_task_id" FOREIGN KEY ("task_id") REFERENCES "tasks" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "attachments" ADD CONSTRAINT "fk_attachments_uploaded_by" FOREIGN KEY ("uploaded_by") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "attachments" ADD CONSTRAINT "fk_attachments_comment_id" FOREIGN KEY ("comment_id") REFERENCES "comments" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_logs_user_id" FOREIGN KEY ("user_id") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "auth_tokens" ADD CONSTRAINT "fk_auth_tokens_user_id" FOREIGN KEY ("user_id") REFERENCES "users" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "comments" ADD CONSTRAINT "fk_comments_task_id" FOREIGN KEY ("task_id") REFERENCES "tasks" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "comments" ADD CONSTRAINT "fk_comments_user_id" FOREIGN KEY ("user_id") REFERENCES "users" (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "custom_field_options" ADD CONSTRAINT "fk_custom_field_options_field_id" FOREIGN KEY ("field_id") REFERENCES "custom_fields" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "doc_files" ADD CONSTRAINT "fk_doc_files_space_id" FOREIGN KEY ("space_id") REFERENCES "doc_spaces" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "doc_files" ADD CONSTRAINT "fk_doc_files_page_id" FOREIGN KEY ("page_id") REFERENCES "doc_pages" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "doc_files" ADD CONSTRAINT "fk_doc_files_uploaded_by" FOREIGN KEY ("uploaded_by") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "doc_page_versions" ADD CONSTRAINT "fk_doc_page_versions_page_id" FOREIGN KEY ("page_id") REFERENCES "doc_pages" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "doc_page_versions" ADD CONSTRAINT "fk_doc_page_versions_author" FOREIGN KEY ("author") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "doc_pages" ADD CONSTRAINT "fk_doc_pages_space_id" FOREIGN KEY ("space_id") REFERENCES "doc_spaces" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "doc_pages" ADD CONSTRAINT "fk_doc_pages_published_by" FOREIGN KEY ("published_by") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "doc_pages" ADD CONSTRAINT "fk_doc_pages_draft_by" FOREIGN KEY ("draft_by") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "doc_pages" ADD CONSTRAINT "fk_doc_pages_created_by" FOREIGN KEY ("created_by") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "doc_spaces" ADD CONSTRAINT "fk_doc_spaces_project_id" FOREIGN KEY ("project_id") REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "doc_spaces" ADD CONSTRAINT "fk_doc_spaces_created_by" FOREIGN KEY ("created_by") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notifications_user_id" FOREIGN KEY ("user_id") REFERENCES "users" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notifications_task_id" FOREIGN KEY ("task_id") REFERENCES "tasks" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notifications_actor_id" FOREIGN KEY ("actor_id") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notifications_plan_item_id" FOREIGN KEY ("plan_item_id") REFERENCES "plan_items" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notifications_project_id" FOREIGN KEY ("project_id") REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_columns" ADD CONSTRAINT "fk_plan_columns_project_id" FOREIGN KEY ("project_id") REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_columns" ADD CONSTRAINT "fk_plan_columns_created_by" FOREIGN KEY ("created_by") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_issues" ADD CONSTRAINT "fk_plan_issues_project_id" FOREIGN KEY ("project_id") REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_issues" ADD CONSTRAINT "fk_plan_issues_owner_id" FOREIGN KEY ("owner_id") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_issues" ADD CONSTRAINT "fk_plan_issues_created_by" FOREIGN KEY ("created_by") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_item_files" ADD CONSTRAINT "fk_plan_item_files_project_id" FOREIGN KEY ("project_id") REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_item_files" ADD CONSTRAINT "fk_plan_item_files_item_id" FOREIGN KEY ("item_id") REFERENCES "plan_items" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_item_files" ADD CONSTRAINT "fk_plan_item_files_uploaded_by" FOREIGN KEY ("uploaded_by") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_item_files" ADD CONSTRAINT "fk_plan_item_files_update_id" FOREIGN KEY ("update_id") REFERENCES "plan_item_updates" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_item_links" ADD CONSTRAINT "fk_plan_item_links_project_id" FOREIGN KEY ("project_id") REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_item_links" ADD CONSTRAINT "fk_plan_item_links_from_id" FOREIGN KEY ("from_id") REFERENCES "plan_items" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_item_links" ADD CONSTRAINT "fk_plan_item_links_to_id" FOREIGN KEY ("to_id") REFERENCES "plan_items" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_item_links" ADD CONSTRAINT "fk_plan_item_links_created_by" FOREIGN KEY ("created_by") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_item_updates" ADD CONSTRAINT "fk_plan_item_updates_project_id" FOREIGN KEY ("project_id") REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_item_updates" ADD CONSTRAINT "fk_plan_item_updates_item_id" FOREIGN KEY ("item_id") REFERENCES "plan_items" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_item_updates" ADD CONSTRAINT "fk_plan_item_updates_author_id" FOREIGN KEY ("author_id") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_items" ADD CONSTRAINT "fk_plan_items_project_id" FOREIGN KEY ("project_id") REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_items" ADD CONSTRAINT "fk_plan_items_group_id" FOREIGN KEY ("group_id") REFERENCES "project_groups" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_items" ADD CONSTRAINT "fk_plan_items_owner_id" FOREIGN KEY ("owner_id") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_items" ADD CONSTRAINT "fk_plan_items_created_by" FOREIGN KEY ("created_by") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_journal" ADD CONSTRAINT "fk_plan_journal_project_id" FOREIGN KEY ("project_id") REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_journal" ADD CONSTRAINT "fk_plan_journal_author_id" FOREIGN KEY ("author_id") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_resources" ADD CONSTRAINT "fk_plan_resources_project_id" FOREIGN KEY ("project_id") REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_settings" ADD CONSTRAINT "fk_plan_settings_project_id" FOREIGN KEY ("project_id") REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "plan_statuses" ADD CONSTRAINT "fk_plan_statuses_project_id" FOREIGN KEY ("project_id") REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "project_groups" ADD CONSTRAINT "fk_project_groups_project_id" FOREIGN KEY ("project_id") REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "project_groups" ADD CONSTRAINT "fk_project_groups_created_by" FOREIGN KEY ("created_by") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "project_members" ADD CONSTRAINT "fk_project_members_project_id" FOREIGN KEY ("project_id") REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "project_members" ADD CONSTRAINT "fk_project_members_user_id" FOREIGN KEY ("user_id") REFERENCES "users" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "project_milestones" ADD CONSTRAINT "fk_project_milestones_project_id" FOREIGN KEY ("project_id") REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "project_milestones" ADD CONSTRAINT "fk_project_milestones_created_by" FOREIGN KEY ("created_by") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "projects" ADD CONSTRAINT "fk_projects_owner_id" FOREIGN KEY ("owner_id") REFERENCES "users" (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "projects" ADD CONSTRAINT "fk_projects_created_by" FOREIGN KEY ("created_by") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "fk_role_permissions_role_id" FOREIGN KEY ("role_id") REFERENCES "roles" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "fk_role_permissions_permission_id" FOREIGN KEY ("permission_id") REFERENCES "permissions" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "sessions" ADD CONSTRAINT "fk_sessions_user_id" FOREIGN KEY ("user_id") REFERENCES "users" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "sprints" ADD CONSTRAINT "fk_sprints_project_id" FOREIGN KEY ("project_id") REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "sprints" ADD CONSTRAINT "fk_sprints_created_by" FOREIGN KEY ("created_by") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "task_custom_values" ADD CONSTRAINT "fk_task_custom_values_task_id" FOREIGN KEY ("task_id") REFERENCES "tasks" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "task_custom_values" ADD CONSTRAINT "fk_task_custom_values_field_id" FOREIGN KEY ("field_id") REFERENCES "custom_fields" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "task_relations" ADD CONSTRAINT "fk_task_relations_source_task_id" FOREIGN KEY ("source_task_id") REFERENCES "tasks" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "task_relations" ADD CONSTRAINT "fk_task_relations_target_task_id" FOREIGN KEY ("target_task_id") REFERENCES "tasks" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "task_relations" ADD CONSTRAINT "fk_task_relations_created_by" FOREIGN KEY ("created_by") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "task_tag_relations" ADD CONSTRAINT "fk_task_tag_relations_task_id" FOREIGN KEY ("task_id") REFERENCES "tasks" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "task_tag_relations" ADD CONSTRAINT "fk_task_tag_relations_tag_id" FOREIGN KEY ("tag_id") REFERENCES "tags" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "task_type_fields" ADD CONSTRAINT "fk_task_type_fields_task_type_id" FOREIGN KEY ("task_type_id") REFERENCES "task_types" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "task_type_fields" ADD CONSTRAINT "fk_task_type_fields_field_id" FOREIGN KEY ("field_id") REFERENCES "custom_fields" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_project_id" FOREIGN KEY ("project_id") REFERENCES "projects" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_task_type_id" FOREIGN KEY ("task_type_id") REFERENCES "task_types" (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_status_id" FOREIGN KEY ("status_id") REFERENCES "task_statuses" (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_priority_id" FOREIGN KEY ("priority_id") REFERENCES "task_priorities" (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_creator_id" FOREIGN KEY ("creator_id") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_assignee_id" FOREIGN KEY ("assignee_id") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_reporter_id" FOREIGN KEY ("reporter_id") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_parent_task_id" FOREIGN KEY ("parent_task_id") REFERENCES "tasks" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_sprint_id" FOREIGN KEY ("sprint_id") REFERENCES "sprints" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_forked_from_task_id" FOREIGN KEY ("forked_from_task_id") REFERENCES "tasks" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "users" ADD CONSTRAINT "fk_users_role_id" FOREIGN KEY ("role_id") REFERENCES "roles" (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "fk_webhook_deliveries_webhook_id" FOREIGN KEY ("webhook_id") REFERENCES "webhooks" (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "webhooks" ADD CONSTRAINT "fk_webhooks_created_by" FOREIGN KEY ("created_by") REFERENCES "users" (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;

-- índices
CREATE UNIQUE INDEX idx_api_tokens_hash ON api_tokens (token_hash);
CREATE INDEX idx_api_tokens_user ON api_tokens (user_id, created);
CREATE INDEX idx_attachments_task ON attachments (task_id, created);
CREATE INDEX "idx_attachments_comment" ON "attachments" (comment_id);
CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_entity_id ON audit_logs (entity_id);
CREATE INDEX idx_audit_user ON audit_logs (user_id);
CREATE INDEX idx_audit_created ON audit_logs (created);
CREATE UNIQUE INDEX idx_auth_tokens_hash ON auth_tokens (token_hash);
CREATE INDEX idx_auth_tokens_user ON auth_tokens (user_id, purpose, created);
CREATE INDEX idx_comments_task ON comments (task_id, created);
CREATE INDEX idx_comments_user ON comments (user_id);
CREATE INDEX idx_custom_field_options_field ON custom_field_options (field_id);
CREATE UNIQUE INDEX idx_custom_fields_name ON custom_fields (name);
CREATE INDEX idx_custom_fields_type ON custom_fields (type);
CREATE INDEX idx_doc_files_page ON doc_files (page_id, created);
CREATE UNIQUE INDEX idx_doc_versions_page ON doc_page_versions (page_id, version);
CREATE INDEX idx_doc_pages_tree ON doc_pages (space_id, parent_id, position);
CREATE INDEX idx_doc_pages_status ON doc_pages (space_id, status, published_at);
CREATE UNIQUE INDEX idx_doc_spaces_key ON doc_spaces (key);
CREATE INDEX idx_doc_spaces_project ON doc_spaces (project_id);
CREATE INDEX idx_email_outbox_due ON email_outbox (status, next_attempt_at, created);
CREATE INDEX idx_login_attempts_key ON login_attempts (key, attempted_at);
CREATE INDEX idx_notifications_inbox ON notifications (user_id, read_at, created);
CREATE UNIQUE INDEX idx_notifications_dedupe ON notifications (user_id, dedupe_key) WHERE dedupe_key != '';
CREATE UNIQUE INDEX idx_permissions_code ON permissions (code);
CREATE INDEX idx_plan_columns_project ON plan_columns (project_id, position);
CREATE UNIQUE INDEX idx_plan_issues_number ON plan_issues (project_id, number);
CREATE INDEX idx_plan_item_files_item ON plan_item_files (item_id, created);
CREATE INDEX idx_plan_item_files_project ON plan_item_files (project_id);
CREATE INDEX idx_plan_item_files_update ON plan_item_files (update_id);
CREATE UNIQUE INDEX idx_plan_item_links_pair ON plan_item_links (from_id, to_id, type);
CREATE INDEX idx_plan_item_links_project ON plan_item_links (project_id);
CREATE INDEX idx_plan_item_updates_item ON plan_item_updates (item_id, created);
CREATE INDEX idx_plan_item_updates_project ON plan_item_updates (project_id);
CREATE INDEX idx_plan_items_order ON plan_items (project_id, group_id, parent_id, position);
CREATE INDEX idx_plan_journal_project ON plan_journal (project_id, entry_date);
CREATE UNIQUE INDEX idx_plan_resources_name ON plan_resources (project_id, name_key);
CREATE UNIQUE INDEX idx_plan_settings_project ON plan_settings (project_id);
CREATE INDEX idx_plan_statuses_project ON plan_statuses (project_id, position);
CREATE INDEX idx_project_groups_order ON project_groups (project_id, parent_id, position);
CREATE UNIQUE INDEX idx_project_members_pair ON project_members (project_id, user_id);
CREATE INDEX idx_project_members_user ON project_members (user_id);
CREATE INDEX idx_milestones_project ON project_milestones (project_id, due_date);
CREATE UNIQUE INDEX idx_projects_key ON projects (key);
CREATE INDEX idx_projects_owner ON projects (owner_id);
CREATE INDEX idx_projects_status ON projects (status);
CREATE INDEX idx_projects_archived ON projects (archived_at);
CREATE INDEX idx_projects_name ON projects (name);
CREATE UNIQUE INDEX idx_role_permissions_pair ON role_permissions (role_id, permission_id);
CREATE INDEX idx_role_permissions_permission ON role_permissions (permission_id);
CREATE UNIQUE INDEX idx_roles_code ON roles (code);
CREATE UNIQUE INDEX idx_sessions_token_hash ON sessions (token_hash);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);
CREATE INDEX idx_sprints_project ON sprints (project_id, state);
CREATE UNIQUE INDEX idx_tags_name_key ON tags (name_key);
CREATE UNIQUE INDEX idx_task_values_pair ON task_custom_values (task_id, field_id);
CREATE INDEX idx_task_values_text ON task_custom_values (field_id, value_text);
CREATE INDEX idx_task_values_number ON task_custom_values (field_id, value_number);
CREATE INDEX idx_task_values_date ON task_custom_values (field_id, value_date);
CREATE UNIQUE INDEX idx_task_priorities_key ON task_priorities (key);
CREATE INDEX idx_task_priorities_order ON task_priorities ("order");
CREATE UNIQUE INDEX idx_task_relations_unique ON task_relations (source_task_id, target_task_id, relation_type);
CREATE INDEX idx_task_relations_target ON task_relations (target_task_id, relation_type);
CREATE UNIQUE INDEX idx_task_statuses_key ON task_statuses (key);
CREATE INDEX idx_task_statuses_order ON task_statuses ("order");
CREATE UNIQUE INDEX idx_task_tags_pair ON task_tag_relations (task_id, tag_id);
CREATE INDEX idx_task_tags_tag ON task_tag_relations (tag_id);
CREATE UNIQUE INDEX idx_task_type_fields_pair ON task_type_fields (task_type_id, field_id);
CREATE INDEX idx_task_type_fields_field ON task_type_fields (field_id);
CREATE UNIQUE INDEX idx_task_types_key ON task_types (key);
CREATE INDEX idx_task_types_order ON task_types ("order");
CREATE UNIQUE INDEX idx_tasks_project_number ON tasks (project_id, number);
CREATE UNIQUE INDEX idx_tasks_code ON tasks (code);
CREATE INDEX idx_tasks_status ON tasks (status_id);
CREATE INDEX idx_tasks_priority ON tasks (priority_id);
CREATE INDEX idx_tasks_type ON tasks (task_type_id);
CREATE INDEX idx_tasks_assignee ON tasks (assignee_id);
CREATE INDEX idx_tasks_creator ON tasks (creator_id);
CREATE INDEX idx_tasks_created ON tasks (created);
CREATE INDEX idx_tasks_due_date ON tasks (due_date);
CREATE INDEX "idx_tasks_parent" ON "tasks" (parent_task_id);
CREATE INDEX "idx_tasks_board" ON "tasks" (project_id, status_id, position);
CREATE INDEX "idx_tasks_sprint" ON "tasks" (sprint_id);
CREATE INDEX "idx_tasks_forked_from" ON "tasks" (forked_from_task_id);
CREATE INDEX "idx_tasks_start_date" ON "tasks" (project_id, start_date);
CREATE UNIQUE INDEX "idx_email__pb_users_auth_" ON "users" (lower("email"));
CREATE INDEX "idx_users_role" ON "users" (role_id);
CREATE INDEX "idx_users_status" ON "users" (status);
CREATE INDEX "idx_users_name" ON "users" (name);
CREATE INDEX idx_webhook_deliveries_due ON webhook_deliveries (status, next_attempt_at, created);
CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries (webhook_id, created);
CREATE INDEX idx_webhooks_active ON webhooks (active);

-- "updated" automático
CREATE TRIGGER "trg_api_tokens_updated" BEFORE UPDATE ON "api_tokens" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_auth_tokens_updated" BEFORE UPDATE ON "auth_tokens" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_comments_updated" BEFORE UPDATE ON "comments" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_custom_field_options_updated" BEFORE UPDATE ON "custom_field_options" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_custom_fields_updated" BEFORE UPDATE ON "custom_fields" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_doc_pages_updated" BEFORE UPDATE ON "doc_pages" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_doc_spaces_updated" BEFORE UPDATE ON "doc_spaces" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_email_outbox_updated" BEFORE UPDATE ON "email_outbox" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_permissions_updated" BEFORE UPDATE ON "permissions" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_plan_columns_updated" BEFORE UPDATE ON "plan_columns" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_plan_issues_updated" BEFORE UPDATE ON "plan_issues" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_plan_item_updates_updated" BEFORE UPDATE ON "plan_item_updates" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_plan_items_updated" BEFORE UPDATE ON "plan_items" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_plan_journal_updated" BEFORE UPDATE ON "plan_journal" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_plan_resources_updated" BEFORE UPDATE ON "plan_resources" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_plan_settings_updated" BEFORE UPDATE ON "plan_settings" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_plan_statuses_updated" BEFORE UPDATE ON "plan_statuses" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_platform_settings_updated" BEFORE UPDATE ON "platform_settings" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_project_groups_updated" BEFORE UPDATE ON "project_groups" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_project_members_updated" BEFORE UPDATE ON "project_members" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_project_milestones_updated" BEFORE UPDATE ON "project_milestones" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_projects_updated" BEFORE UPDATE ON "projects" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_role_permissions_updated" BEFORE UPDATE ON "role_permissions" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_roles_updated" BEFORE UPDATE ON "roles" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_sessions_updated" BEFORE UPDATE ON "sessions" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_sprints_updated" BEFORE UPDATE ON "sprints" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_tags_updated" BEFORE UPDATE ON "tags" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_task_priorities_updated" BEFORE UPDATE ON "task_priorities" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_task_statuses_updated" BEFORE UPDATE ON "task_statuses" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_task_type_fields_updated" BEFORE UPDATE ON "task_type_fields" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_task_types_updated" BEFORE UPDATE ON "task_types" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_tasks_updated" BEFORE UPDATE ON "tasks" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_users_updated" BEFORE UPDATE ON "users" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_webhook_deliveries_updated" BEFORE UPDATE ON "webhook_deliveries" FOR EACH ROW EXECUTE FUNCTION touch_updated();
CREATE TRIGGER "trg_webhooks_updated" BEFORE UPDATE ON "webhooks" FOR EACH ROW EXECUTE FUNCTION touch_updated();
