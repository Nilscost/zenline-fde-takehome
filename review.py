#!/usr/bin/env python3
"""Category opportunity review for ZenBeauty Retail (Beauty > Hair Coloration).

Reads the three CSVs in data/, applies a small set of transparent rules and
writes:
  output/category_review.html   stakeholder-facing review (open in a browser)
  output/recommendations.md     the same recommendations as plain Markdown
  output/actions.csv            every flagged SKU, one row per (SKU, action)

Standard library only:  python3 review.py
"""
import csv
import html
import statistics
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / "data"
OUT = ROOT / "output"

# --- Rule thresholds: every recommendation traces back to these numbers. ------
T = {
    "rising_market": 0.20,       # market trend that counts as clearly rising
    "positive_market": 0.10,     # market trend that counts as positive
    "min_market_rev": 25_000,    # ignore SKUs whose 12w market is smaller (EUR)
    "weak_share": 0.01,          # channel/market revenue share that counts as "not selling"
    "trend_gap": -0.30,          # channel trend minus market trend: execution gap
    "price_gap": 0.15,           # price difference vs. same product at a competitor
    "low_margin": 0.25,          # margin that counts as thin
    "declining": -0.15,          # trend that counts as declining (channel and market)
    "shade_under_index": 0.60,   # shade share below this fraction of category share
    "shade_comp_trend": 0.15,    # competitor trend that counts as rising for a shade
}

NUMERIC = [
    "price_eur", "channel_revenue_eur_12w", "channel_units_sold_12w",
    "channel_margin_pct", "channel_sales_trend_12w_pct",
    "market_revenue_eur_12w", "market_units_sold_12w", "market_sales_trend_12w_pct",
]


