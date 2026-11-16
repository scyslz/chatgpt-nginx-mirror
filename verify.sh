#!/usr/bin/env bash
# 本地自检：不依赖外网 DNS，直接带 Host 头访问本机 80
set -uo pipefail

BASE="${BASE:-http://127.0.0.1}"
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

check() {
  local host="$1" path="$2" want="$3"
  local out code
  out=$(curl -sS -o /tmp/gpt-check.$$ -w '%{http_code}' --max-time 30 \
        -H "Host: $host" -H "User-Agent: $UA" "$BASE$path" 2>/dev/null)
  code="$out"
  if [[ "$code" == "$want" ]]; then
    printf '  ok   %-45s %s\n' "$host$path" "$code"
  else
    printf '  FAIL %-45s got %s want %s\n' "$host$path" "$code" "$want"
  fi
  rm -f /tmp/gpt-check.$$
}

echo "== 首页/接口"
check chat.example.com  /            200
check example.com       /            404
check chat.example.com  /backend-api/me 401
check api.example.com   /v1/models   401

echo "== 页面域名改写"
body=$(curl -sS --max-time 30 -H 'Host: chat.example.com' -H "User-Agent: $UA" "$BASE/" 2>/dev/null)
left=$(printf '%s' "$body" | grep -oE '//(chatgpt\.com|cdn\.oaistatic\.com|persistent\.oaistatic\.com|files\.oaiusercontent\.com|api\.openai\.com|auth\.openai\.com)' | sort -u | tr '\n' ' ')
if [[ -z "$left" ]]; then
  echo "  ok   页面中未残留上游域名"
else
  echo "  warn 仍残留：$left"
fi
printf '%s' "$body" | grep -q 'example\.com' && echo "  ok   已出现镜像域名" || echo "  FAIL 未发现镜像域名"

echo "== 静态资源"
check persistent.example.com '/learning/flags/2026-11-06/gg.png' 200
