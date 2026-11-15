/* Method & data questions. Everything is rendered from window.DATA. */
(function () {
  'use strict';
  var D = window.DATA, app = document.getElementById('app');
  if (!D || !app) return;
  var F = UI.fmt, el = UI.el, M = D.method;

  var st = document.createElement('style');
  st.textContent = '.mth-list{margin:6px 0 0;padding-left:20px}.mth-list li{margin:4px 0}.mth-sub{font-size:14px;margin:16px 0 6px;color:var(--accent)}';
  document.head.appendChild(st);

  app.appendChild(el('div', { class: 'page-head' },
    el('h1', { text: 'Method and data questions' }),
    el('p', { class: 'sub', text: 'How products are flagged, how the prizes are sized, and what we would like to confirm with ' + D.meta.client + '.' })));

  function plain(container, cols, rows) {
    UI.table(container, { columns: cols.map(function (c) { c.sortable = false; return c; }), rows: rows });
  }
  function list(items) {
    return el('ul', { class: 'mth-list' }, items.map(function (t) { return el('li', { text: t }); }));
  }

  function thrValue(t) {
    var v = t.value;
    if (t.unit === 'eur') return F.eur(v);
    if (t.unit === 'pct') {
      if (/rising|positive|declining|trend/.test(t.key)) return F.pct(v, Number.isInteger(v * 100) ? 0 : 1);
      return F.share(v, Number.isInteger(v * 100) ? 0 : 1);
    }
    if (t.unit === 'ratio') return v.toFixed(2);
    return F.int(v);
  }

  // Thresholds
  var c1 = UI.card('Thresholds', 'Every cut-off used on the pages. They live in the T dictionary at the top of review.py; change a value there and re-run to update all pages.');
  plain(c1, [
    { key: 'label', label: 'Setting' },
    { key: 'value', label: 'Value', num: true, fmt: function (v, r) { return thrValue(r); } },
    { key: 'used_in', label: 'Used in', fmt: function (v) { return (v || []).join(', '); } }
  ], D.thresholds);
  app.appendChild(c1);

  // Rules by page
  var c2 = UI.card('How products are flagged', 'Plain-language rules, with the current threshold values filled in.');
  var pages = [];
  M.rules.forEach(function (r) { if (pages.indexOf(r.page) < 0) pages.push(r.page); });
  pages.forEach(function (p) {
    c2.appendChild(el('h3', { class: 'mth-sub', text: p }));
    plain(c2, [{ key: 'name', label: 'Rule' }, { key: 'text', label: 'Definition' }],
      M.rules.filter(function (r) { return r.page === p; }));
  });
  app.appendChild(c2);

  // Prize
  var c3 = UI.card('Size-of-prize scenarios', 'Illustrative ranges per ' + D.meta.period_weeks + ' weeks, not forecasts. They overlap partly, so do not add them together.');
  var basis = {};
  M.prize_bases.forEach(function (b) { basis[b.q] = b.text; });
  plain(c3, [
    { key: 'q', label: 'Question', fmt: function (v) { return 'Q' + v; } },
    { key: 'action', label: 'Recommendation' },
    { key: 'prize_low', label: 'Range', num: true, fmt: function (v, r) { return F.eurK(r.prize_low) + ' – ' + F.eurK(r.prize_high) + ' (' + r.prize_unit + ')'; } },
    { key: 'basis', label: 'How it is calculated', fmt: function (v, r) { return basis[r.q] || r.basis; } }
  ], D.recs.slice().sort(function (a, b) { return a.q - b.q; }));
  app.appendChild(c3);

  // Charts
  var c4 = UI.card('How to read the charts', 'Each chart is split into four quadrants; the lines mark the cut-offs. Click a bubble to drill down, use the back button to return.');
  c4.appendChild(list(M.quadrant_notes.map(function (n) { return n.chart + ': ' + n.text; })));
  var qn = { assort_comp: 'Assortment: competitor view', assort_client: 'Assortment: our channel view', products: 'Products', price: 'Price', availability: 'Availability' };
  var qrows = Object.keys(D.quadrants).map(function (k) { var q = D.quadrants[k]; return { chart: qn[k] || k, tr: q.tr, tl: q.tl, br: q.br, bl: q.bl }; });
  c4.appendChild(el('h3', { class: 'mth-sub', text: 'Quadrant names' }));
  plain(c4, [
    { key: 'chart', label: 'Chart' }, { key: 'tl', label: 'Top left' }, { key: 'tr', label: 'Top right' },
    { key: 'bl', label: 'Bottom left' }, { key: 'br', label: 'Bottom right' }], qrows);
  app.appendChild(c4);

  var c5 = UI.card('Data questions to confirm with the customer');
  c5.appendChild(list(M.data_questions));
  app.appendChild(c5);

  var c6 = UI.card('Caveats');
  c6.appendChild(list(M.caveats));
  app.appendChild(c6);
})();