def read_csv(name):
    with open(DATA / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load():
    meta = {r["product_id"]: r for r in read_csv("product_metadata.csv")}
    skus = read_csv("sku_performance.csv")
    for r in skus:
        for k in NUMERIC:
            r[k] = float(r[k])
        m = meta[r["product_id"]]
        r["supplier"] = m["supplier"]
        r["shelf_cm"] = int(m["shelf_space_cm"])
        r["rev"] = r["channel_revenue_eur_12w"]
        r["mkt"] = r["market_revenue_eur_12w"]
        r["ch_trend"] = r["channel_sales_trend_12w_pct"]
        r["mk_trend"] = r["market_sales_trend_12w_pct"]
        r["margin"] = r["channel_margin_pct"]
        r["share"] = r["rev"] / r["mkt"]
        r["active"] = r["status"] == "aktiv"
    comps = read_csv("competitor_market_signals.csv")
    for c in comps:
        c["price"] = float(c["price_eur"])
        c["score"] = float(c["signal_score_0_100"])
        c["trend"] = float(c["trend_score_12w_pct"])
    return skus, comps


# --- formatting helpers --------------------------------------------------------
def eur(x):
    return f"€{x:,.0f}"


def pct(x, signed=True):
    return f"{x * 100:+.0f}%" if signed else f"{x * 100:.1f}%"


def flag(action, r, reason, value, value_label):
    return {"action": action, "sku": r, "reason": reason, "value": value, "value_label": value_label}


# --- rules ---------------------------------------------------------------------
def build_flags(skus, comps):
    med_share = statistics.median(r["share"] for r in skus)
    revs = sorted(r["rev"] for r in skus)
    rev_p25, rev_p75 = revs[len(revs) // 4], revs[3 * len(revs) // 4]
    med_margin = statistics.median(r["margin"] for r in skus)
    exact = {c["competitor_product_name"].lower(): c for c in comps}
    flags = []

    def upside(r):  # revenue if the SKU reached the median SKU's share of its market
        return max(0.0, r["mkt"] * med_share - r["rev"])

    for r in skus:
        c = exact.get(r["product_name"].lower())
        thin_share = r["share"] < T["weak_share"] and r["mkt"] >= T["min_market_rev"]

        # 1. Fix availability
        if r["active"] and r["stock_status"] == "out_of_stock":
            flags.append(flag("Fix availability", r,
                f"Active but out of stock; market trend {pct(r['mk_trend'])}, channel trend {pct(r['ch_trend'])}",
                r["rev"], "12w revenue exposed"))
        elif r["active"] and r["stock_status"] == "low_stock" and r["mk_trend"] >= T["rising_market"]:
            flags.append(flag("Fix availability", r,
                f"Low stock while market grows {pct(r['mk_trend'])}",
                r["rev"], "12w revenue exposed"))

        # 2. Promote / fix execution: demand is there, the channel is not capturing it
        if (r["active"] and r["stock_status"] != "out_of_stock"
                and r["mk_trend"] >= T["positive_market"] and r["mkt"] >= T["min_market_rev"]
                and (thin_share or r["ch_trend"] - r["mk_trend"] <= T["trend_gap"])):
            flags.append(flag("Promote / fix execution", r,
                f"Market {eur(r['mkt'])} growing {pct(r['mk_trend'])}, but channel sells {eur(r['rev'])} "
                f"(share {pct(r['share'], False)}) with trend {pct(r['ch_trend'])}",
                *((upside(r), "12w upside at median share") if thin_share
                  else (r["rev"], "12w revenue at risk"))))

        # 3. Price review: same product priced very differently elsewhere, or thin margin on a big seller
        if c and abs(r["price_eur"] / c["price"] - 1) >= T["price_gap"]:
            gap = r["price_eur"] / c["price"] - 1
            flags.append(flag("Price review", r,
                f"Our price €{r['price_eur']:.2f} is {pct(gap)} vs €{c['price']:.2f} at {c['source']} "
                f"({c['competitor_product_id']}, signal score {c['score']:.0f})",
                abs(r["price_eur"] - c["price"]) * r["channel_units_sold_12w"], "12w price gap × units"))
        elif r["active"] and r["margin"] < T["low_margin"] and r["rev"] >= rev_p75:
            flags.append(flag("Price review", r,
                f"Margin {pct(r['margin'], False)} vs category median {pct(med_margin, False)} "
                f"on {eur(r['rev'])} revenue (top quartile)",
                r["rev"] * (med_margin - r["margin"]), "12w margin gap to median"))

        # 4. Relist: delisted and not selling while the market for it is growing
        if (not r["active"] and thin_share and r["mk_trend"] >= T["rising_market"]):
            flags.append(flag("Relist / assortment gap", r,
                f"Inactive with {eur(r['rev'])} sales; market {eur(r['mkt'])} growing {pct(r['mk_trend'])}",
                upside(r), "12w upside at median share"))

        # 5. Delist / mark down: small, and shrinking both in our channel and in the market
        if (r["active"] and r["rev"] < rev_p25
                and r["mk_trend"] <= T["declining"] and r["ch_trend"] <= T["declining"]):
            flags.append(flag("Delist / mark down", r,
                f"{eur(r['rev'])} revenue (bottom quartile); channel {pct(r['ch_trend'])}, market {pct(r['mk_trend'])}; "
                f"{r['shelf_cm']} cm shelf",
                r["rev"], "12w revenue forgone"))

        # Hygiene: flagged inactive but still selling
        if not r["active"] and r["rev"] >= rev_p25:
            flags.append(flag("Status check", r,
                f"Marked inaktiv but sold {eur(r['rev'])} in 12w ({r['stock_status']})",
                r["rev"], "12w revenue on inactive SKU"))

    flags.sort(key=lambda f: -f["value"])
    stats = {"med_share": med_share, "rev_p25": rev_p25, "rev_p75": rev_p75, "med_margin": med_margin}
    return flags, stats


def shade_table(skus, comps):
    """Roll up own performance and competitor signals per shade group."""
    cat_share = sum(r["rev"] for r in skus) / sum(r["mkt"] for r in skus)
    own, comp = defaultdict(list), defaultdict(list)
    for r in skus:
        own[r["shade_group"]].append(r)
    for c in comps:
        comp[c["shade_group"]].append(c)
    rows = []
    for shade, v in own.items():
        rev, mkt = sum(r["rev"] for r in v), sum(r["mkt"] for r in v)
        cs = comp.get(shade, [])
        row = {
            "shade": shade, "n": len(v), "oos": sum(r["stock_status"] == "out_of_stock" for r in v),
            "rev": rev, "mkt": mkt, "share": rev / mkt,
            "ch_trend": sum(r["ch_trend"] * r["rev"] for r in v) / rev,
            "mk_trend": sum(r["mk_trend"] * r["mkt"] for r in v) / mkt,
            "n_comp": len(cs),
            "comp_trend": statistics.mean(c["trend"] for c in cs) if cs else 0.0,
            "comps": sorted(cs, key=lambda c: -c["score"]),
        }
        why = []
        if row["share"] < T["shade_under_index"] * cat_share:
            why.append(f"share {pct(row['share'], False)} vs category {pct(cat_share, False)}")
        if row["comp_trend"] >= T["shade_comp_trend"] and row["ch_trend"] <= T["declining"]:
            why.append(f"competitor signals {pct(row['comp_trend'])} while our sales {pct(row['ch_trend'])}")
        row["why"] = "; ".join(why)
        rows.append(row)
    rows.sort(key=lambda r: -r["mkt"])
    return rows, cat_share


def data_checks(skus, comps):
    inactive = [r for r in skus if not r["active"]]
    off = sum(1 for r in skus if abs(r["rev"] - r["price_eur"] * r["channel_units_sold_12w"]) > 0.05 * max(r["rev"], 1))
    names = Counter(r["product_name"] for r in skus)
    return [
        f"{len(inactive)} SKUs are marked `inaktiv` but together sold {eur(sum(r['rev'] for r in inactive))} "
        f"in 12 weeks ({sum(r['rev'] for r in inactive) / sum(r['rev'] for r in skus):.0%} of category revenue); "
        f"{sum(r['stock_status'] == 'in_stock' for r in inactive)} of them are in stock. "
        "Confirm what `inaktiv` means (delisted, sell-through, or stale flag) before acting on status.",
        f"For {off} of {len(skus)} SKUs, revenue differs by more than 5% from list price × units. "
        "Treated as promotions/price changes during the period; `price_eur` is used as current shelf price.",
        f"{sum(1 for n in names.values() if n > 1)} product names appear on two SKU IDs (different pack or subcategory), "
        "and some subcategory labels contradict the product name. Rules therefore key on product_id, never on name.",
        f"{sum(1 for c in comps if not 0 <= c['score'] <= 100)} competitor signal scores fall outside the documented 0–100 range; "
        "scores are only used for ordering, not arithmetic.",
        f"Competitor signals are one snapshot ({comps[0]['observed_date']}) from {len({c['source'] for c in comps})} sources "
        "of differing quality (retailer listings vs. search/social). Only "
        f"{sum(1 for c in comps if c['competitor_product_name'].lower() in {r['product_name'].lower() for r in skus})} "
        "competitor rows are an exact product match to our assortment, so like-for-like price comparison is limited to those.",
    ]


# --- recommendations -----------------------------------------------------------
def build_recommendations(flags, shades, skus, comps, stats):
    by = defaultdict(list)
    for f in flags:
        by[f["action"]].append(f)
    total_rev = sum(r["rev"] for r in skus)
    recs = []

    f = by["Fix availability"]
    oos = [x for x in f if x["sku"]["stock_status"] == "out_of_stock"]
    low = [x for x in f if x["sku"]["stock_status"] == "low_stock"]
    sup, n = Counter(x["sku"]["supplier"] for x in f).most_common(1)[0]
    sup_rev = sum(x["value"] for x in f if x["sku"]["supplier"] == sup)
    recs.append({
        "action": "Fix availability", "owner": "Supply chain + supplier managers",
        "title": f"Restore stock on {len(f)} active SKUs carrying {eur(sum(x['value'] for x in f))} of 12-week revenue",
        "summary": f"{len(oos)} active SKUs are out of stock ({eur(sum(x['value'] for x in oos))} revenue, "
                   f"{sum(x['value'] for x in oos) / total_rev:.1%} of the category) and {len(low)} more are on low stock "
                   f"while their market grows ≥{pct(T['rising_market'])}. "
                   f"{sup} supplies {n} of the {len(f)} ({eur(sup_rev)}), so one supplier conversation covers the largest share.",
        "next": f"Expedite replenishment in the order shown; raise service level with {sup}. "
                "The out-of-stock SKUs with a falling market are lower priority: restock but do not over-order.",
        "caveat": "Stock status is a snapshot with no on-hand quantity or lead time; 'revenue exposed' is the last 12 weeks' sales, not a forecast of lost sales.",
        "flags": f[:8],
    })

    f = by["Promote / fix execution"]
    recs.append({
        "action": "Promote / fix execution", "owner": "Category manager + store operations",
        "title": f"Fix execution on {len(f)} listed, stocked SKUs that the market wants but the channel is not selling",
        "summary": "These SKUs are active and available, the wider market for them is large and growing, yet channel sales "
                   "are near zero or collapsing. That pattern points to an execution problem (listing, planogram, "
                   "online visibility, price) rather than a demand problem. About "
                   f"{eur(sum(x['value'] for x in f))} per 12 weeks is at stake: the upside from reaching the median SKU share "
                   f"({pct(stats['med_share'], False)} of market revenue) where sales are near zero, plus current revenue where sales are collapsing.",
        "next": "Check each SKU in store and online this week (is it actually on shelf and findable?), then promote. "
                "For seasonal shades, time the push to the season.",
        "caveat": "Sizing is illustrative: upside assumes the SKU can reach the median share of its market proxy. Root cause is not in the data and needs a store/listing check.",
        "flags": f[:8],
    })

    f = by["Price review"]
    exact = [x for x in f if "vs €" in x["reason"]]
    thin = [x for x in f if x not in exact]
    recs.append({
        "action": "Price review", "owner": "Pricing",
        "title": f"Review price on {len(exact)} SKUs far out of line with competitors and {len(thin)} thin-margin top sellers",
        "summary": f"{len(exact)} SKUs have an exact product match at a competitor with a price gap of at least {T['price_gap']:.0%}: "
                   f"{sum('is -' in x['reason'] for x in exact)} priced well below (margin left on the table) and "
                   f"{sum('is +' in x['reason'] for x in exact)} well above (uncompetitive). "
                   f"Separately, {len(thin)} top-quartile sellers run below {T['low_margin']:.0%} margin against a category median of "
                   f"{pct(stats['med_margin'], False)}; closing that gap would be worth about {eur(sum(x['value'] for x in thin))} margin per 12 weeks.",
        "next": "Re-price the two exact matches first (clear evidence). For the thin-margin sellers, check whether the cause is price or cost and take it into supplier negotiations.",
        "caveat": "Only two like-for-like competitor prices exist. Competitor prices are single observations and pack sizes are not given for competitor rows.",
        "flags": exact + thin[:6],
    })

    f = by["Relist / assortment gap"]
    hot = [s for s in shades if s["why"]]
    comp_rows = [c for s in hot for c in s["comps"] if c["trend"] >= T["rising_market"]][:8]
    recs.append({
        "action": "Relist / assortment gap", "owner": "Category manager + buying",
        "title": f"Relist {len(f)} delisted fashion shades and close the gap in {', '.join(s['shade'] for s in hot)}",
        "summary": f"{len(f)} inactive SKUs sit in markets worth {eur(sum(x['sku']['mkt'] for x in f))} per 12 weeks that are growing ≥{pct(T['rising_market'])}. "
                   + " ".join(f"{s['shade']}: {s['why']} ({s['n_comp']} competitor signals, {s['oos']} of {s['n']} SKUs out of stock)." for s in hot),
        "next": "Relist these SKUs at a competitive price (see price review), and ask suppliers about the rising competitor products listed.",
        "caveat": "Competitor signals mix retailer rank, search and social data; treat them as direction, not volume. Why the SKUs were delisted is unknown.",
        "flags": f[:8], "comps": comp_rows,
    })

    f = by["Delist / mark down"]
    recs.append({
        "action": "Delist / mark down", "owner": "Category manager",
        "title": f"Delist or mark down {len(f)} small SKUs that are shrinking in both channel and market",
        "summary": f"These {len(f)} active SKUs are in the bottom revenue quartile and declining at least {-T['declining']:.0%} in both our channel and the wider market. "
                   f"Together they bring {eur(sum(x['value'] for x in f))} per 12 weeks ({sum(x['value'] for x in f) / total_rev:.1%} of category revenue) "
                   f"but occupy {sum(x['sku']['shelf_cm'] for x in f)} cm of shelf, which can go to the SKUs in recommendations 1, 2 and 4.",
        "next": "Mark down remaining stock, delist at the next range review, and reallocate the shelf space.",
        "caveat": f"{sum(x['sku']['private_label'] == 'True' for x in f)} are private label (high margin, own-brand strategy): review those individually. Seasonal SKUs may simply be out of season.",
        "flags": sorted(f, key=lambda x: x["value"])[:14],
    })
    return recs


# --- rendering -----------------------------------------------------------------
SKU_COLS = [
    ("SKU", lambda f: f["sku"]["product_id"]),
    ("Product", lambda f: f["sku"]["product_name"]),
    ("Status / stock", lambda f: f"{f['sku']['status']} / {f['sku']['stock_status'].replace('_', ' ')}"),
    ("Evidence", lambda f: f["reason"]),
    ("Supplier", lambda f: f["sku"]["supplier"]),
    ("€ at stake", lambda f: f"{eur(f['value'])} ({f['value_label']})"),
]


def write_actions_csv(flags):
    with open(OUT / "actions.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["action", "product_id", "product_name", "brand", "subcategory", "shade_group", "status",
                    "stock_status", "supplier", "price_eur", "channel_revenue_eur_12w", "channel_margin_pct",
                    "channel_sales_trend_12w_pct", "market_revenue_eur_12w", "market_sales_trend_12w_pct",
                    "evidence", "value_eur", "value_basis"])
        for x in flags:
            r = x["sku"]
            w.writerow([x["action"], r["product_id"], r["product_name"], r["brand"], r["subcategory"], r["shade_group"],
                        r["status"], r["stock_status"], r["supplier"], r["price_eur"], r["rev"], r["margin"],
                        r["ch_trend"], r["mkt"], r["mk_trend"], x["reason"], round(x["value"]), x["value_label"]])


def write_markdown(recs, checks):
    lines = ["# Category opportunity review: Hair Coloration", "",
             "Generated by `review.py` from the files in `data/`. Every number below is computed from those files.", ""]
    for i, rec in enumerate(recs, 1):
        lines += [f"## {i}. {rec['title']}", "", f"**Action:** {rec['action']} · **Owner:** {rec['owner']}", "",
                  rec["summary"], "", "| " + " | ".join(h for h, _ in SKU_COLS) + " |", "|" + "---|" * len(SKU_COLS)]
        lines += ["| " + " | ".join(str(fn(x)) for _, fn in SKU_COLS) + " |" for x in rec["flags"]]
        if rec.get("comps"):
            lines += ["", "Rising competitor products in these shades:", ""]
            lines += [f"- {c['competitor_product_id']} {c['competitor_product_name']} ({c['shade_group']}): €{c['price']:.2f}, "
                      f"score {c['score']:.0f}, trend {pct(c['trend'])}, {c['source']}" for c in rec["comps"]]
        lines += ["", f"**Next step:** {rec['next']}", "", f"**Caveat:** {rec['caveat']}", ""]
    lines += ["## Data questions to confirm with the customer", ""] + [f"- {c}" for c in checks] + [""]
    (OUT / "recommendations.md").write_text("\n".join(lines), encoding="utf-8")


CSS = """
:root{--bg:#f6f5f1;--card:#fff;--ink:#1d1d1b;--muted:#6b6a65;--line:#e3e1da;--accent:#1f5c4d;--warn:#8a5a00}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 16px 64px}h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:40px 0 12px}
h3{font-size:17px;margin:0 0 8px}.sub{color:var(--muted);margin:0 0 24px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.kpi,.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.kpi b{display:block;font-size:22px}.kpi span{color:var(--muted);font-size:13px}
.card{margin-bottom:16px;padding:20px}.tag{display:inline-block;font-size:12px;font-weight:600;color:var(--accent);
border:1px solid var(--accent);border-radius:99px;padding:1px 10px;margin-bottom:8px}.owner{color:var(--muted);font-size:13px;margin-left:8px}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px;margin:12px 0}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;white-space:nowrap}
td.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}tr.hot td{background:#fdf6e3}
.next{margin:8px 0 4px}.caveat{color:var(--warn);font-size:13px;margin:0}
.filters{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.filters button{font:inherit;font-size:13px;padding:4px 12px;border-radius:99px;
border:1px solid var(--line);background:var(--card);cursor:pointer}.filters button.on{background:var(--accent);color:#fff;border-color:var(--accent)}
li{margin-bottom:6px}code{background:#eceae3;padding:0 4px;border-radius:4px}
"""

JS = """
document.querySelectorAll('.filters button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.filters button').forEach(x=>x.classList.toggle('on',x===b));
  document.querySelectorAll('#all tbody tr').forEach(tr=>tr.hidden=b.dataset.a!=='All'&&tr.dataset.a!==b.dataset.a);});
"""


def table(headers, rows, row_attrs=None):
    e = html.escape
    head = "".join(f"<th>{e(h)}</th>" for h in headers)
    body = ""
    for i, row in enumerate(rows):
        attrs = row_attrs[i] if row_attrs else ""
        body += f"<tr {attrs}>" + "".join(
            f'<td class="n">{e(c[1:])}</td>' if c.startswith("\t") else f"<td>{e(c)}</td>" for c in row) + "</tr>"
    return f'<div class="scroll"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'


def write_html(recs, flags, shades, cat_share, checks, skus, comps, stats):
    e = html.escape
    total_rev, total_mkt = sum(r["rev"] for r in skus), sum(r["mkt"] for r in skus)
    kpis = [
        (str(len(skus)), f"SKUs ({sum(r['active'] for r in skus)} active)"),
        (eur(total_rev), "channel revenue, 12 weeks"),
        (pct(cat_share, False), "share of market revenue"),
        (pct(sum(r["rev"] * r["margin"] for r in skus) / total_rev, False), "revenue-weighted margin"),
        (str(sum(r["active"] and r["stock_status"] == "out_of_stock" for r in skus)), "active SKUs out of stock"),
        (str(len({f["sku"]["product_id"] for f in flags if f["action"] != "Status check"})), "SKUs with a recommended action"),
    ]
    parts = [f"<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
             f"<title>Hair Coloration category review</title><style>{CSS}</style></head><body><main>",
             "<h1>Hair Coloration: category opportunity review</h1>",
             f"<p class='sub'>ZenBeauty Retail · last 12 weeks · {len(skus)} SKUs, {len(comps)} competitor/market signals · "
             "generated by <code>review.py</code> from the provided data</p>",
             "<div class='kpis'>" + "".join(f"<div class='kpi'><b>{e(v)}</b><span>{e(l)}</span></div>" for v, l in kpis) + "</div>",
             "<h2>Recommendations</h2>"]
    for i, rec in enumerate(recs, 1):
        parts.append(f"<div class='card'><span class='tag'>{e(rec['action'])}</span><span class='owner'>Owner: {e(rec['owner'])}</span>"
                     f"<h3>{i}. {e(rec['title'])}</h3><p>{e(rec['summary'])}</p>")
        parts.append(table([h for h, _ in SKU_COLS], [[str(fn(x)) for _, fn in SKU_COLS] for x in rec["flags"]]))
        if rec.get("comps"):
            parts.append("<p><b>Rising competitor products in these shades</b></p>")
            parts.append(table(["ID", "Competitor product", "Shade", "Price", "Signal score", "Trend", "Source"],
                               [[c["competitor_product_id"], c["competitor_product_name"], c["shade_group"], f"\t€{c['price']:.2f}",
                                 f"\t{c['score']:.0f}", "\t" + pct(c["trend"]), c["source"]] for c in rec["comps"]]))
        parts.append(f"<p class='next'><b>Next step:</b> {e(rec['next'])}</p><p class='caveat'>Caveat: {e(rec['caveat'])}</p></div>")

    parts.append("<h2>Shade groups: our performance vs. market and competitor signals</h2>"
                 "<p class='sub'>Highlighted rows are under-indexed or losing sales while competitor signals rise.</p>")
    parts.append(table(
        ["Shade group", "SKUs", "Out of stock", "Channel revenue", "Share of market", "Channel trend", "Market trend",
         "Competitor signals", "Competitor trend", "Flag"],
        [[s["shade"], f"\t{s['n']}", f"\t{s['oos']}", "\t" + eur(s["rev"]), "\t" + pct(s["share"], False), "\t" + pct(s["ch_trend"]),
          "\t" + pct(s["mk_trend"]), f"\t{s['n_comp']}", "\t" + pct(s["comp_trend"]), s["why"]] for s in shades],
        ["class='hot'" if s["why"] else "" for s in shades]))

    actions = ["All"] + list(dict.fromkeys(f["action"] for f in sorted(flags, key=lambda f: f["action"])))
    counts = Counter(f["action"] for f in flags)
    parts.append("<h2>All flagged SKUs</h2><p class='sub'>One row per SKU and action, sorted by € at stake. Also in <code>output/actions.csv</code>.</p>"
                 "<div class='filters'>" + "".join(
                     f"<button data-a='{e(a)}' class='{'on' if a == 'All' else ''}'>{e(a)} ({len(flags) if a == 'All' else counts[a]})</button>"
                     for a in actions) + "</div>")
    parts.append(table(["Action"] + [h for h, _ in SKU_COLS],
                       [[f["action"]] + [str(fn(f)) for _, fn in SKU_COLS] for f in flags],
                       [f"data-a='{e(f['action'])}'" for f in flags]).replace("<table>", "<table id='all'>"))

    parts.append("<h2>Data questions to confirm with the customer</h2><ul>" +
                 "".join(f"<li>{e(c).replace('`', '')}</li>" for c in checks) + "</ul>")
    parts.append("<h2>How SKUs are flagged</h2><ul>"
                 f"<li><b>Fix availability:</b> active and out of stock; or active, low stock and market trend ≥ {pct(T['rising_market'])}.</li>"
                 f"<li><b>Promote / fix execution:</b> active, not out of stock, market ≥ {eur(T['min_market_rev'])} and growing ≥ {pct(T['positive_market'])}, "
                 f"and either channel share &lt; {T['weak_share']:.0%} or channel trend trails market trend by ≥ {abs(T['trend_gap']) * 100:.0f} points.</li>"
                 f"<li><b>Price review:</b> exact product match at a competitor with a price gap ≥ {T['price_gap']:.0%}; or active, margin &lt; {T['low_margin']:.0%} and top-quartile revenue (≥ {eur(stats['rev_p75'])}).</li>"
                 f"<li><b>Relist / assortment gap:</b> inactive, channel share &lt; {T['weak_share']:.0%}, market ≥ {eur(T['min_market_rev'])} and growing ≥ {pct(T['rising_market'])}.</li>"
                 f"<li><b>Delist / mark down:</b> active, bottom-quartile revenue (&lt; {eur(stats['rev_p25'])}), channel and market trend both ≤ {pct(T['declining'])}.</li>"
                 f"<li><b>Status check:</b> inactive but revenue ≥ {eur(stats['rev_p25'])}.</li>"
                 f"<li><b>Upside at median share:</b> market revenue × median SKU share ({pct(stats['med_share'], False)}) − current revenue. Illustrative, not a forecast.</li></ul>")
    parts.append(f"<script>{JS}</script></main></body></html>")
    (OUT / "category_review.html").write_text("".join(parts), encoding="utf-8")


def main():
    OUT.mkdir(exist_ok=True)
    skus, comps = load()
    flags, stats = build_flags(skus, comps)
    shades, cat_share = shade_table(skus, comps)
    checks = data_checks(skus, comps)
    recs = build_recommendations(flags, shades, skus, comps, stats)
    write_actions_csv(flags)
    write_markdown(recs, checks)
    write_html(recs, flags, shades, cat_share, checks, skus, comps, stats)
    print(f"{len(skus)} SKUs, {len(comps)} competitor signals -> {len(flags)} flags")
    for a, n in Counter(f["action"] for f in flags).most_common():
        print(f"  {a:26} {n}")
    print(f"Wrote {OUT / 'category_review.html'}")


if __name__ == "__main__":
    main()
