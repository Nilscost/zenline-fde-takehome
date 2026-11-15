#!/usr/bin/env python3
"""Category opportunity review for ZenBeauty Retail (Beauty > Hair Coloration).

Reads the three CSVs in data/, applies a small set of transparent rules and writes:
  output/<copy of web/>          the interactive multi-page site (hand-written, in web/)
  output/assets/data.js          window.DATA: every number the site shows
  output/recommendations.md      the recommendations as plain Markdown
  output/actions.csv             every flagged item, one row per (item, list)

Standard library only:  python3 review.py
"""
import csv
import json
import shutil
import statistics
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / "data"
OUT = ROOT / "output"
GENERATED = "2026-11-15"

# --- Business thresholds: every list and prize traces back to these numbers. ---
T = {
    "min_market_rev": 25_000,     # ignore SKUs/cells whose 12-week market revenue is smaller (EUR)
    "positive_market": 0.10,      # market trend that counts as positive
    "rising_market": 0.20,        # market trend that counts as clearly rising
    "declining": -0.15,           # trend that counts as declining (channel and market)
    "comp_popular_score": 50,     # competitor signal score that counts as popular (0-100)
    "comp_rising_trend": 0.15,    # competitor trend that counts as rising
    "gap_max_coverage": 1,        # a cell with at most this many active, in-stock SKUs has thin coverage
    "under_share_ratio": 0.60,    # cell share below this fraction of category share = under-performing
    "weak_share": 0.01,           # channel/market revenue share that counts as "not selling"
    "under_index": 0.25,          # fair-share index at or below this = under-indexed vs market demand
    "trend_gap": -0.30,           # channel trend minus market trend: losing ground vs the market
    "price_gap_exact": 0.15,      # price gap vs the identical product at a competitor
    "price_gap_market": 0.20,     # price gap vs the market average selling price
    "low_margin": 0.25,           # margin that counts as thin
    "prize_low_recovery": 0.5,    # prize, low case: share of the revenue/margin at stake that is recovered
    "prize_high_recovery": 1.0,   # prize, high case: share of the revenue/margin at stake that is recovered
    "prize_high_lowstock": 0.25,  # prize, high case: share of low-stock revenue in rising markets at stake
}
# label, unit and the pages that use each threshold (shown on the Method page).
TM = {
    "min_market_rev": ("Smallest 12-week market worth acting on", "eur", ["Assortment", "Products"]),
    "positive_market": ("Market trend that counts as positive", "pct", ["Products", "Price"]),
    "rising_market": ("Market trend that counts as clearly rising", "pct", ["Assortment", "Availability"]),
    "declining": ("Trend that counts as declining (channel and market)", "pct", ["Products"]),
    "comp_popular_score": ("Competitor signal score that counts as popular", "score", ["Assortment"]),
    "comp_rising_trend": ("Competitor trend that counts as rising", "pct", ["Assortment"]),
    "gap_max_coverage": ("Active, in-stock SKUs at or below which a cell has thin coverage", "count", ["Assortment"]),
    "under_share_ratio": ("Cell share below this fraction of category share = under-performing", "ratio", ["Assortment"]),
    "weak_share": ("Revenue share of market that counts as not selling", "pct", ["Assortment", "Products"]),
    "under_index": ("Fair-share index at or below which a SKU is under-indexed", "ratio", ["Products"]),
    "trend_gap": ("Channel trend minus market trend that counts as losing ground", "pct", ["Products", "Price"]),
    "price_gap_exact": ("Price gap vs the identical competitor product", "pct", ["Price"]),
    "price_gap_market": ("Price gap vs the market average selling price", "pct", ["Price"]),
    "low_margin": ("Margin that counts as thin", "pct", ["Price"]),
    "prize_low_recovery": ("Prize, low case: share of the amount at stake that is recovered", "ratio", ["Recommendations"]),
    "prize_high_recovery": ("Prize, high case: share of the amount at stake that is recovered", "ratio", ["Recommendations"]),
    "prize_high_lowstock": ("Prize, high case: share of low-stock revenue in rising markets", "ratio", ["Availability"]),
}
REC_SORT = "prize"  # "prize" = largest high-end prize first; "question" = question order 1-4

MONEY_KEYS = {"price", "rev", "mkt_rev", "mkt_asp", "prize_low", "prize_high", "total_rev", "total_mkt_rev",
              "comp_price", "client_price_median", "comp_price_median", "rev_in", "rev_low", "rev_oos",
              "rev_exposed", "median_sku_rev", "rev_p25", "rev_p75", "median_cell_rev", "x_split_rev"}

OWNERS = {1: "Category manager + buying", 2: "Category manager + store operations", 3: "Pricing",
          4: "Supply chain + supplier managers"}
QUESTIONS = {1: "Do you have the right assortment?", 2: "Are you selling the right products?",
             3: "Are you selling at the right price?", 4: "Are the products available?"}
PAGES = {1: "assortment.html", 2: "products.html", 3: "price.html", 4: "availability.html"}


# --- formatting helpers ---------------------------------------------------------
def eur(x):
    return f"€{x:,.0f}"


def pct(x, dp=0):
    return f"{x * 100:+.{dp}f}%".replace("-", "−")


def share(x, dp=1):
    return f"{x * 100:.{dp}f}%"


def div(a, b):
    return a / b if b else None


def plural(n, word, many=None):
    return f"{n} {word if n == 1 else (many or word + 's')}"


def stock_label(s):
    return s.replace("_", " ")


