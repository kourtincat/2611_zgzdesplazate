#!/usr/bin/env bash
# Actualizar el VPS a la última versión de GitHub (como root):  bash /opt/zgz-desplazate/deploy/update.sh
set -euo pipefail
cd /opt/zgz-desplazate
sudo -u zgz git pull --ff-only
sudo -u zgz npm ci
sudo -u zgz npm run build
systemctl restart zgz-desplazate
echo "Actualizado: $(git log -1 --format='%h %s')"
