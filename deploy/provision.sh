#!/usr/bin/env bash
# Prepara una instancia Ubuntu 24.04 de Lightsail para el mini-erp (#3). Idempotente: se puede
# volver a correr sin romper nada. Uso (ver deploy/README.md):
#   sudo bash deploy/provision.sh <host> "<clave pública de deploy>" [sinónimo ...]
set -euo pipefail

SITE="${1:?Falta el host, ej. mini.contax.ar o 203-0-113-10.sslip.io}"
PUBKEY="${2:?Falta la clave pública de deploy}"
shift 2
HERE="$(cd "$(dirname "$0")" && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "Correr con sudo" >&2; exit 1; }

# PostgreSQL guarda los datos en el disco adicional de Lightsail, montado en /mnt/pgdata: sobrevive
# a la instancia y crece aparte. Sin el disco no se toca nada.
PG_VERSION=16
PG_CLUSTER=main
PG_MOUNT=/mnt/pgdata
PG_DATA="$PG_MOUNT/$PG_VERSION/$PG_CLUSTER"
PG_CONF_DIR="/etc/postgresql/$PG_VERSION/$PG_CLUSTER"
PG_UNIT="postgresql@$PG_VERSION-$PG_CLUSTER.service"
if ! mountpoint -q "$PG_MOUNT"; then
  cat >&2 <<EOF
$PG_MOUNT no es un punto de montaje: falta el disco de PostgreSQL. Antes de seguir:
  1. En la consola de Lightsail: Storage > Create disk (en la misma zona que la instancia) y
     "Attach" a esta instancia.
  2. Acá, ver qué dispositivo es (el disco sin particiones, p. ej. /dev/nvme1n1): lsblk
  3. Solo si el disco es nuevo (borra lo que tenga): sudo mkfs -t ext4 /dev/nvme1n1
  4. sudo mkdir -p $PG_MOUNT
     echo "UUID=\$(sudo blkid -s UUID -o value /dev/nvme1n1) $PG_MOUNT ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab
     sudo mount -a && mountpoint $PG_MOUNT
  5. Volver a correr este script.
EOF
  exit 1
fi

# Swap de 1 GB: la instancia tiene 512 MB, compartidos entre Node y PostgreSQL
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
# El swap es la red de seguridad, no memoria de trabajo: que el kernel lo use lo menos posible
echo 'vm.swappiness = 10' > /etc/sysctl.d/60-mini-erp.conf
sysctl -q -p /etc/sysctl.d/60-mini-erp.conf

apt-get update
apt-get install -y ca-certificates curl gnupg debian-keyring debian-archive-keyring apt-transport-https

# Node 24 (NodeSource) y pnpm por corepack (la versión del packageManager)
if ! node -v 2>/dev/null | grep -q '^v24\.'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
corepack enable

# Caddy (repo oficial)
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

# PostgreSQL 16 de Ubuntu. El paquete ya trae las extensiones de contrib (unaccent incluida) y trae
# pg_dump, que usa el backup. Al instalarse crea un cluster vacío en /var/lib/postgresql: se cambia
# por uno en el disco adicional.
apt-get install -y "postgresql-$PG_VERSION"

# Que el cluster no arranque antes de que esté montado el disco
install -d "/etc/systemd/system/$PG_UNIT.d"
printf '[Unit]\nRequiresMountsFor=%s\n' "$PG_MOUNT" > "/etc/systemd/system/$PG_UNIT.d/mini-erp.conf"
systemctl daemon-reload

pg_psql() {
  # Como postgres, por el socket (peer), en este cluster. Desde / para que psql no se queje del
  # directorio actual.
  (cd / && runuser -u postgres -- psql --cluster "$PG_VERSION/$PG_CLUSTER" -X -q -v ON_ERROR_STOP=1 -At "$@")
}

# El directorio de datos del cluster, o vacío si no existe
cluster_dir() {
  pg_lsclusters -h | awk -v v="$PG_VERSION" -v c="$PG_CLUSTER" '$1 == v && $2 == c { print $6 }'
}

