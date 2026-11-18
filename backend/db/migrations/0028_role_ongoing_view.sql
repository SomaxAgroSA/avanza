-- Vista da lista "Em andamento" por perfil (§41), escolhida em Controle de acesso → Perfis.
-- '' = Gestão (a tela de sempre); 'executive' = Direção e gerência (painel de consulta).
-- Lista fechada no domínio (domain/permissions.js#ONGOING_VIEWS); não muda permissão nenhuma.
ALTER TABLE "roles" ADD COLUMN "ongoing_view" text NOT NULL DEFAULT '';
