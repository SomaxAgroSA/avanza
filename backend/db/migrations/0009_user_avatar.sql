-- Foto do usuário (regras de negócio §23): o arquivo fica no Storage em "users/<id>/<arquivo>", na coluna
-- "avatar" que já existia desde o PocketBase. Trocar ou remover a foto (e excluir o usuário) manda a
-- anterior para a lixeira do Storage.
CREATE TRIGGER "trg_users_trash" AFTER DELETE OR UPDATE ON "users" FOR EACH ROW EXECUTE FUNCTION trash_files('avatar');
