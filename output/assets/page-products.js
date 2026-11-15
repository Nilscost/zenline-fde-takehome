/* Page 2: Products. Are you selling the right products? */
(function () {
  "use strict";
  var D = window.DATA, app = document.getElementById("app");
  if (!D || !app || !window.UI || !window.QuadChart) return;
  var U = UI, F = U.fmt, E = U.el, COL = U.COLORS, Q = D.quadrants.products;

  var st = document.createElement("style");
  st.textContent =
    ".pg-callout{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px 28px;align-items:flex-start;border-left:4px solid var(--accent)}" +
    ".pg-callout h3{margin:6px 0 4px;font-size:18px}.pg-callout p{margin:2px 0}.pg-callout .pg-prize{text-align:right;flex:none}" +
    ".pg-callout .pg-prize b{display:block;font-size:24px;color:var(--accent);white-space:nowrap}.pg-callout .pg-prize span{font-size:12px;color:var(--muted)}" +
    ".pgp-summary{margin:10px 0 0;font-size:14px}.pgp-tools{display:flex;flex-wrap:wrap;gap:8px 24px;align-items:center;margin:0 0 10px}" +
    ".pgp-tools label{font-size:13px;color:var(--muted);margin-right:6px}";
  document.head.appendChild(st);

  function callout(rec) {
    var c = E("section", { class: "card pg-callout" });
    var l = E("div", null,
      E("div", { html: U.badge("Q" + rec.q, "q") + ' <span class="note">Recommended action</span>' }),
      E("h3", { text: rec.action }), E("p", { text: rec.evidence }), E("p", { class: "note", text: rec.basis }));
    var r = E("div", { class: "pg-prize" }, E("b", { text: F.eur(rec.prize_low) + " – " + F.eur(rec.prize_high) }),
      E("span", { text: "per " + D.meta.period_weeks + " weeks · " + rec.prize_unit + ", illustrative" }));
    c.appendChild(l); c.appendChild(r);
    return c;
  }

  var rec = D.recs.filter(function (r) { return r.q === 2; })[0];
  app.appendChild(E("div", { class: "page-head" },
    E("h1", { text: rec ? rec.question : "Are you selling the right products?" }),
    E("p", { class: "sub", text: "Each product is compared with its share of market demand: where demand is strong but our share is low, shelf and promotion are not working hard enough." })));
  if (rec) app.appendChild(callout(rec));

  /* ---- lookups & lists ---- */
  var skuById = {}; D.skus.forEach(function (s) { skuById[s.id] = s; });
  var npMap = {}, lpMap = {};
  D.lists.not_pushed.forEach(function (r) { npMap[r.id] = r; });
  D.lists.low_perf.forEach(function (r) { lpMap[r.id] = r; });
  var LIST_TXT = { relist: "Relist", not_pushed: "Not pushed enough", low_perf: "Low performing", price_review: "Price review", restock: "Restock" };
  var NEUTRAL = "#b8c4cc", AGG = "#6f8f86";

  // labelled SKUs: all not-pushed, then low performers with the most shelf space, max 12
  var labelIds = {};
  D.lists.not_pushed.forEach(function (r) { labelIds[r.id] = 1; });
  D.lists.low_perf.map(function (r) { return skuById[r.id]; }).filter(Boolean)
    .sort(function (a, b) { return b.shelf_cm - a.shelf_cm; })
    .forEach(function (s) { if (Object.keys(labelIds).length < 12) labelIds[s.id] = 1; });

  var state = { mode: "sku", x: "share", drill: null, sel: null };
  var chartCard = U.card("Demand versus our share", "Bubbles above the horizontal line are products where we hold more than our fair share of market demand; below it, we under-index.");
  var tools = E("div", { class: "pgp-tools" });
  chartCard.appendChild(tools);
  var chartBox = E("div"); chartCard.appendChild(chartBox);
  var tblHead = E("h3", { style: { margin: "16px 0 6px" } });
  var tblBox = E("div");
  chartCard.appendChild(tblHead); chartCard.appendChild(tblBox);
  app.appendChild(chartCard);

  var toggleMode, toggleX;
  var g1 = E("span"), g2 = E("span");
  g1.appendChild(E("label", { text: "View" }));
  toggleMode = U.toggle(g1, [{ value: "sku", label: "SKUs" }, { value: "cell", label: "Subcategory × shade" }, { value: "brand", label: "Brand" }], state.mode, function (v) {
    state.mode = v; state.drill = null; state.sel = null; build();
  });
  g2.appendChild(E("label", { text: "X axis" }));
  toggleX = U.toggle(g2, [{ value: "share", label: "Market demand: unit share" }, { value: "trend", label: "Market trend" }], state.x, function (v) {
    state.x = v; build();
  });
  tools.appendChild(g1); tools.appendChild(g2);

  function xAxis() {
    return state.x === "share"
      ? { label: "Market demand: share of total market units (log)", scale: "log", split: Q.x_split_mkt_unit_share, format: function (v) { var p = v * 100; return F.share(v, p >= 1 ? 1 : p >= 0.1 ? 2 : 3); } }
      : { label: "Market trend, 12 weeks", scale: "linear", split: Q.x_split_mk_trend, format: function (v) { return F.pct(v); } };
  }
  function xv(o) { return state.x === "share" ? o.mkt_unit_share : o.mk_trend; }
  var yAxis = { label: "Channel vs market: unit share index (1 = fair share)", scale: "log", split: Q.y_split, format: function (v) { return F.idx(v, v < 1 ? 2 : (v < 10 ? 1 : 0)); } };

  function skuColor(s) {
    if (!s.active) return COL.inactive;
    if (npMap[s.id]) return COL.client;
    if (lpMap[s.id]) return COL.out_of_stock;
    return NEUTRAL;
  }
  function listTxt(s) { return (s.lists || []).map(function (c) { return LIST_TXT[c] || c; }); }
  function skuPoints(ids) {
    return ids.map(function (id) { return skuById[id]; }).filter(Boolean).map(function (s) {
      var inactive = !s.active;
      return {
        id: s.id, x: xv(s), y: s.fair_index, size: s.shelf_share, color: skuColor(s), hollow: inactive, dashed: inactive,
        label: labelIds[s.id] ? s.id : null,
        tip: { title: s.id + " · " + s.name, rows: [
          ["Brand · cell", s.brand + " · " + U.cellLabel(s.cell)], ["Status", (inactive ? "Inactive" : "Active") + " · " + s.stock.replace(/_/g, " ")],
          ["Market unit share", F.share(s.mkt_unit_share, 2)], ["Channel unit share", F.share(s.ch_unit_share, 2)],
          ["Fair-share index", F.idx(s.fair_index)], ["Shelf share", F.share(s.shelf_share, 2)],
          ["Market trend", F.pct(s.mk_trend)], ["Channel trend", F.pct(s.ch_trend)],
          ["Channel revenue", F.eur(s.rev)], ["Lists", listTxt(s).join(", ") || "–"]] }
      };
    });
  }
  function aggPoints(kind) {
    var src = kind === "cell" ? D.cells.filter(function (c) { return c.n_skus > 0; }) : D.brands;
    var pts = src.map(function (o) {
      var name = kind === "cell" ? U.cellLabel(o.key) : o.key;
      return {
        id: o.key, x: xv(o), y: o.fair_index, size: o.shelf_share, color: AGG,
        data: { skuIds: o.sku_ids, name: name }, _ext: Math.abs(Math.log(Math.max(o.fair_index, 0.02))),
        tip: { title: name, rows: [
          ["SKUs (active)", o.n_skus != null ? o.n_skus + " (" + o.n_active + ")" : o.sku_ids.length],
          ["Market unit share", F.share(o.mkt_unit_share, 2)], ["Channel unit share", F.share(o.ch_unit_share, 2)],
          ["Fair-share index", F.idx(o.fair_index)], ["Shelf share", F.share(o.shelf_share, 2)],
          ["Market trend", F.pct(o.mk_trend)], ["Channel trend", F.pct(o.ch_trend)], ["Channel revenue", F.eur(o.rev)],
          ["Click", "to see its SKUs"]] }
      };
    });
    pts.slice().sort(function (a, b) { return b._ext - a._ext; }).slice(0, 6).forEach(function (p) { p.label = p.data.name; });
    return pts;
  }

  var legendSku = [
    { label: "Not pushed enough", color: COL.client }, { label: "Low performing", color: COL.out_of_stock },
    { label: "Other active SKU", color: NEUTRAL }, { label: "Inactive SKU", color: COL.inactive, hollow: true }
  ];
  function rootView() {
    var base = { x: xAxis(), y: yAxis, sizeNote: "Bubble size = share of shelf space" };
    if (state.mode === "sku") {
      base.id = "skus"; base.title = "All SKUs"; base.points = skuPoints(D.skus.map(function (s) { return s.id; })); base.legend = legendSku; base.kind = "sku";
    } else {
      base.id = state.mode; base.title = state.mode === "cell" ? "All subcategory × shade groups" : "All brands";
      base.points = aggPoints(state.mode); base.kind = state.mode;
      base.legend = [{ label: state.mode === "cell" ? "Subcategory × shade group (click to see its SKUs)" : "Brand (click to see its SKUs)", color: AGG }];
    }
    return base;
  }
  function drillView() {
    return { id: "drill:" + state.drill.id, title: state.drill.name, kind: "sku", x: xAxis(), y: yAxis, points: skuPoints(state.drill.ids), legend: legendSku, sizeNote: "Bubble size = share of shelf space" };
  }

  var qc = QuadChart.create(chartBox, {
    rMin: 3, rMax: 11,   // shelf share varies little; keep bubbles small so points stay separable
    height: 480, x: xAxis(), y: yAxis,
    quadrants: { tl: Q.tl, tr: Q.tr, bl: Q.bl, br: Q.br },
    tints: { tr: "good", bl: "bad", br: "rgba(208,138,30,.07)" },
    onClick: function (p) {
      var v = qc.view();
      if (v.kind === "sku") { selectRow(p.id); return; }
      state.drill = { id: p.id, name: p.data.name, ids: p.data.skuIds };
      state.sel = null;
      qc.pushView(drillView());
    },
    onBackgroundClick: function () { selectRow(null); },
    onViewChange: function (v) {
      if (v && state.drill && qc.depth() === 1) state.drill = null;
      renderTable();
    }
  });

  /* ---- table under chart ---- */
  var tbl = null, tblKind = null;
  function pctCol(k, label, dp, title) { return { key: k, label: label, num: true, title: title, fmt: function (v) { return F.share(v, dp); } }; }
  var skuCols = [
    { key: "id", label: "ID" }, { key: "name", label: "Product" }, { key: "brand", label: "Brand" },
    { key: "cell", label: "Subcategory · shade", fmt: function (v) { return U.cellLabel(v); } },
    { key: "status", label: "Status", html: true, fmt: function (v) { return U.statusBadge(v); } },
    { key: "stock", label: "Stock", html: true, fmt: function (v) { return U.stockBadge(v); } },
    pctCol("mkt_unit_share", "Market unit share", 2), pctCol("ch_unit_share", "Channel unit share", 2), pctCol("shelf_share", "Shelf share", 2),
    { key: "fair_index", label: "Fair-share index", num: true, title: "Channel unit share ÷ market unit share (1 = fair share)", fmt: function (v) { return F.idx(v); } },
    { key: "shelf_index", label: "Shelf index", num: true, title: "Shelf share ÷ market unit share (1 = shelf in line with demand)", fmt: function (v) { return F.idx(v); } },
    { key: "ch_trend", label: "Channel trend", num: true, fmt: function (v) { return F.pct(v); } },
    { key: "mk_trend", label: "Market trend", num: true, fmt: function (v) { return F.pct(v); } },
    { key: "rev", label: "Channel revenue", num: true, fmt: function (v) { return F.eur(v); } },
    { key: "lists", label: "Lists", sortValue: function (r) { return listTxt(r).join(", "); }, fmt: function (v, r) { return listTxt(r).join(", ") || "–"; } }
  ];
  var aggCols = [
    { key: "name", label: "Group" }, { key: "n_skus", label: "SKUs", num: true }, { key: "n_active", label: "Active", num: true },
    pctCol("mkt_unit_share", "Market unit share", 2), pctCol("ch_unit_share", "Channel unit share", 2), pctCol("shelf_share", "Shelf share", 2),
    { key: "fair_index", label: "Fair-share index", num: true, fmt: function (v) { return F.idx(v); } },
    { key: "ch_trend", label: "Channel trend", num: true, fmt: function (v) { return F.pct(v); } },
    { key: "mk_trend", label: "Market trend", num: true, fmt: function (v) { return F.pct(v); } },
    { key: "rev", label: "Channel revenue", num: true, fmt: function (v) { return F.eur(v); } }
  ];
  function rid(r) { return r.id != null ? r.id : r.key; }
  function currentRows() {
    var v = qc.view(); if (!v) return [];
    if (v.kind === "sku") return v.points.map(function (p) { return skuById[p.id]; }).filter(Boolean);
    var src = v.kind === "cell" ? D.cells : D.brands;
    var ids = {}; v.points.forEach(function (p) { ids[p.id] = 1; });
    return src.filter(function (o) { return ids[o.key]; }).map(function (o) {
      return Object.assign({}, o, { name: v.kind === "cell" ? U.cellLabel(o.key) : o.key, n_skus: o.n_skus != null ? o.n_skus : o.sku_ids.length });
    });
  }
  function renderTable() {
    var v = qc.view(); if (!v) return;
    var rows = currentRows();
    tblHead.textContent = v.kind === "sku" ? (qc.depth() > 1 ? "SKUs in " + v.title + " (" + rows.length + ")" : "All SKUs (" + rows.length + ")")
      : (v.kind === "cell" ? "Subcategory × shade groups" : "Brands") + " (" + rows.length + ")";
    if (!tbl || tblKind !== v.kind) {
      tblBox.innerHTML = "";
      tblKind = v.kind;
      tbl = U.table(tblBox, {
        columns: v.kind === "sku" ? skuCols : aggCols, rows: rows, maxHeight: 420,
        sort: v.kind === "sku" ? { key: "fair_index", dir: "asc" } : { key: "rev", dir: "desc" },
        onRowClick: function (r) {
          if (tblKind === "sku") selectRow(rid(r)); else { selectRow(rid(r)); }
        }
      });
    } else tbl.setRows(rows);
    tbl.setHighlight(state.sel ? function (r) { return rid(r) === state.sel; } : null);
  }
  function selectRow(id) {
    state.sel = id;
    qc.select(id);
    qc.highlight(id ? [id] : null);
    if (tbl) tbl.setHighlight(id ? function (r) { return rid(r) === id; } : null);
  }
  function build() {
    toggleMode.set(state.mode); toggleX.set(state.x);
    state.sel = null;
    var d = state.drill;
    qc.setView(rootView());
    state.drill = d;
    if (d) qc.pushView(drillView());
  }

  /* ---- computed lists ---- */
  function focusSku(id) {
    if (qc.view().kind !== "sku" || !qc.view().points.some(function (p) { return p.id === id; })) {
      state.mode = "sku"; state.drill = null; build();
    }
    selectRow(id);
    chartCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function prize(r) { return F.eur(r.prize_low) + " – " + F.eur(r.prize_high); }
  var grid = E("div", { class: "grid-2" });
  app.appendChild(grid);

  var npCard = U.card("Not pushed enough", "Active SKUs in a growing market where we sell far less than our fair share, or where our sales are falling well behind the market. Click a row to find it in the chart.");
  var npRows = D.lists.not_pushed.map(function (r) { var s = skuById[r.id] || {}; return Object.assign({ name: s.name }, r); });
  U.table(npCard, {
    columns: [{ key: "id", label: "ID" }, { key: "name", label: "Product" }, { key: "reason", label: "Why" },
      { key: "prize_high", label: "Prize range (revenue)", num: true, fmt: function (v, r) { return prize(r); } }],
    rows: npRows, sort: { key: "prize_high", dir: "desc" }, onRowClick: function (r) { focusSku(r.id); }, empty: "No SKUs on this list"
  });
  var npLow = 0, npHigh = 0; npRows.forEach(function (r) { npLow += r.prize_low; npHigh += r.prize_high; });
  npCard.appendChild(E("p", { class: "note", text: "Per-SKU prizes are illustrative revenue scenarios for " + D.meta.period_weeks + " weeks. Their sum, " + F.eur(npLow) + " – " + F.eur(npHigh) + ", matches the recommendation range above." }));
  grid.appendChild(npCard);

  var lpCard = U.card("Low performing", "Active SKUs in the bottom quartile of channel revenue where both our sales and the market are falling. Candidates to delist or reduce.");
  var lpRows = D.lists.low_perf.map(function (r) { var s = skuById[r.id] || {}; return Object.assign({ name: s.name, shelf_cm: s.shelf_cm, rev: s.rev }, r); });
  U.table(lpCard, {
    columns: [{ key: "id", label: "ID" }, { key: "name", label: "Product" }, { key: "reason", label: "Why" },
      { key: "shelf_cm", label: "Shelf cm", num: true, fmt: function (v) { return F.int(v); } }],
    rows: lpRows, sort: { key: "shelf_cm", dir: "desc" }, onRowClick: function (r) { focusSku(r.id); }, maxHeight: 420, empty: "No SKUs on this list"
  });
  var cm = 0, rv = 0; lpRows.forEach(function (r) { cm += r.shelf_cm || 0; rv += r.rev || 0; });
  lpCard.appendChild(E("p", { class: "pgp-summary", text:
    "Together these " + lpRows.length + " SKUs take " + F.int(cm) + " cm of shelf (" + F.share(cm / D.meta.total_shelf_cm) + " of the total) and bring in " +
    F.eur(rv) + " (" + F.share(rv / D.meta.total_rev) + " of channel revenue) over " + D.meta.period_weeks + " weeks." }));
  grid.appendChild(lpCard);

  build();
})();
