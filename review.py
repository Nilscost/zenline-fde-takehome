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
    "min_market_rev": 25_000,     # ignore SKUs/groups whose 12-week market revenue is smaller (EUR)
    "positive_market": 0.10,      # market trend that counts as positive
    "rising_market": 0.20,        # market trend that counts as clearly rising
    "declining": -0.15,           # trend that counts as declining (channel and market)
    "comp_popular_score": 50,     # competitor signal score that counts as popular (0-100)
    "comp_rising_trend": 0.15,    # competitor trend that counts as rising
    "gap_max_coverage": 2,        # a hot group with 1..this many active, in-stock SKUs is thinly covered ("expand")
    "under_share_ratio": 0.60,    # group share below this fraction of category share = under-performing
    "weak_share": 0.01,           # channel/market revenue share that counts as "not selling"
    "under_index": 0.25,          # fair-share index at or below this = under-indexed vs market demand
    "trend_gap": -0.30,           # channel trend minus market trend: losing ground vs the market
    "push_high_mkt_rev": 100_000, # push, high tier: market at least this large (EUR, 12 weeks)
    "push_high_index": 0.75,      # push, high tier: fair-share index at or below this (strongly under-indexed)
    "price_gap_exact": 0.15,      # price gap vs the identical product at a competitor
    "price_idx_below": 0.90,      # price index (our price / market avg selling price) at or below = below market
    "price_idx_above": 1.20,      # price index at or above = above market
    "elasticity_low": -1.0,       # assumed price elasticity of demand, less elastic case
    "elasticity_high": -2.0,      # assumed price elasticity of demand, more elastic case
    "low_margin": 0.25,           # margin that counts as thin
    "prize_low_recovery": 0.5,    # prize, low case: share of the revenue/margin at stake that is recovered
    "prize_high_recovery": 1.0,   # prize, high case: share of the revenue/margin at stake that is recovered
    "prize_high_lowstock": 0.25,  # prize, high case: share of low-stock revenue in rising markets at stake
}
# label, unit and the pages that use each threshold (shown on the Method page).
TM = {
    "min_market_rev": ("Smallest 12-week market worth acting on", "eur", ["Assortment", "Products"]),
    "positive_market": ("Market trend that counts as positive", "pct", ["Products", "Price"]),
    "rising_market": ("Market trend that counts as clearly rising (relist, push high tier, restock)", "pct", ["Assortment", "Products", "Availability"]),
    "declining": ("Trend that counts as declining (low-performer high tier: channel and market)", "pct", ["Products"]),
    "comp_popular_score": ("Competitor signal score that counts as popular", "score", ["Assortment"]),
    "comp_rising_trend": ("Competitor trend that counts as rising", "pct", ["Assortment"]),
    "gap_max_coverage": ("Hot subcategory × shade group with 1 to this many active, in-stock products = expand", "count", ["Assortment"]),
    "under_share_ratio": ("Group share below this fraction of category share = under-performing", "ratio", ["Assortment"]),
    "weak_share": ("Revenue share of market that counts as not selling", "pct", ["Assortment", "Products"]),
    "under_index": ("Fair-share index at or below which a SKU is under-indexed", "ratio", ["Products"]),
    "trend_gap": ("Channel trend minus market trend that counts as losing ground", "pct", ["Products", "Price"]),
    "push_high_mkt_rev": ("Push, high tier: smallest 12-week market", "eur", ["Products"]),
    "push_high_index": ("Push, high tier: fair-share index at or below", "ratio", ["Products"]),
    "price_gap_exact": ("Price gap vs the identical competitor product", "pct", ["Price"]),
    "price_idx_below": ("Price index (our price ÷ market average selling price) at or below = below market", "ratio", ["Price"]),
    "price_idx_above": ("Price index (our price ÷ market average selling price) at or above = above market", "ratio", ["Price"]),
    "elasticity_low": ("Assumed price elasticity of demand, less elastic case (assumption, not measured)", "ratio", ["Price"]),
    "elasticity_high": ("Assumed price elasticity of demand, more elastic case (assumption, not measured)", "ratio", ["Price"]),
    "low_margin": ("Margin that counts as thin", "pct", ["Price"]),
    "prize_low_recovery": ("Prize, low case: share of the amount at stake that is recovered", "ratio", ["Recommendations"]),
    "prize_high_recovery": ("Prize, high case: share of the amount at stake that is recovered", "ratio", ["Recommendations"]),
    "prize_high_lowstock": ("Prize, high case: share of low-stock revenue in rising markets", "ratio", ["Availability"]),
}
REC_SORT = "question"  # "prize" = largest high-end prize first; "question" = question order 1-4

