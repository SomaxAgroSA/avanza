#!/bin/bash
# Avanza no macOS para a rede local: sobe o servidor a cada login e mostra o endereço de acesso.
#
#   scripts/mac/avanza.sh instalar   copia o servidor para ~/Avanza, inicia a cada login e já sobe agora
#   scripts/mac/avanza.sh atualizar  leva as mudanças do repositório para ~/Avanza e reinicia
#   scripts/mac/avanza.sh remover    desfaz o início automático e para o servidor (os dados ficam)
#   scripts/mac/avanza.sh endereco   mostra o endereço de acesso (janela + terminal)
#   scripts/mac/avanza.sh status     servidor no ar? em qual endereço?
#   scripts/mac/avanza.sh migrar     leva os dados do PocketBase (~/Avanza/backend/pb_data) para o Supabase
#
# O servidor roda numa cópia fora de Documentos (AVANZA_DIR, padrão ~/Avanza): o macOS não deixa
# programas iniciados no login lerem Documentos. O .env da cópia nunca é sobrescrito (só ganha as
# variáveis do Supabase que faltarem). Os dados ficam no Supabase local (Docker pelo Colima), que o
# servidor sobe antes da API (ADR-044). Enquanto está no ar, o Mac anuncia na rede local (Bonjour) o
# nome AVANZA_NOME.local (padrão avanza.local) apontando para o IP do Wi-Fi.
# Requisitos: colima e supabase em ~/.local/bin (ou no PATH), dependências instaladas no repositório e
# backend/.env com KAMBAN_HTTP=0.0.0.0:<porta> (para aceitar conexões da rede) e o Supabase.

set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
RUN_DIR="${AVANZA_DIR:-$HOME/Avanza}"
NOME="${AVANZA_NOME:-avanza}"
LABEL=com.avanza.server
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/Avanza"
DOMAIN="gui/$(id -u)"
# o LaunchAgent não carrega o perfil do shell: colima, supabase e docker ficam em ~/.local/bin
export PATH="$HOME/.local/bin:$PATH:/usr/local/bin:/opt/homebrew/bin"

porta() {
  local p
  p=$(sed -n 's/^KAMBAN_HTTP=.*:\([0-9][0-9]*\)[[:space:]]*$/\1/p' "$RUN_DIR/backend/.env" "$ROOT/backend/.env" 2>/dev/null | head -1)
  echo "${p:-8090}"
}

# Endereços IPv4 do Mac nas redes ativas, uma por linha "IP|rede" — o Wi-Fi primeiro (cabo e outras depois).
ips_locais() {
  local lista
  lista=$(networksetup -listallhardwareports 2>/dev/null |
    awk '/^Hardware Port:/{sub(/^Hardware Port: /, ""); nome=$0} /^Device:/{print $2 "|" nome}' |
    while IFS='|' read -r dev nome; do
      ip=$(ipconfig getifaddr "$dev" 2>/dev/null)
      [ -n "$ip" ] && echo "$ip|$nome"
    done)
  echo "$lista" | grep '|Wi-Fi$'
  echo "$lista" | grep -v '|Wi-Fi$' | grep .
  return 0
}

# IP principal (o do Wi-Fi quando houver); vazio se estiver sem rede.
ip_local() {
  ips_locais | head -1 | cut -d'|' -f1
}

no_ar() {
  curl -fs -m 3 "http://127.0.0.1:$(porta)/api/v1/health" >/dev/null 2>&1
}

agente_instalado() {
  launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1
}

texto_endereco() {
  local lista host p sufixo
  lista=$(ips_locais); host=$(scutil --get LocalHostName 2>/dev/null); p=$(porta)
  if [ -z "$lista" ]; then
    echo "Avanza no ar, mas este Mac está sem rede. Neste Mac: http://localhost:$p"
    return
  fi
  sufixo=":$p"
  [ "$p" = "80" ] && sufixo=""
  echo "Avanza no ar. Acesse pela rede:"
  echo "  http://$NOME.local$sufixo"
  echo "$lista" | while IFS='|' read -r ip nome; do echo "  http://$ip$sufixo  ($nome)"; done
  [ -n "$host" ] && echo "  http://$host.local$sufixo"
}

