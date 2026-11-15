/* Recommendations (entry page). Everything is rendered from window.DATA. */
(function () {
  'use strict';
  var D = window.DATA, app = document.getElementById('app');
  if (!D || !app) return;
  var F = UI.fmt, el = UI.el;

  // Card order comes from the data layer: "prize" = largest high-end prize first, "question" = Q1..Q4.
  const SORT = 'question';

  var st = document.createElement('style');
  st.textContent =
    '.idx-order{color:var(--muted);font-size:13px;margin:0 0 10px}' +
    '.idx-card{display:flex;justify-content:space-between;align-items:center;gap:24px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:18px 22px;margin-bottom:12px;color:inherit;text-decoration:none;transition:transform .12s,box-shadow .12s,border-color .12s}' +
    '.idx-card:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(31,92,77,.12);border-color:var(--accent)}' +
    '.idx-card h3{font-size:19px;margin:8px 0 4px}' +
    '.idx-q{color:var(--muted);font-size:13px;margin-left:6px}' +
    '.idx-prize .idx-lbl{font-weight:600;color:var(--ink);margin-bottom:2px}' +
    '.idx-prize{text-align:right;flex:none}' +
    '.idx-prize b{display:block;font-size:26px;line-height:1.2;color:var(--accent);font-variant-numeric:tabular-nums;white-space:nowrap}' +
    '.idx-prize span{display:block;font-size:12px;color:var(--muted)}' +
    '.idx-prize .idx-pct{font-weight:600;color:var(--accent);font-size:13px}' +
    '@media(max-width:1100px){.idx-card{flex-direction:column;align-items:flex-start;gap:10px}.idx-prize{text-align:left}}';
  document.head.appendChild(st);

  var m = D.meta;
  app.appendChild(el('div', { class: 'page-head' },
    el('h1', { text: 'Hair Coloration: category opportunity review' })));

  var recs = D.recs.slice();
  if (SORT === 'prize') recs.sort(function (a, b) { return b.prize_high - a.prize_high; });
  else recs.sort(function (a, b) { return a.q - b.q; });

  var total = D.opportunity_total;
  // Size of prize as a share of total 12-week channel sales.
  function pctSales(lo, hi) {
    var t = m.total_rev; if (!t) return '';
    function f(v) { var p = v / t * 100; return (p >= 10 ? p.toFixed(0) : p.toFixed(1)) + '%'; }
    return f(lo) + '–' + f(hi) + ' of total sales';
  }
  var S = D.summary || {};
  function has(k) { return typeof S[k] === 'number' && isFinite(S[k]); }
  function n(k, one, many) { return has(k) ? F.int(S[k]) + ' ' + (S[k] === 1 ? one : many) : many; }
  var relists = has('n_relist') ? S.n_relist : (D.lists && D.lists.gaps || []).filter(function (g) { return g.type === 'sku'; }).length;
  var parts = [
    'relisting ' + F.int(relists) + ' high-demand ' + (relists === 1 ? 'product' : 'products') +
      ' and adding ' + n('n_gap_groups', 'missing subcategory × shade group', 'missing subcategory × shade groups'),
    'supporting ' + n('n_push', 'under-sold product', 'under-sold products') + ' and reviewing ' + n('n_low', 'low performer', 'low performers'),
    'reviewing ' + n('n_price', 'price outlier', 'price outliers'),
    'prioritising replenishment' + (has('n_restock') ? ' for ' + n('n_restock', 'SKU', 'SKUs') : '')
  ];
  var introEl = el('p', { class: 'idx-intro' },
    'After analysing Hair Coloration sales, market demand and competitor signals, we recommend ' +
    parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1] + '. ');
  if (total) introEl.appendChild(el('b', { text: 'Estimated size of prize: ' + F.prize(total.low) + '–' + F.prize(total.high) + ' (' + pctSales(total.low, total.high) + ')' }));
  if (total) introEl.appendChild(document.createTextNode(' in additional or protected revenue over ' + m.period_weeks + ' weeks.'));
  app.appendChild(introEl);

  var sec = el('section', null, el('h2', { text: 'Recommendations' }),
    el('p', { class: 'idx-order', text: 'Right assortment → right products → right price → right availability. Select a recommendation for the evidence.' }));
  recs.forEach(function (r) {
    sec.appendChild(el('a', { class: 'idx-card', href: r.page },
      el('div', null,
        el('div', { html: UI.badge('Q' + r.q, 'q') + ' <span class="idx-q">' + UI.esc(r.question) + '</span>' }),
        el('h3', { text: UI.plain(r.action) })),
      el('div', { class: 'idx-prize' },
        el('span', { class: 'idx-lbl', text: 'Estimated size of prize' }),
        el('b', { text: F.prize(r.prize_low) + ' – ' + F.prize(r.prize_high) }),
        el('span', { class: 'idx-pct', text: pctSales(r.prize_low, r.prize_high) }),
        el('span', { text: 'per ' + m.period_weeks + ' weeks · ' + r.prize_unit }))));
  });
  app.appendChild(sec);

  app.appendChild(el('p', { class: 'note', text: total ? UI.plain(total.basis) : 'Opportunity ranges are estimated scenarios, not forecasts.' }));
  app.appendChild(el('p', { class: 'note', html: 'The assumptions and source calculations are on the <a href="method.html">Method page</a>.' }));
})();
