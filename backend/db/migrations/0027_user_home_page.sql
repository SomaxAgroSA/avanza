-- Página que a pessoa abre ao entrar no Avanza (§38), escolhida em Controle de acesso → Por pessoa.
-- '' = automática (Panorama para quem vê o painel executivo; senão, a lista de projetos).
-- Lista fechada no domínio (domain/user.js#HOME_PAGES); não muda permissão nenhuma.
ALTER TABLE "users" ADD COLUMN "home_page" text NOT NULL DEFAULT '';
