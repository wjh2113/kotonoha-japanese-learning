#!/usr/bin/env bash
# Deploy kotonoha-japanese-learning to JD Cloud (rsync + npm + pm2 + nginx).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${DEPLOY_HOST:-ubuntu@111.228.6.222}"
REMOTE_DIR="${DEPLOY_PATH:-/opt/kotonoha-japanese-learning}"
STAGING="/tmp/kotonoha-japanese-learning-deploy"
PORT="${DEPLOY_PORT:-8791}"
DOMAIN="${DEPLOY_DOMAIN:-japan.aidigitcloud.cn}"
ACCESS_PASSWORD="${ACCESS_PASSWORD:-Kotonoha@2026}"

echo "==> Build locally"
cd "${ROOT}"
npm run build

echo "==> Stage to ${REMOTE}:${STAGING}"
ssh "${REMOTE}" "rm -rf '${STAGING}' && mkdir -p '${STAGING}'"
rsync -az \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude '.postgres-data' \
  --exclude '.DS_Store' \
  --exclude 'dist' \
  "${ROOT}/" "${REMOTE}:${STAGING}/"
rsync -az "${ROOT}/dist/" "${REMOTE}:${STAGING}/dist/"

if [[ -f "${ROOT}/.env" ]]; then
  echo "==> Upload local .env as reference (secrets stay off git)"
  scp "${ROOT}/.env" "${REMOTE}:${STAGING}/.env.localupload"
fi

echo "==> Install into ${REMOTE_DIR}, DB, nginx, pm2"
ssh "${REMOTE}" bash -s <<REMOTE
set -euo pipefail
STAGING='${STAGING}'
REMOTE_DIR='${REMOTE_DIR}'
PORT='${PORT}'
DOMAIN='${DOMAIN}'
ACCESS_PASSWORD='${ACCESS_PASSWORD}'

sudo mkdir -p "\${REMOTE_DIR}"
sudo rsync -a \
  --exclude '.env' \
  --exclude 'node_modules' \
  "\${STAGING}/" "\${REMOTE_DIR}/"

cd "\${REMOTE_DIR}"

if [[ -f "\${STAGING}/.env.localupload" ]]; then
  sudo cp "\${STAGING}/.env.localupload" "\${REMOTE_DIR}/.env"
fi
if [[ ! -f "\${REMOTE_DIR}/.env" ]]; then
  sudo cp "\${REMOTE_DIR}/.env.example" "\${REMOTE_DIR}/.env"
fi

set_env() {
  local key="\$1"
  local value="\$2"
  if sudo grep -q "^\${key}=" "\${REMOTE_DIR}/.env"; then
    sudo sed -i "s|^\${key}=.*|\${key}=\${value}|" "\${REMOTE_DIR}/.env"
  else
    echo "\${key}=\${value}" | sudo tee -a "\${REMOTE_DIR}/.env" >/dev/null
  fi
}

set_env PORT "\${PORT}"
set_env HOST 127.0.0.1
set_env NODE_ENV production
set_env LLM_GATEWAY_URL https://aiapimgrapi.aidigitcloud.cn
set_env LLM_GATEWAY_TENANT Japan
set_env LLM_GATEWAY_CHAT_CAPABILITY quality-chat
set_env LLM_GATEWAY_SPEECH_CAPABILITY speech
set_env LLM_GATEWAY_VISION_CAPABILITY vision
set_env DATABASE_URL 'postgresql://kotonoha_app:kotonoha_app@127.0.0.1:5433/kotonoha'
if ! sudo grep -q '^ACCESS_PASSWORD=.' "\${REMOTE_DIR}/.env"; then
  set_env ACCESS_PASSWORD "\${ACCESS_PASSWORD}"
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kotonoha_app') THEN
    CREATE ROLE kotonoha_app LOGIN PASSWORD 'kotonoha_app';
  ELSE
    ALTER ROLE kotonoha_app WITH LOGIN PASSWORD 'kotonoha_app';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE kotonoha OWNER kotonoha_app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'kotonoha')\\gexec
GRANT ALL PRIVILEGES ON DATABASE kotonoha TO kotonoha_app;
SQL
sudo -u postgres psql -d kotonoha -v ON_ERROR_STOP=1 -c "GRANT ALL ON SCHEMA public TO kotonoha_app;"