# --- 1. load -----------------------------------------------------------------------
def read_csv(name):
    with open(DATA / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load():
    """Join the SKU performance and metadata files on product_id (names repeat, IDs do not)."""
    meta = {r["product_id"]: r for r in read_csv("product_metadata.csv")}
    skus = []
    for r in read_csv("sku_performance.csv"):
        m = meta[r["product_id"]]
        skus.append({
            "id": r["product_id"], "name": r["product_name"], "brand": r["brand"], "sub": r["subcategory"],
            "shade": r["shade_group"], "cell": f"{r['subcategory']}|{r['shade_group']}", "season": r["seasonality"],
            "status": r["status"], "active": r["status"] == "aktiv", "stock": r["stock_status"],
            "pl": r["private_label"] == "True", "supplier": m["supplier"], "pack": r["pack_size"],
            "shelf_cm": int(m["shelf_space_cm"]), "price": float(r["price_eur"]),
            "rev": float(r["channel_revenue_eur_12w"]), "units": int(float(r["channel_units_sold_12w"])),
            "margin": float(r["channel_margin_pct"]), "ch_trend": float(r["channel_sales_trend_12w_pct"]),
            "mkt_rev": float(r["market_revenue_eur_12w"]), "mkt_units": int(float(r["market_units_sold_12w"])),
            "mk_trend": float(r["market_sales_trend_12w_pct"]),
        })
    comps = []
    for r in read_csv("competitor_market_signals.csv"):
        comps.append({
            "id": r["competitor_product_id"], "name": r["competitor_product_name"], "brand": r["brand"],
            "sub": r["subcategory"], "shade": r["shade_group"], "cell": f"{r['subcategory']}|{r['shade_group']}",
            "price": float(r["price_eur"]), "rank": float(r["rank_or_popularity_signal"]),
            "score": float(r["signal_score_0_100"]), "source": r["source"], "trend": float(r["trend_score_12w_pct"]),
            "observed": r["observed_date"],
        })
    for c in comps:
        c["hot"] = c["score"] >= T["comp_popular_score"] and c["trend"] >= T["comp_rising_trend"]
    return skus, comps


# --- 2. SKU metrics ----------------------------------------------------------------
def sku_metrics(skus, comps):
    """Add share / index / price fields to every SKU; return category-level statistics."""
    tot = {k: sum(s[k] for s in skus) for k in ("rev", "units", "mkt_rev", "mkt_units", "shelf_cm")}
    active = [s for s in skus if s["active"]]
    # Percentiles: statistics.quantiles(n=4, method="inclusive") for p25/p75, statistics.median for medians.
    S = {
        "total_rev": tot["rev"], "total_units": tot["units"], "total_mkt_rev": tot["mkt_rev"],
        "total_mkt_units": tot["mkt_units"], "total_shelf_cm": tot["shelf_cm"],
        "cat_share": tot["rev"] / tot["mkt_rev"],
        "weighted_margin": sum(s["rev"] * s["margin"] for s in skus) / tot["rev"],
        "sku_share_p25": statistics.quantiles([s["rev"] / s["mkt_rev"] for s in active], n=4, method="inclusive")[0],
        "sku_share_median": statistics.median(s["rev"] / s["mkt_rev"] for s in active),
        "median_margin": statistics.median(s["margin"] for s in skus),
        "rev_p25": statistics.quantiles([s["rev"] for s in skus], n=4, method="inclusive")[0],
        "rev_p75": statistics.quantiles([s["rev"] for s in skus], n=4, method="inclusive")[2],
        "median_mkt_unit_share": statistics.median(s["mkt_units"] / tot["mkt_units"] for s in skus),
        "median_sku_rev": statistics.median(s["rev"] for s in skus),
    }
    by_cell = defaultdict(list)
    for c in comps:
        by_cell[c["cell"]].append(c["price"])
    by_name = {}
    for c in comps:
        by_name.setdefault(c["name"].lower(), c)
    sku_by_name = {}
    for s in skus:
        sku_by_name.setdefault(s["name"].lower(), s["id"])
    for c in comps:
        c["match_sku"] = sku_by_name.get(c["name"].lower())
    for s in skus:
        s["share"] = s["rev"] / s["mkt_rev"]
        s["mkt_unit_share"] = s["mkt_units"] / tot["mkt_units"]
        s["ch_unit_share"] = s["units"] / tot["units"]
        s["shelf_share"] = s["shelf_cm"] / tot["shelf_cm"]
        s["fair_index"] = div(s["ch_unit_share"], s["mkt_unit_share"])
        s["shelf_index"] = div(s["shelf_share"], s["mkt_unit_share"])
        s["mkt_asp"] = div(s["mkt_rev"], s["mkt_units"])
        s["price_idx_mkt"] = div(s["price"], s["mkt_asp"]) if s["mkt_asp"] else None
        med = statistics.median(by_cell[s["cell"]]) if by_cell.get(s["cell"]) else None
        s["price_idx_comp"] = div(s["price"], med)
        s["trend_gap"] = s["ch_trend"] - s["mk_trend"]
        c = by_name.get(s["name"].lower())
        s["match"] = ({"comp_id": c["id"], "comp_name": c["name"], "comp_price": c["price"], "source": c["source"],
                       "gap": s["price"] / c["price"] - 1} if c else None)
        s["lists"], s["price_signals"], s["price_tier"] = [], [], None
    return S


# --- 3. cells, brands, suppliers ---------------------------------------------------
def wavg(rows, key, weight):
    w = sum(r[weight] for r in rows)
    return sum(r[key] * r[weight] for r in rows) / w if w else None


def build_cells(skus, comps, S):
    sk, cm = defaultdict(list), defaultdict(list)
    for s in skus:
        sk[s["cell"]].append(s)
    for c in comps:
        cm[c["cell"]].append(c)
    cells = []
    for key in sorted(set(sk) | set(cm)):
        v, cs = sk.get(key, []), cm.get(key, [])
        sub, shade = key.split("|")
        rev, units = sum(s["rev"] for s in v), sum(s["units"] for s in v)
        mkt_rev, mkt_units = sum(s["mkt_rev"] for s in v), sum(s["mkt_units"] for s in v)
        cell = {
            "key": key, "sub": sub, "shade": shade, "n_skus": len(v),
            "n_active": sum(s["active"] for s in v), "n_inactive": sum(not s["active"] for s in v),
            "n_oos": sum(s["stock"] == "out_of_stock" for s in v), "n_low": sum(s["stock"] == "low_stock" for s in v),
            "coverage": sum(s["active"] and s["stock"] != "out_of_stock" for s in v),
            "rev": rev, "units": units, "mkt_rev": mkt_rev, "mkt_units": mkt_units,
            "ch_trend": wavg(v, "ch_trend", "rev") if rev else None,
            "mk_trend": wavg(v, "mk_trend", "mkt_rev") if v else None,
            "share": div(rev, mkt_rev),
            "shelf_cm": sum(s["shelf_cm"] for s in v),
            "mkt_unit_share": mkt_units / S["total_mkt_units"], "ch_unit_share": units / S["total_units"],
            "price_idx_mkt": statistics.mean(s["price_idx_mkt"] for s in v) if v else None,
            "client_price_median": statistics.median(s["price"] for s in v) if v else None,
            "n_comp": len(cs), "n_hot": sum(c["hot"] for c in cs),
            "comp_score_mean": statistics.mean(c["score"] for c in cs) if cs else None,
            "comp_trend_mean": statistics.mean(c["trend"] for c in cs) if cs else None,
            "comp_rank_best": min(c["rank"] for c in cs) if cs else None,
            "comp_price_median": statistics.median(c["price"] for c in cs) if cs else None,
            "sku_ids": [s["id"] for s in v], "comp_ids": [c["id"] for c in cs],
        }
        cell["shelf_share"] = cell["shelf_cm"] / S["total_shelf_cm"]
        cell["fair_index"] = div(cell["ch_unit_share"], cell["mkt_unit_share"]) if v else None
        cell["trend_gap"] = (cell["ch_trend"] - cell["mk_trend"]
                             if cell["ch_trend"] is not None and cell["mk_trend"] is not None else None)
        cell["price_idx_comp"] = div(cell["client_price_median"], cell["comp_price_median"]) \
            if cell["client_price_median"] and cell["comp_price_median"] else None
        cell["gap"] = cell["n_hot"] >= 1 and cell["coverage"] <= T["gap_max_coverage"]
        hot_txt = f"{plural(cell['n_hot'], 'hot competitor product')} (popular and rising)"
        if not cell["gap"]:
            cell["gap_reason"] = ""
        elif cell["n_skus"] == 0:
            cell["gap_reason"] = f"{hot_txt}; we list no SKU in this cell"
        else:
            cell["gap_reason"] = (f"{hot_txt}; only {plural(cell['coverage'], 'active, available SKU')} "
                                  f"of our {cell['n_skus']} in the cell")
        cell["under"] = bool(cell["share"] is not None and cell["share"] < T["under_share_ratio"] * S["cat_share"]
                             and mkt_rev >= T["min_market_rev"])
        cell["under_reason"] = (f"Share {share(cell['share'])} of a {eur(mkt_rev)} market vs {share(S['cat_share'])} for the "
                                f"category (threshold {share(T['under_share_ratio'] * S['cat_share'])})") if cell["under"] else ""
        cells.append(cell)
    return cells


def build_brands(skus, S):
    g = defaultdict(list)
    for s in skus:
        g[s["brand"]].append(s)
    out = []
    for b, v in sorted(g.items()):
        rev, units = sum(s["rev"] for s in v), sum(s["units"] for s in v)
        mkt_rev, mkt_units = sum(s["mkt_rev"] for s in v), sum(s["mkt_units"] for s in v)
        row = {"key": b, "n_skus": len(v), "n_active": sum(s["active"] for s in v), "rev": rev, "units": units,
               "mkt_rev": mkt_rev, "mkt_units": mkt_units,
               "ch_trend": wavg(v, "ch_trend", "rev") if rev else None, "mk_trend": wavg(v, "mk_trend", "mkt_rev"),
               "share": div(rev, mkt_rev), "mkt_unit_share": mkt_units / S["total_mkt_units"],
               "ch_unit_share": units / S["total_units"],
               "shelf_share": sum(s["shelf_cm"] for s in v) / S["total_shelf_cm"],
               "price_idx_mkt": statistics.mean(s["price_idx_mkt"] for s in v), "sku_ids": [s["id"] for s in v]}
        row["fair_index"] = div(row["ch_unit_share"], row["mkt_unit_share"])
        row["trend_gap"] = row["ch_trend"] - row["mk_trend"] if row["ch_trend"] is not None else None
        out.append(row)
    return out


def build_suppliers(skus):
    """Stock mix is counted on ACTIVE SKUs (inactive SKUs are not expected to be on shelf)."""
    g = defaultdict(list)
    for s in skus:
        g[s["supplier"]].append(s)
    out = []
    for name, v in g.items():
        a = [s for s in v if s["active"]]
        part = {k: [s for s in a if s["stock"] == k] for k in ("in_stock", "low_stock", "out_of_stock")}
        row = {"name": name, "n": len(v), "n_active": len(a), "n_in": len(part["in_stock"]),
               "n_low": len(part["low_stock"]), "n_oos": len(part["out_of_stock"]),
               "oos_rate": div(len(part["out_of_stock"]), len(a)), "low_rate": div(len(part["low_stock"]), len(a)),
               "rev": sum(s["rev"] for s in v), "rev_in": sum(s["rev"] for s in part["in_stock"]),
               "rev_low": sum(s["rev"] for s in part["low_stock"]), "rev_oos": sum(s["rev"] for s in part["out_of_stock"]),
               "n_restock": sum("restock" in s["lists"] for s in v), "sku_ids": [s["id"] for s in v]}
        row["rev_exposed"] = row["rev_low"] + row["rev_oos"]
        out.append(row)
    out.sort(key=lambda r: -r["rev_exposed"])
    return out


# --- 4. lists and prizes -----------------------------------------------------------
def price_signals(s, S):
    """Return [(signal, direction)] for one SKU; direction is "above" or "below"."""
    sig, m = [], s["match"]
    if m and abs(m["gap"]) >= T["price_gap_exact"]:
        d = "above" if m["gap"] > 0 else "below"
        sig.append(({"code": "exact", "label": f"Priced {d} the identical competitor product",
                     "detail": f"€{s['price']:.2f} vs €{m['comp_price']:.2f} at {m['source']} ({m['comp_id']}), {pct(m['gap'])}"}, d))
    if s["price_idx_mkt"] is not None and abs(s["price_idx_mkt"] - 1) >= T["price_gap_market"]:
        d = "above" if s["price_idx_mkt"] > 1 else "below"
        sig.append(({"code": "market", "label": f"Priced {d} the market average",
                     "detail": f"€{s['price']:.2f} vs market average €{s['mkt_asp']:.2f}, {pct(s['price_idx_mkt'] - 1)}"}, d))
    if s["mk_trend"] >= T["positive_market"] and s["trend_gap"] <= T["trend_gap"]:
        sig.append(({"code": "trend", "label": "Losing ground while the market grows",
                     "detail": f"Channel trend {pct(s['ch_trend'])} vs market {pct(s['mk_trend'])}"}, "above"))
    if s["active"] and s["margin"] < T["low_margin"] and s["rev"] >= S["rev_p75"]:
        sig.append(({"code": "margin", "label": "Thin margin on a big seller",
                     "detail": f"Margin {share(s['margin'])} on {eur(s['rev'])} revenue (top quartile, from {eur(S['rev_p75'])})"}, "below"))
    return sig


def build_lists(skus, cells, S):
    p25, med = S["sku_share_p25"], S["sku_share_median"]
    lo_r, hi_r = T["prize_low_recovery"], T["prize_high_recovery"]
    L = {"gaps": [], "under_cells": [], "not_pushed": [], "low_perf": [], "price_review": [], "restock": []}
    gap_skus = []
    for s in skus:
        # Q1 (a) SKU-level gap: delisted, not selling, in a rising market
        if (not s["active"] and s["share"] < T["weak_share"] and s["mkt_rev"] >= T["min_market_rev"]
                and s["mk_trend"] >= T["rising_market"]):
            s["lists"].append("relist")
            gap_skus.append({
                "type": "sku", "key": s["cell"], "sku_id": s["id"],
                "reason": f"Inactive with {eur(s['rev'])} sales ({share(s['share'])}) in a {eur(s['mkt_rev'])} market growing {pct(s['mk_trend'])}",
                "prize_low": max(s["mkt_rev"] * p25 - s["rev"], 0.0), "prize_high": max(s["mkt_rev"] * med - s["rev"], 0.0)})
        # Q2 not pushed enough
        if (s["active"] and s["stock"] != "out_of_stock" and s["mkt_rev"] >= T["min_market_rev"]
                and s["mk_trend"] >= T["positive_market"]
                and (s["fair_index"] <= T["under_index"] or s["trend_gap"] <= T["trend_gap"])):
            s["lists"].append("not_pushed")
            tg = s["trend_gap"] <= T["trend_gap"]
            L["not_pushed"].append({
                "id": s["id"],
                "reason": f"Market {eur(s['mkt_rev'])} growing {pct(s['mk_trend'])}; channel sells {eur(s['rev'])} ({share(s['share'])} of market) with trend {pct(s['ch_trend'])}",
                "prize_low": max(s["mkt_rev"] * p25 - s["rev"], lo_r * s["rev"] if tg else 0.0),
                "prize_high": max(s["mkt_rev"] * med - s["rev"], hi_r * s["rev"] if tg else 0.0)})
        # Q2 low performing
        if (s["active"] and s["rev"] < S["rev_p25"] and s["ch_trend"] <= T["declining"] and s["mk_trend"] <= T["declining"]):
            s["lists"].append("low_perf")
            L["low_perf"].append({
                "id": s["id"],
                "reason": f"{eur(s['rev'])} revenue (bottom quartile, below {eur(S['rev_p25'])}); channel {pct(s['ch_trend'])}, market {pct(s['mk_trend'])}; {s['shelf_cm']} cm shelf"})
        # Q3 price review
        sig = price_signals(s, S)
        if sig:
            dirs = [d for _, d in sig]
            codes = [x["code"] for x, _ in sig]
            story = dirs[0] if len(set(dirs)) == 1 else "mixed"
            tier = "Confirmed" if "exact" in codes or max(dirs.count("above"), dirs.count("below")) >= 2 else "Flag"
            at_stake = 0.0
            m = s["match"]
            if "exact" in codes and m["gap"] < 0:
                at_stake += (m["comp_price"] - s["price"]) * s["units"]
            if "margin" in codes:
                at_stake += max(S["median_margin"] - s["margin"], 0.0) * s["rev"]
            s["lists"].append("price_review")
            s["price_signals"], s["price_tier"] = codes, tier
            L["price_review"].append({"id": s["id"], "tier": tier, "story": story, "signals": [x for x, _ in sig],
                                      "prize_low": lo_r * at_stake, "prize_high": hi_r * at_stake})
        # Q4 restock
        oos = s["active"] and s["stock"] == "out_of_stock"
        low = s["active"] and s["stock"] == "low_stock" and s["mk_trend"] >= T["rising_market"]
        if oos or low:
            s["lists"].append("restock")
            L["restock"].append({
                "id": s["id"],
                "reason": (f"Active but out of stock; {eur(s['rev'])} revenue in 12 weeks, market {pct(s['mk_trend'])}" if oos else
                           f"Low stock while the market grows {pct(s['mk_trend'])}; {eur(s['rev'])} revenue in 12 weeks"),
                "prize_low": lo_r * s["rev"] if oos else 0.0,
                "prize_high": hi_r * s["rev"] if oos else T["prize_high_lowstock"] * s["rev"]})
    # Q1 (b) under-performing cells: prize on the cell's SKUs excluding SKUs counted in other prizes
    counted = {s["id"] for s in skus if set(s["lists"]) & {"relist", "not_pushed", "restock", "price_review"}}
    sk = {s["id"]: s for s in skus}
    for c in cells:
        if c["under"]:
            v = [sk[i] for i in c["sku_ids"] if i not in counted]
            target = T["under_share_ratio"] * S["cat_share"] * sum(s["mkt_rev"] for s in v)
            L["under_cells"].append({"key": c["key"], "reason": c["under_reason"], "share": c["share"],
                                     "prize_low": 0.0, "prize_high": max(target - sum(s["rev"] for s in v), 0.0)})
    gap_cells = [{"type": "cell", "key": c["key"], "reason": c["gap_reason"], "n_hot": c["n_hot"],
                  "coverage": c["coverage"], "comp_ids": c["comp_ids"]}
                 for c in sorted((c for c in cells if c["gap"]), key=lambda c: -c["n_hot"])]
    L["gaps"] = gap_cells + sorted(gap_skus, key=lambda g: -g["prize_high"])
    L["under_cells"].sort(key=lambda x: -x["prize_high"])
    L["not_pushed"].sort(key=lambda x: -x["prize_high"])
    L["low_perf"].sort(key=lambda x: sk[x["id"]]["rev"])
    L["price_review"].sort(key=lambda x: (x["tier"] != "Confirmed", -x["prize_high"], -sk[x["id"]]["rev"]))
    L["restock"].sort(key=lambda x: -sk[x["id"]]["rev"])
    return L


# --- 5. recommendations ------------------------------------------------------------
def build_recs(skus, cells, suppliers, L, S):
    sk = {s["id"]: s for s in skus}
    relist = [g for g in L["gaps"] if g["type"] == "sku"]
    gap_cells = [g for g in L["gaps"] if g["type"] == "cell"]
    p25, med = share(S["sku_share_p25"]), share(S["sku_share_median"])
    lo_r, hi_r = T["prize_low_recovery"], T["prize_high_recovery"]
    recs = []

    # Q1
    rs = [sk[g["sku_id"]] for g in relist]
    low = sum(g["prize_low"] for g in relist)
    high = sum(g["prize_high"] for g in relist) + sum(u["prize_high"] for u in L["under_cells"])
    ids = " and ".join(s["id"] for s in rs[:3])
    evidence = (f"{ids} sit in markets worth {eur(sum(s['mkt_rev'] for s in rs))} growing at least {pct(min(s['mk_trend'] for s in rs))}, "
                f"with {eur(sum(s['rev'] for s in rs))} of channel sales" if rs else
                f"{plural(len(gap_cells), 'cell')} have hot competitor products but at most {T['gap_max_coverage']} in-stock SKU")
    recs.append({
        "q": 1, "action": f"Relist {plural(len(relist), 'delisted high-demand SKU')} and close {plural(len(gap_cells), 'assortment gap')}; "
                          f"lift {plural(len(L['under_cells']), 'under-performing cell')}",
        "evidence": evidence, "prize_low": low, "prize_high": high, "prize_unit": "revenue",
        "basis": f"Low: relist SKUs reach the 25th-percentile SKU share ({p25}) of their market. "
                 f"High: relist SKUs reach the median SKU share ({med}) and under-performing cells lift to {share(T['under_share_ratio'] * S['cat_share'])} share "
                 f"({T['under_share_ratio']:.0%} of category share {share(S['cat_share'])}), excluding SKUs counted in other recommendations."})

    # Q2
    np_ = L["not_pushed"]
    top = sk[np_[0]["id"]] if np_ else None
    recs.append({
        "q": 2, "action": f"Push {plural(len(np_), 'under-sold SKU')} in growing markets and review {plural(len(L['low_perf']), 'low performer')}",
        "evidence": (f"{top['id']} has a {eur(top['mkt_rev'])} market growing {pct(top['mk_trend'])}, but the channel sells {eur(top['rev'])} "
                     f"({share(top['share'])} of market) with trend {pct(top['ch_trend'])}" if top else "No SKU meets the not-pushed rule"),
        "prize_low": sum(x["prize_low"] for x in np_), "prize_high": sum(x["prize_high"] for x in np_), "prize_unit": "revenue",
        "basis": f"Low: not-pushed SKUs reach the 25th-percentile SKU share ({p25}) of their market, or keep {lo_r:.0%} of current revenue where the channel trails the market by {abs(T['trend_gap']) * 100:.0f}+ points (the larger). "
                 f"High: median SKU share ({med}), or {hi_r:.0%} of current revenue where sales are collapsing (the larger)."})

    # Q3
    pr = L["price_review"]
    n_conf = sum(p["tier"] == "Confirmed" for p in pr)
    ex = [sk[p["id"]] for p in pr if sk[p["id"]]["match"] and "exact" in sk[p["id"]]["price_signals"]]
    ex.sort(key=lambda s: (-(s["units"] > 0), -abs(s["match"]["gap"])))  # prefer a match that actually sells
    e = ex[0] if ex else None
    recs.append({
        "q": 3, "action": f"Review price on {plural(n_conf, 'confirmed SKU')} and check {plural(len(pr) - n_conf, 'more flagged SKU')}",
        "evidence": (f"{e['id']} is priced at €{e['price']:.2f}, {pct(e['match']['gap'])} vs the identical product at {e['match']['source']} "
                     f"(€{e['match']['comp_price']:.2f}, {e['match']['comp_id']})" if e else "No SKU has a large gap to an identical competitor product"),
        "prize_low": sum(p["prize_low"] for p in pr), "prize_high": sum(p["prize_high"] for p in pr), "prize_unit": "gross margin",
        "basis": f"Low: {lo_r:.0%} of the gross margin at stake. High: {hi_r:.0%} of it. At stake = (competitor price − our price) × units for identical products priced "
                 f"{T['price_gap_exact']:.0%}+ below a competitor, plus (median margin {share(S['median_margin'])} − margin) × revenue for thin-margin big sellers."})

    # Q4
    rl = L["restock"]
    oos = [sk[x["id"]] for x in rl if sk[x["id"]]["stock"] == "out_of_stock"]
    lows = [sk[x["id"]] for x in rl if sk[x["id"]]["stock"] == "low_stock"]
    oos_rev, low_rev = sum(s["rev"] for s in oos), sum(s["rev"] for s in lows)
    sup = suppliers[0]
    exposed = sum(s["rev_exposed"] for s in suppliers)
    recs.append({
        "q": 4, "action": f"Restock {plural(len(oos), 'out-of-stock SKU')} and {plural(len(lows), 'low-stock SKU')} in rising markets; start with {sup['name']}",
        "evidence": f"{plural(len(oos), 'active SKU')} out of stock carry {eur(oos_rev)} of 12-week revenue, and {sup['name']} alone accounts for {share(sup['rev_exposed'] / exposed, 0)} of exposed revenue",
        "prize_low": lo_r * oos_rev, "prize_high": hi_r * oos_rev + T["prize_high_lowstock"] * low_rev, "prize_unit": "revenue",
        "basis": f"Low: {lo_r:.0%} of the 12-week revenue of {plural(len(oos), 'active out-of-stock SKU')}. High: {hi_r:.0%} of it plus "
                 f"{T['prize_high_lowstock']:.0%} of the 12-week revenue of {plural(len(lows), 'low-stock SKU')} in markets growing {pct(T['rising_market'])} or more."})
    for r in recs:
        r.update(page=PAGES[r["q"]], question=QUESTIONS[r["q"]], owner=OWNERS[r["q"]])
    return recs


# --- 6. method text ----------------------------------------------------------------
def build_method(skus, comps, cells, S, L, recs):
    inactive = [s for s in skus if not s["active"]]
    names = Counter(s["name"] for s in skus)
    off = sum(1 for s in skus if abs(s["rev"] - s["price"] * s["units"]) > 0.05 * max(s["rev"], 1))
    skunames = {s["name"].lower() for s in skus}
    relist_ids = [g["sku_id"] for g in L["gaps"] if g["type"] == "sku"]
    sk = {s["id"]: s for s in skus}
    p25, med = share(S["sku_share_p25"]), share(S["sku_share_median"])
    dq = [
        f"{len(inactive)} SKUs are marked inaktiv but together sold {eur(sum(s['rev'] for s in inactive))} in 12 weeks "
        f"({sum(s['rev'] for s in inactive) / S['total_rev']:.0%} of category revenue); "
        f"{sum(s['stock'] == 'in_stock' for s in inactive)} of them are in stock. "
        "Confirm what inaktiv means (delisted, sell-through, or stale flag) before acting on status.",
        f"For {off} of {len(skus)} SKUs, revenue differs by more than 5% from list price × units. "
        "Treated as promotions/price changes during the period; price_eur is used as current shelf price.",
        f"{sum(1 for n in names.values() if n > 1)} product names appear on two SKU IDs (different pack or subcategory), "
        "and some subcategory labels contradict the product name. Rules therefore key on product_id, never on name.",
        f"{sum(1 for c in comps if not 0 <= c['score'] <= 100)} competitor signal scores fall outside the documented 0–100 range; "
        "scores are only used for ordering and thresholds, not arithmetic beyond cell averages.",
        f"Competitor signals are one snapshot ({comps[0]['observed']}) from {len({c['source'] for c in comps})} sources "
        f"of differing quality (retailer listings vs. search/social). Only {sum(1 for c in comps if c['name'].lower() in skunames)} "
        "competitor rows are an exact product match to our assortment, so like-for-like price comparison is limited to those.",
    ]
    if {"HC0007", "HC0003"} <= set(relist_ids):
        a, b = sk["HC0007"], sk["HC0003"]
        dq.append(f"Why were HC0007 and HC0003 delisted? Their markets are {eur(a['mkt_rev'])} and {eur(b['mkt_rev'])} "
                  f"growing {pct(a['mk_trend'])} and {pct(b['mk_trend'])}, yet channel sales are {eur(a['rev'])} and {eur(b['rev'])}. "
                  "Was it a supplier, margin or space decision, and does it still hold?")
    rules = [
        {"page": "Assortment", "name": "Assortment gap cell", "text":
            f"A subcategory × shade cell with at least one hot competitor product (signal score ≥ {T['comp_popular_score']} and trend ≥ {pct(T['comp_rising_trend'])}) "
            f"and at most {plural(T['gap_max_coverage'], 'active in-stock SKU')} of our own."},
        {"page": "Assortment", "name": "Relist SKU", "text":
            f"An inactive SKU that sells under {share(T['weak_share'], 0)} of its market, in a market of at least {eur(T['min_market_rev'])} growing {pct(T['rising_market'])} or more."},
        {"page": "Assortment", "name": "Under-performing cell", "text":
            f"A cell whose share of market revenue is below {T['under_share_ratio']:.0%} of the category share ({share(S['cat_share'])}), "
            f"in a market of at least {eur(T['min_market_rev'])}."},
        {"page": "Products", "name": "Not pushed enough", "text":
            f"An active, not out-of-stock SKU in a market of at least {eur(T['min_market_rev'])} growing {pct(T['positive_market'])} or more, "
            f"whose fair-share index is {T['under_index']} or lower, or whose channel trend trails the market by {abs(T['trend_gap']) * 100:.0f} points or more."},
        {"page": "Products", "name": "Low performing", "text":
            f"An active SKU with revenue below the bottom quartile ({eur(S['rev_p25'])}) where both channel and market trend are {pct(T['declining'])} or worse."},
        {"page": "Price", "name": "Signal: identical competitor product", "text":
            f"Our price differs by {T['price_gap_exact']:.0%} or more from the same product name at a competitor (above or below)."},
        {"page": "Price", "name": "Signal: market average", "text":
            f"Our price differs by {T['price_gap_market']:.0%} or more from the market average selling price (market revenue ÷ market units)."},
        {"page": "Price", "name": "Signal: losing ground", "text":
            f"Market trend is {pct(T['positive_market'])} or more and our channel trend trails it by {abs(T['trend_gap']) * 100:.0f} points or more (suggests price too high)."},
        {"page": "Price", "name": "Signal: thin margin", "text":
            f"Active SKU with margin below {share(T['low_margin'], 0)} and revenue in the top quartile (from {eur(S['rev_p75'])}); suggests price too low."},
        {"page": "Price", "name": "Price tier", "text":
            "Confirmed when the identical-product signal fires or at least two signals point the same way (all above or all below); otherwise Flag. "
            "Price vs the competitor cell median is context only: competitor pack sizes are unknown."},
        {"page": "Availability", "name": "Restock", "text":
            f"An active SKU that is out of stock, or on low stock in a market growing {pct(T['rising_market'])} or more."},
    ]
    prize_bases = [{"q": r["q"], "text": r["basis"]} for r in recs]
    prize_bases.append({"q": 0, "text": "Prizes are illustrative scenarios for 12 weeks, not forecasts. The four ranges overlap partly and are not additive."})
    quad = [
        {"chart": "Assortment: competitor view", "text": f"x = mean competitor signal score of the cell, y = mean competitor trend; splits at {T['comp_popular_score']} and {pct(T['comp_rising_trend'])}; bubble size = number of competitor products."},
        {"chart": "Assortment: our channel view", "text": "x = channel revenue or units of the cell (log), y = revenue-weighted channel trend; x splits at the median cell, y at 0%."},
        {"chart": "Products", "text": "x = share of market units (log, split at median) or market trend (split at 0%), y = fair-share index (log, split at 1.0 = fair share of demand); bubble size = shelf share."},
        {"chart": "Price", "text": "x = price index vs market average or vs competitor cell median (split at 1.0), y = channel trend minus market trend (split at 0)."},
        {"chart": "Availability", "text": f"x = channel revenue (log, split at median SKU {eur(S['median_sku_rev'])}), y = market trend (split at 0%); colour = stock status."},
    ]
    caveats = [
        "Stock status is a snapshot: there is no on-hand quantity, lead time or lost-sales data.",
        f"Competitor signals are one snapshot ({comps[0]['observed']}) from mixed sources (retailer rank, search, social); read them as direction, not volume.",
        "Competitor pack sizes are unknown, so competitor price comparisons are indicative.",
        "The data is synthetic: the strongest signals sit in a handful of SKUs, so conclusions rest on few items.",
        "Channel and market 'share' is a ratio of channel revenue to a market-demand proxy, not a true market share.",
        "Prize figures are illustrative scenarios, not forecasts, and are not additive across questions.",
    ]
    return {"rules": rules, "prize_bases": prize_bases, "quadrant_notes": quad, "data_questions": dq, "caveats": caveats}


def build_quadrants(S, cells):
    cl = [c for c in cells if c["n_skus"]]
    return {
        "assort_comp": {"x_split": T["comp_popular_score"], "y_split": T["comp_rising_trend"],
                        "tl": "Emerging: rising, less popular", "tr": "Hot: popular and rising",
                        "bl": "Quiet: less popular, not rising", "br": "Established: popular, not rising"},
        "assort_client": {"x_split_rev": statistics.median(c["rev"] for c in cl),
                          "x_split_units": statistics.median(c["units"] for c in cl), "y_split": 0,
                          "tl": "Growing niches: small and growing", "tr": "Strongholds: large and growing",
                          "bl": "Weak spots: small and shrinking", "br": "At risk: large but shrinking"},
        "products": {"x_split_mkt_unit_share": S["median_mkt_unit_share"], "x_split_mk_trend": 0, "y_split": 1,
                     "tl": "Niche strengths: small demand, we over-index", "tr": "Winners: strong demand, we over-index",
                     "bl": "Low performers: weak demand, we under-index (delist / mark-down candidates)",
                     "br": "Under-pushed: demand is there, we under-index"},
        "price": {"x_split": 1, "y_split": 0,
                  "tl": "Priced below, keeping pace (room to raise)", "tr": "Priced above, keeping pace",
                  "bl": "Priced below, losing ground (check execution, not price)",
                  "br": "Priced above, losing ground (review price)"},
        "availability": {"x_split": S["median_sku_rev"], "y_split": 0,
                         "tl": "Restock next: smaller, rising market", "tr": "Restock first: big sellers, rising market",
                         "bl": "Low priority", "br": "Keep stocked: big sellers, flat or falling market"},
    }


# --- 7. assemble DATA --------------------------------------------------------------
def build_data(skus, comps):
    S = sku_metrics(skus, comps)
    cells = build_cells(skus, comps, S)
    L = build_lists(skus, cells, S)
    suppliers = build_suppliers(skus)
    brands = build_brands(skus, S)
    recs = build_recs(skus, cells, suppliers, L, S)
    cl = [c for c in cells if c["n_skus"]]
    n_oos = sum(s["active"] and s["stock"] == "out_of_stock" for s in skus)
    meta = {
        "client": "ZenBeauty Retail", "category": "Beauty > Hair Coloration", "period_weeks": 12,
        "generated": GENERATED, "observed_date": comps[0]["observed"],
        "n_skus": len(skus), "n_active": sum(s["active"] for s in skus), "n_inactive": sum(not s["active"] for s in skus),
        "n_comps": len(comps), "n_cells_client": len(cl), "n_cells_comp": len({c["cell"] for c in comps}),
        "total_rev": S["total_rev"], "total_units": S["total_units"], "total_mkt_rev": S["total_mkt_rev"],
        "total_mkt_units": S["total_mkt_units"], "total_shelf_cm": S["total_shelf_cm"], "cat_share": S["cat_share"],
        "weighted_margin": S["weighted_margin"], "n_active_oos": n_oos,
        "sku_share_p25": S["sku_share_p25"], "sku_share_median": S["sku_share_median"],
        "median_margin": S["median_margin"], "rev_p25": S["rev_p25"], "rev_p75": S["rev_p75"],
        "median_mkt_unit_share": S["median_mkt_unit_share"], "median_sku_rev": S["median_sku_rev"],
        "median_cell_rev": statistics.median(c["rev"] for c in cl), "median_cell_units": statistics.median(c["units"] for c in cl),
    }
    kpis = [
        {"label": f"SKUs ({meta['n_active']} active)", "value": meta["n_skus"], "fmt": "int"},
        {"label": "Channel revenue, 12 weeks", "value": round(S["total_rev"], 2), "fmt": "eur"},
        {"label": "Share of market revenue", "value": round(S["cat_share"], 6), "fmt": "pct"},
        {"label": "Revenue-weighted margin", "value": round(S["weighted_margin"], 6), "fmt": "pct"},
        {"label": "Active SKUs out of stock", "value": n_oos, "fmt": "int"},
    ]
    return {
        "meta": meta,
        "thresholds": [{"key": k, "value": v, "unit": TM[k][1], "label": TM[k][0], "used_in": TM[k][2]} for k, v in T.items()],
        "rec_sort": REC_SORT, "kpis": kpis, "skus": skus, "comps": comps, "cells": cells, "brands": brands,
        "suppliers": suppliers, "lists": L, "recs": recs, "quadrants": build_quadrants(S, cells),
        "method": build_method(skus, comps, cells, S, L, recs),
    }


def clean(v, key=None):
    """Round money to 2 dp and fractions to 6 dp; never emit NaN/Infinity."""
    if isinstance(v, float):
        if v != v or v in (float("inf"), float("-inf")):
            return None
        return round(v, 2 if key in MONEY_KEYS else 6)
    if isinstance(v, dict):
        return {k: clean(x, k) for k, x in v.items()}
    if isinstance(v, list):
        return [clean(x, key) for x in v]
    return v


# --- 8. writers --------------------------------------------------------------------
def prize_text(r):
    return f"{eur(r['prize_low'])}–{eur(r['prize_high'])} per 12 weeks ({r['prize_unit']}, illustrative)"


def md_table(headers, rows):
    esc = lambda x: str(x).replace("|", "/").replace("\n", " ")
    return ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)] + \
           ["| " + " | ".join(esc(c) for c in r) + " |" for r in rows] + [""]


