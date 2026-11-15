/* Q1 Assortment: right range? Grain = subcategory x shade group. Everything from window.DATA. */
(function () {
  'use strict';
  var D = window.DATA, app = document.getElementById('app');
  if (!D || !app) return;
  var F = UI.fmt, el = UI.el, C = UI.COLORS, M = D.meta, Q = D.quadrants;
  var RED = C.out_of_stock, AMBER = C.low_stock;

  var st = document.createElement('style');
  st.textContent =
    '.asm-callout{display:flex;justify-content:space-between;gap:24px;align-items:center;flex-wrap:wrap}' +
    '.page-head h1{font-size:18px;color:var(--muted);font-weight:400}.asm-callout h3{font-size:27px;margin:8px 0 4px}.asm-callout p{margin:0}' +
    '.asm-prize{text-align:right;flex:none}.asm-prize b{display:block;font-size:26px;color:var(--accent);font-variant-numeric:tabular-nums;white-space:nowrap}' +
    '.asm-prize span{display:block;font-size:12px;color:var(--muted)}.asm-prize i{font-size:11px;color:var(--warn);font-style:normal}' +
    '.asm-basis{margin-top:10px!important;font-size:13px;color:var(--muted)}' +
    '.asm-charts{scroll-margin-top:64px}' +
    '.asm-sub{font-size:14px;margin:14px 0 6px}.asm-sub:first-child{margin-top:0}' +
    '.asm-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px}' +
    '.asm-cross{min-height:18px;color:var(--warn);font-size:13px;margin:6px 0 0}';
  document.head.appendChild(st);

  var cellBy = {}; D.cells.forEach(function (c) { cellBy[c.key] = c; });
  var skusBy = {}; D.skus.forEach(function (s) { (skusBy[s.cell] = skusBy[s.cell] || []).push(s); });
  var compsBy = {}; D.comps.forEach(function (c) { (compsBy[c.cell] = compsBy[c.cell] || []).push(c); });
  function nn(v) { return typeof v === 'number' && isFinite(v); }
  function lbl(k) { return UI.cellLabel(k); }

  /* ---------- header + callout ---------- */
  app.appendChild(el('div', { class: 'page-head' },
    el('h1', { text: 'Q1 · Do you have the right assortment?' }),
    el('p', { class: 'sub', text: 'Where competitors have popular, rising products we lack, and where our own cells sell below the category norm. Each bubble is a subcategory and shade group.' })));

  var rec = D.recs.filter(function (r) { return r.q === 1; })[0];
  if (rec) {
    var co = UI.card();
    co.appendChild(el('div', { class: 'asm-callout' },
      el('div', null, el('div', { html: UI.badge('Q1', 'q') }), el('h3', { text: rec.action }), el('p', { class: 'note', text: rec.evidence })),
      el('div', { class: 'asm-prize' }, el('b', { text: F.prize(rec.prize_low) + ' – ' + F.prize(rec.prize_high) }),
        el('span', { text: 'per ' + M.period_weeks + ' weeks · ' + rec.prize_unit }), el('i', { text: 'illustrative' }))));
    co.appendChild(el('p', { class: 'asm-basis', text: rec.basis }));
    app.appendChild(co);
  }

  /* ---------- chart cards ---------- */
  var chartsRow = el('div', { class: 'grid-2 asm-charts' });
  var cardA = UI.card('Competitor signals', 'Which cells competitors are pushing. Click a bubble to see its competitor products.');
  var hostA = el('div'); var noteA = el('div', { class: 'asm-cross' });
  var abbr = {}; // short labels: shade + subcategory initials
  function sub3(s) { return s.split(/[^A-Za-z0-9]+/).filter(Boolean).map(function (w) { return w[0].toUpperCase(); }).join(''); }
  D.cells.forEach(function (c) { abbr[c.sub] = sub3(c.sub); });
  cardA.appendChild(hostA); cardA.appendChild(noteA);
  cardA.appendChild(el('p', { class: 'note', text: 'Labels: shade · subcategory initials (' + Object.keys(abbr).map(function (k) { return abbr[k] + ' = ' + k; }).join('; ') + ').' }));

  var cardB = UI.card('Your performance', 'How your own cells sell and trend. Click a bubble to see its SKUs.');
  var tools = el('div', { class: 'toolrow' });
  var metric = 'rev';
  var tg = UI.toggle(tools, [{ value: 'rev', label: 'Revenue' }, { value: 'units', label: 'Units' }], 'rev', function (v) { metric = v; renderB(); });
  var hostB = el('div'); var noteB = el('div', { class: 'asm-cross' });
  cardB.appendChild(tools); cardB.appendChild(hostB); cardB.appendChild(noteB);
  chartsRow.appendChild(cardA); chartsRow.appendChild(cardB);
  app.appendChild(chartsRow);

  /* ---------- state ---------- */
  var cur = null;      // selected cell key
  var A, B;

  function drillKey(ch) { return ch && ch.depth() > 1 ? ch.view().cellKey : null; }

  /* ---------- chart A ---------- */
  var qa = Q.assort_comp;
  function rootA() {
    var pts = D.cells.filter(function (c) { return c.n_comp > 0 && nn(c.comp_score_mean) && nn(c.comp_trend_mean); }).map(function (c) {
      return {
        id: c.key, x: c.comp_score_mean, y: c.comp_trend_mean, size: c.n_comp, color: c.n_skus === 0 ? RED : '#a6aaa8',
        label: c.n_skus === 0 ? c.shade + ' · ' + abbr[c.sub] : null, data: c,
        tip: { title: lbl(c.key), rows: [
          ['Competitor products', F.int(c.n_comp) + ' (' + F.int(c.n_hot) + ' hot)'],
          ['Mean signal score', F.idx(c.comp_score_mean, 1)], ['Mean trend', F.pct(c.comp_trend_mean)],
          ['Best rank', nn(c.comp_rank_best) ? '#' + F.int(c.comp_rank_best) + ' (lower = better)' : '–'],
          ['Median competitor price', nn(c.comp_price_median) ? F.money(c.comp_price_median) : '–'],
          ['Your SKUs', F.int(c.n_skus) + ' (' + F.int(c.coverage) + ' active in stock)']
        ].concat(c.gap ? [['Gap', c.gap_reason]] : []) }
      };
    });
    return { id: 'cells', title: 'All cells', points: pts,
      legend: [{ label: 'Zero client SKUs', color: RED }, { label: 'Other cell', color: '#a6aaa8' }],
      sizeNote: 'Bubble size = number of competitor products' };
  }
  function compView(key) {
    var pts = (compsBy[key] || []).map(function (p) {
      var ms = p.match_sku ? UI.sku(p.match_sku) : null;
      return {
        id: p.id, x: p.score, y: p.trend, color: '#a6aaa8', label: p.id, data: p,
        tip: { title: p.id + ' · ' + p.name, rows: [
          ['Brand', p.brand], ['Source', p.source], ['Price', F.money(p.price)],
          ['Rank', '#' + F.int(p.rank) + ' (lower = better)'], ['Signal score', F.idx(p.score, 0)], ['Trend', F.pct(p.trend)],
          ['Hot', p.hot ? 'Yes: popular and rising' : 'No'],
          ['Matched client SKU', ms ? ms.id + ' · ' + (ms.status === 'inaktiv' ? 'inactive' : 'active') : 'None']
        ] }
      };
    });
    // Fixed axes in the drill-down (same frame as all competitor products) so a cell with one
    // or two products is not stretched into a corner.
    var tr = DATA.comps.map(function (c) { return c.trend; });
    return { id: 'cell:' + key, cellKey: key, title: lbl(key), points: pts,
      x: { min: 0, max: 110 }, y: { min: Math.min.apply(null, tr) - 0.05, max: Math.max.apply(null, tr) + 0.05 },
      legend: [{ label: 'Competitor product', color: '#a6aaa8' }], sizeNote: '' };
  }

  /* ---------- chart B ---------- */
  var qb = Q.assort_client;
  function xOwn(o) { return metric === 'rev' ? o.rev : o.units; }
  function axisB() {
    var r = metric === 'rev';
    return {
      label: r ? 'Channel revenue, 12 weeks (log)' : 'Channel units, 12 weeks (log)',
      scale: 'log', format: r ? F.eurK : F.int, split: r ? qb.x_split_rev : qb.x_split_units
    };
  }
  function rootB() {
    var r = metric === 'rev';
    var pts = D.cells.filter(function (c) { return c.n_skus > 0 && nn(c.ch_trend); }).map(function (c) {
      var p = {
        id: c.key, x: xOwn(c), y: c.ch_trend, size: c.n_skus, data: c,
        color: c.gap ? RED : c.under ? AMBER : C.client,
        tip: { title: lbl(c.key), rows: [
          ['SKUs', F.int(c.n_skus)],
          ['Channel revenue', F.eur(c.rev)], ['Channel units', F.int(c.units)],
          ['Market revenue', F.eur(c.mkt_rev)],
          ['Share of market', F.share(c.share) + ' vs category ' + F.share(M.cat_share)],
          ['Channel trend', F.pct(c.ch_trend)], ['Market trend', F.pct(c.mk_trend)]
        ].concat(c.under ? [['Under-performing', c.under_reason]] : []).concat(c.gap ? [['Gap', c.gap_reason]] : [])
          .concat(c.rev <= 0 ? [['Note', 'No channel sales: drawn in the 0 lane']] : []) }
      };
      return p;
    });
    return { id: 'cells', title: 'All cells', points: pts, x: axisB(),
      legend: [{ label: 'Assortment gap', color: RED }, { label: 'Under-performing', color: AMBER }, { label: 'Other cell', color: C.client }],
      sizeNote: 'Bubble size = number of SKUs' };
  }
  function skuView(key) {
    var r = metric === 'rev';
    var pts = (skusBy[key] || []).filter(function (s) { return nn(s.ch_trend); }).map(function (s) {
      var p = {
        id: s.id, x: xOwn(s), y: s.ch_trend, label: s.id, data: s,
        color: C.client,
        tip: { title: s.id + ' · ' + s.name, rows: [
          ['Brand', s.brand],
          ['Price', F.money(s.price)], ['Channel revenue', F.eur(s.rev)], ['Channel units', F.int(s.units)],
          ['Share of market', F.share(s.share)], ['Channel trend', F.pct(s.ch_trend)], ['Market trend', F.pct(s.mk_trend)],
          ['Supplier', s.supplier]
        ].concat(s.rev <= 0 ? [['Note', 'No channel sales: drawn in the 0 lane']] : []) }
      };
      return p;
    });
    return { id: 'cell:' + key, cellKey: key, title: lbl(key), points: pts, x: axisB(),
      legend: [{ label: 'Your SKU', color: C.client }], sizeNote: '' };
  }
  function renderB() {
    var k = drillKey(B);
    busy = true;
    B.setView(rootB());
    if (k) B.pushView(skuView(k));
    busy = false;
    sync();
  }

  /* ---------- detail table ---------- */
  var detail = UI.card('All cells', 'Click a row to select the cell in both charts.');
  var detailBody = el('div');
  detail.appendChild(detailBody);

  function flags(r) {
    var o = [];
    if (r.gap) o.push(UI.badge('Gap', 'out_of_stock'));
    if (r.under) o.push(UI.badge('Under-performing', 'low_stock'));
    if (r.n_hot > 0) o.push(UI.badge('Hot competitor', 'flag'));
    return o.join(' ');
  }
  var cellCols = [
    { key: 'key', label: 'Cell', fmt: function (v) { return lbl(v); } },
    { key: 'n_skus', label: 'Client SKUs', num: true, fmt: F.int },
    { key: 'coverage', label: 'Coverage', num: true, fmt: F.int, title: 'Active SKUs that are in stock or low stock' },
    { key: 'rev', label: 'Channel revenue', num: true, fmt: F.eur },
    { key: 'mkt_rev', label: 'Market revenue', num: true, fmt: F.eur },
    { key: 'share', label: 'Share of market', num: true, fmt: function (v) { return v == null ? '–' : F.share(v); } },
    { key: 'ch_trend', label: 'Channel trend', num: true, fmt: function (v) { return F.pct(v); } },
    { key: 'mk_trend', label: 'Market trend', num: true, fmt: function (v) { return F.pct(v); } },
    { key: 'n_comp', label: 'Competitor products', num: true, fmt: F.int },
    { key: 'n_hot', label: 'Hot', num: true, fmt: F.int, title: 'Hot competitor products: popular and rising' },
    { key: 'comp_score_mean', label: 'Comp. score', num: true, fmt: function (v) { return v == null ? '–' : F.idx(v, 1); } },
    { key: 'comp_trend_mean', label: 'Comp. trend', num: true, fmt: function (v) { return F.pct(v); } },
    { key: 'flags', label: 'Flags', html: true, fmt: function (v, r) { return flags(r); }, sortValue: function (r) { return (r.gap ? 2 : 0) + (r.under ? 1 : 0); } }
  ];
  var skuCols = [
    { key: 'id', label: 'SKU' }, { key: 'name', label: 'Name' }, { key: 'brand', label: 'Brand' },
    { key: 'status', label: 'Status', html: true, fmt: function (v) { return UI.statusBadge(v); } },
    { key: 'stock', label: 'Stock', html: true, fmt: function (v) { return UI.stockBadge(v); } },
    { key: 'price', label: 'Price', num: true, fmt: F.money },
    { key: 'rev', label: 'Revenue', num: true, fmt: F.eur }, { key: 'units', label: 'Units', num: true, fmt: F.int },
    { key: 'share', label: 'Share of market', num: true, fmt: function (v) { return F.share(v); } },
    { key: 'ch_trend', label: 'Channel trend', num: true, fmt: function (v) { return F.pct(v); } },
    { key: 'mk_trend', label: 'Market trend', num: true, fmt: function (v) { return F.pct(v); } }
  ];
  var compCols = [
    { key: 'id', label: 'Product' }, { key: 'name', label: 'Name' }, { key: 'brand', label: 'Brand' }, { key: 'source', label: 'Source' },
    { key: 'price', label: 'Price', num: true, fmt: F.money },
    { key: 'rank', label: 'Rank', num: true, fmt: F.int, title: 'Lower = better' },
    { key: 'score', label: 'Score', num: true, fmt: function (v) { return F.idx(v, 0); } },
    { key: 'trend', label: 'Trend', num: true, fmt: function (v) { return F.pct(v); } },
    { key: 'hot', label: 'Hot', fmt: function (v) { return v ? 'Yes' : 'No'; } },
    { key: 'match_sku', label: 'Matched SKU', fmt: function (v) { return v || '–'; } }
  ];

  function renderDetail() {
    detailBody.innerHTML = '';
    var h2 = detail.querySelector('h2'), p = detail.querySelector('p.note');
    if (!cur) {
      h2.textContent = 'All cells'; p.textContent = 'Click a row to select the cell in both charts.';
      UI.table(detailBody, { columns: cellCols, rows: D.cells, sort: { key: 'rev', dir: 'desc' }, maxHeight: 420, onRowClick: function (r) { select(r.key, 'both', true); } });
      return;
    }
    var c = cellBy[cur];
    h2.textContent = 'Selected cell: ' + lbl(cur);
    p.textContent = F.int(c.n_skus) + ' client SKUs and ' + F.int(c.n_comp) + ' competitor products in this cell.';
    detailBody.appendChild(el('button', { class: 'btn', type: 'button', text: 'Show all cells', onclick: showAll }));
    detailBody.appendChild(el('h3', { class: 'asm-sub', text: 'Your SKUs' }));
    UI.table(detailBody, { columns: skuCols, rows: skusBy[cur] || [], sort: { key: 'rev', dir: 'desc' }, empty: 'No client SKUs in this cell' });
    detailBody.appendChild(el('h3', { class: 'asm-sub', text: 'Competitor products' }));
    UI.table(detailBody, { columns: compCols, rows: compsBy[cur] || [], sort: { key: 'score', dir: 'desc' }, empty: 'No competitor signals for this cell' });
  }

  /* ---------- selection / linking ---------- */
  var lastDetail = 'x';
  function hasPoint(ch, key) { return ch.view().points.some(function (p) { return p.id === key; }); }
  var busy = false;
  function sync() {
    if (!A || !B || busy) return;
    if (!drillKey(A) && !drillKey(B)) cur = null;
    [[A, noteA, 'No competitor signals for this cell'], [B, noteB, 'No client SKUs in this cell']].forEach(function (t) {
      var ch = t[0], note = t[1];
      note.textContent = '';
      if (ch.depth() > 1) return;
      if (cur && hasPoint(ch, cur)) { ch.highlight([cur]); ch.select(cur); }
      else { ch.highlight(null); ch.select(null); if (cur) note.textContent = t[2] + ' (' + lbl(cur) + ').'; }
    });
    if (lastDetail !== cur) { lastDetail = cur; renderDetail(); }
  }
  // mode: 'A' | 'B' | 'both' = which chart(s) drill into the cell
  function select(key, mode, scroll) {
    cur = key; busy = true;
    var chs = [[A, rootA, compView, 'A'], [B, rootB, skuView, 'B']];
    chs.forEach(function (t) {
      var ch = t[0], want = mode === 'both' || mode === t[3];
      var has = t[0] === A ? (compsBy[key] || []).length > 0 : (skusBy[key] || []).length > 0;
      if (ch.depth() > 1 && (drillKey(ch) !== key || !(want && has))) ch.setView(t[1]());
      if (want && has && drillKey(ch) !== key) ch.pushView(t[2](key));
    });
    busy = false;
    sync();
    if (scroll) chartsRow.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function showAll() { cur = null; busy = true; A.setView(rootA()); B.setView(rootB()); busy = false; sync(); }

  A = QuadChart.create(hostA, {
    height: 460,
    source: 'Source: competitor_market_signals.csv · observation ' + M.observed_date + '; coverage: sku_performance.csv.',
    x: { label: 'Competitor popularity: mean signal score (0–100, higher = more popular)', scale: 'linear', format: function (v) { return F.int(v); }, split: qa.x_split },
    y: { label: 'Competitor trend, 12 weeks', scale: 'linear', format: function (v) { return F.pct(v); }, split: qa.y_split },
    quadrants: { tl: qa.tl, tr: qa.tr, bl: qa.bl, br: qa.br }, tints: { tr: 'good' },
    onClick: function (p, qc) { if (qc.depth() === 1) select(p.id, 'A'); },
    onViewChange: function () { sync(); }
  });
  B = QuadChart.create(hostB, {
    height: 460,
    x: axisB(),
    y: { label: 'Channel trend vs prior 12 weeks', scale: 'linear', format: function (v) { return F.pct(v); }, split: qb.y_split },
    quadrants: { tl: qb.tl, tr: qb.tr, bl: qb.bl, br: qb.br }, tints: { tr: 'good', bl: 'bad' },
    onClick: function (p, qc) { if (qc.depth() === 1) select(p.id, 'B'); },
    onViewChange: function () { sync(); }
  });
  A.setView(rootA());
  B.setView(rootB());
  renderDetail();

  /* ---------- lists ---------- */
  var cGap = UI.card('Assortment actions', 'Missing cells with popular, rising competitor signals, plus delisted SKUs in strong markets. Click a row to open the cell.');
  var gapRows = D.lists.gaps.map(function (g) {
    var s = g.sku_id ? UI.sku(g.sku_id) : null;
    return { type: g.type, key: g.key, sku: s ? s.id + ' · ' + s.name : '', reason: g.reason, prize_low: g.prize_low, prize_high: g.prize_high };
  });
  UI.table(cGap, { columns: [
    { key: 'type', label: 'Type', fmt: function (v) { return v === 'sku' ? 'Relist SKU' : 'Gap cell'; } },
    { key: 'key', label: 'Cell', fmt: function (v) { return lbl(v); } },
    { key: 'sku', label: 'SKU', fmt: function (v) { return v || '–'; } },
    { key: 'reason', label: 'Reason' },
    { key: 'prize_high', label: 'Prize (per ' + M.period_weeks + ' wks)', num: true, fmt: function (v, r) { return v == null ? '–' : F.prize(r.prize_low) + ' – ' + F.prize(r.prize_high); } }
  ], rows: gapRows, maxHeight: 360, onRowClick: function (r) { select(r.key, 'both', true); } });
  app.appendChild(cGap);

  var peerRows = D.lists.gaps.filter(function (g) { return g.type === 'cell' && g.peer_n > 0; });
  if (peerRows.length) {
    var peers = UI.card('Size of prize · missing assortment', 'Illustrative 12-week revenue range from represented peer cells with similar competitor popularity and trend. These are peer observations, not measured demand or a forecast for the missing cell.');
    UI.table(peers, { columns: [
      { key: 'key', label: 'Missing cell', fmt: function (v) { return lbl(v); } },
      { key: 'prize_high', label: 'Peer revenue range', num: true, fmt: function (v, r) { return F.prize(r.prize_low) + ' – ' + F.prize(r.prize_high); } },
      { key: 'peer_keys', label: 'Comparable represented cells', fmt: function (v) { return (v || []).map(lbl).join('; '); } },
      { key: 'peer_sku_ids', label: 'Peer SKUs', fmt: function (v) { return (v || []).join(', '); } },
      { key: 'peer_basis', label: 'Estimation basis' }
    ], rows: peerRows, onRowClick: function (r) { select(r.key, 'both', true); } });
    peers.appendChild(el('p', { class: 'note', text: 'Source: competitor_market_signals.csv and sku_performance.csv. Ranges use the lowest and highest observed revenue among up to three nearest represented cells by normalized signal score and trend. Peer sets may overlap; the combined scenario assumes each new cell adds incremental revenue without cannibalizing existing sales.' }));
    app.appendChild(peers);
  }


  var cUnder = UI.card('Under-performing cells', 'Cells selling below the share threshold. Click a row to open the cell.');
  UI.table(cUnder, { columns: [
    { key: 'key', label: 'Cell', fmt: function (v) { return lbl(v); } },
    { key: 'share', label: 'Share vs category share', num: true, fmt: function (v) { return F.share(v) + ' vs ' + F.share(M.cat_share); } },
    { key: 'reason', label: 'Reason' },
    { key: 'prize_high', label: 'Prize, high case', num: true, fmt: function (v) { return F.prize(v); } }
  ], rows: D.lists.under_cells, sort: { key: 'prize_high', dir: 'desc' }, maxHeight: 360, onRowClick: function (r) { select(r.key, 'both', true); } });
  app.appendChild(cUnder);
  app.appendChild(detail);

  app.appendChild(el('p', { class: 'caveat', text: 'Competitor signals are one snapshot (' + M.observed_date + ') from mixed sources (retailers, search, social): they show direction, not volume.' }));
})();
