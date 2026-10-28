# Avanza — imagem de produção: a API em Node (/api/v1 e o tempo real) serve também o web compilado.
# Os dados ficam no Supabase da empresa (Postgres + Storage) — ver docker-compose.yml e docs/deployment.md.
#   docker compose up -d           (ver docker-compose.yml)
#   docker build -t avanza .       (imagem avulsa)

# --- 1. build do web (grava em backend/public)
FROM node:24-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN mkdir -p /src/backend && npm run build

# --- 2. dependências de produção da API
FROM node:24-alpine AS deps
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# --- 3. imagem final (usuário sem privilégios "node", uid 1000)
FROM node:24-alpine
RUN apk add --no-cache tzdata wget
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY backend/package.json ./
COPY backend/src ./src
COPY backend/db ./db
COPY backend/scripts ./scripts
COPY --from=web /src/backend/public ./public
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
USER node
ENV NODE_ENV=production \
    KAMBAN_ENV=production \
    KAMBAN_HTTP=0.0.0.0:8090
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:8090/api/v1/health >/dev/null || exit 1
ENTRYPOINT ["/app/entrypoint.sh"]