# Anuncia NOME.local (Bonjour/mDNS) apontando para o IP principal (o do Wi-Fi) e refaz o anúncio se o
# IP mudar. Funciona para quem está na mesma rede (macOS, iPhone e Windows 10+ resolvem nomes .local).
anunciar_nome() {
  local ip atual="" pid=""
  trap '[ -n "$pid" ] && kill "$pid" 2>/dev/null; exit 0' TERM INT
  while true; do
    ip=$(ip_local)
    if [ "$ip" != "$atual" ]; then
      [ -n "$pid" ] && kill "$pid" 2>/dev/null
      pid=""
      if [ -n "$ip" ]; then
        dns-sd -P "Avanza" _http._tcp local "$(porta)" "$NOME.local" "$ip" path=/ >/dev/null 2>&1 &
        pid=$!
      fi
      atual=$ip
    fi
    sleep 30 &
    wait $!
  done
}

mostrar_endereco() {
  local texto principal resposta
  texto=$(texto_endereco)
  echo "$texto"
  principal=$(echo "$texto" | grep -m1 -o 'http://[^ ]*')
  resposta=$(osascript - "$texto" <<'APPLESCRIPT' 2>/dev/null
on run argv
  set r to display dialog (item 1 of argv) with title "Avanza" buttons {"Copiar endereço", "OK"} default button "OK" giving up after 300
  return button returned of r
end run
APPLESCRIPT
)
  [ "$resposta" = "Copiar endereço" ] && printf '%s' "$principal" | pbcopy
  return 0
}

# Regra do Lima (a VM do Colima): portas dos contêineres só em 127.0.0.1. Sem ela, o Colima publica
# o Postgres (senha padrão) e o Studio do Supabase local para a rede inteira; só a API deve aparecer.
LIMA_OVERRIDE="$HOME/.colima/_lima/_config/override.yaml"
proteger_portas() {
  grep -q 'avanza: portas locais' "$LIMA_OVERRIDE" 2>/dev/null && return 1
  mkdir -p "$(dirname "$LIMA_OVERRIDE")"
  cat > "$LIMA_OVERRIDE" <<'YAML'
# avanza: portas locais — os contêineres (Supabase) ficam só em 127.0.0.1; a rede vê apenas a API.
portForwards:
  - guestIP: 0.0.0.0
    guestIPMustBeZero: true
    guestPortRange: [1, 65535]
    hostIP: 127.0.0.1
    hostPortRange: [1, 65535]
    proto: tcp
YAML
  echo "Portas do Supabase restritas a este Mac ($LIMA_OVERRIDE)."
  return 0
}

# Motor do Docker (Colima) e Supabase local no ar (o banco e os arquivos do Avanza).
subir_supabase() {
  command -v colima >/dev/null || { echo "colima não encontrado (instale em ~/.local/bin)." >&2; return 1; }
  command -v supabase >/dev/null || { echo "supabase não encontrado (instale em ~/.local/bin)." >&2; return 1; }
  if proteger_portas && colima status >/dev/null 2>&1; then
    colima restart || return 1
  fi
  colima status >/dev/null 2>&1 || colima start || return 1
  (cd "$ROOT" && supabase start >/dev/null) || { echo "O Supabase não subiu (rode 'supabase start' em $ROOT para ver o erro)." >&2; return 1; }
}

