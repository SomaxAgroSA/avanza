-- Projetos por perfil (ajuste 25/11/2026), escolhido em Controle de acesso → Perfis: as listas que aparecem no
-- menu Projetos, sem mudar o que a pessoa pode fazer (isso continua nas permissões do perfil).
-- projects_lists: as listas visíveis, separadas por vírgula e na ordem do menu ('all', 'ongoing', 'finished',
-- 'archived'); '' = as quatro (como antes). Sempre ao menos uma. Lista fechada em domain/permissions.js#PROJECT_LISTS.
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "projects_lists" text NOT NULL DEFAULT '';
