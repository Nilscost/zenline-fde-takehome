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
    '.idx-ev{margin:0;color:var(--muted);font-size:14px}' +
    '.idx-prize{text-align:right;flex:none}' +
    '.idx-prize b{display:block;font-size:26px;line-height:1.2;color:var(--accent);font-variant-numeric:tabular-nums;white-space:nowrap}' +
    '.idx-prize span{display:block;font-size:12px;color:var(--muted)}' +
    '.idx-prize i{font-size:11px;color:var(--warn);font-style:normal}' +
    '@media(max-width:1100px){.idx-card{flex-direction:column;align-items:flex-start;gap:10px}.idx-prize{text-align:left}}';
  document.head.appendChild(st);

  var m = D.meta;
  app.appendChild(el('div', { class: 'page-head' },
    el('h1', { text: 'Hair Coloration: category opportunity review' })));

  var recs = D.recs.slice();
  if (SORT === 'prize') recs.sort(function (a, b) { return b.prize_high - a.prize_high; });
  else recs.sort(function (a, b) { return a.q - b.q; });

  var total = D.opportunity_total;
  var relists = D.lists.gaps.filter(function (g) { return g.type === 'sku'; }).length;
  var intro = 'After analysing Hair Coloration sales, market demand and competitor signals, we recommend relisting ' + relists +
    ' high-demand SKUs and filling missing assortment, supporting under-sold products and reviewing low performers, reviewing price outliers, and prioritising replenishment';
  if (total) intro += ' — an illustrative ' + F.prize(total.low) + '–' + F.prize(total.high) + ' in additional or protected revenue over 12 weeks.';
  else intro += '.';
  app.appendChild(el('p', { class: 'idx-intro', text: intro }));

  var sec = el('section', null, el('h2', { text: 'Recommendations' }),
    el('p', { class: 'idx-order', text: 'Right assortment → right products → right price → right availability. Select a recommendation for the evidence.' }));
  recs.forEach(function (r) {
    sec.appendChild(el('a', { class: 'idx-card', href: r.page },
      el('div', null,
        el('div', { html: UI.badge('Q' + r.q, 'q') + ' <span class="idx-q">' + UI.esc(r.question) + '</span>' }),
        el('h3', { text: r.action }),
        el('p', { class: 'idx-ev', text: r.evidence })),
      el('div', { class: 'idx-prize' },
        el('b', { text: F.prize(r.prize_low) + ' – ' + F.prize(r.prize_high) }),
        el('span', { text: 'per ' + m.period_weeks + ' weeks · ' + r.prize_unit }),
        el('i', { text: 'illustrative' }))));
  });
  app.appendChild(sec);

  app.appendChild(el('p', { class: 'note', text: total ? total.basis : 'Opportunity ranges are illustrative scenarios, not forecasts.' }));
  app.appendChild(el('p', { class: 'note', html: 'The assumptions and source calculations are on the <a href="method.html">Method page</a>.' }));
})();
