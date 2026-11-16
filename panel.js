(function () {
  if (window.__gptArc) return;
  window.__gptArc = 1;

  var KEY = "gpt_archive_dom";
  var dom = [];
  var btn = null;
  var panel = null;
  var listEl = null;
  var detailEl = null;
  var entries = [];
  var expanded = null;

  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; }
  }
  function saveLocal(a) {
    try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {}
  }
  function textOf(m) {
    var t = "";
    if (m && m.content) {
      var p = m.content.parts;
      if (p && p.length) {
        for (var i = 0; i < p.length; i++) if (typeof p[i] === "string") t += p[i];
      } else if (typeof m.content.text === "string") {
        t = m.content.text;
      }
    }
    return (t || "").trim();
  }
  function roleOf(m) {
    if (m && m.author && m.author.role) return m.author.role;
    if (m && m.role) return m.role;
    return "assistant";
  }
  function normalize(messages) {
    var out = [];
    for (var i = 0; i < (messages || []).length; i++) {
      var m = messages[i];
      if (m && m.r && m.t) { out.push({ r: m.r, t: m.t }); continue; }
      var t = textOf(m);
      if (t) out.push({ r: roleOf(m), t: t });
    }
    return out;
  }
  function firstUser(messages) {
    for (var i = 0; i < (messages || []).length; i++) {
      var m = messages[i];
      if (m && (m.r === "user" || (m.author && m.author.role === "user"))) {
        return m.t || textOf(m);
      }
    }
    return "";
  }
  function snapshot() {
    var nodes = document.querySelectorAll("[data-message-author-role]");
    if (!nodes.length) return;
    var arr = [];
    for (var i = 0; i < nodes.length; i++) {
      var t = (nodes[i].innerText || "").trim();
      if (t) arr.push({ r: nodes[i].getAttribute("data-message-author-role"), t: t });
    }
    if (arr.length && JSON.stringify(arr) !== JSON.stringify(dom)) {
      dom = arr;
      saveLocal(arr);
    }
  }
  function fmtTime(ts) {
    if (!ts) return "";
    try { return new Date(ts * 1000).toLocaleString(); } catch (e) { return ""; }
  }
  function shortTitle(t) {
    t = (t || "").replace(/\s+/g, " ").trim();
    if (!t) return "（无标题会话）";
    return t.length > 24 ? t.slice(0, 24) + "…" : t;
  }

  function clearLocal() {
    dom = [];
    saveLocal([]);
    if (btn) btn.style.display = "none";
    if (panel) panel.style.display = "none";
  }
  function clearAll() {
    try { fetch("/__gpt/clear", { method: "POST", credentials: "same-origin" }); } catch (e) {}
    clearLocal();
  }
  function deleteEntry(e) {
    if (!e || e.live) { clearLocal(); return; }
    try {
      fetch("/__gpt/delete?id=" + encodeURIComponent(e.id), { method: "POST", credentials: "same-origin" })
        .then(refreshList);
    } catch (err) { refreshList(); }
  }

  function buildPanel() {
    panel = document.createElement("div");
    panel.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483646;display:none;align-items:flex-end";
    var box = document.createElement("div");
    box.style.cssText = "background:#fff;color:#111;width:100%;max-height:80vh;border-radius:16px 16px 0 0;padding:12px 14px;overflow:auto;font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif";
    var head = document.createElement("div");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:600";
    head.textContent = "会话";
    var auth = document.createElement("a");
    auth.href = "/__auth/import";
    auth.textContent = "登录同步";
    auth.style.cssText = "margin-left:auto;margin-right:10px;color:#06c;text-decoration:none;font-weight:400;font-size:13px";
    var clr = document.createElement("button");
    clr.textContent = "清空全部";
    clr.style.cssText = "border:1px solid #ddd;background:#fff;border-radius:6px;padding:4px 10px;color:#c00";
    clr.onclick = function () { if (confirm("清空所有会话？")) clearAll(); };
    head.appendChild(clr);
    listEl = document.createElement("div");
    detailEl = document.createElement("div");
    detailEl.style.cssText = "margin-top:8px";
    box.appendChild(head);
    box.appendChild(listEl);
    box.appendChild(detailEl);
    panel.appendChild(box);
    panel.onclick = function (e) { if (e.target === panel) panel.style.display = "none"; };
    document.documentElement.appendChild(panel);
  }

  function showDetail(entry) {
    expanded = entry.id;
    if (entry.live) {
      renderDetail(normalize(entry.messages), entry);
      return;
    }
    detailEl.textContent = "加载中…";
    fetch("/__gpt/get?id=" + encodeURIComponent(entry.id), { credentials: "same-origin" })
      .then(function (r) { return r.status === 204 ? null : r.json(); })
      .then(function (j) {
        if (!j || !j.conversation) { detailEl.textContent = "会话不存在"; return; }
        renderDetail(normalize(j.conversation.messages), entry);
      })
      .catch(function () { detailEl.textContent = "加载失败"; });
  }

  function renderDetail(msgs, entry) {
    detailEl.innerHTML = "";
    if (!msgs.length) { detailEl.textContent = "（空会话）"; return; }
    for (var i = 0; i < msgs.length; i++) {
      var d = document.createElement("div");
      d.style.cssText = "margin:6px 0;padding:8px 10px;border-radius:8px;white-space:pre-wrap;" +
        (msgs[i].r === "user" ? "background:#f2f4f8" : "background:#eef7ee");
      d.textContent = (msgs[i].r === "user" ? "你: " : "AI: ") + msgs[i].t;
      detailEl.appendChild(d);
    }
  }

  function renderList() {
    entries = [];
    var local = loadLocal();
    var liveTitle = firstUser(local);
    fetch("/__gpt/list", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var server = (j && j.conversations) || [];
        if (local.length) {
          var newest = server[0];
          var live = {
            id: "__live",
            live: true,
            ts: 0,
            count: local.length,
            title: liveTitle,
            messages: local,
          };
          // 本地页面快照通常比最新一条服务端归档多最后一条回答，优先展示
          if (!newest || local.length >= (newest.count || 0)) entries.push(live);
        }
        for (var i = 0; i < server.length; i++) entries.push(server[i]);
        paintList();
      })
      .catch(function () {
        if (local.length) {
          entries.push({ id: "__live", live: true, ts: 0, count: local.length, title: liveTitle, messages: local });
          paintList();
        }
      });
  }

  function paintList() {
    if (btn) {
      btn.textContent = "会话 " + entries.length;
      btn.style.display = "";
    }
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!entries.length) {
      listEl.textContent = "暂无会话";
      detailEl.innerHTML = "";
      return;
    }
    for (var i = 0; i < entries.length; i++) {
      (function (e) {
        var row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:9px 8px;border-bottom:1px solid #eee;cursor:pointer";
        var main = document.createElement("div");
        main.style.cssText = "flex:1;min-width:0";
        var t1 = document.createElement("div");
        t1.style.cssText = "font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
        t1.textContent = shortTitle(e.title);
        var t2 = document.createElement("div");
        t2.style.cssText = "font-size:12px;color:#888";
        t2.textContent = (e.live ? "当前页面 · " : "") + (e.count || 0) + " 条" + (e.ts ? " · " + fmtTime(e.ts) : "");
        main.appendChild(t1);
        main.appendChild(t2);
        var cont = document.createElement("button");
        cont.textContent = "继续";
        cont.style.cssText = "border:1px solid #cde;background:#f5f9ff;border-radius:6px;padding:4px 8px;color:#06c;font-size:12px";
        cont.onclick = function (ev) {
          ev.stopPropagation();
          if (e.live) { alert("当前页面会话直接在这里继续即可"); return; }
          fetch("/__gpt/active?id=" + encodeURIComponent(e.id), { method: "POST", credentials: "same-origin" })
            .then(function () {
              try { localStorage.setItem("gpt_continue", e.title || ""); } catch (err) {}
              location.reload();
            })
            .catch(function () { alert("设置失败"); });
        };
        var del = document.createElement("button");
        del.textContent = "删除";
        del.style.cssText = "border:1px solid #eee;background:#fff;border-radius:6px;padding:4px 8px;color:#c00;font-size:12px";
        del.onclick = function (ev) { ev.stopPropagation(); deleteEntry(e); };
        row.appendChild(main);
        row.appendChild(cont);
        row.appendChild(del);
        row.onclick = function () {
          if (expanded === e.id) {
            expanded = null;
            detailEl.innerHTML = "";
          } else {
            showDetail(e);
          }
        };
        listEl.appendChild(row);
      })(entries[i]);
    }
  }

  function refreshList() { if (panel) renderList(); }

  function render() {
    if (!btn) {
      btn = document.createElement("div");
      btn.id = "gpt-arc-btn";
      btn.style.cssText = "background:#fff;color:#333;border:1px solid #ddd;border-radius:16px;padding:6px 10px;font:12px/1.4 -apple-system,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.12);opacity:.95;min-width:68px;text-align:center";
      btn.onclick = function () {
        if (!panel) buildPanel();
        panel.style.display = "flex";
        renderList();
      };
      sideBar().appendChild(btn);
    }
    btn.style.display = "";
    renderList();
  }

  function showContinueBanner(title) {
    var bar = document.createElement("div");
    bar.id = "gpt-continue-bar";
    bar.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:2147483647;background:#06c;color:#fff;padding:8px 12px;font:13px/1.5 -apple-system,sans-serif;display:flex;gap:10px;align-items:center";
    var tx = document.createElement("div");
    tx.style.cssText = "flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    tx.textContent = "已选择继续：" + (title || "旧会话") + " · 直接发送消息即可带上旧上下文";
    var close = document.createElement("button");
    close.textContent = "×";
    close.style.cssText = "background:transparent;border:0;color:#fff;font-size:18px;line-height:1";
    close.onclick = function () {
      try { localStorage.removeItem("gpt_continue"); } catch (e) {}
      bar.remove();
    };
    bar.appendChild(tx);
    bar.appendChild(close);
    document.documentElement.appendChild(bar);
  }

  function sideBar() {
    var c = document.getElementById("gpt-side-btns");
    if (!c) {
      c = document.createElement("div");
      c.id = "gpt-side-btns";
      c.style.cssText = "position:fixed;right:10px;top:36%;transform:translateY(-50%);z-index:2147483646;display:flex;flex-direction:column;gap:8px;align-items:stretch";
      document.documentElement.appendChild(c);
    }
    return c;
  }

  function authEntry() {
    if (document.getElementById("gpt-auth-btn")) return;
    var a = document.createElement("a");
    a.id = "gpt-auth-btn";
    a.href = "/__auth/import";
    a.textContent = "账号";
    a.style.cssText = "background:#fff;color:#333;border:1px solid #ddd;border-radius:16px;padding:6px 10px;font:12px/1.4 -apple-system,sans-serif;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.12);opacity:.95;min-width:68px;text-align:center";
    sideBar().appendChild(a);
  }

  function watchWall() {
    setInterval(function () {
      var hasInput = document.querySelector('#prompt-textarea, textarea, [contenteditable="true"]');
      if (hasInput) return;
      var t = document.body ? (document.body.innerText || "") : "";
      if (t.indexOf("你将获得更加智能的回复") < 0 && t.indexOf("Log in or sign up") < 0) return;
      var last = 0;
      try { last = Number(sessionStorage.getItem("gpt_wall_reload") || 0); } catch (e) {}
      if (Date.now() - last < 60000) return;
      try { sessionStorage.setItem("gpt_wall_reload", String(Date.now())); } catch (e) {}
      fetch("/__gpt/list", { credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var c = j && j.conversations && j.conversations[0];
          if (!c || !c.id) { location.reload(); return; }
          fetch("/__gpt/active?id=" + encodeURIComponent(c.id), { method: "POST", credentials: "same-origin" })
            .then(function () { location.reload(); })
            .catch(function () { location.reload(); });
        })
        .catch(function () { location.reload(); });
    }, 2500);
  }

  function boot() {
    dom = loadLocal();
    authEntry();
    watchWall();
    render();
    var cont = null;
    try { cont = localStorage.getItem("gpt_continue"); } catch (e) {}
    if (cont !== null) showContinueBanner(cont);
    setInterval(snapshot, 1500);
    var cleared = false;
    setInterval(function () {
      if (cleared) return;
      var n = document.querySelectorAll("[data-message-author-role]").length;
      if (n > 0) {
        cleared = true;
        try { localStorage.removeItem("gpt_continue"); } catch (e) {}
        var bar = document.getElementById("gpt-continue-bar");
        if (bar) bar.remove();
      }
    }, 1500);
  }

  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