# Chamado pelo LaunchAgent, dentro da cópia.
executar() {
  local node pid codigo marca nome_pid
  node="${AVANZA_NODE:-$(command -v node)}"
  if [ ! -x "$node" ]; then
    echo "Node não encontrado (defina AVANZA_NODE ou rode o instalar de novo)." >&2
    exit 1
  fi
  cd "$ROOT" || exit 1
  [ -f backend/public/index.html ] || { echo "Falta o build do web: rode o atualizar no repositório." >&2; exit 1; }
  subir_supabase || exit 1

  "$node" backend/scripts/start.js &
  pid=$!
  anunciar_nome &
  nome_pid=$!
  trap 'kill -INT "$pid" 2>/dev/null; kill "$nome_pid" 2>/dev/null' TERM INT

  # Mostra o endereço quando a API responder e a rede tiver IP; só uma vez a cada 10 min,
  # para não repetir a janela se o LaunchAgent reiniciar o servidor.
  (
    for _ in $(seq 1 90); do
      no_ar && [ -n "$(ip_local)" ] && break
      sleep 2
    done
    mkdir -p "$LOG_DIR"
    marca="$LOG_DIR/.ultimo-aviso"
    if [ -z "$(find "$marca" -mmin -10 2>/dev/null)" ]; then
      touch "$marca"
      mostrar_endereco
    fi
  ) &

  wait "$pid"; codigo=$?
  wait "$pid" 2>/dev/null  # o primeiro wait volta antes da hora quando chega um sinal
  kill "$nome_pid" 2>/dev/null  # o nome some da rede junto com o servidor
  exit "$codigo"
}

# Gera o build do web no repositório e copia para RUN_DIR só o que o servidor precisa.
copiar_para_execucao() {
  local d
  if [ "$ROOT" = "$RUN_DIR" ]; then
    echo "Rode este comando a partir do repositório, não de $RUN_DIR." >&2
    exit 1
  fi
  [ -d "$ROOT/backend/node_modules" ] || { echo "Faltam as dependências: rode 'npm ci --prefix backend'." >&2; exit 1; }
  [ -f "$ROOT/backend/.env" ] || { echo "Falta backend/.env (rode 'npm --prefix backend run setup')." >&2; exit 1; }

  echo "Gerando o build do web..."
  (cd "$ROOT" && npm run build >/dev/null) || { echo "O build do web falhou (rode 'npm run build' para ver o erro)." >&2; exit 1; }

  echo "Copiando para $RUN_DIR..."
  for d in backend/src backend/db backend/scripts backend/public backend/node_modules supabase scripts/mac; do
    mkdir -p "$RUN_DIR/$d"
    rsync -a --delete --exclude .temp --exclude .branches "$ROOT/$d/" "$RUN_DIR/$d/" || exit 1
  done
  cp "$ROOT/backend/package.json" "$RUN_DIR/backend/package.json"
  # sobras da versão PocketBase; o pb_data fica (volta atrás e origem do "migrar")
  rm -rf "$RUN_DIR/backend/bin" "$RUN_DIR/backend/pb_hooks" "$RUN_DIR/backend/pb_migrations" "$RUN_DIR/backend/pb_public"
  if [ -f "$RUN_DIR/backend/.env" ]; then
    completar_env
  else
    cp "$ROOT/backend/.env" "$RUN_DIR/backend/.env"
  fi
}

# .env da cópia: acrescenta as variáveis do Supabase que faltarem. Conexão e chaves vêm do repositório;
# esquema e bucket são sempre os da equipe (o desenvolvimento usa outros no mesmo Supabase local).
completar_env() {
  local var linha
  for var in KAMBAN_DATABASE_URL KAMBAN_DB_SCHEMA KAMBAN_SUPABASE_URL KAMBAN_SUPABASE_SECRET_KEY KAMBAN_STORAGE_BUCKET KAMBAN_SECRET_KEY; do
    grep -q "^$var=" "$RUN_DIR/backend/.env" && continue
    case "$var" in
      KAMBAN_DB_SCHEMA) linha="KAMBAN_DB_SCHEMA=avanza" ;;
      KAMBAN_STORAGE_BUCKET) linha="KAMBAN_STORAGE_BUCKET=avanza-files" ;;
      *) linha=$(grep -m1 "^$var=" "$ROOT/backend/.env") || continue ;;
    esac
    printf '%s\n' "$linha" >> "$RUN_DIR/backend/.env"
    echo "  .env da cópia: $var acrescentada"
  done
}