PG_RESTART=0
current_dir="$(cluster_dir)"
if [ -n "$current_dir" ] && [ "$current_dir" != "$PG_DATA" ]; then
  # El cluster que crea apt. Se borra solo si no tiene bases propias.
  pg_ctlcluster "$PG_VERSION" "$PG_CLUSTER" start >/dev/null 2>&1 || true
  own_dbs="$(pg_psql -c "SELECT count(*) FROM pg_database WHERE datname NOT IN ('postgres', 'template0', 'template1')")"
  if [ "$own_dbs" != "0" ]; then
    echo "El cluster $PG_VERSION/$PG_CLUSTER está en $current_dir y tiene bases propias: no lo borro." >&2
    echo "Moverlo a $PG_DATA a mano o borrarlo (pg_dropcluster --stop $PG_VERSION $PG_CLUSTER) y volver a correr." >&2
    exit 1
  fi
  echo "Borro el cluster vacío de $current_dir para crearlo en $PG_DATA"
  pg_dropcluster --stop "$PG_VERSION" "$PG_CLUSTER"
  current_dir=""
fi
if [ -z "$current_dir" ]; then
  if [ -e "$PG_DATA/PG_VERSION" ]; then
    # Un disco con datos de otra instancia: pg_createcluster no lo adopta (espera la configuración
    # adentro del directorio), y recrearlo los borraría
    echo "$PG_DATA ya tiene un cluster pero esta instancia no lo conoce: no lo toco (deploy/README.md)." >&2
    exit 1
  fi
  # Locale C.UTF-8, como las bases que crea el código (LC_COLLATE 'C': orden por bytes, que no cambia
  # con una actualización de glibc; LC_CTYPE 'C.UTF-8': lower, upper e ILIKE con letras no ASCII).
  # Las búsquedas sin acentos ni mayúsculas las hacen unaccent e ILIKE, no la collation. C.UTF-8
  # está siempre en Ubuntu; es_AR.UTF-8 habría que generarlo. Puerto 5432 fijo: el de DATABASE_URL.
  pg_createcluster "$PG_VERSION" "$PG_CLUSTER" -p 5432 -d "$PG_DATA" --locale C.UTF-8 --encoding UTF8 --start
  PG_RESTART=1
fi

# Memoria: la instancia tiene 512 MB y Node (pool de 10 conexiones) va en la misma máquina.
# listen_addresses vacío: solo el socket Unix (/var/run/postgresql), nada por TCP.
PG_TUNING="$(mktemp)"
cat > "$PG_TUNING" <<'EOF'
# Lo escribe deploy/provision.sh: no editar a mano (se pisa al volver a correrlo).
listen_addresses = ''
max_connections = 20
shared_buffers = 64MB
work_mem = 2MB
maintenance_work_mem = 32MB
effective_cache_size = 192MB
# Disco SSD de Lightsail
random_page_cost = 1.1
EOF
if ! cmp -s "$PG_TUNING" "$PG_CONF_DIR/conf.d/mini-erp.conf"; then
  install -m 644 -o postgres -g postgres "$PG_TUNING" "$PG_CONF_DIR/conf.d/mini-erp.conf"
  PG_RESTART=1
fi
rm -f "$PG_TUNING"
systemctl enable postgresql
if [ "$PG_RESTART" -eq 1 ]; then
  systemctl restart "$PG_UNIT"
else
  systemctl start "$PG_UNIT"
fi

# Solo peer por el socket (lo trae Ubuntu): sin contraseñas que guardar
if ! grep -Eq '^[[:space:]]*local[[:space:]]+all[[:space:]]+all[[:space:]]+peer([[:space:]]|$)' "$PG_CONF_DIR/pg_hba.conf"; then
  echo "Falta 'local all all peer' en $PG_CONF_DIR/pg_hba.conf: el servicio no podría entrar." >&2
  exit 1
fi

