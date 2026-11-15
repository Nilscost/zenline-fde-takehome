/* Page 3: Price. Are you selling at the right price? */
(function () {
  "use strict";
  var D = window.DATA, app = document.getElementById("app");
  if (!D || !app || !window.UI || !window.QuadChart) return;
  var U = UI, F = U.fmt, E = U.el, COL = U.COLORS, Q = D.quadrants.price;

  var st = document.createElement("style");
  st.textContent =
    ".pg-callout{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px 28px;align-items:flex-start;border-left:4px solid var(--accent)}" +
    ".pg-callout h3{margin:6px 0 4px;font-size:18px}.pg-callout p{margin:2px 0}.pg-callout .pg-prize{text-align:right;flex:none}" +
    ".pg-callout .pg-prize b{display:block;font-size:24px;color:var(--accent);white-space:nowrap}.pg-callout .pg-prize span{font-size:12px;color:var(--muted)}" +
    ".pgr-tools{display:flex;flex-wrap:wrap;gap:8px 24px;align-items:center;margin:0 0 10px}.pgr-tools label{font-size:13px;color:var(--muted);margin-right:6px}" +
    ".pgr-sig{display:inline-block;font-size:11.5px;border:1px solid var(--line);border-radius:99px;padding:0 8px;margin:0 4px 2px 0;color:var(--ink);background:#faf9f5;cursor:help;white-space:nowrap}" +
    ".pgr-sig.pgr-above{border-color:#8e2a6b;color:#6d1f52}.pgr-sig.pgr-below{border-color:#4a6fa5;color:#34527f}" +
    ".pgr-sent{margin:6px 0;font-size:14px}.pgr-ids{color:var(--muted);font-size:13px}";
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

  var rec = D.recs.filter(function (r) { return r.q === 3; })[0];
  app.appendChild(E("div", { class: "page-head" },
    E("h1", { text: rec ? rec.question : "Are you selling at the right price?" }),
    E("p", { class: "sub", text: "Price is only a lever where our price and our sales trend point the same way. We combine four signals and rank the products to review." })));
  if (rec) app.appendChild(callout(rec));

  var skuById = {}; D.skus.forEach(function (s) { skuById[s.id] = s; });
  var STORY = { above: "Price looks high", below: "Price looks low", mixed: "Signals disagree" };
  var TIER_COL = { Confirmed: "#8e2a6b", Flag: COL.low_stock };
  var NEUTRAL = "#b8c4cc";

  /* ---- main chart ---- */
  var state = { x: "mkt", mode: "sku", drill: null, sel: null };
  var chartCard = U.card("Price position versus sales momentum", "Bottom-right is where a high price coincides with a channel that is losing ground to the market.");
  var tools = E("div", { class: "pgr-tools" });
  chartCard.appendChild(tools);
  var note = E("p", { class: "caveat" });
  var chartBox = E("div");
  chartCard.appendChild(chartBox); chartCard.appendChild(note);
  app.appendChild(chartCard);

  var tX, tM;
  var g1 = E("span"), g2 = E("span");
  g1.appendChild(E("label", { text: "X axis" }));
  tX = U.toggle(g1, [{ value: "mkt", label: "vs market average price" }, { value: "comp", label: "vs competitor price in cell" }], state.x, function (v) { state.x = v; build(); });
  g2.appendChild(E("label", { text: "View" }));
  tM = U.toggle(g2, [{ value: "sku", label: "SKUs" }, { value: "cell", label: "Subcategory × shade" }], state.mode, function (v) { state.mode = v; state.drill = null; build(); });
  tools.appendChild(g2); tools.appendChild(g1);

  function xAxis() {
    return state.x === "mkt"
      ? { label: "Our price ÷ market average selling price (1 = in line)", scale: "linear", split: Q.x_split, format: function (v) { return F.idx(v); } }
      : { label: "Our price ÷ median competitor price in the cell (log, 1 = in line)", scale: "log", split: 1, format: function (v) { return F.idx(v, v < 1 ? 2 : 1); } };
  }
  var yAxis = { label: "Channel trend minus market trend (points)", scale: "linear", split: Q.y_split, format: function (v) { return F.pct(v); } };
  function xv(o) { return state.x === "mkt" ? o.price_idx_mkt : o.price_idx_comp; }

  // labels: confirmed plus the flags with the biggest prize, max 12
  var prizeOf = {}; D.lists.price_review.forEach(function (r) { prizeOf[r.id] = r.prize_high; });
  var labelIds = {};
  D.lists.price_review.filter(function (r) { return r.tier === "Confirmed"; }).forEach(function (r) { labelIds[r.id] = 1; });
  D.lists.price_review.filter(function (r) { return r.tier !== "Confirmed"; }).sort(function (a, b) { return b.prize_high - a.prize_high; })
    .forEach(function (r) { if (Object.keys(labelIds).length < 12) labelIds[r.id] = 1; });

  var legendSku = [
    { label: "Confirmed", color: TIER_COL.Confirmed }, { label: "Flag", color: TIER_COL.Flag },
    { label: "No price signal", color: NEUTRAL }, { label: "Inactive SKU", color: COL.inactive, hollow: true }
  ];
  function skuPoints(ids) {
    return ids.map(function (i) { return skuById[i]; }).filter(function (s) { return s && xv(s) != null; }).map(function (s) {
      var ina = !s.active, sig = (s.price_signals || []).length;
      return {
        id: s.id, x: xv(s), y: s.trend_gap, size: s.rev,
        color: ina ? COL.inactive : (TIER_COL[s.price_tier] || NEUTRAL), hollow: ina, dashed: ina,
        label: labelIds[s.id] ? s.id : null,
        tip: { title: s.id + " · " + s.name, rows: [
          ["Price tier", s.price_tier || "No signal"], ["Status", (ina ? "Inactive" : "Active") + " · " + s.stock.replace(/_/g, " ")],
          ["Our price", F.money(s.price)], ["Market average price", F.money(s.mkt_asp)], ["Price ÷ market", F.idx(s.price_idx_mkt)],
          ["Price ÷ competitor median", F.idx(s.price_idx_comp)], ["Channel trend", F.pct(s.ch_trend)], ["Market trend", F.pct(s.mk_trend)],
          ["Trend gap", F.pct(s.trend_gap)], ["Margin", F.share(s.margin)], ["Channel revenue", F.eur(s.rev)],
          ["Signals fired", sig ? s.price_signals.join(", ") : "none"]] }
      };
    });
  }
  function cellPoints() {
    return D.cells.filter(function (c) { return c.n_skus > 0 && xv(c) != null && c.trend_gap != null; }).map(function (c) {
      return {
        id: c.key, x: xv(c), y: c.trend_gap, size: c.rev, color: "#6f8f86", data: { ids: c.sku_ids, name: U.cellLabel(c.key) },
        label: null,
        tip: { title: U.cellLabel(c.key), rows: [["SKUs (active)", c.n_skus + " (" + c.n_active + ")"],
          ["Price ÷ market", F.idx(c.price_idx_mkt)], ["Price ÷ competitor median", F.idx(c.price_idx_comp)],
          ["Channel trend", F.pct(c.ch_trend)], ["Market trend", F.pct(c.mk_trend)], ["Trend gap", F.pct(c.trend_gap)],
          ["Channel revenue", F.eur(c.rev)], ["Click", "to see its SKUs"]] }
      };
    });
  }
  function rootView() {
    var v = { x: xAxis(), y: yAxis, sizeNote: "Bubble size = channel revenue" };
    if (state.mode === "sku") {
      v.id = "skus"; v.title = "All SKUs"; v.kind = "sku"; v.legend = legendSku;
      v.points = skuPoints(D.skus.map(function (s) { return s.id; }));
    } else {
      v.id = "cells"; v.title = "All subcategory × shade groups"; v.kind = "cell";
      v.legend = [{ label: "Subcategory × shade group (click to see its SKUs)", color: "#6f8f86" }];
      v.points = cellPoints();
    }
    return v;
  }
  function drillView() {
    return { id: "drill:" + state.drill.id, title: state.drill.name, kind: "sku", x: xAxis(), y: yAxis, legend: legendSku,
      sizeNote: "Bubble size = channel revenue", points: skuPoints(state.drill.ids) };
  }
  function updateNote() {
    var v = qc.view(), txt = "";
    if (state.x === "comp" && v) {
      var ids = v.kind === "sku" ? (state.drill ? state.drill.ids : D.skus.map(function (s) { return s.id; })) : null;
      if (ids) {
        var miss = ids.filter(function (i) { return skuById[i] && skuById[i].price_idx_comp == null; }).length;
        txt = miss + " of " + ids.length + " SKUs have no competitor product in their cell and are not shown on this axis.";
      } else {
        var no = D.cells.filter(function (c) { return c.n_skus > 0 && c.price_idx_comp == null; }).length, tot = D.cells.filter(function (c) { return c.n_skus > 0; }).length;
        txt = no + " of " + tot + " groups have no competitor price and are not shown. Competitor pack sizes are unknown, so this view is context, not evidence.";
      }
    } else if (state.mode === "cell" && v && v.kind === "cell") {
      var nn = D.cells.filter(function (c) { return c.n_skus > 0 && c.trend_gap == null; }).length;
      if (nn) txt = nn + " groups have no trend gap and are not shown.";
    }
    note.textContent = txt; note.style.display = txt ? "" : "none";
  }

  var qc = QuadChart.create(chartBox, {
    height: 480, x: xAxis(), y: yAxis,
    quadrants: { tl: Q.tl, tr: Q.tr, bl: Q.bl, br: Q.br },
    tints: { br: "bad", tl: "good" },
    onClick: function (p) {
      var v = qc.view();
      if (v.kind === "sku") { selectSku(p.id); return; }
      state.drill = { id: p.id, name: p.data.name, ids: p.data.ids }; state.sel = null;
      qc.pushView(drillView());
    },
    onBackgroundClick: function () { selectSku(null); },
    onViewChange: function () { if (state.drill && qc.depth() === 1) state.drill = null; updateNote(); }
  });
  function build() {
    tX.set(state.x); tM.set(state.mode);
    state.sel = null; hlRows();
    var d = state.drill;
    qc.setView(rootView());
    state.drill = d;
    if (d) qc.pushView(drillView());
    updateNote();
  }

  /* ---- products for price review ---- */
  var rows = D.lists.price_review.map(function (r) {
    var s = skuById[r.id] || {};
    return Object.assign({}, r, { name: s.name, price: s.price, mkt_asp: s.mkt_asp, price_idx_mkt: s.price_idx_mkt, trend_gap: s.trend_gap, margin: s.margin });
  }).sort(function (a, b) { return (a.tier === "Confirmed" ? 0 : 1) - (b.tier === "Confirmed" ? 0 : 1) || b.prize_high - a.prize_high; });
  var SIG_TXT = { exact: "Exact match", market: "Vs market", trend: "Losing ground", margin: "Thin margin" };
  function sigHtml(r) {
    return (r.signals || []).map(function (g) {
      var dir = g.code === "trend" ? "above" : g.code === "margin" ? "below" : (/above/i.test(g.label) ? "above" : /below/i.test(g.label) ? "below" : "");
      return '<span class="pgr-sig pgr-' + dir + '" title="' + U.esc(g.label + ": " + g.detail) + '">' + U.esc(SIG_TXT[g.code] || g.code) + "</span>";
    }).join("");
  }
  var revCard = U.card("Products for price review", "Confirmed = a like-for-like competitor price gap, or two signals pointing the same way. Flag = one signal, or signals that disagree. Hover a signal for its detail.");
  var filterRow = E("div", { class: "pgr-tools" });
  revCard.appendChild(filterRow);
  var filt = "All", reviewTbl;
  U.toggle(filterRow, [{ value: "All", label: "All (" + rows.length + ")" },
    { value: "Confirmed", label: "Confirmed (" + rows.filter(function (r) { return r.tier === "Confirmed"; }).length + ")" },
    { value: "Flag", label: "Flag (" + rows.filter(function (r) { return r.tier === "Flag"; }).length + ")" }], filt, function (v) {
    filt = v; reviewTbl.setRows(rows.filter(function (r) { return v === "All" || r.tier === v; }));
  });
  reviewTbl = U.table(revCard, {
    columns: [
      { key: "tier", label: "Tier", html: true, sortValue: function (r) { return r.tier === "Confirmed" ? 0 : 1; }, fmt: function (v) { return U.badge(v, v === "Confirmed" ? "confirmed" : "flag"); } },
      { key: "id", label: "ID" }, { key: "name", label: "Product" },
      { key: "story", label: "Signals say", fmt: function (v) { return STORY[v] || v; } },
      { key: "signals", label: "Signals fired", html: true, sortable: false, fmt: function (v, r) { return sigHtml(r); } },
      { key: "price", label: "Price", num: true, fmt: function (v) { return F.money(v); } },
      { key: "mkt_asp", label: "Market avg price", num: true, fmt: function (v) { return F.money(v); } },
      { key: "price_idx_mkt", label: "Price index", num: true, title: "Our price ÷ market average price", fmt: function (v) { return F.idx(v); } },
      { key: "trend_gap", label: "Trend gap", num: true, title: "Channel trend minus market trend", fmt: function (v) { return F.pct(v); } },
      { key: "margin", label: "Margin", num: true, fmt: function (v) { return F.share(v); } },
      { key: "prize_high", label: "Prize range (margin)", num: true, fmt: function (v, r) { return F.eur(r.prize_low) + " – " + F.eur(r.prize_high); } }
    ],
    rows: rows, sort: { key: "tier", dir: "asc" }, maxHeight: 460,
    onRowClick: function (r) { focusSku(r.id); }
  });
  app.appendChild(revCard);

  function hlRows() { if (reviewTbl) reviewTbl.setHighlight(state.sel ? function (r) { return r.id === state.sel; } : null); }
  function selectSku(id) {
    state.sel = id; qc.select(id); qc.highlight(id ? [id] : null); hlRows();
  }
  function focusSku(id) {
    var v = qc.view();
    if (v.kind !== "sku" || !v.points.some(function (p) { return p.id === id; })) {
      if (!(v.kind === "sku" && state.x === "comp" && skuById[id] && skuById[id].price_idx_comp == null)) { state.mode = "sku"; state.drill = null; build(); }
    }
    selectSku(id);
    chartCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---- signal cards ---- */
  var sg = E("div", { class: "page-head", style: { margin: "24px 0 12px" } }, E("h2", { text: "The evidence behind the list" }));
  app.appendChild(sg);

  var thr = (D.thresholds || []).filter(function (t) { return t.key === "price_gap_exact"; })[0];
  var matches = D.skus.filter(function (s) { return s.match; });
  var c1 = U.card("Signal 1 · Exact competitor matches", "Only these " + matches.length + " products have a like-for-like competitor price (same product name, snapshot of " + D.meta.observed_date + "). " + (thr ? "A gap of " + F.pct(thr.value).replace("+", "") + " or more counts as a signal." : ""));
  U.table(c1, {
    columns: [{ key: "id", label: "SKU" }, { key: "name", label: "Product" },
      { key: "price", label: "Our price", num: true, fmt: function (v) { return F.money(v); } },
      { key: "comp_name", label: "Competitor product", sortValue: function (r) { return r.match.comp_name; }, fmt: function (v, r) { return r.match.comp_name; } },
      { key: "comp_id", label: "Comp. ID", sortValue: function (r) { return r.match.comp_id; }, fmt: function (v, r) { return r.match.comp_id; } },
      { key: "source", label: "Source", sortValue: function (r) { return r.match.source; }, fmt: function (v, r) { return r.match.source; } },
      { key: "comp_price", label: "Competitor price", num: true, sortValue: function (r) { return r.match.comp_price; }, fmt: function (v, r) { return F.money(r.match.comp_price); } },
      { key: "gap", label: "Gap", num: true, sortValue: function (r) { return r.match.gap; }, fmt: function (v, r) { return F.pct(r.match.gap); } },
      { key: "units", label: "Channel units", num: true, fmt: function (v) { return F.int(v); } },
      { key: "status", label: "Status", html: true, fmt: function (v) { return U.statusBadge(v); } },
      { key: "stock", label: "Stock", html: true, fmt: function (v) { return U.stockBadge(v); } }],
    rows: matches, sort: { key: "gap", dir: "asc" }, onRowClick: function (r) { focusSku(r.id); }, empty: "No exact matches"
  });
  app.appendChild(c1);

  var c2 = U.card("Signal 2 · Price position", "Per SKU, the price index against the market average is in the chart and the review table above. Per subcategory × shade group, our median price against the competitor median:");
  var cellRows = D.cells.filter(function (c) { return c.client_price_median != null && c.comp_price_median != null; });
  U.table(c2, {
    columns: [{ key: "key", label: "Subcategory · shade", fmt: function (v) { return U.cellLabel(v); } },
      { key: "client_price_median", label: "Our median price", num: true, fmt: function (v) { return F.money(v); } },
      { key: "comp_price_median", label: "Competitor median price", num: true, fmt: function (v) { return F.money(v); } },
      { key: "price_idx_comp", label: "Price index vs competitors", num: true, fmt: function (v) { return F.idx(v); } },
      { key: "n_comp", label: "Competitor products", num: true, fmt: function (v) { return F.int(v); } }],
    rows: cellRows, sort: { key: "price_idx_comp", dir: "desc" }, maxHeight: 360
  });
  c2.appendChild(E("p", { class: "caveat", text: "Competitor pack sizes are unknown, so this is context, not evidence. It is not used to decide the review list." }));
  app.appendChild(c2);

  var trendIds = D.skus.filter(function (s) { return (s.price_signals || []).indexOf("trend") >= 0; }).map(function (s) { return s.id; });
  var marginIds = D.skus.filter(function (s) { return (s.price_signals || []).indexOf("margin") >= 0; }).map(function (s) { return s.id; });
  var c3 = U.card("Signal 3 · Sales trend and margin");
  function sent(n, txt, ids) {
    c3.appendChild(E("p", { class: "pgr-sent", text: F.int(n) + " " + txt }));
    c3.appendChild(E("p", { class: "pgr-ids", text: ids.length ? ids.join(", ") : "None" }));
  }
  sent(trendIds.length, trendIds.length === 1 ? "SKU is losing ground while its market grows (channel trend well below market trend):" : "SKUs are losing ground while their market grows (channel trend well below market trend):", trendIds);
  sent(marginIds.length, marginIds.length === 1 ? "big seller earns a thin margin:" : "big sellers earn a thin margin (top-quartile revenue, margin below the threshold):", marginIds);
  app.appendChild(c3);

  build();
})();
