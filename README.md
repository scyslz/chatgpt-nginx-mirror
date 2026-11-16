# ChatGPT 反向代理 · Nginx / OpenResty 版

用一份 OpenResty 配置把 `*.example.com` 按子域名前缀反代到 ChatGPT / OpenAI 各站点，
并改写页面、脚本、请求体、跳转和 Cookie 里的域名。没有本地业务后端，所有请求最终都
回源官方站点。

功能：

- 前缀路由：`chat.` → `chatgpt.com`，`cdn.` → `cdn.oaistatic.com`，`api.` → `api.openai.com` …
- 页面/JS/CSS/JSON 里的上游域名反写成镜像域名
- 请求体域名还原（否则发消息会 `400 Invalid clientContextualInfo`）
- 3xx `Location`、`Set-Cookie Domain` 统一收敛到镜像父域
- SSE 流式不缓冲，WebSocket 透传
- 未登录会话归档：浮层里查看 / 切换 / 删除，支持注入上下文继续旧会话
- 官方登录 Cookie 多账号导入、校验、切换、删除（支持整段 cURL）
- Cookie 裁剪与加固，避免超大头导致 400/502

> 只测过「前缀模式」（`chat.example.com`）。apex 固定 404。

---

## 1. 目录结构

```
.
├── chatgpt-mirror.conf   # 站点配置（前缀路由 + 改写 + 归档 + 账号管理）
├── panel.js              # 页面右下角归档浮层
├── auth.html             # 账号管理页
├── auth.js               # 账号管理页脚本
├── deploy.sh             # 复制到容器 -> nginx -t -> reload
├── verify.sh             # 带 Host 头访问本机 80 的自检脚本
└── README.md
```

---

## 2. 依赖

- OpenResty（需要 `ngx_http_lua_module`、`ngx_http_sub_module`、`ngx_shared_dict`）
- 一个反向代理/CDN 负责终止 TLS（示例里是腾讯云 EdgeOne）
- 源站只监听 **80（HTTP）**，由 CDN 回源；如果你想自己终止 TLS，需要额外加 `listen 443 ssl` 和证书

配置开头声明了归档用的共享内存：

```nginx
lua_shared_dict gpt_archive 16m;
```

---

## 3. 部署

### 3.1 改成自己的域名

```bash
cd chatgpt-nginx-mirror
BASE=your-domain.tld                          # 换成你的域名
sed -i "s/example\.com/$BASE/g" chatgpt-mirror.conf panel.js auth.js auth.html README.md
```

同时确认容器内的路径（`deploy.sh` 里可改）：

```bash
DEST_DIR=/opt/nxpanel/nginx/sites-enabled
PANEL_DEST=/opt/nxpanel/nginx/chatgpt-panel.js
AUTH_HTML_DEST=/opt/nxpanel/auth.html
AUTH_JS_DEST=/opt/nxpanel/auth.js
```

### 3.2 复制并重载

```bash
CONTAINER=nxpanel ./deploy.sh
```

脚本会 `docker cp` 配置和前端文件，执行 `nginx -t`，通过后才 `nginx -s reload`。
不用 Docker 的话，把 4 个文件拷到对应路径，再 `openresty -t && openresty -s reload`。

### 3.3 自检

```bash
./verify.sh
# 或指定端口/地址
BASE=http://127.0.0.1:8080 ./verify.sh
```

检查项：首页 200、apex 404、`/backend-api/me` 401、页面里没有残留上游域名、
静态资源 200。

### 3.4 域名与 CDN

1. 为 `example.com` 和 `*.example.com` 添加解析，指向你的 CDN（EdgeOne / Cloudflare 等）。
2. 源站填本机公网 IP，协议 **HTTP**，端口 **80**。
3. **回源 Host 必须保持用户请求的域名**（`chat.example.com`），否则 nginx 无法按前缀选上游。
4. 放行 WebSocket 和流式响应，不要对 `text/event-stream` 开压缩/缓存。

> 如果用 Cloudflare Worker 之类的中继回源，注意 Cloudflare 会给子请求强制加
> `Cf-Worker` / `Cf-Visitor` / `Cf-Ew-Via` / `Cf-Ray` / `Cdn-Loop` 头，OpenAI 会判定为
> 代理流量直接 403。本配置已经把这些头置空（`proxy_set_header Xxx "";`）。

---

## 4. 前缀映射

| 访问域名 | 上游 |
| --- | --- |
| `chat.` / `www.` / `gpt.` / 其他未列出的前缀 | `chatgpt.com` |
| `api.` | `api.openai.com` |
| `auth.` | `auth.openai.com` |
| `ab.` | `ab.chatgpt.com` |
| `cdn.` | `cdn.oaistatic.com` |
| `persistent.` | `persistent.oaistatic.com` |
| `files.` | `files.oaiusercontent.com` |
| `platform.` | `platform.openai.com` |
| `developers.` | `developers.openai.com` |
| `help.` | `help.openai.com` |
| `status.` | `status.openai.com` |
| `sora.` | `sora.chatgpt.com` |
| `ws.` / `wss.` | `ws.chatgpt.com` |