# Usuarios: minierp corre el servicio; deploy recibe las versiones desde GitHub Actions.
# /var/lib/mini-erp queda solo como home de minierp: los datos están en PostgreSQL (los .sqlite de
# antes, si los hay, no se tocan).
id minierp >/dev/null 2>&1 || useradd --system --home-dir /var/lib/mini-erp --shell /usr/sbin/nologin minierp
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
printf '%s\n' "$PUBKEY" > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
# deploy lee el journal: deploy.sh muestra el del backup si la copia previa falla
usermod -aG systemd-journal deploy

# El rol y la base de la app: el rol del sistema minierp entra como el rol minierp (peer). Sin
# superusuario: es dueño de su base y crea ahí sus esquemas.
if [ "$(pg_psql -c "SELECT 1 FROM pg_roles WHERE rolname = 'minierp'")" != "1" ]; then
  pg_psql -c "CREATE ROLE minierp LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE"
fi
if [ "$(pg_psql -c "SELECT 1 FROM pg_database WHERE datname = 'minierp'")" != "1" ]; then
  pg_psql -c "CREATE DATABASE minierp OWNER minierp TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C.UTF-8'"
fi
# unaccent: las migraciones también la piden (IF NOT EXISTS), pero queda creada desde acá. La crea
# minierp (es "trusted" y minierp es dueño de la base), no postgres: así es su dueño y un
# pg_restore --clean como minierp la puede borrar y volver a crear (deploy/README.md)
(cd / && runuser -u minierp -- psql --cluster "$PG_VERSION/$PG_CLUSTER" -X -q -v ON_ERROR_STOP=1 -d minierp \
  -c "SET client_min_messages = warning" -c "CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public")
if [ "$(pg_psql -d minierp -c "SELECT extowner::regrole FROM pg_extension WHERE extname = 'unaccent'")" != "minierp" ]; then
  echo "unaccent es de otro rol (no de minierp): un pg_restore --clean va a fallar (deploy/README.md, \"Restaurar\")." >&2
fi

# deploy solo puede reiniciar el servicio y correr la copia previa al deploy (el backup)
SUDOERS="$(mktemp)"
cat > "$SUDOERS" <<'EOF'
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart mini-erp
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl start mini-erp-backup.service
EOF
visudo -cf "$SUDOERS"
install -m 440 -o root -g root "$SUDOERS" /etc/sudoers.d/mini-erp-deploy
rm -f "$SUDOERS"

# Carpetas. Los backups (pg_dump) tienen hashes de contraseñas: solo minierp los lee.
install -d -o deploy -g deploy /opt/mini-erp /opt/mini-erp/releases
install -d -m 750 -o minierp -g minierp /var/lib/mini-erp /var/lib/mini-erp-backups
install -d -m 755 /etc/mini-erp
if [ ! -f /etc/mini-erp/env ]; then
  sed "s/__SITE_ADDRESS__/$SITE/" "$HERE/env.example" > /etc/mini-erp/env
fi
# Un servidor de antes de PostgreSQL: se le agrega la base (DATA_DIR, si está, ya no se usa)
if ! grep -q '^DATABASE_URL=' /etc/mini-erp/env; then
  grep '^DATABASE_URL=' "$HERE/env.example" >> /etc/mini-erp/env
  echo "Agregué DATABASE_URL a /etc/mini-erp/env"
fi
chown root:minierp /etc/mini-erp/env
chmod 640 /etc/mini-erp/env

# systemd: el servicio arranca con el primer deploy (todavía no hay /opt/mini-erp/current)
install -m 644 "$HERE/mini-erp.service" "$HERE/mini-erp-backup.service" "$HERE/mini-erp-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable mini-erp
systemctl enable --now mini-erp-backup.timer

# Caddy y PUBLIC_URL con el host real (y sus sinónimos, si los hay)
bash "$HERE/set-host.sh" "$SITE" "$@"

echo
echo "Listo: Node $(node -v), Caddy $(caddy version | cut -d' ' -f1), sitio https://$SITE"
echo "PostgreSQL $(pg_psql -c 'SHOW server_version' | cut -d' ' -f1) con los datos en $PG_DATA, base minierp por el socket (peer)"
echo "Falta el primer deploy desde GitHub Actions y, con la base vacía, crear el root (deploy/README.md)."
