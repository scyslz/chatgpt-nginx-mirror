#!/usr/bin/env bash
# 部署/更新 *.example.com 反代配置到 nxpanel 的 OpenResty
set -euo pipefail

CONTAINER="${CONTAINER:-nxpanel}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$DIR/chatgpt-mirror.conf"
PANEL_SRC="$DIR/panel.js"
AUTH_HTML="$DIR/auth.html"
AUTH_JS="$DIR/auth.js"
DEST_DIR="/opt/nxpanel/nginx/sites-enabled"
DEST_NAME="chatgpt-mirror.conf"
PANEL_DEST="/opt/nxpanel/nginx/chatgpt-panel.js"
AUTH_HTML_DEST="/opt/nxpanel/auth.html"
AUTH_JS_DEST="/opt/nxpanel/auth.js"

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "容器 $CONTAINER 不存在" >&2
  exit 1
fi

echo "==> 复制配置"
docker cp "$SRC" "$CONTAINER:$DEST_DIR/$DEST_NAME"
docker cp "$PANEL_SRC" "$CONTAINER:$PANEL_DEST"
docker cp "$AUTH_HTML" "$CONTAINER:$AUTH_HTML_DEST"
docker cp "$AUTH_JS" "$CONTAINER:$AUTH_JS_DEST"
# 让 nginx worker(nobody) 能读到 panel.js
docker exec "$CONTAINER" chmod o+x /opt/nxpanel/nginx 2>/dev/null || true
chmod 644 "$SRC" 2>/dev/null || true

echo "==> nginx -t"
if ! docker exec "$CONTAINER" nginx -t; then
  echo "配置校验失败，已保留原配置，未 reload" >&2
  exit 1
fi

echo "==> reload"
docker exec "$CONTAINER" nginx -s reload
echo "完成：$DEST_DIR/$DEST_NAME"
