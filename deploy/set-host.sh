#!/usr/bin/env bash
# Fija el host público del mini-erp (#11): reescribe el Caddyfile (el sitio principal y un bloque de
# redirección por cada sinónimo) y PUBLIC_URL, y recarga Caddy y el servicio. Idempotente: sirve para
# instalar y para mudar de host. Uso (ver deploy/README.md):
#   sudo bash deploy/set-host.sh <host principal> [sinónimo ...]
set -euo pipefail

HOST="${1:?Falta el host principal, ej. mini.contax.ar}"
shift
HERE="$(cd "$(dirname "$0")" && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "Correr con sudo" >&2; exit 1; }

# Los sinónimos redirigen con 308, que conserva el método (un POST sigue siendo POST). Sirven para el
# navegador; la conexión del POS va siempre al host principal (una redirección entre dominios no pasa CORS).
{
  sed "s/__SITE_ADDRESS__/$HOST/" "$HERE/Caddyfile"
  for alias in "$@"; do
    printf '\n# Sinónimo de %s\n%s {\n\tredir https://%s{uri} 308\n}\n' "$HOST" "$alias" "$HOST"
  done
} > /etc/caddy/Caddyfile.new
caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile
mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

# PUBLIC_URL arma la página de alta que vuelve al POS
if [ -f /etc/mini-erp/env ]; then
  if grep -q '^PUBLIC_URL=' /etc/mini-erp/env; then
    sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=https://$HOST|" /etc/mini-erp/env
  else
    echo "PUBLIC_URL=https://$HOST" >> /etc/mini-erp/env
  fi
  if systemctl is-active --quiet mini-erp; then
    systemctl restart mini-erp
  fi
fi

echo "Host principal: https://$HOST"
for alias in "$@"; do
  echo "  $alias → https://$HOST"
done
