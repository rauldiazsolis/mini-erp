#!/usr/bin/env bash
# Activa una versión ya descomprimida en /opt/mini-erp/releases/<sha> (#3). Lo llama deploy.yml por
# SSH como el usuario deploy. Si no queda lista (/health), vuelve a la versión anterior, salvo que
# siga migrando (#47).
set -euo pipefail

SHA="${1:?Falta el sha}"
BASE=/opt/mini-erp
RELEASE="$BASE/releases/$SHA"
PREVIOUS="$(readlink -f "$BASE/current" 2>/dev/null || true)"
# Tope para una migración larga (#47): pasado esto, se avisa pero no se vuelve atrás
MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT:-900}"

activate() {
  ln -sfn "$1" "$BASE/current.new"
  mv -Tf "$BASE/current.new" "$BASE/current"
  sudo systemctl restart mini-erp
}

# Espera a que el mini-erp nuevo atienda (#47). /health responde 503 "maintenance" mientras migra y
# 503 "migration-failed" si la migración falló (las bases quedaron como estaban).
# Sale con 0 si está listo, 1 si hay que volver atrás y 2 si sigue migrando al vencer el tope.
wait_ready() {
  local body code status start now last_answer last_log=0
  body="$(mktemp)"
  start="$(date +%s)"
  last_answer="$start"
  while true; do
    code="$(curl -s -o "$body" -w '%{http_code}' --max-time 5 http://localhost:4100/health || true)"
    status="$(grep -o '"status":"[^"]*"' "$body" | head -n 1 | cut -d '"' -f 4 || true)"
    now="$(date +%s)"
    case "$code:$status" in
      200:*)
        rm -f "$body"
        return 0
        ;;
      503:migration-failed)
        echo "La migración falló: $(cat "$body")" >&2
        rm -f "$body"
        return 1
        ;;
      503:maintenance)
        last_answer="$now"
        if [ $((now - start)) -ge "$MIGRATION_TIMEOUT" ]; then
          rm -f "$body"
          return 2
        fi
        if [ $((now - last_log)) -ge 30 ]; then
          echo "Migrando: $(cat "$body")"
          last_log="$now"
        fi
        ;;
      *)
        # 30 s seguidos sin una respuesta del mini-erp (medidos en tiempo, no en intentos)
        if [ $((now - last_answer)) -ge 30 ]; then
          rm -f "$body"
          return 1
        fi
        ;;
    esac
    sleep 1
  done
}

cd "$RELEASE"
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --prod --frozen-lockfile
activate "$RELEASE"

set +e
wait_ready
ready=$?
set -e

if [ "$ready" -eq 2 ]; then
  echo "La migración sigue corriendo después de ${MIGRATION_TIMEOUT} s. No vuelvo atrás: cortarla puede dejar bases en versiones distintas." >&2
  echo "Revisá: sudo journalctl -u mini-erp -n 100 --no-pager" >&2
  exit 1
fi

if [ "$ready" -ne 0 ]; then
  echo "La versión $SHA no quedó lista" >&2
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE" ]; then
    activate "$PREVIOUS"
    echo "Volví a $(basename "$PREVIOUS")" >&2
  fi
  exit 1
fi

rm -f "$BASE/releases/$SHA.tar.gz"
# Deja las últimas 5 versiones (la activa es la más nueva)
ls -1dt "$BASE"/releases/*/ | tail -n +6 | xargs -r rm -rf
echo "Versión $SHA activa"