MONEY_KEYS = {"price", "rev", "mkt_rev", "mkt_asp", "target_price", "cost_proxy", "revenue_change_at_target", "gross_profit_change_at_target",
              "revenue_change_low", "revenue_change_high", "gp_change_low", "gp_change_high", "units_at_target_low",
              "units_at_target_high", "price_gp_low", "price_gp_high", "shelf_cm_needed", "low", "high", "prize_low", "prize_high", "total_rev", "total_mkt_rev",
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


def group_label(key):
    return key.replace("|", " · ")


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
        cell["label"] = group_label(key)
        # "hot" = the group sits in the top-right of the competitor view (mean score and mean trend above the splits).
        cell["hot"] = bool(cell["comp_score_mean"] is not None and cell["comp_score_mean"] >= T["comp_popular_score"]
                           and cell["comp_trend_mean"] >= T["comp_rising_trend"])
        if cell["hot"] and cell["n_skus"] == 0:
            cell["priority"] = "add"
        elif cell["hot"] and cell["coverage"] <= T["gap_max_coverage"]:
            cell["priority"] = "expand"
        else:
            cell["priority"] = None
        cell["gap"] = cell["priority"] == "add"
        hot_txt = f"{plural(cell['n_hot'], 'hot competitor product')} (popular and rising)"
        if cell["priority"] == "add":
            cell["priority_reason"] = (f"Competitors are popular and rising here (mean score {cell['comp_score_mean']:.0f}, "
                                       f"trend {pct(cell['comp_trend_mean'])}) and we list no product in this group.")
            cell["gap_reason"] = f"{hot_txt}; we list no product in this subcategory × shade group"
        elif cell["priority"] == "expand":
            cell["priority_reason"] = (f"Competitors are popular and rising here (mean score {cell['comp_score_mean']:.0f}, "
                                       f"trend {pct(cell['comp_trend_mean'])}) but only {plural(cell['coverage'], 'active, in-stock product')} of ours cover it.")
            cell["gap_reason"] = (f"{hot_txt}; only {plural(cell['coverage'], 'active, in-stock product')} "
                                  f"of our {cell['n_skus']} in the group")
        else:
            cell["priority_reason"] = ""
            cell["gap_reason"] = ""
        cell["under"] = bool(cell["share"] is not None and cell["share"] < T["under_share_ratio"] * S["cat_share"]
                             and mkt_rev >= T["min_market_rev"])
        cell["under_reason"] = (f"Share {share(cell['share'])} of a {eur(mkt_rev)} market vs {share(S['cat_share'])} for the "
                                f"category (threshold {share(T['under_share_ratio'] * S['cat_share'])})") if cell["under"] else ""
        cells.append(cell)
    peers = [c for c in cells if c["n_skus"] and c["n_comp"]]
    for c in cells:
        if not c["priority"]:
            continue
        ranked = sorted((p for p in peers if p["key"] != c["key"]),
                        key=lambda p: (abs(p["comp_score_mean"] - c["comp_score_mean"]) / 100
                                       + abs(p["comp_trend_mean"] - c["comp_trend_mean"]), p["key"]))[:3]
        # The estimate is the revenue of the products added, not of a whole peer group:
        # peer revenue per active product × products suggested (hot competitor products, at least 1).
        n_sug = max(c["n_hot"], 1)
        per = [p["rev"] / max(p["n_active"], 1) for p in ranked]
        lo, hi = n_sug * min(per, default=0), n_sug * max(per, default=0)
        basis = ("Nearest three represented subcategory × shade groups by |score difference|/100 + |trend difference|; "
                 f"min–max peer 12-week revenue per active product × {plural(n_sug, 'product')} suggested. "
                 "Sparse, cross-subcategory analogues; signals are not sales forecasts.")
        c.update(peer_keys=[p["key"] for p in ranked], peer_labels=[p["label"] for p in ranked],
                 peer_sku_ids=[i for p in ranked for i in p["sku_ids"]],
                 peer_n=len(ranked), prize_low=lo, prize_high=hi, peer_basis=basis)
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
    sig = []
    idx = s["price_idx_mkt"]
    if idx is not None and (idx <= T["price_idx_below"] or idx >= T["price_idx_above"]):
        d = "above" if idx > 1 else "below"
        sig.append(({"code": "market", "label": f"Priced {d} the market average selling price",
                     "detail": f"€{s['price']:.2f} vs market revenue ÷ units €{s['mkt_asp']:.2f}, price index {idx:.2f}; not an observed shelf price"}, d))
    return sig


def price_scenario(s):
    """Move the price to the market average selling price under two assumed elasticities.

    units_at_target = units × (target ÷ price)^elasticity; unit cost proxy = price × (1 − margin);
    gross-profit change = units_at_target × (target − cost) − units × (price − cost)."""
    price, target, units = s["price"], s["mkt_asp"], s["units"]
    cost = price * (1 - s["margin"])
    out = {"cost_proxy": cost, "margin_at_target": (target - cost) / target}
    for tag in ("low", "high"):
        e = T[f"elasticity_{tag}"]
        u = units * (target / price) ** e
        out[f"units_at_target_{tag}"] = u
        out[f"revenue_change_{tag}"] = u * target - units * price
        out[f"gp_change_{tag}"] = u * (target - cost) - units * (price - cost)
    return out


def shelf_medians(skus):
    act = [s for s in skus if s["active"]]
    by_sub = defaultdict(list)
    for s in act:
        by_sub[s["sub"]].append(s["shelf_cm"])
    return {k: statistics.median(v) for k, v in by_sub.items()}, statistics.median(s["shelf_cm"] for s in act)


def tier_rank(t):
    return {"high": 0, "medium": 1}.get(t, 2)


def build_lists(skus, cells, S):
    p25, med = S["sku_share_p25"], S["sku_share_median"]
    lo_r, hi_r = T["prize_low_recovery"], T["prize_high_recovery"]
    L = {"gaps": [], "under_cells": [], "not_pushed": [], "low_perf": [], "price_review": [], "restock": []}
    sub_med, all_med = shelf_medians(skus)
    # coverage: other active, not out-of-stock SKUs in the same subcategory × shade group
    avail = Counter(s["cell"] for s in skus if s["active"] and s["stock"] != "out_of_stock")
    for s in skus:
        own = s["active"] and s["stock"] != "out_of_stock"
        s["peers_active"] = avail[s["cell"]] - (1 if own else 0)
        s["keeps_coverage"] = s["peers_active"] >= 1
        s["push_tier"], s["low_tier"] = None, None
    gap_skus = []
    for s in skus:
        # Q1 (a) SKU-level gap: delisted, not selling, in a rising market
        if (not s["active"] and s["share"] < T["weak_share"] and s["mkt_rev"] >= T["min_market_rev"]
                and s["mk_trend"] >= T["rising_market"]):
            s["lists"].append("relist")
            gap_skus.append({
                "type": "sku", "priority": "relist", "key": s["cell"], "sku_id": s["id"], "name": s["name"],
                "reason": f"Inactive with {eur(s['rev'])} sales ({share(s['share'])}) in a {eur(s['mkt_rev'])} market growing {pct(s['mk_trend'])}",
                "n_skus_suggested": 1, "shelf_cm_needed": float(s["shelf_cm"]),
                "shelf_basis": f"The product's own recorded shelf space ({s['shelf_cm']} cm)",
                "prize_low": max(s["mkt_rev"] * p25 - s["rev"], 0.0), "prize_high": max(s["mkt_rev"] * med - s["rev"], 0.0)})
        strong = s["mkt_unit_share"] >= S["median_mkt_unit_share"]
        over = s["fair_index"] >= 1
        s["product_quadrant"] = ("winners" if strong else "niche_strengths") if over else ("under_pushed" if strong else "low_performers")
        # Q2 not pushed enough
        if s["active"] and s["stock"] != "out_of_stock" and s["product_quadrant"] == "under_pushed":
            s["lists"].append("not_pushed")
            tg = s["trend_gap"] <= T["trend_gap"]
            s["push_tier"] = ("high" if s["mkt_rev"] >= T["push_high_mkt_rev"] and s["mk_trend"] >= T["rising_market"]
                              and s["fair_index"] <= T["push_high_index"] else "medium")
            L["not_pushed"].append({
                "id": s["id"], "name": s["name"], "tier": s["push_tier"],
                "reason": f"Above-median market unit demand and fair-share index {s['fair_index']:.2f} below 1; market trend {pct(s['mk_trend'])}; channel sells {eur(s['rev'])} ({share(s['share'])} of market) with trend {pct(s['ch_trend'])}",
                "prize_low": max(s["mkt_rev"] * p25 - s["rev"], lo_r * s["rev"] if tg else 0.0),
                "prize_high": max(s["mkt_rev"] * med - s["rev"], hi_r * s["rev"] if tg else 0.0)})
        # Q2 low performing
        if s["active"] and s["product_quadrant"] == "low_performers":
            s["lists"].append("low_perf")
            s["low_tier"] = ("high" if s["rev"] <= S["rev_p25"] and s["ch_trend"] <= T["declining"]
                             and s["mk_trend"] <= T["declining"] else "medium")
            n = s["peers_active"]
            L["low_perf"].append({
                "id": s["id"], "name": s["name"], "tier": s["low_tier"], "shelf_cm": s["shelf_cm"],
                "peers_active": n, "keeps_coverage": s["keeps_coverage"],
                "coverage_note": (f"{plural(n, 'other active product')} cover{'s' if n == 1 else ''} this group" if n
                                  else "Last active product in this group: keep or replace"),
                "reason": f"Below-median market unit demand and fair-share index {s['fair_index']:.2f} below 1; {eur(s['rev'])} revenue; channel trend {pct(s['ch_trend'])}, market trend {pct(s['mk_trend'])}; review viability before delisting"})
        # Q3 price review
        sig = price_signals(s, S)
        if sig:
            direction = sig[0][1]
            idx = s["price_idx_mkt"]
            large = idx <= 1 - 2 * (1 - T["price_idx_below"]) or idx >= 1 + 2 * (T["price_idx_above"] - 1)
            tier = "Large gap" if large else "Flag"
            sc = price_scenario(s)
            s.update(cost_proxy=sc["cost_proxy"], margin_at_target=sc["margin_at_target"])
            ups = [max(sc["gp_change_low"], 0.0), max(sc["gp_change_high"], 0.0)] if s["active"] else [0.0, 0.0]
            note = ""
            if not s["active"]:
                note = "Inactive product: no uplift counted"
            elif max(ups) == 0:
                note = (f"No gross-profit uplift at either assumed elasticity ({T['elasticity_low']:g}, {T['elasticity_high']:g}): "
                        f"moving to €{s['mkt_asp']:.2f} {'raises' if direction == 'below' else 'cuts'} price but loses more than it gains")
            s["lists"].append("price_review")
            s["price_signals"], s["price_tier"] = [x["code"] for x, _ in sig], tier
            L["price_review"].append({
                "id": s["id"], "name": s["name"], "tier": tier, "story": direction, "direction": direction,
                "signals": [x for x, _ in sig], "price": s["price"], "target_price": s["mkt_asp"], "price_idx": idx,
                "units": s["units"], "elasticity_low": T["elasticity_low"], "elasticity_high": T["elasticity_high"],
                **{k: sc[k] for k in ("cost_proxy", "margin_at_target", "units_at_target_low", "units_at_target_high",
                                      "revenue_change_low", "revenue_change_high", "gp_change_low", "gp_change_high")},
                "revenue_change_at_target": sc["revenue_change_low"], "gross_profit_change_at_target": sc["gp_change_low"],
                "prize_low": min(ups), "prize_high": max(ups), "uplift_note": note})
        # Q4 restock
        oos = s["active"] and s["stock"] == "out_of_stock"
        low = s["active"] and s["stock"] == "low_stock" and s["mk_trend"] >= T["rising_market"]
        if oos or low:
            s["lists"].append("restock")
            L["restock"].append({
                "id": s["id"], "name": s["name"],
                "reason": (f"Active but out of stock; {eur(s['rev'])} revenue in 12 weeks, market {pct(s['mk_trend'])}" if oos else
                           f"Low stock while the market grows {pct(s['mk_trend'])}; {eur(s['rev'])} revenue in 12 weeks"),
                "prize_low": lo_r * s["rev"] if oos else 0.0,
                "prize_high": hi_r * s["rev"] if oos else T["prize_high_lowstock"] * s["rev"]})
    # Q1 (b) under-performing groups: prize on the group's SKUs excluding SKUs counted in other prizes
    counted = {s["id"] for s in skus if set(s["lists"]) & {"relist", "not_pushed", "restock", "price_review"}}
    sk = {s["id"]: s for s in skus}
    for c in cells:
        if c["under"]:
            v = [sk[i] for i in c["sku_ids"] if i not in counted]
            target = T["under_share_ratio"] * S["cat_share"] * sum(s["mkt_rev"] for s in v)
            L["under_cells"].append({"key": c["key"], "name": c["label"], "reason": c["under_reason"], "share": c["share"],
                                     "prize_low": 0.0, "prize_high": max(target - sum(s["rev"] for s in v), 0.0)})
    gap_cells = []
    for c in cells:
        if not c["priority"]:
            continue
        n_sug = max(c["n_hot"], 1)
        if c["sub"] in sub_med:
            m, src = sub_med[c["sub"]], f"median shelf space of our active {c['sub']} products"
        else:
            m, src = all_med, "median shelf space of all our active products (none active in this subcategory)"
        gap_cells.append({
            "type": "cell", "priority": c["priority"], "key": c["key"], "name": c["label"], "reason": c["gap_reason"],
            "priority_reason": c["priority_reason"], "n_hot": c["n_hot"], "coverage": c["coverage"], "comp_ids": c["comp_ids"],
            "n_skus_suggested": n_sug, "shelf_cm_needed": n_sug * m,
            "shelf_basis": f"{plural(n_sug, 'product')} × {m:g} cm ({src})",
            **{k: c[k] for k in ("prize_low", "prize_high", "peer_keys", "peer_labels", "peer_sku_ids", "peer_n", "peer_basis")}})
    L["gaps"] = sorted(gap_cells + gap_skus, key=lambda g: (-g["prize_high"], -g["prize_low"], g["key"]))
    L["under_cells"].sort(key=lambda x: -x["prize_high"])
    L["not_pushed"].sort(key=lambda x: (tier_rank(x["tier"]), -x["prize_high"], x["id"]))
    L["low_perf"].sort(key=lambda x: (tier_rank(x["tier"]), -x["shelf_cm"], sk[x["id"]]["rev"], x["id"]))
    L["price_review"].sort(key=lambda x: (-x["prize_high"], -x["prize_low"], -sk[x["id"]]["rev"], x["id"]))
    L["restock"].sort(key=lambda x: -sk[x["id"]]["rev"])
    return L


def cell_level_prizes(L):
    """Group-level prizes (missing/expand groups and under-performing groups); max per group so nothing is counted twice."""
    out = {}
    for x in [g for g in L["gaps"] if g["type"] == "cell"] + L["under_cells"]:
        lo, hi = out.get(x["key"], (0.0, 0.0))
        out[x["key"]] = (max(lo, x["prize_low"]), max(hi, x["prize_high"]))
    return out


# --- 5. recommendations ------------------------------------------------------------
def join_names(names):
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def build_recs(skus, cells, suppliers, L, S):
    sk = {s["id"]: s for s in skus}
    relist = [g for g in L["gaps"] if g["type"] == "sku"]
    add = [g for g in L["gaps"] if g["type"] == "cell" and g["priority"] == "add"]
    expand = [g for g in L["gaps"] if g["type"] == "cell" and g["priority"] == "expand"]
    p25, med = share(S["sku_share_p25"]), share(S["sku_share_median"])
    lo_r, hi_r = T["prize_low_recovery"], T["prize_high_recovery"]
    recs = []

    # Q1
    rs = [sk[g["sku_id"]] for g in relist]
    cl = cell_level_prizes(L)
    low = sum(g["prize_low"] for g in relist) + sum(v[0] for v in cl.values())
    high = sum(g["prize_high"] for g in relist) + sum(v[1] for v in cl.values())
    under = L["under_cells"]
    action = f"Relist {plural(len(rs), 'delisted high-demand product')} and add {plural(len(add), 'missing subcategory × shade group')}"
    if expand:
        action += f", expand {plural(len(expand), 'thinly covered group')}"
    action += f" and strengthen {plural(len(under), 'under-performing subcategory × shade group')}"
    evidence = (f"{join_names([s['name'] for s in rs[:3]])} sit in markets worth {eur(sum(s['mkt_rev'] for s in rs))} growing at least "
                f"{pct(min(s['mk_trend'] for s in rs))}, with {eur(sum(s['rev'] for s in rs))} of channel sales" if rs else
                f"{plural(len(add), 'subcategory × shade group')} have hot competitor products but no product of ours")
    recs.append({
        "q": 1, "action": action, "evidence": evidence, "prize_low": low, "prize_high": high, "prize_unit": "revenue",
        "basis": "Missing and thinly covered subcategory × shade groups: min–max 12-week revenue per active product in the three nearest represented groups (by competitor score and trend) × products suggested (sparse analogues, not forecasts). "
                 f"Relist products: low reaches the 25th-percentile product share ({p25}) of their market, high the median product share ({med}). "
                 f"Under-performing groups (high case only): lift to {share(T['under_share_ratio'] * S['cat_share'])} share "
                 f"({T['under_share_ratio']:.0%} of category share {share(S['cat_share'])}), excluding products counted in other recommendations. "
                 "A group that is both thinly covered and under-performing is counted once (the larger estimate)."})

    # Q2
    np_, lp = L["not_pushed"], L["low_perf"]
    top = sk[np_[0]["id"]] if np_ else None
    n_np_hi, n_lp_hi = sum(x["tier"] == "high" for x in np_), sum(x["tier"] == "high" for x in lp)
    recs.append({
        "q": 2, "action": f"Push {plural(len(np_), 'under-sold product')} and review {plural(len(lp), 'low performer')}",
        "evidence": (f"{top['name']} has a {eur(top['mkt_rev'])} market growing {pct(top['mk_trend'])}, but the channel sells {eur(top['rev'])} "
                     f"({share(top['share'])} of market) with trend {pct(top['ch_trend'])}; {n_np_hi} push and {n_lp_hi} review candidates are high priority"
                     if top else "No product meets the not-pushed rule"),
        "prize_low": sum(x["prize_low"] for x in np_), "prize_high": sum(x["prize_high"] for x in np_), "prize_unit": "revenue",
        "basis": f"Low: under-sold products reach the 25th-percentile product share ({p25}) of their market, or keep {lo_r:.0%} of current revenue where the channel trails the market by {abs(T['trend_gap']) * 100:.0f}+ points (the larger). "
                 f"High: median product share ({med}), or {hi_r:.0%} of current revenue where sales are collapsing (the larger). Only products below these targets receive a positive estimate; low performers are not monetised."})

    # Q3
    pr = L["price_review"]
    n_above, n_below = sum(p["direction"] == "above" for p in pr), sum(p["direction"] == "below" for p in pr)
    n_up = sum(p["prize_high"] > 0 for p in pr)
    el, eh = T["elasticity_low"], T["elasticity_high"]
    recs.append({"q": 3, "action": f"Review {plural(len(pr), 'price outlier')} ({n_above} above, {n_below} below market price)",
        "evidence": f"Prices are compared with the market average selling price (market revenue ÷ market units); {plural(n_up, 'product')} show a gross-profit uplift when moved to it under the assumed elasticities",
        "prize_low": sum(p["prize_low"] for p in pr), "prize_high": sum(p["prize_high"] for p in pr), "prize_unit": "gross profit",
        "basis": f"Move each active outlier (price index ≤ {T['price_idx_below']:.2f} or ≥ {T['price_idx_above']:.2f}) to the market average selling price. "
                 f"Units at target = units × (target ÷ price)^elasticity, with assumed elasticities {el:g} and {eh:g} (assumptions, not measured). "
                 "Unit cost proxy = price × (1 − reported margin); gross-profit uplift = units at target × (target − cost) − units × (price − cost). "
                 "Range = smaller and larger positive uplift of the two elasticities; negative uplifts count as zero. Validate costs, promotions and elasticity before acting."})

    # Q4
    rl = L["restock"]
    oos = [sk[x["id"]] for x in rl if sk[x["id"]]["stock"] == "out_of_stock"]
    lows = [sk[x["id"]] for x in rl if sk[x["id"]]["stock"] == "low_stock"]
    oos_rev, low_rev = sum(s["rev"] for s in oos), sum(s["rev"] for s in lows)
    sup = suppliers[0]
    exposed = sum(s["rev_exposed"] for s in suppliers)
    recs.append({
        "q": 4, "action": f"Prioritise replenishment for {plural(len(rl), 'SKU')} ({len(oos)} out of stock, {len(lows)} low stock)",
        "evidence": f"{plural(len(oos), 'active product')} out of stock carry {eur(oos_rev)} of 12-week revenue, and {sup['name']} alone accounts for {share(sup['rev_exposed'] / exposed, 0)} of exposed revenue",
        "prize_low": lo_r * oos_rev, "prize_high": hi_r * oos_rev + T["prize_high_lowstock"] * low_rev, "prize_unit": "revenue protected",
        "basis": f"Low: {lo_r:.0%} of the 12-week revenue of {plural(len(oos), 'active out-of-stock product')}. High: {hi_r:.0%} of it plus "
                 f"{T['prize_high_lowstock']:.0%} of the 12-week revenue of {plural(len(lows), 'low-stock product')} in markets growing {pct(T['rising_market'])} or more."})
    for r in recs:
        r.update(page=PAGES[r["q"]], question=QUESTIONS[r["q"]], owner=OWNERS[r["q"]])
    summary = {"n_relist": len(rs), "n_gap_groups": len(add), "n_expand_groups": len(expand), "n_under_groups": len(under),
               "n_push": len(np_), "n_push_high": n_np_hi, "n_low": len(lp), "n_low_high": n_lp_hi,
               "n_price": len(pr), "n_price_above": n_above, "n_price_below": n_below,
               "n_restock": len(rl), "n_oos": len(oos), "n_low_stock": len(lows)}
    return recs, summary


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
        "scores are only used for ordering and thresholds, not arithmetic beyond subcategory × shade group averages.",
        f"Competitor signals are one snapshot ({comps[0]['observed']}) from {len({c['source'] for c in comps})} sources "
        f"of differing quality (retailer listings vs. search/social). Only {sum(1 for c in comps if c['name'].lower() in skunames)} "
        "competitor rows are an exact product match to our assortment, so like-for-like price comparison is limited to those.",
    ]
    if len(relist_ids) >= 2:
        a, b = sk[relist_ids[0]], sk[relist_ids[1]]
        dq.append(f"Why were {a['name']} and {b['name']} delisted? Their markets are {eur(a['mkt_rev'])} and {eur(b['mkt_rev'])} "
                  f"growing {pct(a['mk_trend'])} and {pct(b['mk_trend'])}, yet channel sales are {eur(a['rev'])} and {eur(b['rev'])}. "
                  "Was it a supplier, margin or space decision, and does it still hold?")
    hot_def = (f"mean competitor signal score ≥ {T['comp_popular_score']} and mean competitor trend ≥ {pct(T['comp_rising_trend'])} "
               "(top-right of the competitor view)")
    el, eh = T["elasticity_low"], T["elasticity_high"]
    rules = [
        {"page": "Assortment", "name": "Add: missing subcategory × shade group", "text":
            f"A subcategory × shade group where competitors are hot ({hot_def}) and we list no product. "
            "Estimate: min–max 12-week revenue per active product of the nearest three represented groups by |score difference|/100 + |trend difference|, × products suggested."},
        {"page": "Assortment", "name": "Expand: thinly covered group", "text":
            f"A hot group (same definition) where we list products but only 1 to {T['gap_max_coverage']} are active and in stock. "
            "Estimate: min–max 12-week revenue per active product of the same three nearest peer groups × products suggested."},
        {"page": "Assortment", "name": "Shelf space needed", "text":
            "Products suggested = number of hot competitor products in the group (at least 1; 1 for a relist). "
            "Shelf needed = products suggested × median shelf space of our active products in the same subcategory "
            "(overall median when none are active there); a relist uses the product's own shelf space."},
        {"page": "Assortment", "name": "Relist product", "text":
            f"An inactive product that sells under {share(T['weak_share'], 0)} of its market, in a market of at least {eur(T['min_market_rev'])} growing {pct(T['rising_market'])} or more."},
        {"page": "Assortment", "name": "Under-performing group", "text":
            f"A subcategory × shade group whose share of market revenue is below {T['under_share_ratio']:.0%} of the category share ({share(S['cat_share'])}), "
            f"in a market of at least {eur(T['min_market_rev'])}."},
        {"page": "Products", "name": "Quadrant decision rules", "text":
            "Market unit demand splits at the median; fair-share index (channel unit share ÷ market unit share) splits at 1. "
            "Active, available bottom-right products are under-sold (push); active bottom-left products are low performers (review viability)."},
        {"page": "Products", "name": "Push: high vs medium", "text":
            f"High: market of at least {eur(T['push_high_mkt_rev'])}, market trend {pct(T['rising_market'])} or more and fair-share index "
            f"{T['push_high_index']:.2f} or lower. All other under-sold products are medium."},
        {"page": "Products", "name": "Low performer: high vs medium", "text":
            f"High: revenue in the bottom quartile (up to {eur(S['rev_p25'])}) with both channel and market trend {pct(T['declining'])} or worse. "
            "All other low performers are medium."},
        {"page": "Products", "name": "Low performer coverage", "text":
            "Counts the other active, not out-of-stock products in the same subcategory × shade group. "
            "When none remain, removing the product empties the group: keep or replace it rather than delist."},
        {"page": "Price", "name": "Price outlier", "text":
            f"Price index = our price ÷ market average selling price (market revenue ÷ market units). Below market at {T['price_idx_below']:.2f} or less, "
            f"above market at {T['price_idx_above']:.2f} or more. Large gap marks indices at {1 - 2 * (1 - T['price_idx_below']):.2f} or less / "
            f"{1 + 2 * (T['price_idx_above'] - 1):.2f} or more (magnitude, not confidence). The market average is a realized proxy, not a shelf price."},
        {"page": "Price", "name": "Elasticity scenario", "text":
            f"Target price = market average selling price. Units at target = units × (target ÷ price)^elasticity, with assumed elasticities {el:g} and {eh:g} "
            "(assumptions: no elasticity was measured). Unit cost proxy = price × (1 − reported margin). Gross-profit uplift = units at target × (target − cost) "
            "− units × (price − cost); revenue change shown alongside. Only positive uplift counts; inactive products count zero."},
        {"page": "Availability", "name": "Restock", "text":
            f"An active product that is out of stock, or on low stock in a market growing {pct(T['rising_market'])} or more."},
    ]
    prize_bases = [{"q": r["q"], "text": r["basis"]} for r in recs]
    prize_bases.append({"q": 0, "text": "12-week estimates, not forecasts. Individual question ranges overlap. The combined revenue total takes the largest revenue estimate per product across actions, "
                                        "plus group-level estimates (missing, thinly covered and under-performing subcategory × shade groups, the larger one per group). "
                                        "The Q3 price estimate is gross profit and is reported separately, not added."})
    quad = [
        {"chart": "Assortment: competitor view", "text": f"x = mean competitor signal score of the subcategory × shade group, y = mean competitor trend; splits at {T['comp_popular_score']} and {pct(T['comp_rising_trend'])}; bubble size = number of competitor products."},
        {"chart": "Assortment: our channel view", "text": "x = channel revenue or units of the group (log), y = revenue-weighted channel trend; x splits at the median group, y at 0%."},
        {"chart": "Products", "text": "x = share of market units (log, split at median product demand), y = channel unit share divided by market unit share (log, split at 1.0). Bubble size = shelf share. Inactive and out-of-stock products require separate review before acting."},
        {"chart": "Price", "text": f"x = price index vs the market average selling price; y = channel revenue (log). Review lines at {T['price_idx_below']:.2f} and {T['price_idx_above']:.2f} mark the outlier thresholds. This is not a quadrant decision chart."},
        {"chart": "Availability", "text": f"x = channel revenue (log, split at median product {eur(S['median_sku_rev'])}), y = market trend (split at 0%); colour = stock status."},
    ]
    caveats = [
        "Stock status is a snapshot: there is no on-hand quantity, lead time or lost-sales data.",
        f"Competitor signals are one snapshot ({comps[0]['observed']}) from mixed sources (retailer rank, search, social); read them as direction, not volume.",
        "Competitor pack sizes are unknown, so competitor price comparisons are indicative.",
        f"Price elasticities ({el:g} and {eh:g}) are assumptions; the price estimates show what happens if demand reacts that way, not what will happen.",
        "The data is synthetic: the strongest signals sit in a handful of products, so conclusions rest on few items.",
        "Channel and market 'share' is a ratio of channel revenue to a market-demand proxy, not a true market share.",
        "Question ranges overlap. The separately calculated combined total takes the largest estimate per product; peer-group estimates assume no cannibalization and may share a small peer sample.",
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
                     "bl": "Review candidates: weak demand, we under-index",
                     "br": "Under-pushed: demand is there, we under-index"},
        "price": {"review_low": T["price_idx_below"], "review_high": T["price_idx_above"], "description": "Price index vs the market average selling price against channel revenue; review outliers, no quadrant rules"},
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
    recs, summary = build_recs(skus, cells, suppliers, L, S)
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
    candidates = defaultdict(list)
    for g in L["gaps"]:
        if g["type"] == "sku":
            candidates[g["sku_id"]].append(g)
    for name in ("not_pushed", "restock"):
        for x in L[name]:
            candidates[x["id"]].append(x)
    cl_prizes = cell_level_prizes(L)
    total = {"low": sum(max(x["prize_low"] for x in v) for v in candidates.values()) + sum(v[0] for v in cl_prizes.values()),
             "high": sum(max(x["prize_high"] for x in v) for v in candidates.values()) + sum(v[1] for v in cl_prizes.values()),
             "price_gp_low": sum(p["prize_low"] for p in L["price_review"]),
             "price_gp_high": sum(p["prize_high"] for p in L["price_review"]),
             "basis": "Estimated 12-week revenue, not a forecast: the largest revenue estimate per product across relist, push and restock actions, "
                      "plus group-level estimates for missing, thinly covered and under-performing subcategory × shade groups (the larger one per group). "
                      "Assumes actions on the same product fully overlap and no cannibalization between groups. "
                      "The Q3 price estimate is gross profit, not revenue, so it is shown separately and not added."}
    assert all(total[k] >= 0 for k in ("low", "high")) and total["low"] <= total["high"]
    ck = {c["key"]: c for c in cells}
    for g in L["gaps"]:
        if g["type"] == "cell":
            c = ck[g["key"]]
            assert g["peer_n"] > 0 and c["hot"] and g["key"] not in g["peer_keys"]
            assert (c["n_skus"] == 0) if g["priority"] == "add" else (c["n_skus"] > 0 and c["coverage"] <= T["gap_max_coverage"])
        assert g["shelf_cm_needed"] > 0 and g["n_skus_suggested"] >= 1
    assert all(p["prize_low"] <= p["prize_high"] and p["prize_low"] >= 0 for p in L["price_review"])
    assert all((p["price_idx"] <= T["price_idx_below"]) == (p["direction"] == "below") for p in L["price_review"])
    assert all(x["tier"] in ("high", "medium") for x in L["not_pushed"] + L["low_perf"])
    assert all(x["keeps_coverage"] == (x["peers_active"] >= 1) for x in L["low_perf"])
    assert summary["n_price"] == summary["n_price_above"] + summary["n_price_below"]
    assert summary["n_restock"] == summary["n_oos"] + summary["n_low_stock"]
    return {
        "opportunity_total": total,
        "summary": summary,
        "meta": meta,
        "thresholds": [{"key": k, "value": v, "unit": TM[k][1], "label": TM[k][0], "used_in": TM[k][2]} for k, v in T.items() if k not in {"price_gap_exact", "low_margin", "under_index", "positive_market"}],
        "rec_sort": REC_SORT, "kpis": kpis, "skus": skus, "comps": comps, "cells": cells, "brands": brands,
        "suppliers": suppliers, "lists": L, "recs": recs, "quadrants": build_quadrants(S, cells),
        "method": build_method(skus, comps, cells, S, L, recs),
    }