ensure_japan_tenant() {
  local admin_password
  admin_password="\$(sudo docker exec aiapimgr-api-1 printenv ADMIN_PASSWORD 2>/dev/null | tr -d '\\r' || true)"
  if [[ -z "\${admin_password}" ]]; then
    admin_password="\$(sudo grep -E '^ADMIN_PASSWORD=' /opt/AIapiMgr/backend/.env 2>/dev/null | cut -d= -f2- | tr -d '\\r' || true)"
  fi
  if [[ -z "\${admin_password}" ]]; then
    echo "AIapiMgr admin password not found; skip Japan tenant bootstrap"
    return
  fi
  local login token tenants existing_id key=""
  login="\$(curl -fsS -X POST http://127.0.0.1:8001/admin/api/auth/login \
    -H 'content-type: application/json' \
    -d "{\\"password\\":\\"\${admin_password}\\"}" || true)"
  token="\$(printf '%s' "\${login}" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("access_token",""))' 2>/dev/null || true)"
  if [[ -z "\${token}" ]]; then
    echo "AIapiMgr admin login failed; skip Japan tenant bootstrap"
    return
  fi
  tenants="\$(curl -fsS http://127.0.0.1:8001/admin/api/tenants -H "Authorization: Bearer \${token}")"
  existing_id="\$(printf '%s' "\${tenants}" | python3 -c 'import json,sys; rows=json.load(sys.stdin); print(next((str(t["id"]) for t in rows if t.get("tenant_code")=="Japan"), ""))')"
  if [[ -z "\${existing_id}" ]]; then
    local created
    created="\$(curl -fsS -X POST http://127.0.0.1:8001/admin/api/tenants \
      -H "Authorization: Bearer \${token}" -H 'content-type: application/json' \
      -d '{"tenant_code":"Japan","name":"KOTONOHA","daily_budget_cny":200,"points_balance":20000}')"
    key="\$(printf '%s' "\${created}" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("api_key",""))')"
    existing_id="\$(printf '%s' "\${created}" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))')"
    echo "Created AIapiMgr tenant Japan id=\${existing_id}"
  else
    echo "AIapiMgr tenant Japan already exists id=\${existing_id}"
  fi
  if [[ -n "\${existing_id}" ]]; then
    curl -fsS -X PUT "http://127.0.0.1:8001/admin/api/tenants/\${existing_id}/capabilities" \
      -H "Authorization: Bearer \${token}" -H 'content-type: application/json' \
      -d '{"capabilities":["quality-chat","speech","vision"]}' >/dev/null || true
  fi
  if [[ -n "\${key}" ]]; then
    sudo sed -i "s|^LLM_GATEWAY_API_KEY=.*|LLM_GATEWAY_API_KEY=\${key}|" "\${REMOTE_DIR}/.env"
  elif ! sudo grep -q '^LLM_GATEWAY_API_KEY=.' "\${REMOTE_DIR}/.env"; then
    echo "Japan tenant exists but API key is not on this server .env; AI enrich will stay offline until a key is set."
  fi
}
ensure_japan_tenant

sudo chown -R ubuntu:ubuntu "\${REMOTE_DIR}"
cd "\${REMOTE_DIR}"
npm install --omit=dev

NGINX_SNIPPET=/etc/nginx/conf.d/kotonoha-japanese-learning.conf
sudo tee "\${NGINX_SNIPPET}" >/dev/null <<'NGINX'
# kotonoha-japanese-learning → Node
server {
    listen 80;
    server_name japan.aidigitcloud.cn;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name japan.aidigitcloud.cn;

    ssl_certificate /etc/nginx/ssl/aidigitcloud.cn/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/aidigitcloud.cn/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:8791;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
        proxy_read_timeout 150s;
        proxy_send_timeout 150s;
    }
}
NGINX

sudo nginx -t
sudo systemctl reload nginx

if sudo -u ubuntu pm2 describe kotonoha-japanese-learning >/dev/null 2>&1; then
  sudo -u ubuntu pm2 restart kotonoha-japanese-learning --update-env
else
  sudo -u ubuntu pm2 start "\${REMOTE_DIR}/ecosystem.config.cjs"
fi
sudo -u ubuntu pm2 save

sleep 3
echo "==> Health"
curl -fsS "http://127.0.0.1:\${PORT}/api/health"
echo
curl -fsS -o /dev/null -w "HTTPS %{http_code}\\n" --resolve "\${DOMAIN}:443:127.0.0.1" "https://\${DOMAIN}/api/health" || true
sudo -u ubuntu pm2 status kotonoha-japanese-learning
rm -rf "\${STAGING}"
REMOTE

echo "==> Done → https://${DOMAIN}"
echo "    访问密码：${ACCESS_PASSWORD}"
echo "    若公网打不开，请给 ${DOMAIN} 加 A 记录 → 111.228.6.222"
