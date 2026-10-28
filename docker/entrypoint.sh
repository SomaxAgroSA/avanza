#!/bin/sh
# Entrada da imagem: aplica as migrations e cria/atualiza o super administrador (se as variáveis
# estiverem definidas), depois sobe a API com o web.
set -e

if [ -n "$KAMBAN_ADMIN_EMAIL" ] && [ -n "$KAMBAN_ADMIN_PASSWORD" ]; then
  node /app/scripts/create-admin.js
fi

exec node /app/src/server.js
