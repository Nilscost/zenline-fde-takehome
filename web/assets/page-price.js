/* Page 3: one consistent price-versus-market review. */
(function () {
  "use strict";
  var D = window.DATA, app = document.getElementById("app");
  if (!D || !app || !window.UI || !window.QuadChart) return;
  var U = UI, F = U.fmt, E = U.el, COL = U.COLORS;
  var rec = D.recs.filter(function (r) { return r.q === 3; })[0];
  var byId = {}, review = {};
  D.skus.forEach(function (s) { byId[s.id] = s; });
  D.lists.price_review.forEach(function (r) { review[r.id] = r; });
  var threshold = (D.thresholds || []).filter(function (t) { return t.key === "price_gap_market"; })[0];
  var gap = threshold ? threshold.value : 0.2;
  var above = "#8e2a6b", below = "#4a6fa5", neutral = "#b8c4cc";
  app.appendChild(E("div", { class: "page-head" },
    E("h1", { text: rec ? rec.action : "Review prices furthest from the market average" }),
    E("p", { class: "sub", text: "Are you selling at the right price? Review products priced at least " + F.share(gap, 0) + " above or below the market realized average; inactive products need a listing decision first." })));
  if (rec) {
    app.appendChild(E("section", { class: "card" },
      E("div", { html: U.badge("Q3", "q") + ' <span class="note">Recommended action</span>' }),
      E("p", { text: rec.evidence }),
      E("h2", { text: rec.prize_high > 0 ? F.prize(rec.prize_low) + " – " + F.prize(rec.prize_high) : 'No positive uplift at unchanged unit sales' }),
      E("p", { class: "note", text: "Illustrative " + rec.prize_unit + " per " + D.meta.period_weeks + " weeks. " + rec.basis })));
  }
  var chartCard = U.card("Our price versus the market average", "Colored products are the same SKUs flagged in the review list: at least ±" + F.share(gap, 0) + " from the market average. Hollow bubbles are inactive. Revenue shows the scale of each product.");
  var chartBox = E("div"); chartCard.appendChild(chartBox); app.appendChild(chartCard);
  chartCard.appendChild(E("p", { class: "caveat", text: "Market average = market revenue ÷ market units for the SKU. This is a realized average price proxy; promotions, pack mix and timing can affect comparability. Bubble size = channel revenue." }));
  var rows = D.lists.price_review.map(function (r) { return Object.assign({}, byId[r.id], r); });
  var signedChange = rows.reduce(function (sum, r) { return sum + r.revenue_change_at_target; }, 0);
  chartCard.appendChild(E('p', { class: 'note', text: 'Moving all flagged products to their market-average proxy would change 12-week revenue by ' + F.prize(signedChange) + ' at unchanged units. Any benefit from lower prices would require additional sales, which this dataset cannot predict.' }));
  var labelIds = {};
  rows.slice().sort(function (a,b) { return Math.abs(b.price_idx_mkt-1)-Math.abs(a.price_idx_mkt-1); }).slice(0,3).forEach(function(r){ labelIds[r.id]=true; });
  function direction(s) { return s.price_idx_mkt > 1 ? "Above market · review reduction" : "Below market · review uplift"; }
  var table;
  var qc = QuadChart.create(chartBox, {
    height: 480,
    x: { label: "Our price ÷ market realized average (1 = in line)", scale: "linear", split: 1, references: [{value:1-gap,label:"−"+F.share(gap,0)},{value:1+gap,label:"+"+F.share(gap,0)}], format: function(v){return F.idx(v);} },
    y: { label: "Channel revenue, " + D.meta.period_weeks + " weeks (log)", scale: "log", format: function(v){return F.eurK(v);} },
    onClick: function(p) { qc.select(p.id); qc.highlight([p.id]); if(table) table.setHighlight(function(r){return r.id===p.id;}); },
    onBackgroundClick: function(){qc.select(null);qc.highlight(null);if(table)table.setHighlight(null);}
  });
  qc.setView({ id: "prices", title: "SKU price comparison", kind: "sku",
    legend: [{label:"Above market · price review",color:above},{label:"Below market · price review",color:below},{label:"Within review threshold",color:neutral},{label:"Inactive",color:COL.inactive,hollow:true}],
    sizeNote: "Review threshold: ≤" + F.idx(1-gap) + " or ≥" + F.idx(1+gap) + " · bubble size = channel revenue",
    points: D.skus.filter(function(s){return s.price_idx_mkt!=null;}).map(function(s){
      return {id:s.id,x:s.price_idx_mkt,y:s.rev,size:s.rev,color:review[s.id]?(s.price_idx_mkt>1?above:below):neutral,hollow:!s.active,label:labelIds[s.id]?s.id:null,
        tip:{title:s.id+" · "+s.name,rows:[["Review",review[s.id]?direction(s):s.active?"Within threshold":"Inactive"],["Our price",F.money(s.price)],["Market realized average",F.money(s.mkt_asp)],["Gap to market",F.pct(s.price_idx_mkt-1)],["Current margin",F.share(s.margin)],["Channel revenue",F.eur(s.rev)],["Market trend",F.pct(s.mk_trend)]]}};
    })
  });
  var reviewCard = U.card("Products for price review", "Test pricing toward the market average. Below-market products offer a potential uplift; above-market products need a demand response before a reduction can pay back.");
  table = U.table(reviewCard, {
    columns: [{key:"id",label:"ID"},{key:"name",label:"Product"},{key:"active",label:"Status",fmt:function(v){return v?'Active':'Inactive · listing review first';}},
      {key:"price_idx_mkt",label:"Review direction",fmt:function(v,r){return direction(r);}},
      {key:"price",label:"Our price",num:true,fmt:function(v){return F.money(v);}},
      {key:"mkt_asp",label:"Market average / target",num:true,fmt:function(v){return F.money(v);}},
      {key:"gap",label:"Gap to market",num:true,sortValue:function(r){return Math.abs(r.price_idx_mkt-1);},fmt:function(v,r){return F.pct(r.price_idx_mkt-1);}},
      {key:"margin",label:"Current margin",num:true,fmt:function(v){return F.share(v);}},
      {key:"margin_at_target",label:"Margin at target",num:true,fmt:function(v){return F.share(v);}},
      {key:"revenue_change_at_target",label:"Revenue change at target",num:true,fmt:function(v){return (v>0?"+":"")+F.prize(v);}},
      {key:"prize_high",label:"Uplift opportunity",num:true,fmt:function(v,r){return r.prize_high>0?F.prize(r.prize_low)+" – "+F.prize(r.prize_high):"Demand case needed";}}],
    rows:rows,sort:{key:"gap",dir:"desc"},maxHeight:520,
    onRowClick:function(r){qc.select(r.id);qc.highlight([r.id]);table.setHighlight(function(s){return s.id===r.id;});chartCard.scrollIntoView({behavior:"smooth",block:"start"});}
  });
  reviewCard.appendChild(E("p", {class:"caveat",text:"Target scenarios hold units and estimated unit cost constant; revenue change is signed and is not a forecast. Uplift opportunity is 50–100% of positive revenue change only. Target margin uses current price × (1 − reported margin) as a cost proxy; validate costs and demand before changing prices."}));
  app.appendChild(reviewCard);
})();
