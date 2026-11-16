(function () {
  var listEl = document.getElementById("list");
  var msgEl = document.getElementById("msg");
  var form = document.getElementById("addForm");
  var nameEl = document.getElementById("name");
  var cookieEl = document.getElementById("cookie");
  var saveBtn = document.getElementById("saveBtn");

  function setMsg(text, ok) {
    msgEl.textContent = text || "";
    msgEl.className = ok ? "ok" : (text ? "err" : "");
  }
  function fmt(ts) {
    if (!ts) return "";
    try { return new Date(ts * 1000).toLocaleString(); } catch (e) { return ""; }
  }
  function api(method, payload) {
    var opt = { method: method, credentials: "same-origin", headers: {} };
    if (payload) {
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(payload);
    }
    return fetch("/__auth/api", opt).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: "服务端返回异常" }; });
    });
  }

  function render(data) {
    listEl.innerHTML = "";
    var ps = (data && Array.isArray(data.profiles)) ? data.profiles : [];
    if (!ps.length) {
      var em = document.createElement("div");
      em.className = "empty";
      em.textContent = "还没有保存的账号，登录官方站后把 Cookie 粘贴到下面。";
      listEl.appendChild(em);
      return;
    }
    ps.forEach(function (p) {
      var card = document.createElement("div");
      card.className = "card";

      var main = document.createElement("div");
      main.className = "main";
      var nm = document.createElement("div");
      nm.className = "name";
      nm.textContent = p.name || "未命名账号";
      if (p.active) {
        var b = document.createElement("span");
        b.className = "badge";
        b.textContent = "使用中";
        nm.appendChild(b);
      }
      var meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = "保存于 " + fmt(p.ts);
      main.appendChild(nm);
      main.appendChild(meta);

      var use = document.createElement("button");
      use.type = "button";
      use.textContent = p.active ? "已启用" : "切换";
      use.disabled = !!p.active;
      use.onclick = function () {
        use.disabled = true;
        api("POST", { action: "use", id: p.id }).then(function (res) {
          if (!res.ok) { setMsg(res.error || "切换失败"); use.disabled = false; return; }
          setMsg("已切换到 " + (p.name || "该账号") + "，正在返回主站…", true);
          setTimeout(function () { location.href = "/"; }, 700);
        }).catch(function () { setMsg("切换失败"); use.disabled = false; });
      };

      var del = document.createElement("button");
      del.type = "button";
      del.className = "danger";
      del.textContent = "删除";
      del.onclick = function () {
        if (!confirm("删除账号「" + (p.name || "未命名") + "」？")) return;
        api("POST", { action: "delete", id: p.id }).then(function (res) {
          if (!res.ok) { setMsg(res.error || "删除失败"); return; }
          setMsg("已删除", true);
          load();
        });
      };

      card.appendChild(main);
      card.appendChild(use);
      card.appendChild(del);
      listEl.appendChild(card);
    });
  }

  function load() {
    api("GET").then(function (data) {
      if (!data || data.ok === false) {
        listEl.innerHTML = '<div class="empty">加载失败：' + ((data && data.error) || "未知错误") + "</div>";
        return;
      }
      render(data);
    }).catch(function () {
      listEl.innerHTML = '<div class="empty">加载失败，请刷新重试</div>';
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var cookie = (cookieEl.value || "").trim();
    if (!cookie) { setMsg("请先粘贴 Cookie"); cookieEl.focus(); return; }
    saveBtn.disabled = true;
    setMsg("校验中…", true);
    api("POST", { action: "save", input: cookie, name: (nameEl.value || "").trim() })
      .then(function (res) {
        saveBtn.disabled = false;
        if (!res.ok) { setMsg(res.error || "保存失败"); return; }
        cookieEl.value = "";
        nameEl.value = "";
        setMsg(res.warning || "校验通过，已保存并切换", !!res.warning);
        load();
      })
      .catch(function () {
        saveBtn.disabled = false;
        setMsg("保存失败，请重试");
      });
  });

  document.getElementById("clearAll").onclick = function () {
    if (!confirm("清空全部已保存的账号？")) return;
    api("POST", { action: "clear" }).then(function (res) {
      if (!res.ok) { setMsg(res.error || "清空失败"); return; }
      setMsg("已清空", true);
      load();
    });
  };

  load();
})();
