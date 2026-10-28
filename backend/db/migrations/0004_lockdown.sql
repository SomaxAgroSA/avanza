-- Só a API acessa estas tabelas (conexão direta do Postgres). No Supabase, a API REST (PostgREST) e o
-- Realtime usam os papéis anon/authenticated: sem permissão no esquema e com RLS ligado sem nenhuma
-- política, nada passa por eles — mesmo que alguém exponha o esquema por engano. O dono das tabelas
-- (o usuário da API) não é afetado pelo RLS.
DO $$
DECLARE
  t record;
  r text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', current_schema(), r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', current_schema(), r);
    END IF;
  END LOOP;
END
$$;