路径原样透传，例如 `api.example.com/v1/chat/completions`。
要加新前缀，改 `map $gpt_prefix $gpt_upstream` 和请求体还原表 `hosts` 即可。

---

## 5. 实现要点

- `map $host -> $gpt_prefix -> $gpt_upstream`：纯配置实现前缀路由。
- `resolver`：变量形式 `proxy_pass https://$gpt_upstream` 需要在运行时解析 DNS。
- `proxy_ssl_server_name / proxy_ssl_name`：上游是 Cloudflare，必须带 SNI。
- `proxy_set_header Accept-Encoding ""` + `sub_filter`：先让上游返回未压缩内容，
  再改写 HTML/CSS/JS/JSON 里的域名，最后由本机 gzip。
- `proxy_redirect`：改写上游 3xx 的 `Location`。
- `proxy_hide_header`：去掉上游的 `CSP / HSTS / Alt-Svc / Report-To / NEL`，
  否则会限制或干扰镜像域名。
- `proxy_cookie_domain`：Cookie 统一收敛到 `.example.com`，让各前缀共享登录态。
- `proxy_buffering off`：SSE 流式输出不缓冲。
- **请求体域名还原（Lua）**：ChatGPT 前端会把页面域名写进
  `clientContextualInfo.app_name`、page-view 的 `url/entryUrl` 等字段，上游会校验。
  对 `application/json`、`application/x-www-form-urlencoded`、`text/plain` 做字面替换，
  把 `*.example.com` 还原成对应上游域名，支持任意自定义前缀。
- `access_by_lua_block` 里对超大 Cookie 做裁剪，避免回源请求头超限。
- `header_filter_by_lua_block` 过滤 `cf_clearance`、`session-token` 等会膨胀的 Cookie。

---

## 6. 未登录会话归档

未登录页面刷新后会丢会话（前端只在内存里保存，也不请求历史接口），所以配置里做了归档，
不依赖外部服务，只存在 `lua_shared_dict`：

- 首次访问下发 `gpt_sid`（365 天）。
- `/unauth-mweb/conversation/updates` 请求里的 `prompt` 记为用户消息；
  从响应 SSE 的 `control.conversationId` 和 `content[].dil.fallbackMarkdown`
  取会话 id 和回答。
- 每个 sid 最多 20 个会话，单会话最多 100 条，同一会话持续更新。
- 页面注入 `/__gpt/panel.js`：右下角「归档 N 个会话」，可查看、删除、清空、继续。
- **继续旧会话**：归档同时保存 `oai-session-id` 和
  `x-web-mobile-conversation-document-affinity`；下次发送时把
  `backendConversationId` / `parentMessageId` / `oai-session-id` / affinity 一起还原。
  要求同一个浏览器（`oai-did` 不变），affinity 约 24 小时有效；失败会返回
  `conversation_not_found`，该次不写入归档。
- 内部接口：`/__gpt/list`、`/__gpt/get?id=`、`/__gpt/delete?id=`、
  `/__gpt/active?id=`、`/__gpt/clear`。

限制：直接打开 `/uc/<id>` 会被官方重定向回首页，所以页面主区域不会回显旧消息，
旧消息在归档浮层里看。OpenResty 重启后 shared dict 丢失（localStorage 的当前页面
快照仍在）。

---

## 7. 官方登录（Cookie 导入）

镜像域名无法走 Google/Apple/邮箱 OAuth：`redirect_uri` 和 `audience` 必须是官方域名，
会返回 `invalid_authorize_request`。替代方案是导入官方 Cookie：

1. 在同一个浏览器打开 `https://chatgpt.com/` 并登录；
2. F12 → Network → 任意 chatgpt.com 请求 → 复制 `Cookie:` 请求头（或复制整段 cURL）；
3. 打开 `https://chat.example.com/__auth/import`，或点主站左下角「账号」；
4. 粘贴保存，刷新主站。

实现细节：

- 最多保存 10 个账号，可填备注名，可切换/删除/清空。
- 当前账号的 Cookie 只会注入给 `chatgpt.com`、`api.openai.com`、`auth.openai.com`，
  不会发给 CDN。
- 保存时会真的请求一次 `/backend-api/me`（或带 Bearer 时 `/backend-api/profiles/me`）
  做校验，失败不保存。
- 账号和归档都按 `gpt_sid` 隔离，存在 shared dict，180 天过期。
- Cookie 等同账号权限，只在自己的服务器上使用。

---

## 8. 已知限制

- 第三方 OAuth、Passkey 等依赖固定回调域名的流程可能失败。
- 未在映射表中的上游子域会回落到 `chatgpt.com`。
- 页面里的裸 `openai.com` 链接保持指向真实站点，不改写。
- 归档在 shared dict 里，重启会丢；多实例部署不共享。
- 只有前缀模式；apex 返回 404。
- 该站点是独立 conf，不出现在 nxpanel 面板的站点列表里，更新走 `deploy.sh`。

---

## 9. 安全

Cookie 等同账号权限。`/__auth/*` 没有额外鉴权，只靠 `gpt_sid` 隔离，不要公开给
不可信的人使用；建议在 CDN/WAF 层给 `/__auth/*` 加访问控制，或只在自己常用的
浏览器里使用。
