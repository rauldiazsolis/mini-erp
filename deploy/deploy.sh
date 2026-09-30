#!/usr/bin/env bash
# Activa una versión ya descomprimida en /opt/mini-erp/releases/<sha> (#3). Lo llama deploy.yml por
# SSH como el usuario deploy. Si /health no responde, vuelve a la versión anterior.
set -euo pipefail

SHA="${1:?Falta el sha}"
BASE=/opt/mini-erp
RELEASE="$BASE/releases/$SHA"
PREVIOUS="$(readlink -f "$BASE/current" 2>/dev/null || true)"

activate() {
  ln -sfn "$1" "$BASE/current.new"
  mv -Tf "$BASE/current.new" "$BASE/current"
  sudo systemctl restart mini-erp
}

healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS http://localhost:4100/health >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

cd "$RELEASE"
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --prod --frozen-lockfile
activate "$RELEASE"

if ! healthy; then
  echo "La versión $SHA no respondió /health" >&2
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
