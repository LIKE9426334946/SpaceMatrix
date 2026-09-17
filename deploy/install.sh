#!/usr/bin/env bash
set -euo pipefail

cd /opt/SpaceMatrix
if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 用户运行。"
  exit 1
fi
if [ ! -x /usr/bin/node ] || ! /usr/bin/node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo "请先安装 Node.js 22 或更新版本，确保 /usr/bin/node 可用。"
  exit 1
fi

npm ci --omit=dev --no-audit --no-fund
install -m 644 deploy/SpaceMatrix.service /etc/systemd/system/SpaceMatrix.service
install -m 644 deploy/SpaceMatrix.nginx.conf /etc/nginx/sites-available/SpaceMatrix
ln -sfn /etc/nginx/sites-available/SpaceMatrix /etc/nginx/sites-enabled/SpaceMatrix
nginx -t
systemctl daemon-reload
systemctl enable --now nginx
systemctl enable SpaceMatrix
systemctl restart SpaceMatrix
systemctl reload nginx
echo "SpaceMatrix 已启动：外部 16044 → 127.0.0.1:3044"
echo "展示页面：http://服务器IP:16044/"
echo "管理页面：http://服务器IP:16044/admin"