def clean(v, key=None):
    """Round money to 2 dp and fractions to 6 dp; never emit NaN/Infinity."""
    if isinstance(v, float):
        if v != v or v in (float("inf"), float("-inf")):
            return None
        return round(v, 2 if key in MONEY_KEYS else 6) + 0.0  # + 0.0 turns -0.0 into 0.0
    if isinstance(v, dict):
        return {k: clean(x, k) for k, x in v.items()}
    if isinstance(v, list):
        return [clean(x, key) for x in v]
    return v


# --- 8. writers --------------------------------------------------------------------
def prize_text(r):
    return f"€{r['prize_low']/1000:,.0f}k–€{r['prize_high']/1000:,.0f}k per 12 weeks ({r['prize_unit']}, estimated)"


def md_table(headers, rows):
    esc = lambda x: str(x).replace("|", "/").replace("\n", " ")
    return ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)] + \
           ["| " + " | ".join(esc(c) for c in r) + " |" for r in rows] + [""]


def k(x):
    return f"€{x/1000:,.0f}k"


def write_markdown(D):
    sk = {s["id"]: s for s in D["skus"]}
    L, M, O = D["lists"], D["method"], D["opportunity_total"]
    recs = sorted(D["recs"], key=lambda r: -r["prize_high"]) if REC_SORT == "prize" else D["recs"]
    out = ["# Category opportunity review: Hair Coloration", "",
           f"Generated by `review.py` from the files in `data/` ({D['meta']['n_skus']} SKUs, {D['meta']['n_comps']} competitor signals, "
           f"competitor snapshot {D['meta']['observed_date']}). Every number is computed from those files.", "", "## Recommendations", ""]
    for r in recs:
        out += [f"### Q{r['q']} · {r['question']}", "", f"**{r['action']}**", "", r["evidence"] + ".", "",
                f"- Estimated prize: {prize_text(r)}", f"- Basis: {r['basis']}", f"- Owner: {r['owner']}", ""]

    def st(i):
        return f"{sk[i]['status']} / {stock_label(sk[i]['stock'])}"

    def rng(x):
        return f"{k(x['prize_low'])}–{k(x['prize_high'])}"

    out += [f"Combined estimated revenue opportunity/protection: {k(O['low'])}–{k(O['high'])}; price gross-profit estimate "
            f"{k(O['price_gp_low'])}–{k(O['price_gp_high'])} shown separately. {O['basis']}", ""]
    out += ["## Q1 · Assortment", "", "### Assortment priorities (add, expand, relist)", ""]
    out += md_table(["Priority", "Name", "Reason", "Products suggested", "Shelf needed", "Estimated 12-week revenue", "Basis"],
                    [[g["priority"], g["name"], g["reason"], g["n_skus_suggested"], f"{g['shelf_cm_needed']:g} cm ({g['shelf_basis']})", rng(g),
                      (g["peer_basis"] + " Peers: " + "; ".join(g["peer_labels"])) if g["type"] == "cell" else "Relist: market share scenario"]
                     for g in L["gaps"]])
    out += ["### Under-performing subcategory × shade groups", ""]
    out += md_table(["Group", "Reason", "Estimate (high)"], [[u["name"], u["reason"], k(u["prize_high"])] for u in L["under_cells"]])
    out += ["## Q2 · Products", "", "### Not pushed enough", ""]
    out += md_table(["Product", "Tier", "ID", "Status / stock", "Reason", "Estimate"],
                    [[x["name"], x["tier"], x["id"], st(x["id"]), x["reason"], rng(x)] for x in L["not_pushed"]])
    out += ["### Low performing", ""]
    out += md_table(["Product", "Tier", "ID", "Status / stock", "Shelf", "Coverage", "Reason"],
                    [[x["name"], x["tier"], x["id"], st(x["id"]), f"{x['shelf_cm']} cm", x["coverage_note"], x["reason"]] for x in L["low_perf"]])
    out += ["## Q3 · Price", ""]
    out += md_table(["Product", "Direction", "ID", "Price", "Target", "Index", "Revenue change", "Gross-profit uplift", "Note"],
                    [[p["name"], p["direction"], p["id"], f"€{p['price']:.2f}", f"€{p['target_price']:.2f}", f"{p['price_idx']:.2f}",
                      f"€{p['revenue_change_low']:,.0f} / €{p['revenue_change_high']:,.0f}", f"€{p['prize_low']:,.0f}–€{p['prize_high']:,.0f}", p["uplift_note"]]
                     for p in L["price_review"]])
    out += ["## Q4 · Availability", ""]
    out += md_table(["Product", "ID", "Status / stock", "Reason", "Estimate"],
                    [[x["name"], x["id"], st(x["id"]), x["reason"], rng(x)] for x in L["restock"]])
    out += md_table(["Supplier", "Active SKUs", "Out of stock", "Low stock", "Revenue exposed"],
                    [[s["name"], s["n_active"], s["n_oos"], s["n_low"], eur(s["rev_exposed"])] for s in D["suppliers"][:6]])
    out += ["## Thresholds", ""]
    out += md_table(["Key", "Value", "Meaning"], [[t["key"], t["value"], t["label"]] for t in D["thresholds"]])
    out += ["## Rules", ""] + [f"- **{r['page']}: {r['name']}.** {r['text']}" for r in M["rules"]]
    out += ["", "## Estimate bases", ""] + [f"- {'Q' + str(p['q']) if p['q'] else 'General'}: {p['text']}" for p in M["prize_bases"]]
    out += ["", "## Data questions to confirm with the customer", ""] + [f"- {q}" for q in M["data_questions"]]
    out += ["", "## Caveats", ""] + [f"- {c}" for c in M["caveats"]] + [""]
    (OUT / "recommendations.md").write_text("\n".join(out), encoding="utf-8")


