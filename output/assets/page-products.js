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
    ".pgp-tools label{font-size:13px;color:var(--muted);margin-right:6px}" +
    ".badge.tier-push-high{background:#1f6b46;color:#fff;border-color:#1f6b46}.badge.tier-push-medium{background:rgba(147,207,166,.35);color:#1f6b46;border-color:#93cfa6}" +
    ".badge.tier-low-high{background:#a3271c;color:#fff;border-color:#a3271c}.badge.tier-low-medium{background:rgba(238,158,148,.3);color:#8a2318;border-color:#ee9e94}" +
    ".pgp-cov{font-size:13px}.pgp-cov b{font-weight:600}.pgp-cov.keep b{color:#8a2318}.pgp-cov.ok b{color:#1f6b46}";
  document.head.appendChild(st);

  // Text from the data file: product names instead of ID codes, "group" instead of "cell".
  function txt(t) {
    if (t == null) return "";
    return String(t).replace(/\b(HC|CM)\d{3,4}\b/g, function (id) {
      var o = id[0] === "H" ? U.sku(id) : U.comp(id); return o ? o.name : id;
    }).replace(/\bcells\b/g, "groups").replace(/\bCells\b/g, "Groups").replace(/\bcell\b/g, "group").replace(/\bCell\b/g, "Group");
  }
  function short(n, max) { n = String(n || ""); max = max || 22; return n.length > max ? n.slice(0, max - 1).trimEnd() + "…" : n; }
  function callout(rec) {
    var c = E("section", { class: "card pg-callout" });
    var l = E("div", null,
      E("div", { html: U.badge("Q" + rec.q, "q") + ' <span class="note">Recommended action</span>' }),
      E("h3", { text: txt(rec.action) }), E("p", { text: txt(rec.evidence) }), E("p", { class: "note", text: txt(rec.basis) }));
    var r = E("div", { class: "pg-prize" }, E("b", { text: F.prize(rec.prize_low) + " – " + F.prize(rec.prize_high) }),
      E("span", { text: "per " + D.meta.period_weeks + " weeks · " + rec.prize_unit + " · estimated size of prize" }));
    c.appendChild(l); c.appendChild(r);
    return c;
  }

  var rec = D.recs.filter(function (r) { return r.q === 2; })[0];
  app.appendChild(E("div", { class: "page-head" },
    E("h1", { text: "Push high-demand products; review weak performers" }),
    E("p", { class: "sub", text: "Are you selling the right products? Compare market demand with our fair-share index, then act on the two lists below." })));
  if (rec) app.appendChild(callout(rec));

  /* ---- lookups & lists ---- */
  var skuById = {}; D.skus.forEach(function (s) { skuById[s.id] = s; });
  var npMap = {}, lpMap = {};
  D.lists.not_pushed.forEach(function (r) { npMap[r.id] = r; });
  D.lists.low_perf.forEach(function (r) { lpMap[r.id] = r; });
  var LIST_TXT = { relist: "Relist", not_pushed: "Not pushed enough", low_perf: "Low performing", price_review: "Price review", restock: "Restock" };
  var NEUTRAL = "#b8c4cc", AGG = "#6f8f86";
  var TIER_COL = { push_high: "#1f6b46", push_medium: "#93cfa6", low_high: "#a3271c", low_medium: "#ee9e94" };
  var TIER_RANK = { high: 2, medium: 1 };
  // Tier fields may be missing in older data: fall back to list membership (and the list row's tier).
  function pushTier(s) {
    if (s.push_tier !== undefined) return s.push_tier || null;
    var r = npMap[s.id]; return r ? (r.tier || "high") : null;
  }
  function lowTier(s) {
    if (s.low_tier !== undefined) return s.low_tier || null;
    var r = lpMap[s.id]; return r ? (r.tier || "high") : null;
  }
  function keepsCov(s) {
    if (typeof s.keeps_coverage === "boolean") return s.keeps_coverage;
    var r = lpMap[s.id]; return r && typeof r.keeps_coverage === "boolean" ? r.keeps_coverage : null;
  }
  function covNote(s) { var r = lpMap[s.id]; return r && r.coverage_note ? txt(r.coverage_note) : ""; }
  // Coverage ring on low performers: dashed = others still cover the group (can go); solid = last product in its group
  var RING_OK = { color: "#6b6a65", width: 1.8, dash: true }, RING_LAST = { color: "#1d1d1b", width: 2.4 };
  function tierBadge(kind, t) {
    if (!t) return "–";
    var txtT = kind === "push" ? (t === "high" ? "Push first" : "Push") : (t === "high" ? "Review first" : "Review");
    return U.badge(txtT, "tier-" + kind + "-" + t);
  }
  function tierSort(t, v) { return (TIER_RANK[t] || 0) * 1e12 + (typeof v === "number" && isFinite(v) ? v : 0); }

  // labelled SKUs: all not-pushed, then low performers with the most shelf space, max 12
  var labelIds = {};
  D.lists.not_pushed.slice().sort(function (a, b) { return tierSort(b.tier, b.prize_high) - tierSort(a.tier, a.prize_high); }).slice(0, 7).forEach(function (r) { labelIds[r.id] = 1; });
  D.lists.low_perf.map(function (r) { return skuById[r.id]; }).filter(Boolean)
    .sort(function (a, b) { return tierSort(lowTier(b), b.shelf_cm) - tierSort(lowTier(a), a.shelf_cm); })
    .forEach(function (s) { if (Object.keys(labelIds).length < 12) labelIds[s.id] = 1; });

  var state = { mode: "sku", x: "share", drill: null, sel: null };
  var chartCard = U.card("Demand versus our share", "Bubbles above the horizontal line are products where we hold more than our fair share of market demand; below it, we under-index.");
  var tools = E("div", { class: "pgp-tools" });
  chartCard.appendChild(tools);
  var chartBox = E("div"); chartCard.appendChild(chartBox);
  var tblHead = E("h3", { style: { margin: "16px 0 6px" } });
  var tblBox = E("div");
  var allCard = U.card("Product detail", "Select a bubble or group to inspect its products.");
  allCard.appendChild(tblHead); allCard.appendChild(tblBox);
  app.appendChild(chartCard);

  var toggleMode;
  var g1 = E("span");
  g1.appendChild(E("label", { text: "View" }));
  toggleMode = U.toggle(g1, [{ value: "sku", label: "Products" }, { value: "cell", label: "Subcategory × shade" }, { value: "brand", label: "Brand" }], state.mode, function (v) {
    state.mode = v; state.drill = null; state.sel = null; build();
  });
  tools.appendChild(g1);

  function xAxis() {
    return state.x === "share"
      ? { label: "Market demand: share of total market units (log)", scale: "log", split: Q.x_split_mkt_unit_share, format: function (v) { var p = v * 100; return F.share(v, p >= 1 ? 1 : p >= 0.1 ? 2 : 3); } }
      : { label: "Market trend, 12 weeks", scale: "linear", split: Q.x_split_mk_trend, format: function (v) { return F.pct(v); } };
  }
  function xv(o) { return state.x === "share" ? o.mkt_unit_share : o.mk_trend; }
  var yAxis = { label: "Channel vs market: unit share index (1 = fair share)", scale: "log", split: Q.y_split, format: function (v) { return F.idx(v, v < 1 ? 2 : (v < 10 ? 1 : 0)); } };

  function skuColor(s) {
    if (!s.active) return COL.inactive;
    var pt = pushTier(s), lt = lowTier(s);
    if (pt && TIER_COL["push_" + pt]) return TIER_COL["push_" + pt];
    if (lt && TIER_COL["low_" + lt]) return TIER_COL["low_" + lt];
    return NEUTRAL;
  }
  function listTxt(s) { return (s.lists || []).map(function (c) { return LIST_TXT[c] || c; }); }
  function skuPoints(ids) {
    return ids.map(function (id) { return skuById[id]; }).filter(Boolean).map(function (s) {
      var inactive = !s.active, pt = pushTier(s), lt = lowTier(s), kc = s.active && lt ? keepsCov(s) : null;
      var extra = [];
      if (pt) extra.push(["Push tier", pt === "high" ? "High: most likely to push" : "Medium"]);
      if (lt) extra.push(["Review tier", lt === "high" ? "High: top of the review list" : "Medium"]);
      if (kc != null) extra.push(["Coverage", covNote(s) || (kc ? "Other products still cover this group" : "Last product in its group: keep or replace")]);
      if (s.peers_active != null && lt) extra.push(["Other active products in group", F.int(s.peers_active)]);
      return {
        id: s.id, x: xv(s), y: s.fair_index, size: s.shelf_share, color: skuColor(s), hollow: inactive, dashed: inactive,
        ring: kc === true ? RING_OK : kc === false ? RING_LAST : null,
        label: labelIds[s.id] ? short(s.name) : null,
        tip: { title: s.name, rows: [
          ["Brand · group", s.brand + " · " + U.cellLabel(s.cell)], ["Status", (inactive ? "Inactive" : "Active") + " · " + s.stock.replace(/_/g, " ")],
          ["Market unit share", F.share(s.mkt_unit_share, 2)], ["Channel unit share", F.share(s.ch_unit_share, 2)],
          ["Fair-share index", F.idx(s.fair_index)], ["Shelf share", F.share(s.shelf_share, 2)],
          ["Market trend", F.pct(s.mk_trend)], ["Channel trend", F.pct(s.ch_trend)],
          ["Channel revenue", F.eur(s.rev)], ["Lists", listTxt(s).join(", ") || "–"]].concat(extra).concat([["ID", s.id]]) }
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
          ["Click", "to see its products"]] }
      };
    });
    pts.slice().sort(function (a, b) { return b._ext - a._ext; }).slice(0, 6).forEach(function (p) { p.label = p.data.name; });
    return pts;
  }

  var legendSku = [
    { label: "Push first", color: TIER_COL.push_high }, { label: "Push", color: TIER_COL.push_medium },
    { label: "Review first (low performer)", color: TIER_COL.low_high }, { label: "Review", color: TIER_COL.low_medium },
    { label: "Other active product", color: NEUTRAL }, { label: "Inactive product", color: COL.inactive, hollow: true },
    { label: "Others still cover its group", color: "#fff", ring: RING_OK },
    { label: "Last product in its group", color: "#fff", ring: RING_LAST }
  ];
  function rootView() {
    var base = { x: xAxis(), y: yAxis, sizeNote: "Bubble size = share of shelf space" };
    if (state.mode === "sku") {
      base.id = "skus"; base.title = "All products"; base.points = skuPoints(D.skus.map(function (s) { return s.id; })); base.legend = legendSku; base.kind = "sku";
    } else {
      base.id = state.mode; base.title = state.mode === "cell" ? "All subcategory × shade groups" : "All brands";
      base.points = aggPoints(state.mode); base.kind = state.mode;
      base.legend = [{ label: state.mode === "cell" ? "Subcategory × shade group (click to see its products)" : "Brand (click to see its products)", color: AGG }];
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
    { key: "name", label: "Product" }, { key: "brand", label: "Brand" },
    { key: "cell", label: "Subcategory · shade group", fmt: function (v) { return U.cellLabel(v); } },
    { key: "tier", label: "Tier", html: true, sortValue: function (r) { var p = pushTier(r), l = lowTier(r); return p ? 2 + (TIER_RANK[p] || 0) : l ? -(TIER_RANK[l] || 0) : 0; },
      fmt: function (v, r) { var p = pushTier(r), l = lowTier(r); return p ? tierBadge("push", p) : l ? tierBadge("low", l) : "–"; } },
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
    tblHead.textContent = v.kind === "sku" ? (qc.depth() > 1 ? "Products in " + v.title + " (" + rows.length + ")" : "All products (" + rows.length + ")")
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
    toggleMode.set(state.mode);
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
  function prize(r) { return F.prize(r.prize_low) + " – " + F.prize(r.prize_high); }
  var grid = E("div", { class: "grid-2" });
  app.appendChild(grid);

  var npCard = U.card("Not pushed enough", "Bottom-right quadrant: active products with above-median market demand and a fair-share index below 1, excluding out-of-stock products. Push first = most likely to pay back. Click a row to locate it.");
  var npRows = D.lists.not_pushed.map(function (r) {
    var s = skuById[r.id] || {};
    return Object.assign({}, r, { name: r.name || s.name || r.id, tier: r.tier || pushTier(s) || null });
  });
  U.table(npCard, {
    columns: [{ key: "tier", label: "Tier", html: true, sortValue: function (r) { return tierSort(r.tier, r.prize_high); }, fmt: function (v) { return tierBadge("push", v); } },
      { key: "name", label: "Product" }, { key: "reason", label: "Why", fmt: function (v) { return txt(v); } },
      { key: "prize_high", label: "Prize range (revenue)", num: true, fmt: function (v, r) { return prize(r); } }],
    rows: npRows, maxHeight: 420, sort: { key: "tier", dir: "desc" }, onRowClick: function (r) { focusSku(r.id); }, empty: "No SKUs on this list"
  });
  var npLow = 0, npHigh = 0; npRows.forEach(function (r) { npLow += r.prize_low; npHigh += r.prize_high; });
  npCard.appendChild(E("p", { class: "note", text: "Per-product prizes are estimated revenue scenarios for " + D.meta.period_weeks + " weeks. Their sum, " + F.prize(npLow) + " – " + F.prize(npHigh) + ", matches the recommendation range above." }));
  grid.appendChild(npCard);

  var lpCard = U.card("Low performing", "Bottom-left quadrant: active products with below-median market demand and a fair-share index below 1. Review first = top of the review list. Coverage says whether other products still cover the same subcategory × shade group.");
  var lpRows = D.lists.low_perf.map(function (r) {
    var s = skuById[r.id] || {};
    var kc = typeof r.keeps_coverage === "boolean" ? r.keeps_coverage : keepsCov(s);
    return Object.assign({ shelf_cm: s.shelf_cm }, r, { name: r.name || s.name || r.id, rev: s.rev, tier: r.tier || lowTier(s) || null, keeps_coverage: kc });
  });
  U.table(lpCard, {
    columns: [{ key: "tier", label: "Tier", html: true, sortValue: function (r) { return tierSort(r.tier, r.shelf_cm); }, fmt: function (v) { return tierBadge("low", v); } },
      { key: "name", label: "Product" }, { key: "reason", label: "Why", fmt: function (v) { return txt(v); } },
      { key: "keeps_coverage", label: "Coverage", html: true, title: "Can it go without leaving the subcategory × shade group empty?",
        sortValue: function (r) { return r.keeps_coverage == null ? null : r.keeps_coverage ? 1 : 0; },
        fmt: function (v, r) {
          if (v == null) return r.coverage_note ? U.esc(txt(r.coverage_note)) : "–";
          var head = v ? "Can go" : "Last in group";
          var note = r.coverage_note ? txt(r.coverage_note) : (v ? "other products still cover this group" : "keep or replace");
          return '<span class="pgp-cov ' + (v ? "ok" : "keep") + '" title="' + U.esc(note) + '"><b>' + (v ? "◌ " : "● ") + head + "</b><br>" + U.esc(note) + "</span>";
        } },
      { key: "shelf_cm", label: "Shelf cm", num: true, fmt: function (v) { return F.int(v); } }],
    rows: lpRows, sort: { key: "tier", dir: "desc" }, onRowClick: function (r) { focusSku(r.id); }, maxHeight: 420, empty: "No SKUs on this list"
  });
  var cm = 0, rv = 0; lpRows.forEach(function (r) { cm += r.shelf_cm || 0; rv += r.rev || 0; });
  lpCard.appendChild(E("p", { class: "pgp-summary", text:
    "Together these " + lpRows.length + " products take " + F.int(cm) + " cm of shelf (" + F.share(cm / D.meta.total_shelf_cm) + " of the total) and bring in " +
    F.eur(rv) + " (" + F.share(rv / D.meta.total_rev) + " of channel revenue) over " + D.meta.period_weeks + " weeks." }));
  grid.appendChild(lpCard);

  app.appendChild(allCard);
  build();
})();