def write_markdown(D):
    sk = {s["id"]: s for s in D["skus"]}
    L, M = D["lists"], D["method"]
    recs = sorted(D["recs"], key=lambda r: -r["prize_high"]) if REC_SORT == "prize" else D["recs"]
    out = ["# Category opportunity review: Hair Coloration", "",
           f"Generated by `review.py` from the files in `data/` ({D['meta']['n_skus']} SKUs, {D['meta']['n_comps']} competitor signals, "
           f"competitor snapshot {D['meta']['observed_date']}). Every number is computed from those files.", "", "## Recommendations", ""]
    for r in recs:
        out += [f"### Q{r['q']} · {r['question']}", "", f"**{r['action']}**", "", r["evidence"] + ".", "",
                f"- Prize: {prize_text(r)}", f"- Basis: {r['basis']}", f"- Owner: {r['owner']}", ""]

    def sku_rows(items, extra=lambda x: []):
        return [[x["id"], sk[x["id"]]["name"], f"{sk[x['id']]['status']} / {stock_label(sk[x['id']]['stock'])}", x.get("reason", "")] + extra(x)
                for x in items]

    def prize_cell(x):
        return [f"{eur(x['prize_low'])}–{eur(x['prize_high'])}"]

    out += ["## Q1 · Assortment", "", "### Assortment gap cells", ""]
    out += md_table(["Cell", "Reason", "Competitor products"],
                    [[g["key"].replace("|", " · "), g["reason"], ", ".join(g["comp_ids"])] for g in L["gaps"] if g["type"] == "cell"])
    out += ["### SKUs to relist", ""]
    relist = [dict(g, id=g["sku_id"]) for g in L["gaps"] if g["type"] == "sku"]
    out += md_table(["ID", "Product", "Status / stock", "Reason", "Prize"], sku_rows(relist, prize_cell))
    out += ["### Under-performing cells", ""]
    out += md_table(["Cell", "Reason", "Prize (high)"],
                    [[u["key"].replace("|", " · "), u["reason"], eur(u["prize_high"])] for u in L["under_cells"]])
    out += ["## Q2 · Products", "", "### Not pushed enough", ""]
    out += md_table(["ID", "Product", "Status / stock", "Reason", "Prize"], sku_rows(L["not_pushed"], prize_cell))
    out += ["### Low performing", ""]
    out += md_table(["ID", "Product", "Status / stock", "Reason"], sku_rows(L["low_perf"]))
    out += ["## Q3 · Price", ""]
    out += md_table(["ID", "Product", "Status / stock", "Tier", "Signals", "Margin prize"],
                    [[p["id"], sk[p["id"]]["name"], f"{sk[p['id']]['status']} / {stock_label(sk[p['id']]['stock'])}", p["tier"],
                      "; ".join(f"{x['label']} ({x['detail']})" for x in p["signals"]), f"{eur(p['prize_low'])}–{eur(p['prize_high'])}"]
                     for p in L["price_review"]])
    out += ["## Q4 · Availability", ""]
    out += md_table(["ID", "Product", "Status / stock", "Reason", "Prize"], sku_rows(L["restock"], prize_cell))
    out += md_table(["Supplier", "Active SKUs", "Out of stock", "Low stock", "Revenue exposed"],
                    [[s["name"], s["n_active"], s["n_oos"], s["n_low"], eur(s["rev_exposed"])] for s in D["suppliers"][:6]])
    out += ["## Thresholds", ""]
    out += md_table(["Key", "Value", "Meaning"], [[t["key"], t["value"], t["label"]] for t in D["thresholds"]])
    out += ["## Rules", ""] + [f"- **{r['page']}: {r['name']}.** {r['text']}" for r in M["rules"]]
    out += ["", "## Size-of-prize bases", ""] + [f"- {'Q' + str(p['q']) if p['q'] else 'General'}: {p['text']}" for p in M["prize_bases"]]
    out += ["", "## Data questions to confirm with the customer", ""] + [f"- {q}" for q in M["data_questions"]]
    out += ["", "## Caveats", ""] + [f"- {c}" for c in M["caveats"]] + [""]
    (OUT / "recommendations.md").write_text("\n".join(out), encoding="utf-8")


