#!/usr/bin/env bash
# Instalación en un VPS Ubuntu 24.04 limpio (Hetzner, OVH, DigitalOcean…). Ejecutar como root:
#   curl -fsSL https://raw.githubusercontent.com/kourtincat/2611_zgzdesplazate/main/deploy/setup-vps.sh | bash -s -- tu-dominio.es
# Antes: el registro DNS A (y AAAA) de tu-dominio.es y www.tu-dominio.es debe apuntar a la IP del VPS.
set -euo pipefail
DOMAIN="${1:?Uso: setup-vps.sh tu-dominio.es}"
REPO="https://github.com/kourtincat/2611_zgzdesplazate.git"
APP=/opt/zgz-desplazate

apt-get update
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw unattended-upgrades

# Node 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Caddy (repositorio oficial)
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy

# Usuario sin privilegios y código
id zgz >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin zgz
if [ ! -d "$APP/.git" ]; then git clone "$REPO" "$APP"; fi
cd "$APP"
npm ci && npm run build
mkdir -p data && chown -R zgz:zgz "$APP"

# Variables (el token del buzón se genera una vez y se guarda aquí)
if [ ! -f /etc/zgz-desplazate.env ]; then
  cat > /etc/zgz-desplazate.env <<ENV
PORT=8080
HOST=127.0.0.1
SITE_URL=https://$DOMAIN
FEEDBACK_TOKEN=$(openssl rand -hex 24)
ENV
  chmod 600 /etc/zgz-desplazate.env
fi

cp deploy/zgz-desplazate.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now zgz-desplazate

# Caddy con el dominio
cp deploy/Caddyfile /etc/caddy/Caddyfile
mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment=DOMAIN=%s\n' "$DOMAIN" > /etc/systemd/system/caddy.service.d/domain.conf
systemctl daemon-reload && systemctl restart caddy

# Cortafuegos: sólo SSH y web
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

echo "Listo: https://$DOMAIN  (token del buzón en /etc/zgz-desplazate.env)"
