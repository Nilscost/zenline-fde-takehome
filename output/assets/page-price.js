/* Page 3: one consistent price-versus-market review, both directions. */
(function () {
  "use strict";
  var D = window.DATA, app = document.getElementById("app");
  if (!D || !app || !window.UI || !window.QuadChart) return;
  var U = UI, F = U.fmt, E = U.el, COL = U.COLORS;
  var rec = (D.recs || []).filter(function (r) { return r.q === 3; })[0];
  var thr = D.thresholds || [];
  var byId = {}, byName = {};
  (D.skus || []).forEach(function (s) { byId[s.id] = s; byName[s.name] = s; });

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function findThr(re, test) { return thr.filter(function (t) { return re.test(t.key) && isNum(t.value) && (!test || test(t.value)); })[0]; }

  // Price-index thresholds: dedicated keys if present, else derive from the older symmetric gap.
  var gapT = findThr(/^price_gap_market$/);
  var loT = findThr(/price.*(below|low|lo|min)|(below|low).*price/, function (v) { return v > 0 && v < 1; });
  var hiT = findThr(/price.*(above|high|hi|max)|(above|high).*price/, function (v) { return v > 1 && v < 3; });
  var LO = loT ? loT.value : gapT ? 1 - gapT.value : 0.9;
  var HI = hiT ? hiT.value : gapT ? 1 + gapT.value : 1.1;

  // Elasticity assumptions (read from the data, never hard-coded).
  var elast = thr.filter(function (t) { return /elastic/i.test(t.key) && isNum(t.value); });

  var ABOVE = "#8e2a6b", BELOW = "#4a6fa5", NEUTRAL = "#b8c4cc";
  var DIR_TXT = { above: "Above market", below: "Below market" };

  /* ---- rows: merge review entries with SKU facts; tolerate older field names ---- */
  var rows = ((D.lists && D.lists.price_review) || []).map(function (r) {
    var s = byId[r.id] || byName[r.name] || {};
    var idx = isNum(r.price_idx) ? r.price_idx : s.price_idx_mkt;
    var dir = r.direction || r.story || (isNum(idx) ? (idx > 1 ? "above" : "below") : null);
    return Object.assign({}, s, r, {
      id: r.id || s.id, name: r.name || s.name || r.id, direction: dir,
      price: isNum(r.price) ? r.price : s.price, mkt_asp: s.mkt_asp, price_idx: idx,
      prize_low: isNum(r.prize_low) ? r.prize_low : 0, prize_high: isNum(r.prize_high) ? r.prize_high : 0
    });
  });
  var review = {};
  rows.forEach(function (r) { if (r.id) review[r.id] = r; });
  var nAbove = rows.filter(function (r) { return r.direction === "above"; }).length;
  var nBelow = rows.filter(function (r) { return r.direction === "below"; }).length;

  /* ---- header and recommendation ---- */
  app.appendChild(E("div", { class: "page-head" },
    E("h1", { text: rec ? U.plain(rec.action) : "Review prices furthest from the market average" }),
    E("p", { class: "sub", text: "Are you selling at the right price? Products priced at a price index of " + F.idx(HI) + " or more are above market; " + F.idx(LO) + " or less are below market. Inactive products need a listing decision first." })));
  if (rec) {
    app.appendChild(E("section", { class: "card" },
      E("div", { html: U.badge("Q3", "q") + ' <span class="note">Recommended action</span>' }),
      E("p", { class: "note", text: "Estimated size of prize" }),
      E("h2", { text: rec.prize_high > 0 ? F.prize(rec.prize_low) + " – " + F.prize(rec.prize_high) : "No positive uplift under the assumed demand response" }),
      E("p", { class: "note", text: U.plain(rec.prize_unit) + " per " + D.meta.period_weeks + " weeks. " + U.plain(rec.basis || "") })));
  }

  /* ---- chart ---- */
  var chartCard = U.card("Our price versus the market average",
    "Coloured products are the ones in the review list: " + nAbove + " above market (index ≥ " + F.idx(HI) + ") and " + nBelow + " below market (index ≤ " + F.idx(LO) + "). Hollow bubbles are inactive.");
  var chartBox = E("div"); chartCard.appendChild(chartBox); app.appendChild(chartCard);
  chartCard.appendChild(E("p", { class: "caveat", text: "Market average = market revenue ÷ market units for the product. This is a realised average price proxy; promotions, pack mix and timing can affect comparability. Bubble size = channel revenue." }));

  var labelIds = {};
  rows.slice().sort(function (a, b) { return Math.abs(b.price_idx - 1) - Math.abs(a.price_idx - 1); })
    .slice(0, 4).forEach(function (r) { labelIds[r.id] = true; });
  function colorFor(id) { var r = review[id]; return !r ? NEUTRAL : r.direction === "above" ? ABOVE : BELOW; }
  function reviewTxt(s) {
    var r = review[s.id];
    if (r) return DIR_TXT[r.direction] || "In review";
    return s.active ? "Within thresholds" : "Inactive";
  }

  var table;
  var qc = QuadChart.create(chartBox, {
    height: 480,
    x: { label: "Our price ÷ market average (1 = in line)", scale: "linear", split: 1,
      references: [{ value: LO, label: "≤" + F.idx(LO) + " below" }, { value: HI, label: "≥" + F.idx(HI) + " above" }],
      format: function (v) { return F.idx(v); } },
    y: { label: "Channel revenue, " + D.meta.period_weeks + " weeks (log)", scale: "log", format: function (v) { return F.eurK(v); } },
    onClick: function (p) { selectId(p.id, false); },
    onBackgroundClick: function () { selectId(null, false); }
  });
  qc.setView({ id: "prices", title: "Product price comparison", kind: "sku",
    legend: [{ label: "Above market · review", color: ABOVE }, { label: "Below market · review", color: BELOW },
      { label: "Within thresholds", color: NEUTRAL }, { label: "Inactive", color: COL.inactive, hollow: true }],
    sizeNote: "Thresholds: ≤" + F.idx(LO) + " or ≥" + F.idx(HI) + " · bubble size = channel revenue",
    points: (D.skus || []).filter(function (s) { return isNum(s.price_idx_mkt); }).map(function (s) {
      var r = review[s.id];
      var tipRows = [["Review", reviewTxt(s)], ["Our price", F.money(s.price)], ["Market average", F.money(s.mkt_asp)],
        ["Price index", F.idx(s.price_idx_mkt)], ["Current margin", F.share(s.margin)], ["Channel revenue", F.eur(s.rev)]];
      if (r) {
        tipRows.push(["Target price", F.money(r.target_price)]);
        tipRows.push(["Est. gross-profit uplift", r.prize_high > 0 ? F.eur(r.prize_low) + " – " + F.eur(r.prize_high) : "None positive"]);
      }
      tipRows.push(["Product ID", s.id]);
      return { id: s.id, x: s.price_idx_mkt, y: s.rev, size: s.rev, color: colorFor(s.id), hollow: !s.active,
        label: labelIds[s.id] ? U.shortName(s.name, 24) : null,
        tip: { title: s.name, rows: tipRows } };
    })
  });

  /* ---- review list ---- */
  var reviewCard = U.card("Products for price review",
    "Test pricing toward the market average. Sorted by the high end of the estimated gross-profit uplift.");
  var assume;
  if (elast.length) {
    assume = "Assumption: the uplift range uses price elasticities of demand of " +
      elast.map(function (t) {
        var c = /(\w+ elastic case)/i.exec(t.label || "");
        return F.idx(t.value, 1).replace("-", "−") + (c ? " (" + c[1] + ")" : "");
      }).join(" and ") +
      "; an elasticity of −1 means a 1% price rise loses 1% of units. These are assumptions, not measured from the data.";
  } else {
    assume = "Assumption: no demand elasticity values were found in the data; uplift figures are shown as provided.";
  }
  reviewCard.appendChild(E("p", { class: "caveat", text: assume }));

  var filter = "all";
  var tools = E("div", { class: "toolrow" });
  tools.appendChild(E("span", { class: "note", text: "Direction" }));
  U.toggle(tools, [{ value: "all", label: "All (" + rows.length + ")" }, { value: "above", label: "Above market (" + nAbove + ")" },
    { value: "below", label: "Below market (" + nBelow + ")" }], filter, function (v) { filter = v; applyFilter(); });
  reviewCard.appendChild(tools);

  function uplift(r) { return r.prize_high > 0 ? F.eur(r.prize_low) + " – " + F.eur(r.prize_high) : "No positive uplift"; }
  table = U.table(reviewCard, {
    columns: [
      { key: "name", label: "Product", fmt: function (v, r) { return v + (r.active === false ? " (inactive)" : ""); } },
      { key: "direction", label: "Direction", html: true, fmt: function (v) {
        var c = v === "above" ? ABOVE : v === "below" ? BELOW : NEUTRAL;
        return '<span style="white-space:nowrap"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + c + ';margin-right:6px"></span>' + U.esc(DIR_TXT[v] || "–") + "</span>";
      } },
      { key: "price", label: "Our price", num: true, fmt: function (v) { return F.money(v); } },
      { key: "mkt_asp", label: "Market average", num: true, fmt: function (v) { return F.money(v); } },
      { key: "price_idx", label: "Price index", num: true, fmt: function (v) { return F.idx(v); } },
      { key: "target_price", label: "Target price", num: true, fmt: function (v) { return F.money(v); } },
      { key: "prize_high", label: "Est. gross-profit uplift", num: true, fmt: function (v, r) { return uplift(r); } },
      { key: "uplift_note", label: "Note", sortable: false, fmt: function (v) { return U.plain(v || ""); } }],
    rows: rows, sort: { key: "prize_high", dir: "desc" }, maxHeight: 520, empty: "No products in this direction",
    onRowClick: function (r) { selectId(r.id, true); }
  });
  reviewCard.appendChild(E("p", { class: "note", text: "Target price = market average. Uplift ranges are " + D.meta.period_weeks + "-week gross-profit scenarios using the reported margin as a unit-cost proxy; validate costs, promotions and demand before changing prices. Inactive products need a listing decision first." }));
  app.appendChild(reviewCard);

  function visibleRows() { return filter === "all" ? rows : rows.filter(function (r) { return r.direction === filter; }); }
  function applyFilter() {
    var vis = visibleRows();
    table.setRows(vis);
    qc.highlight(filter === "all" ? null : vis.map(function (r) { return r.id; }));
  }
  function selectId(id, scroll) {
    qc.select(id);
    if (id) qc.highlight([id]); else qc.highlight(filter === "all" ? null : visibleRows().map(function (r) { return r.id; }));
    table.setHighlight(id ? function (r) { return r.id === id; } : null);
    if (scroll && id) chartCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }
})();
