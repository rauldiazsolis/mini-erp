#!/usr/bin/env bash
# Activa una versión ya descomprimida en /opt/mini-erp/releases/<sha> (#3). Lo llama deploy.yml por
# SSH como el usuario deploy. Antes de activarla hace una copia de la base (pg_dump, con el backup de
# la versión activa); si la nueva no queda lista (/health), vuelve a la anterior, salvo que siga
# migrando (#47).
set -euo pipefail

SHA="${1:?Falta el sha}"
BASE=/opt/mini-erp
RELEASE="$BASE/releases/$SHA"
PREVIOUS="$(readlink -f "$BASE/current" 2>/dev/null || true)"
BACKUP_DIR=/var/lib/mini-erp-backups
# Tope para una migración larga (#47): pasado esto, se avisa pero no se vuelve atrás
MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT:-900}"
# El archivo de la copia previa, si se pudo leer del journal
PREDUMP=""

activate() {
  ln -sfn "$1" "$BASE/current.new"
  mv -Tf "$BASE/current.new" "$BASE/current"
  sudo systemctl restart mini-erp
}

# Copia previa: corre mini-erp-backup.service (oneshot: systemctl espera a que termine) con el código
# de la versión activa, que es la que conoce el esquema de la base tal como está.
backup_before() {
  local since
  if [ -z "$PREVIOUS" ] || [ ! -d "$PREVIOUS" ]; then
    echo "No hay versión activa (primer deploy): sin copia previa"
    return 0
  fi
  # La transición de SQLite: la versión activa todavía no habla PostgreSQL y la base nueva arranca
  # vacía (deploy/README.md, "Pasar a PostgreSQL"); no hay nada que copiar
  if [ ! -f "$PREVIOUS/src/server/backup/pg-backup.ts" ]; then
    echo "La versión activa es anterior a PostgreSQL: sin copia previa"
    return 0
  fi
  since="$(date +%s)"
  echo "Copia previa de la base (mini-erp-backup.service)"
  if ! sudo systemctl start mini-erp-backup.service; then
    echo "La copia previa falló: no activo $SHA." >&2
    journalctl -u mini-erp-backup.service -n 30 --no-pager >&2 || true
    exit 1
  fi
  PREDUMP="$(journalctl -u mini-erp-backup.service --since "@$since" -o cat --no-pager 2>/dev/null \
    | grep -o "$BACKUP_DIR/minierp-[0-9TZ-]*\.dump" | tail -n 1 || true)"
  echo "Copia previa: ${PREDUMP:-en $BACKUP_DIR}"
}

# Qué hacer si la base quedó más nueva que la versión anterior
restore_hint() {
  echo "Si la migración de $SHA llegó a cambiar la base, la versión anterior no arranca contra un esquema" >&2
  echo "más nuevo que su código: queda en mantenimiento (/health: 503 migration-failed, y en el journal" >&2
  echo "'El esquema … es más nuevo (vN) que este código'). Hay que restaurar la copia previa" >&2
  echo "${PREDUMP:-(la más reciente: sudo ls -t $BACKUP_DIR/minierp-*.dump | head -n 1)}" >&2
  echo "como dice deploy/README.md y reiniciar el servicio." >&2
}

# Espera a que el mini-erp atienda (#47). /health responde 503 "maintenance" mientras migra y
# 503 "migration-failed" si la migración falló (lo ya migrado quedó migrado; la migración que falló
# se deshizo si era transaccional) o si el esquema es más nuevo que el código.
# Sale con 0 si está listo, 1 si no atiende o falló y 2 si sigue migrando al vencer el tope.
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
backup_before
activate "$RELEASE"

set +e
wait_ready
ready=$?
set -e

if [ "$ready" -eq 2 ]; then
  echo "La migración sigue corriendo después de ${MIGRATION_TIMEOUT} s. No vuelvo atrás: cortarla puede dejar esquemas en versiones distintas." >&2
  echo "Revisá: sudo journalctl -u mini-erp -n 100 --no-pager" >&2
  echo "Copia previa: ${PREDUMP:-la más reciente de $BACKUP_DIR}" >&2
  exit 1
fi

if [ "$ready" -ne 0 ]; then
  echo "La versión $SHA no quedó lista" >&2
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE" ]; then
    activate "$PREVIOUS"
    echo "Volví a $(basename "$PREVIOUS")" >&2
    set +e
    wait_ready
    back=$?
    set -e
    if [ "$back" -eq 0 ]; then
      echo "$(basename "$PREVIOUS") atiende de nuevo" >&2
    else
      echo "$(basename "$PREVIOUS") tampoco quedó lista." >&2
      restore_hint
    fi
  fi
  exit 1
fi

rm -f "$BASE/releases/$SHA.tar.gz"
# Deja las últimas 5 versiones (la activa es la más nueva)
ls -1dt "$BASE"/releases/*/ | tail -n +6 | xargs -r rm -rf
echo "Versión $SHA activa"
