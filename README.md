# Hair Coloration: category opportunity review

Zenline FDE take-home. A small script that turns the provided SKU, product and competitor data for ZenBeauty Retail into a one-page category review with five evidence-backed recommendations.

## Inspect or run

- **Read it:** open [output/category_review.html](output/category_review.html) in a browser. It is a single self-contained file.
- **Plain text:** [output/recommendations.md](output/recommendations.md) has the same recommendations; [output/actions.csv](output/actions.csv) lists every flagged SKU for filtering in Excel.
- **Regenerate:** `python3 review.py` (Python 3.9+, standard library only, no install).

## The five recommendations

All figures are for the last 12 weeks and are computed by `review.py` from `data/`.

| # | Action | What | Key evidence |
|---|---|---|---|
| 1 | Fix availability | Restore stock on 23 active SKUs carrying €206,641 of revenue | 12 active SKUs are out of stock (8.4% of category revenue); 11 more are on low stock while their market grows ≥20%. SalonPro Distribution supplies 7 of the 23. |
| 2 | Promote / fix execution | 3 listed, stocked SKUs the market wants but the channel is not selling | HC0001 Schwarzkopf Icy Plum: channel trend −99% vs market +18%. HC0002 private-label Sunlit Peach: €0 sales, in stock, 57% margin, market +31%. HC0004 Wella Pearl Blonde Gloss: €220 sales against a €134,000 market growing +42%. |
| 3 | Price review | 2 SKUs far out of line with the same product at a competitor, plus 8 thin-margin top sellers | HC0006 Garnier Olia Copper Glow at €4.77 vs €7.95 at rossmann.de (CM003). HC0007 Manic Panic Ultra Violet at €18.92 vs €11.99 at amazon.de (CM001). 8 top-quartile sellers run below 25% margin vs a 38.8% median. |
| 4 | Relist / assortment gap | Relist 2 delisted fashion shades; follow up with suppliers on Vivid and Copper | HC0007 and HC0003 are inactive with €0 sales in markets worth €382,500 and growing ≥27%. Vivid share is 2.8% vs 6.3% for the category. Copper has the most competitor signals (10 of 75, average trend +19%) while our Copper sales fall −28%. |
| 5 | Delist / mark down | 14 small SKUs shrinking in both channel and market | Together €5,751 (0.4% of category revenue) on 94 cm of shelf. |

Each recommendation in the report shows the SKU IDs, the numbers behind the flag, an owner, a next step and a caveat.

## How it works

`review.py` loads the three CSVs, joins metadata on `product_id`, and applies six rules. The thresholds sit in one dictionary (`T`) at the top of the file and are printed at the bottom of the report, so a category manager can challenge or change them. Each flag carries a euro figure with its basis stated (revenue exposed, upside at median share, margin gap), and recommendations are ordered and populated from those flags.

Choices made on purpose:

- **Rules, not a score.** A stakeholder can see why a SKU is flagged and argue with it. A blended score would hide that.
- **Channel vs. market is the main signal.** The dataset gives both for every SKU, so the gap between them separates demand problems from execution problems.
- **Competitor data is used narrowly.** Only 2 of 75 competitor rows are an exact match to a customer SKU, so price comparison is limited to those two. Everything else is used as a direction-of-demand signal per shade group.
- **Static HTML output.** No server, no dependencies, easy to email. Markdown and CSV are written alongside for other uses.

## Assumptions

- `channel_*` is the retailer's own sales and `market_*` is a demand proxy for the same product in the wider market, as the data dictionary says. Channel/market is called "share" for short; it is a ratio to a proxy, not a measured market share.
- Trend fields are fractional change over 12 weeks (0.18 = +18%).
- `price_eur` is the current shelf price. Revenue differs from price × units by more than 5% for 151 of 235 SKUs, which is treated as promotions or price changes within the period.
- "Upside at median share" (market revenue × 5.2% − current revenue) is an illustration of size, not a forecast.
- Out of stock and low stock are snapshots. There is no on-hand quantity, lead time or lost-sales estimate.

## Questions for the customer

These are also listed in the report.

1. 38 SKUs are `inaktiv` yet sold €191,360 (14% of category revenue), and 30 are in stock. Is that sell-through of delisted lines, or a stale flag? This changes recommendations 4 and 5.
2. Some subcategory labels contradict the product name (for example a "Root Retouch" product under Permanent Color), and 11 names appear on two SKU IDs. Which field is authoritative?
3. Four competitor signal scores exceed the documented 0–100 range.
4. Why were HC0007 and HC0003 delisted? If it was a supplier or compliance issue, relisting is off the table.

## Known limits

- The dataset is synthetic. Most SKUs track their market closely, so the strongest findings rest on a handful of SKUs. The report says so rather than padding the list.
- The Copper and Winter shade flags are each driven largely by one SKU (HC0006 out of stock, HC0001 collapsing).
- Thresholds were set by looking at this data once. They have not been tuned or back-tested.
- There are no automated tests. Checks were manual: rule outputs compared against hand-filtered rows during exploration.

## Next improvements

1. Add weekly sales and stock-on-hand to estimate lost sales from stock-outs instead of "revenue exposed".
2. Match competitor products to SKUs properly (EAN or fuzzy match with review) to widen price comparison beyond two products.
3. Let the category manager accept, reject or annotate each flag and feed that back into the thresholds.
4. Run on a schedule and show what changed since the last review.
5. Add tests for the rules and input validation for the CSVs.

## Repository

```
data/      provided dataset, unchanged (original README is data/README.md)
review.py  rules and report generation
output/    generated report, Markdown and CSV (committed so they can be read without running)
```

Built with Claude Code as a pair: data profiling and rule screens first, then the script. Every number in the report comes from `review.py` running over `data/`.