def write_actions_csv(D):
    sk = {s["id"]: s for s in D["skus"]}
    ck = {c["key"]: c for c in D["cells"]}
    L = D["lists"]
    cols = ["question", "list", "tier", "product_id", "cell", "product_name", "brand", "subcategory", "shade_group", "status",
            "stock_status", "supplier", "price_eur", "channel_revenue_eur_12w", "channel_margin_pct",
            "channel_sales_trend_12w_pct", "market_revenue_eur_12w", "market_sales_trend_12w_pct", "reason",
            "prize_low_eur", "prize_high_eur"]
    rows = []

    def add(q, lst, item, sku_id=None, key=None, tier=""):
        if sku_id:
            s = sk[sku_id]
            vals = [sku_id, s["cell"], s["name"], s["brand"], s["sub"], s["shade"], s["status"], s["stock"], s["supplier"],
                    s["price"], s["rev"], s["margin"], s["ch_trend"], s["mkt_rev"], s["mk_trend"]]
        else:
            c = ck[key]
            vals = ["", key, "", "", c["sub"], c["shade"], "", "", "", "", c["rev"], "", c["ch_trend"], c["mkt_rev"], c["mk_trend"]]
        reason = item.get("reason") or "; ".join(f"{x['label']} ({x['detail']})" for x in item.get("signals", []))
        rows.append([q, lst, tier] + [("" if v is None else v) for v in vals] +
                    [reason, round(item.get("prize_low", 0), 2) if "prize_high" in item else "",
                     round(item["prize_high"], 2) if "prize_high" in item else ""])

    for g in L["gaps"]:
        if g["type"] == "cell":
            add(1, "gap_cell", g, key=g["key"])
        else:
            add(1, "relist", g, sku_id=g["sku_id"])
    for u in L["under_cells"]:
        add(1, "under_performing_cell", u, key=u["key"])
    for x in L["not_pushed"]:
        add(2, "not_pushed", x, sku_id=x["id"])
    for x in L["low_perf"]:
        add(2, "low_perf", x, sku_id=x["id"])
    for x in L["price_review"]:
        add(3, "price_review", x, sku_id=x["id"], tier=x["tier"])
    for x in L["restock"]:
        add(4, "restock", x, sku_id=x["id"])
    with open(OUT / "actions.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cols)
        w.writerows(rows)
    return len(rows)


def main():
    skus, comps = load()
    D = clean(build_data(skus, comps))
    OUT.mkdir(exist_ok=True)
    if (ROOT / "web").is_dir():
        shutil.copytree(ROOT / "web", OUT, dirs_exist_ok=True)
    else:
        print("Note: web/ not found yet; skipping site copy.")
    (OUT / "assets").mkdir(exist_ok=True)
    (OUT / "assets" / "data.js").write_text(
        "window.DATA = " + json.dumps(D, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    old = OUT / "category_review.html"
    if old.exists():
        old.unlink()
    write_markdown(D)
    n_rows = write_actions_csv(D)

    L = D["lists"]
    print(f"{len(D['skus'])} SKUs, {len(D['comps'])} competitor signals, {len(D['cells'])} cells")
    print("List counts: " + ", ".join(f"{k}={len(v)}" for k, v in L.items()))
    for r in D["recs"]:
        print(f"Q{r['q']} {r['action']}\n    {r['evidence']}\n    {prize_text(r)}")
    print(f"Wrote {OUT / 'assets' / 'data.js'}, {OUT / 'recommendations.md'}, {OUT / 'actions.csv'} ({n_rows} rows)")


if __name__ == "__main__":
    main()
