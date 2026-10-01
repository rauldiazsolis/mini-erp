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

# Swap de 1 GB: la instancia tiene 512 MB
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

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

# Usuarios: minierp corre el servicio; deploy recibe las versiones desde GitHub Actions
id minierp >/dev/null 2>&1 || useradd --system --home-dir /var/lib/mini-erp --shell /usr/sbin/nologin minierp
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
printf '%s\n' "$PUBKEY" > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

# deploy solo puede reiniciar el servicio
echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart mini-erp' > /etc/sudoers.d/mini-erp-deploy
chmod 440 /etc/sudoers.d/mini-erp-deploy
visudo -cf /etc/sudoers.d/mini-erp-deploy

# Carpetas
install -d -o deploy -g deploy /opt/mini-erp /opt/mini-erp/releases
install -d -m 750 -o minierp -g minierp /var/lib/mini-erp /var/lib/mini-erp-backups
install -d -m 755 /etc/mini-erp
if [ ! -f /etc/mini-erp/env ]; then
  sed "s/__SITE_ADDRESS__/$SITE/" "$HERE/env.example" > /etc/mini-erp/env
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
echo "Falta el primer deploy desde GitHub Actions y crear el root (deploy/README.md)."
