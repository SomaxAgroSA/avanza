-- Ver o token de API de novo (ADR-046): o valor passa a ser guardado cifrado (AES-256-GCM com a chave do
-- servidor, KAMBAN_SECRET_KEY — infrastructure/secrets.js), além do hash usado para autenticar. Só o dono vê,
-- pelo navegador, e cada exibição fica no histórico. Tokens anteriores ficam com '' (não podem ser vistos).
ALTER TABLE "api_tokens" ADD COLUMN "value_secret" text NOT NULL DEFAULT '';
