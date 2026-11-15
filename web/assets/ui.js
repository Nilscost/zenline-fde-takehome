/* Shared UI helpers: nav, formatters, sortable table, toggle, badges, lookups. Global: UI */
(function () {
  "use strict";

  var COLORS = {
    in_stock: "#2f7d5b", low_stock: "#d08a1e", out_of_stock: "#c0392b", inactive: "#9a9890",
    client: "#1f5c4d", market: "#9bb8ae", comp: "#4a6fa5", selected: "#111",
    good: "rgba(47,125,91,.06)", bad: "rgba(192,57,43,.05)", neutral: "transparent"
  };

  var MINUS = "−";
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function group(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  var fmt = {
    eur: function (v) {
      if (!isNum(v)) return "–";
      var r = Math.round(v);
      return (r < 0 ? MINUS : "") + "€" + group(Math.abs(r));
    },
    eurK: function (v) {
      if (!isNum(v)) return "–";
      var a = Math.abs(v), s = v < 0 ? MINUS : "", out;
      if (a >= 1e6) out = (a / 1e6).toFixed(1).replace(/\.0$/, "") + "m";
      else if (a >= 1e3) out = (a / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "k";
      else out = String(Math.round(a));
      return s + "€" + out;
    },
    pct: function (v, dp) {
      if (!isNum(v)) return "–";
      dp = dp == null ? 0 : dp;
      var x = v * 100, t = Math.abs(x).toFixed(dp);
      if (+t === 0) return (0).toFixed(dp) + "%";
      return (x < 0 ? MINUS : "+") + t + "%";
    },
    share: function (v, dp) {
      if (!isNum(v)) return "–";
      return (v * 100).toFixed(dp == null ? 1 : dp) + "%";
    },
    idx: function (v, dp) {
      if (!isNum(v)) return "–";
      return v.toFixed(dp == null ? 2 : dp);
    },
    int: function (v) {
      if (!isNum(v)) return "–";
      var r = Math.round(v);
      return (r < 0 ? MINUS : "") + group(Math.abs(r));
    },
    money: function (v) {
      if (!isNum(v)) return "–";
      var t = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return (v < 0 ? MINUS : "") + "€" + t;
    }
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function el(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") e.className = v;
        else if (k === "html") e.innerHTML = v;
        else if (k === "text") e.textContent = v;
        else if (k.slice(0, 2) === "on" && typeof v === "function") e.addEventListener(k.slice(2), v);
        else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
        else e.setAttribute(k, v === true ? "" : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(e, arguments[i]);
    return e;
  }
  function append(parent, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(parent, x); }); return; }
    parent.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }

  function card(title, subtitle) {
    var c = el("section", { class: "card" });
    if (title) c.appendChild(el("h2", { text: title }));
    if (subtitle) c.appendChild(el("p", { class: "note", text: subtitle }));
    return c;
  }

  function toggle(container, options, current, onChange) {
    var wrap = el("div", { class: "pill-toggle", role: "group" });
    var btns = {};
    options.forEach(function (o) {
      var b = el("button", { type: "button", text: o.label, onclick: function () { set(o.value, true); } });
      btns[o.value] = b;
      wrap.appendChild(b);
    });
    function set(v, fire) {
      current = v;
      options.forEach(function (o) {
        btns[o.value].classList.toggle("on", o.value === v);
        btns[o.value].setAttribute("aria-pressed", o.value === v ? "true" : "false");
      });
      if (fire && onChange) onChange(v);
    }
    set(current, false);
    if (container) container.appendChild(wrap);
    return { set: function (v) { set(v, false); }, el: wrap };
  }

  /* ---- sortable table ---- */
  function table(container, cfg) {
    var cols = cfg.columns, rows = cfg.rows || [];
    var sort = cfg.sort ? { key: cfg.sort.key, dir: cfg.sort.dir || "desc" } : null;
    var highlight = null;
    var box = el("div", { class: "table-box" });
    if (cfg.maxHeight) box.style.maxHeight = cfg.maxHeight + "px";
    var tbl = el("table", { class: "tbl" });
    var thead = el("thead"), tbody = el("tbody"), trh = el("tr");
    var ths = {};
    cols.forEach(function (c) {
      var th = el("th", { class: (c.num ? "num " : "") + (c.sortable === false ? "" : "sortable"), title: c.title || null });
      th.appendChild(el("span", { class: "lbl", text: c.label }));
      th.appendChild(el("span", { class: "arrow" }));
      if (c.sortable !== false) {
        th.addEventListener("click", function () {
          if (sort && sort.key === c.key) sort.dir = sort.dir === "desc" ? "asc" : "desc";
          else sort = { key: c.key, dir: c.num ? "desc" : "asc" };
          render();
        });
      }
      ths[c.key] = th;
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    tbl.appendChild(thead);
    tbl.appendChild(tbody);
    box.appendChild(tbl);
    if (container) container.appendChild(box);
    var trs = []; // [{tr,row}]

    function val(row, c) { return c.sortValue ? c.sortValue(row) : row[c.key]; }
    function sorted() {
      var arr = rows.slice();
      if (!sort) return arr;
      var c = cols.filter(function (x) { return x.key === sort.key; })[0];
      if (!c) return arr;
      var m = sort.dir === "asc" ? 1 : -1;
      return arr.map(function (r, i) { return { r: r, i: i, v: val(r, c) }; }).sort(function (a, b) {
        var an = a.v == null || (typeof a.v === "number" && !isFinite(a.v)), bn = b.v == null || (typeof b.v === "number" && !isFinite(b.v));
        if (an || bn) return an && bn ? a.i - b.i : an ? 1 : -1; // nulls always last
        var d;
        if (typeof a.v === "number" && typeof b.v === "number") d = a.v - b.v;
        else if (typeof a.v === "boolean" || typeof b.v === "boolean") d = (a.v ? 1 : 0) - (b.v ? 1 : 0);
        else d = String(a.v).localeCompare(String(b.v), undefined, { numeric: true, sensitivity: "base" });
        return d ? d * m : a.i - b.i;
      }).map(function (x) { return x.r; });
    }

    function render() {
      Object.keys(ths).forEach(function (k) {
        var on = sort && sort.key === k;
        ths[k].classList.toggle("sorted", !!on);
        ths[k].querySelector(".arrow").textContent = on ? (sort.dir === "asc" ? "▲" : "▼") : "";
      });
      tbody.innerHTML = "";
      trs = [];
      var list = sorted();
      if (!list.length) {
        var td = el("td", { class: "empty", colspan: cols.length, text: cfg.empty || "Nothing to show" });
        tbody.appendChild(el("tr", null, td));
      }
      list.forEach(function (row) {
        var cls = cfg.rowClass ? cfg.rowClass(row) : "";
        var tr = el("tr", { class: ((cls || "") + (cfg.onRowClick ? " clickable" : "")).trim() || null });
        cols.forEach(function (c) {
          var v = row[c.key];
          var out = c.fmt ? c.fmt(v, row) : (v == null ? "–" : v);
          var td = el("td", { class: c.num ? "num" : null });
          if (c.html) td.innerHTML = out == null ? "" : out;
          else td.textContent = out == null ? "" : out;
          tr.appendChild(td);
        });
        if (cfg.onRowClick) tr.addEventListener("click", function () { cfg.onRowClick(row); });
        tbody.appendChild(tr);
        trs.push({ tr: tr, row: row });
      });
      applyHighlight(false);
    }

    function applyHighlight(scroll) {
      var first = null;
      trs.forEach(function (t) {
        var on = !!(highlight && highlight(t.row));
        t.tr.classList.toggle("hl", on);
        if (on && !first) first = t.tr;
      });
      if (scroll && first) {
        var head = thead.offsetHeight || 0;
        var br = box.getBoundingClientRect(), tr = first.getBoundingClientRect();
        var top = tr.top - br.top - head, bottom = tr.bottom - br.top;
        if (top < 0 || bottom > box.clientHeight) box.scrollTop += top - 8;
      }
    }

    render();
    return {
      el: box,
      setRows: function (r) { rows = r || []; render(); },
      setHighlight: function (pred) { highlight = pred || null; applyHighlight(true); }
    };
  }

  /* ---- badges ---- */
  var STOCK_TXT = { in_stock: "In stock", low_stock: "Low stock", out_of_stock: "Out of stock" };
  function badge(text, kind) {
    return '<span class="badge ' + esc(kind || "") + '">' + esc(text) + "</span>";
  }
  function stockBadge(stock) { return badge(STOCK_TXT[stock] || stock || "–", STOCK_TXT[stock] ? stock : ""); }
  function statusBadge(status) {
    return status === "inaktiv" ? badge("Inactive", "inactive") : badge("Active", "active");
  }

  /* ---- lookups (lazy maps) ---- */
  var maps = {};
  function lookup(name, arr, key) {
    var d = window.DATA;
    var src = d && d[arr];
    if (!src) return null;
    var m = maps[name];
    if (!m || m.src !== src) {
      m = maps[name] = { src: src, map: {} };
      src.forEach(function (r) { m.map[r[key]] = r; });
    }
    return function (k) { return m.map[k] || null; };
  }
  function mk(name, arr, key) {
    return function (k) { var f = lookup(name, arr, key); return f ? f(k) : null; };
  }
  function cellLabel(key) {
    return key == null ? "" : String(key).split("|").join(" · ");
  }

  function kpis(container, list) {
    var wrap = el("div", { class: "kpis" });
    (list || []).forEach(function (k) {
      var f = k.fmt === "pct" ? fmt.share : k.fmt === "int" ? fmt.int : fmt.eur;
      wrap.appendChild(el("div", { class: "kpi" },
        el("b", { text: f(k.value) }), el("span", { text: k.label })));
    });
    if (container) container.appendChild(wrap);
    return wrap;
  }

  function recCard(rec, opts) {
    opts = opts || {};
    var href = rec.page;
    var c = el("a", { class: "rec-card", href: href });
    var left = el("div", { class: "rc-main" });
    left.appendChild(el("div", { html: badge("Q" + rec.q, "q") + (opts.showQuestion === false ? "" : ' <span class="rc-q">' + esc(rec.question) + "</span>") }));
    left.appendChild(el("h3", { text: rec.action }));
    left.appendChild(el("p", { class: "rc-ev", text: rec.evidence }));
    var right = el("div", { class: "rc-prize" },
      el("b", { text: fmt.eurK(rec.prize_low) + " – " + fmt.eurK(rec.prize_high) }),
      el("span", { text: rec.prize_unit + " / 12 wks" }));
    c.appendChild(left);
    c.appendChild(right);
    return c;
  }

  /* ---- nav ---- */
  var PAGES = [
    ["index", "index.html", "Recommendations"], ["assortment", "assortment.html", "1 Assortment"],
    ["products", "products.html", "2 Products"], ["price", "price.html", "3 Price"],
    ["availability", "availability.html", "4 Availability"], ["method", "method.html", "Method"]
  ];
  function renderNav() {
    var host = document.getElementById("nav");
    if (!host) return;
    var page = document.body.dataset.page;
    host.innerHTML = "";
    var bar = el("div", { class: "nav-bar" });
    bar.appendChild(el("a", { class: "nav-title", href: "index.html", text: "Hair Coloration · Category review" }));
    var links = el("nav", { class: "nav-links" });
    PAGES.forEach(function (p) {
      links.appendChild(el("a", { href: p[1], class: p[0] === page ? "active" : null, "aria-current": p[0] === page ? "page" : null, text: p[2] }));
    });
    bar.appendChild(links);
    host.appendChild(bar);
  }

  function boot() {
    renderNav();
    if (!window.DATA) {
      var app = document.getElementById("app");
      if (app) {
        app.innerHTML = "";
        app.appendChild(el("div", { class: "card data-missing" },
          el("h2", { text: "Data not found" }), el("p", { text: "Data not found. Run python3 review.py." })));
      }
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.UI = {
    COLORS: COLORS, fmt: fmt, esc: esc, el: el, card: card, toggle: toggle, table: table,
    badge: badge, stockBadge: stockBadge, statusBadge: statusBadge,
    sku: mk("sku", "skus", "id"), comp: mk("comp", "comps", "id"), cell: mk("cell", "cells", "key"),
    brand: mk("brand", "brands", "key"), supplier: mk("supplier", "suppliers", "name"),
    cellLabel: cellLabel, kpis: kpis, recCard: recCard
  };
})();
