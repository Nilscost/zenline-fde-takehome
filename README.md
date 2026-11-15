# Hair Coloration category review

Open `output/index.html` directly in a browser. The site works offline. Run `python3 review.py` (Python 3.9+, standard library only) to rebuild the site, `output/recommendations.md`, and `output/actions.csv` from the three unchanged input CSVs.

The recommendations follow the business questions in order: assortment, products, price, availability. Every page includes supporting charts, tables and drill-downs; the Method page documents rules and limitations. Displayed prizes are rounded to thousands; CSV values retain numeric cents.

## Decision rules

- **Assortment:** missing subcategory × shade cells sit in the competitor chart's top-right quadrant (mean score ≥50 and mean trend ≥15%) and contain no customer SKU. The two known high-demand delisted SKUs, HC0003 and HC0007, remain a separate relist action. Thin represented cells are not counted as missing assortment.
- **Products:** market unit-demand share splits at its SKU median; fair-share index splits at 1. Active available SKUs in the bottom-right quadrant form the under-pushed list. Active bottom-left SKUs form the low-performer review list. Low performance alone does not establish that a SKU should be delisted.
- **Price:** review extremes of at least ±20% against each SKU's market revenue divided by market units. This is a realized unit-price proxy, not an observed market shelf price. The Large gap label denotes a gap of at least 40%, not causal confidence. Competitor matches and cell prices provide context only.
- **Availability:** flag active out-of-stock SKUs and active low-stock SKUs in markets growing at least 20%. Stock is a snapshot, without quantities or lead times.

## Opportunity scenarios

All ranges cover 12 weeks and are scenarios, not forecasts.

Missing-cell revenue uses the min–max observed revenue of the nearest three represented cells with competitor signals. Distance is absolute signal-score difference divided by 100 plus absolute trend difference. Each gap retains its peer cell keys, customer SKU IDs and sample count. These are sparse, potentially cross-subcategory analogues; competitor signals are not volumes. Reusing a peer as an analogue does not create a second sale of that peer SKU, but summing new-cell scenarios assumes incremental demand and no cannibalization.

Relist and product scenarios use active-SKU 25th-percentile and median channel/market revenue ratios, with explicit revenue-recovery alternatives for products trailing their markets. Under-performing cell scenarios exclude SKU actions already counted elsewhere. Availability scenarios protect 50–100% of observed out-of-stock revenue, plus up to 25% of qualifying low-stock revenue.

Price scenarios move current price toward the SKU market unit-price proxy while holding units constant. Signed revenue impact is `(target price − current price) × units`. Only positive uplifts on active SKUs enter the positive opportunity range (50–100% realization). Price cuts show negative revenue impact, not an invented positive sales uplift. In this dataset active flagged extremes offer no positive constant-unit revenue prize; below-proxy inactive SKUs remain visible for review but are not monetized. A unit-cost proxy, current price × (1 − reported margin), supports target margin calculations; it holds costs constant but may combine period margin with current price. Validate actual costs, tax and promotions before action. Demand elasticity is unavailable.

The combined revenue opportunity/protection total takes the **maximum low and maximum high per SKU** across overlapping actions, then adds missing-cell scenarios and residual cell opportunities. It excludes gross profit and assumes complete overlap of interventions on one SKU, incremental new-cell demand and no cannibalization. Individual question ranges should not be added.

## Data and verification

`review.py` joins performance and metadata on product ID, computes metrics and action lists, copies `web/` into `output/`, and writes the shared data object. Input data is synthetic. Revenue often differs from current price × units; inactive status still has historical sales. Channel/market ratios are demand-proxy ratios rather than measured market shares. Competitor snapshots are sparse and mixed-source; competitor pack sizes are unavailable.

Generation checks nonnegative ordered combined ranges, peer presence and zero customer coverage for missing cells, and peer sample availability. In-memory checks also verify product-list quadrant membership and market price thresholds. Review `output/actions.csv` for raw actionable records and the Method page for the full assumptions.

## Next improvements

- Validate missing-cell analogues with the buyer, including pack sizes, category labels and likely cannibalization.
- Add weekly sales, on-hand stock and unit costs to replace revenue-protection and margin proxies with stronger estimates.
- Test price changes on a small set of products to measure volume response and gross profit, then record accepted or rejected recommendations.

This revision used Sol agents for the calculation rules and page changes, followed by reconciliation checks, JavaScript syntax checks and browser checks of the generated pages.

```
data/      provided CSVs, unchanged
review.py  rules, rollups and output writers
web/       editable site source
output/    generated offline site, Markdown and CSV
```