# Virada: dados do PocketBase da cópia → Supabase (uma vez). O pb_data não é apagado.
migrar() {
  local node
  node="${AVANZA_NODE:-$(command -v node)}"
  [ -d "$RUN_DIR/backend/pb_data" ] || { echo "Não há dados do PocketBase em $RUN_DIR/backend/pb_data." >&2; exit 1; }
  [ -f "$RUN_DIR/backend/scripts/import-pocketbase.js" ] || { echo "Rode o atualizar antes (a cópia ainda é a versão PocketBase)." >&2; exit 1; }
  subir_supabase || exit 1
  if agente_instalado; then
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
    echo "Servidor parado para a migração."
  fi
  if ! (cd "$RUN_DIR/backend" && "$node" scripts/import-pocketbase.js --from "$RUN_DIR/backend/pb_data" "$@"); then
    echo "A migração falhou; nada foi apagado do PocketBase. Corrija e rode de novo." >&2
    [ -f "$PLIST" ] && launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null
    exit 1
  fi
  [ -f "$PLIST" ] && launchctl bootstrap "$DOMAIN" "$PLIST" && echo "Servidor de volta no ar, agora com o Supabase."
}

instalar() {
  local node
  node=$(command -v node)
  [ -z "$node" ] && { echo "Node não encontrado no PATH." >&2; exit 1; }
  if no_ar && ! agente_instalado; then
    echo "Já existe um servidor na porta $(porta). Pare-o antes de instalar." >&2
    exit 1
  fi
  grep -q '^KAMBAN_HTTP=0\.0\.0\.0:' "$ROOT/backend/.env" 2>/dev/null ||
    echo "Aviso: backend/.env não tem KAMBAN_HTTP=0.0.0.0:<porta>; o Avanza só vai abrir neste Mac." >&2

  copiar_para_execucao
  mkdir -p "$LOG_DIR" "$(dirname "$PLIST")"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$RUN_DIR/scripts/mac/avanza.sh</string>
    <string>executar</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AVANZA_NODE</key>
    <string>$node</string>
    <key>PATH</key>
    <string>$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/avanza.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/avanza.err.log</string>
</dict>
</plist>
EOF
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
  if ! launchctl bootstrap "$DOMAIN" "$PLIST"; then
    echo "Não consegui registrar o LaunchAgent ($PLIST)." >&2
    exit 1
  fi
  echo "Início automático instalado: o Avanza sobe a cada login e mostra o endereço."
  echo "Servidor em $RUN_DIR; logs em $LOG_DIR"
}

atualizar() {
  agente_instalado || { echo "Início automático não instalado: rode o instalar." >&2; exit 1; }
  copiar_para_execucao
  launchctl kickstart -k "$DOMAIN/$LABEL" && echo "Avanza atualizado e reiniciado."
}

remover() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
  rm -f "$PLIST"
  echo "Início automático removido e servidor parado. Os dados continuam no Supabase local (Docker)."
}

status() {
  if agente_instalado; then
    echo "Início automático: instalado (servidor em $RUN_DIR)"
  else
    echo "Início automático: não instalado"
  fi
  if no_ar; then texto_endereco; else echo "Servidor: fora do ar (logs em $LOG_DIR)"; fi
}

case "${1:-}" in
  instalar) instalar ;;
  atualizar) atualizar ;;
  remover) remover ;;
  endereco | endereço) if no_ar; then mostrar_endereco; else echo "Servidor fora do ar."; exit 1; fi ;;
  status) status ;;
  migrar) shift; migrar "$@" ;;
  executar) executar ;;
  *) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