def write_actions_csv(D):
    sk = {s["id"]: s for s in D["skus"]}
    ck = {c["key"]: c for c in D["cells"]}
    L = D["lists"]
    cols = ["question", "list", "name", "tier", "priority", "direction", "product_id", "group", "brand", "subcategory", "shade_group",
            "status", "stock_status", "supplier", "price_eur", "channel_revenue_eur_12w", "channel_margin_pct",
            "channel_sales_trend_12w_pct", "market_revenue_eur_12w", "market_sales_trend_12w_pct", "reason",
            "prize_low_eur", "prize_high_eur", "prize_unit", "products_suggested", "shelf_cm_needed", "shelf_basis",
            "peers_active", "coverage_note", "target_price_eur", "price_index", "revenue_change_low_eur", "revenue_change_high_eur",
            "peer_groups", "peer_sku_ids"]
    rows = []

    def add(q, lst, item, sku_id=None, key=None, unit="revenue"):
        if sku_id:
            s = sk[sku_id]
            vals = [sku_id, group_label(s["cell"]), s["brand"], s["sub"], s["shade"], s["status"], s["stock"], s["supplier"],
                    s["price"], s["rev"], s["margin"], s["ch_trend"], s["mkt_rev"], s["mk_trend"]]
            name = s["name"]
        else:
            c = ck[key]
            vals = ["", c["label"], "", c["sub"], c["shade"], "", "", "", "", c["rev"], "", c["ch_trend"], c["mkt_rev"], c["mk_trend"]]
            name = c["label"]
        reason = item.get("reason") or "; ".join(f"{x['label']} ({x['detail']})" for x in item.get("signals", []))
        if item.get("uplift_note"):
            reason += "; " + item["uplift_note"]
        has = "prize_high" in item
        rows.append([q, lst, name, item.get("tier", ""), item.get("priority", ""), item.get("direction", "")] +
                    [("" if v is None else v) for v in vals] +
                    [reason, round(item.get("prize_low", 0), 2) if has else "", round(item["prize_high"], 2) if has else "",
                     unit if has else "", item.get("n_skus_suggested", ""), item.get("shelf_cm_needed", ""), item.get("shelf_basis", ""),
                     item.get("peers_active", ""), item.get("coverage_note", ""), item.get("target_price", ""), item.get("price_idx", ""),
                     item.get("revenue_change_low", ""), item.get("revenue_change_high", ""),
                     "; ".join(item.get("peer_labels", [])), "; ".join(item.get("peer_sku_ids", []))])

    for g in L["gaps"]:
        if g["type"] == "cell":
            add(1, f"{g['priority']}_group", g, key=g["key"])
        else:
            add(1, "relist", g, sku_id=g["sku_id"])
    for u in L["under_cells"]:
        add(1, "under_performing_group", u, key=u["key"])
    for x in L["not_pushed"]:
        add(2, "not_pushed", x, sku_id=x["id"])
    for x in L["low_perf"]:
        add(2, "low_perf", x, sku_id=x["id"])
    for x in L["price_review"]:
        add(3, "price_review", x, sku_id=x["id"], unit="gross profit")
    for x in L["restock"]:
        add(4, "restock", x, sku_id=x["id"], unit="revenue protected")
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
    print(f"{len(D['skus'])} SKUs, {len(D['comps'])} competitor signals, {len(D['cells'])} subcategory × shade groups")
    print("List counts: " + ", ".join(f"{k}={len(v)}" for k, v in L.items()))
    for r in D["recs"]:
        print(f"Q{r['q']} {r['action']}\n    {r['evidence']}\n    {prize_text(r)}")
    print(f"Wrote {OUT / 'assets' / 'data.js'}, {OUT / 'recommendations.md'}, {OUT / 'actions.csv'} ({n_rows} rows)")


if __name__ == "__main__":
    main()
