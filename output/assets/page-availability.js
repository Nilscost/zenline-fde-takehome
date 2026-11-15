/* Page 4: Availability. Are the products available? */
(function () {
  "use strict";
  var D = window.DATA, app = document.getElementById("app");
  if (!D || !app || !window.UI || !window.QuadChart) return;
  var U = UI, F = U.fmt, E = U.el, COL = U.COLORS, Q = D.quadrants.availability;
  var NS = "http://www.w3.org/2000/svg";

  var st = document.createElement("style");
  st.textContent =
    ".pg-callout{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px 28px;align-items:flex-start;border-left:4px solid var(--accent)}" +
    ".pg-callout h3{margin:6px 0 4px;font-size:18px}.pg-callout p{margin:2px 0}.pg-callout .pg-prize{text-align:right;flex:none}" +
    ".pg-callout .pg-prize b{display:block;font-size:24px;color:var(--accent);white-space:nowrap}.pg-callout .pg-prize span{font-size:12px;color:var(--muted)}" +
    ".pga-tools{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center;margin:0 0 10px}.pga-tools label{font-size:13px;color:var(--muted);margin-right:6px}" +
    ".pga-sel{font-size:13px;color:var(--muted)}.pga-sel b{color:var(--ink)}" +
    "button.pill[disabled]{opacity:.45;cursor:default;pointer-events:none}" +
    ".pga-legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--muted);margin:0 0 6px}" +
    ".pga-legend span{display:inline-flex;align-items:center;gap:6px}.pga-legend i{width:12px;height:12px;border-radius:3px;display:inline-block}" +
    ".pga-svgbox{position:relative}.pga-svgbox svg{display:block;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
    ".pga-svgbox .bar{cursor:pointer}.pga-svgbox .seg:hover{stroke:#111;stroke-width:1.2}";
  document.head.appendChild(st);

  function callout(rec) {
    var c = E("section", { class: "card pg-callout" });
    c.appendChild(E("div", null,
      E("div", { html: U.badge("Q" + rec.q, "q") + ' <span class="note">Recommended action</span>' }),
      E("h3", { text: rec.action }), E("p", { text: rec.evidence }), E("p", { class: "note", text: rec.basis })));
    c.appendChild(E("div", { class: "pg-prize" }, E("b", { text: F.eur(rec.prize_low) + " – " + F.eur(rec.prize_high) }),
      E("span", { text: "per " + D.meta.period_weeks + " weeks · " + rec.prize_unit + ", illustrative" })));
    return c;
  }
  var rec = D.recs.filter(function (r) { return r.q === 4; })[0];
  app.appendChild(E("div", { class: "page-head" },
    E("h1", { text: rec ? rec.question : "Are the products available?" }),
    E("p", { class: "sub", text: "Empty and thin shelves cost the most where a product sells well or its market is growing. Supplier first, then product." })));
  if (rec) app.appendChild(callout(rec));

  var skuById = {}; D.skus.forEach(function (s) { skuById[s.id] = s; });
  var supByName = {}; D.suppliers.forEach(function (s) { supByName[s.name] = s; });
  var state = { metric: "rev", supplier: null, sel: null, activeOnly: true };

  /* per-supplier split by stock status */
  var split = D.suppliers.map(function (sp) {
    var o = { name: sp.name, in_stock: [0, 0], low_stock: [0, 0], out_of_stock: [0, 0], inactive: [0, 0] }; // [revenue, count]
    D.skus.forEach(function (s) {
      if (s.supplier !== sp.name) return;
      var k = s.active ? s.stock : "inactive";
      o[k][0] += s.rev; o[k][1] += 1;
    });
    return o;
  });
  var SEGS = [["in_stock", "In stock", COL.in_stock], ["low_stock", "Low stock", COL.low_stock], ["out_of_stock", "Out of stock", COL.out_of_stock], ["inactive", "Inactive SKUs", COL.inactive]];

  /* ---- supplier card ---- */
  var supCard = U.card("Where is availability a problem?", "Active SKUs by stock status for each supplier, largest revenue at risk (low stock plus out of stock) first. Click a bar to focus the whole page on that supplier.");
  var tools = E("div", { class: "pga-tools" });
  var selInfo = E("span", { class: "pga-sel" });
  var clearBtn = E("button", { type: "button", class: "pill", text: "Clear selection", onclick: function () { clearAll(); } });
  var zoomBtn = E("button", { type: "button", class: "pill", text: "Show only this supplier in chart", onclick: function () { toggleZoom(); } });
  var g = E("span"); g.appendChild(E("label", { text: "Measure" }));
  var tMetric = U.toggle(g, [{ value: "rev", label: "Channel revenue" }, { value: "n", label: "Number of SKUs" }], state.metric, function (v) { state.metric = v; drawBars(); });
  tools.appendChild(g); tools.appendChild(clearBtn); tools.appendChild(zoomBtn); tools.appendChild(selInfo);
  supCard.appendChild(tools);
  var legend = E("div", { class: "pga-legend" });
  SEGS.forEach(function (s) { legend.appendChild(E("span", null, E("i", { style: { background: s[2] } }), s[1])); });
  supCard.appendChild(legend);
  var barBox = E("div", { class: "pga-svgbox" });
  supCard.appendChild(barBox);
  app.appendChild(supCard);

  var tipEl = E("div", { class: "qc-tip" });
  tipEl.style.cssText = "position:fixed;left:0;top:0;display:none;pointer-events:none;z-index:9999;";
  document.body.appendChild(tipEl);
  function showTip(ev, title, rows) {
    tipEl.innerHTML = "";
    tipEl.appendChild(E("div", { class: "qc-tip-title", text: title }));
    var tb = E("table", { class: "qc-tip-rows" });
    rows.forEach(function (r) { tb.appendChild(E("tr", null, E("td", { class: "k", text: r[0] }), E("td", { class: "v", text: r[1] }))); });
    tipEl.appendChild(tb); tipEl.style.display = "block"; moveTip(ev);
  }
  function moveTip(ev) {
    var w = tipEl.offsetWidth, h = tipEl.offsetHeight, x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - 14;
    tipEl.style.left = Math.max(8, x) + "px"; tipEl.style.top = Math.max(8, y) + "px";
  }
  function S(tag, a, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in a) if (a[k] != null) e.setAttribute(k, a[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function nice(max) {
    var raw = max / 5, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / mag;
    var step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
    return { step: step, top: Math.ceil(max / step) * step };
  }

  function drawBars() {
    barBox.innerHTML = "";
    var W = Math.max(480, barBox.clientWidth || 800), rowH = 30, mt = 8, mb = 54, ml = 190, mr = 90;
    var H = mt + rowH * split.length + mb;
    var rev = state.metric === "rev";
    var tot = split.map(function (o) { return SEGS.reduce(function (a, s) { return a + o[s[0]][rev ? 0 : 1]; }, 0); });
    var sc = nice(Math.max.apply(null, tot) || 1), pw = W - ml - mr;
    function X(v) { return v / sc.top * pw; }
    var svg = S("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img" }, barBox);
    for (var v = 0; v <= sc.top + sc.step * 1e-6; v += sc.step) {
      S("line", { x1: ml + X(v), x2: ml + X(v), y1: mt, y2: H - mb, stroke: "#eeece6" }, svg);
      var t = S("text", { x: ml + X(v), y: H - mb + 16, "text-anchor": "middle", "font-size": 11, fill: "#6b6a65" }, svg);
      t.textContent = rev ? F.eurK(v) : F.int(v);
    }
    var ax = S("text", { x: ml + pw / 2, y: H - 10, "text-anchor": "middle", "font-size": 12, "font-weight": 600, fill: "#3d3c38" }, svg);
    ax.textContent = rev ? "Channel revenue, " + D.meta.period_weeks + " weeks, by stock status" : "Number of SKUs by stock status";
    split.forEach(function (o, i) {
      var y = mt + i * rowH, sp = supByName[o.name], dim = state.supplier && state.supplier !== o.name;
      var gEl = S("g", { class: "bar", opacity: dim ? 0.3 : 1 }, svg);
      if (state.supplier === o.name) S("rect", { x: 2, y: y + 1, width: W - 4, height: rowH - 2, rx: 4, fill: "#fdf6e3", stroke: "#d08a1e" }, gEl);
      var lab = S("text", { x: ml - 8, y: y + rowH / 2 + 4, "text-anchor": "end", "font-size": 12.5, fill: "#1d1d1b", "font-weight": state.supplier === o.name ? 700 : 400 }, gEl);
      lab.textContent = o.name.length > 26 ? o.name.slice(0, 25) + "…" : o.name;
      var x0 = ml;
      SEGS.forEach(function (s) {
        var val = o[s[0]][rev ? 0 : 1], w = X(val);
        if (val <= 0) return;
        var r = S("rect", { class: "seg", x: x0, y: y + 5, width: Math.max(w, 0.5), height: rowH - 10, fill: s[2], "fill-opacity": s[0] === "inactive" ? 0.45 : 0.85 }, gEl);
        r.addEventListener("mousemove", function (ev) {
          showTip(ev, o.name + " · " + s[1], [
            ["Channel revenue", F.eur(o[s[0]][0])], ["SKUs", F.int(o[s[0]][1])],
            ["Supplier total", rev ? F.eur(tot[i]) : F.int(tot[i]) + " SKUs"]]);
        });
        r.addEventListener("mouseleave", function () { tipEl.style.display = "none"; });
        x0 += w;
      });
      var vt = S("text", { x: x0 + 6, y: y + rowH / 2 + 4, "font-size": 11.5, fill: "#3d3c38" }, gEl);
      vt.textContent = rev ? F.eurK(tot[i]) : F.int(tot[i]);
      var hit = S("rect", { x: 0, y: y, width: W, height: rowH, fill: "transparent" }, gEl);
      hit.addEventListener("click", function () { selectSupplier(state.supplier === o.name ? null : o.name); });
      hit.addEventListener("mousemove", function (ev) {
        showTip(ev, o.name, [["SKUs (active)", sp.n + " (" + sp.n_active + ")"], ["Revenue", F.eur(sp.rev)], ["Revenue exposed", F.eur(sp.rev_exposed)], ["Click", "to select this supplier"]]);
      });
      hit.addEventListener("mouseleave", function () { tipEl.style.display = "none"; });
    });
  }
  if (typeof ResizeObserver !== "undefined") {
    var lastW = 0, tmr;
    new ResizeObserver(function () { clearTimeout(tmr); tmr = setTimeout(function () { var w = barBox.clientWidth; if (w && w !== lastW) { lastW = w; drawBars(); } }, 80); }).observe(barBox);
  }

  /* ---- SKU chart ---- */
  var restockMap = {}; D.lists.restock.forEach(function (r) { restockMap[r.id] = r; });
  var labelIds = {};
  D.lists.restock.filter(function (r) { return skuById[r.id] && skuById[r.id].stock === "out_of_stock"; })
    .sort(function (a, b) { return b.prize_high - a.prize_high; }).slice(0, 12).forEach(function (r) { labelIds[r.id] = 1; });
  var STOCK_TXT = { in_stock: "In stock", low_stock: "Low stock", out_of_stock: "Out of stock" };

  var chartCard = U.card("Which SKUs to restock first?", "Each bubble is a SKU. The shaded top-right corner is where to act first: big sellers in a growing market.");
  var ctools = E("div", { class: "pga-tools" });
  var g2 = E("span"); g2.appendChild(E("label", { text: "Show" }));
  var tActive = U.toggle(g2, [{ value: "on", label: "Active only" }, { value: "off", label: "All SKUs incl. inactive" }], "on", function (v) { state.activeOnly = v === "on"; rebuild(); });
  ctools.appendChild(g2);
  chartCard.appendChild(ctools);
  var chartBox = E("div"); chartCard.appendChild(chartBox);
  app.appendChild(chartCard);

  function skuPoints(ids) {
    return ids.map(function (i) { return skuById[i]; }).filter(function (s) { return s && (!state.activeOnly || s.active); }).map(function (s) {
      var ina = !s.active;
      return {
        id: s.id, x: s.rev, y: s.mk_trend, size: s.mkt_rev, color: ina ? COL.inactive : COL[s.stock], hollow: ina, dashed: ina,
        label: labelIds[s.id] ? s.id : null,
        tip: { title: s.id + " · " + s.name, rows: [
          ["Supplier", s.supplier], ["Status", ina ? "Inactive" : "Active"], ["Stock", STOCK_TXT[s.stock] || s.stock],
          ["Channel revenue", F.eur(s.rev)], ["Market trend", F.pct(s.mk_trend)], ["Market revenue", F.eur(s.mkt_rev)],
          ["On restock list", restockMap[s.id] ? "Yes" : "No"]] }
      };
    });
  }
  var legend2 = [{ label: "In stock", color: COL.in_stock }, { label: "Low stock", color: COL.low_stock }, { label: "Out of stock", color: COL.out_of_stock }, { label: "Inactive SKU", color: COL.inactive, hollow: true }];
  var xAx = { label: "Channel revenue, " + D.meta.period_weeks + " weeks (log)", scale: "log", split: Q.x_split, format: function (v) { return F.eurK(v); } };
  var yAx = { label: "Market trend, " + D.meta.period_weeks + " weeks", scale: "linear", split: Q.y_split, format: function (v) { return F.pct(v); } };
  function rootView() {
    return { id: "skus", title: "All SKUs", x: xAx, y: yAx, legend: legend2, sizeNote: "Bubble size = market revenue · shaded corner = act here first · labels = out-of-stock SKUs on the restock list", points: skuPoints(D.skus.map(function (s) { return s.id; })) };
  }
  function zoomView() {
    var sp = supByName[state.supplier];
    return { id: "sup:" + sp.name, title: sp.name, x: xAx, y: yAx, legend: legend2, sizeNote: "Bubble size = market revenue", points: skuPoints(sp.sku_ids) };
  }
  var qc = QuadChart.create(chartBox, {
    height: 480, x: xAx, y: yAx, quadrants: { tl: Q.tl, tr: Q.tr, bl: Q.bl, br: Q.br }, tints: { tr: "bad" },
    onClick: function (p) { var s = skuById[p.id]; selectSupplier(s.supplier, p.id); },
    onBackgroundClick: function () { clearAll(); },
    onViewChange: function () { updateControls(); }
  });
  function rebuild() {
    var sup = state.supplier, zoomed = qc.depth() > 1;
    qc.setView(rootView());
    if (zoomed && sup) qc.pushView(zoomView());
    applySel();
  }

  /* ---- tables ---- */
  var tblCard = U.card("Supplier scorecard", "Click a row to select a supplier.");
  var supTbl = U.table(tblCard, {
    columns: [{ key: "name", label: "Supplier" }, { key: "n", label: "SKUs", num: true }, { key: "n_active", label: "Active", num: true },
      { key: "n_oos", label: "Out of stock", num: true }, { key: "n_low", label: "Low stock", num: true },
      { key: "oos_rate", label: "Out-of-stock rate", num: true, title: "Share of active SKUs out of stock", fmt: function (v) { return F.share(v); } },
      { key: "low_rate", label: "Low-stock rate", num: true, title: "Share of active SKUs low on stock", fmt: function (v) { return F.share(v); } },
      { key: "rev", label: "Revenue", num: true, fmt: function (v) { return F.eur(v); } },
      { key: "rev_exposed", label: "Revenue exposed", num: true, title: "Revenue of low-stock and out-of-stock SKUs", fmt: function (v) { return F.eur(v); } },
      { key: "n_restock", label: "SKUs on restock list", num: true }],
    rows: D.suppliers, sort: { key: "rev_exposed", dir: "desc" },
    onRowClick: function (r) { selectSupplier(state.supplier === r.name ? null : r.name); }
  });
  app.appendChild(tblCard);

  var rsCard = U.card("Restock list", "Active SKUs that are out of stock, or low on stock in a market growing fast. Prize = revenue recovered, illustrative. Click a row to find the SKU in the chart.");
  var rsRows = D.lists.restock.map(function (r) { var s = skuById[r.id] || {}; return Object.assign({ name: s.name, supplier: s.supplier, stock: s.stock, rev: s.rev, mk_trend: s.mk_trend }, r); });
  var rsTbl = U.table(rsCard, {
    columns: [{ key: "stock", label: "Stock", html: true, fmt: function (v) { return U.stockBadge(v); } },
      { key: "id", label: "ID" }, { key: "name", label: "Product" }, { key: "supplier", label: "Supplier" },
      { key: "rev", label: "Revenue", num: true, fmt: function (v) { return F.eur(v); } },
      { key: "mk_trend", label: "Market trend", num: true, fmt: function (v) { return F.pct(v); } },
      { key: "reason", label: "Why" },
      { key: "prize_high", label: "Prize range (revenue)", num: true, fmt: function (v, r) { return F.eur(r.prize_low) + " – " + F.eur(r.prize_high); } }],
    rows: rsRows, sort: { key: "prize_high", dir: "desc" }, maxHeight: 460, empty: "No restock SKUs for this selection",
    onRowClick: function (r) { selectSupplier(r.supplier, r.id); }
  });
  app.appendChild(rsCard);

  /* ---- selection logic ---- */
  function applySel() {
    var sp = state.supplier ? supByName[state.supplier] : null;
    var inView = {}; (qc.view().points || []).forEach(function (p) { inView[p.id] = 1; });
    var ids = sp ? sp.sku_ids.filter(function (i) { return inView[i]; }) : null;
    qc.highlight(ids);
    qc.select(state.sel && inView[state.sel] ? state.sel : null);
    drawBars();
    supTbl.setHighlight(sp ? function (r) { return r.name === sp.name; } : null);
    rsTbl.setRows(sp ? rsRows.filter(function (r) { return r.supplier === sp.name; }) : rsRows);
    rsTbl.setHighlight(state.sel ? function (r) { return r.id === state.sel; } : null);
    updateControls();
  }
  function updateControls() {
    var sp = state.supplier ? supByName[state.supplier] : null;
    clearBtn.disabled = !(sp || state.sel);
    zoomBtn.disabled = !sp;
    zoomBtn.textContent = qc.depth() > 1 ? "Back to all SKUs in chart" : "Show only this supplier in chart";
    selInfo.innerHTML = "";
    if (sp) {
      selInfo.appendChild(document.createTextNode("Selected: "));
      selInfo.appendChild(E("b", { text: sp.name }));
      selInfo.appendChild(document.createTextNode(" · " + sp.n + " SKUs · " + F.eur(sp.rev_exposed) + " revenue exposed" + (state.sel ? " · " + state.sel : "")));
    } else selInfo.textContent = "No supplier selected";
  }
  function selectSupplier(name, skuId) {
    var zoomed = qc.depth() > 1;
    if (name !== state.supplier && zoomed) { state.supplier = name; qc.back(); }
    state.supplier = name;
    state.sel = name ? (skuId || null) : null;
    // make sure a selected SKU is visible even when inactive points are hidden
    if (state.sel && skuById[state.sel] && !skuById[state.sel].active && state.activeOnly) { state.activeOnly = false; tActive.set("off"); rebuild(); return; }
    applySel();
  }
  function toggleZoom() {
    if (qc.depth() > 1) qc.back(); else if (state.supplier) qc.pushView(zoomView());
    applySel();
  }
  function clearAll() {
    state.supplier = null; state.sel = null;
    if (qc.depth() > 1) qc.back();
    applySel();
  }

  qc.setView(rootView());
  applySel();
})();
