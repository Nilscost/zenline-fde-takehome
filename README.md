# Hair Coloration category review

A category opportunity review for ZenBeauty's hair coloration range, as an offline website.

## Open and rebuild

- **Live:** https://nilscost.github.io/zenline-fde-takehome/ (rebuilt from the data on every push).
- **Open locally:** `output/index.html` in any browser. No server or network needed.
- **Rebuild:** `python3 review.py` (Python 3.9+, standard library only). It reads the CSVs in `data/` and regenerates `output/`.

## The four questions

| Page | Question | What it shows |
|---|---|---|
| Recommendations | – | One action per question, with its estimated size of prize. |
| 1 Assortment | Do you have the right assortment? | Products to relist, missing subcategory × shade groups, under-sold groups. |
| 2 Products | Are you selling the right products? | Under-sold products with strong demand, and low performers to review. |
| 3 Price | Are you selling at the right price? | Products priced well above or below the market average, with target prices. |
| 4 Availability | Are the products available? | Restock priorities by product, then availability by supplier. |

The **Method** page lists every rule, threshold and assumption.

## Implementation choices

- **Rules, not a score.** Every flag follows a plain rule a category manager can read and challenge on the Method page.
- **One script, one data file.** `review.py` computes everything and writes a single data file; the pages only display it, so every number traces back to the CSVs.
- **No dependencies.** Standard-library Python and hand-written charts, so the site opens from disk and can be emailed.
- **Thresholds in one place.** All cut-offs and assumptions sit in one dictionary at the top of `review.py`.

## Estimated size of prize

- Each range covers 12 weeks. It is a scenario, not a forecast.
- Assortment and product ranges compare our sales with similar products and groups.
- Price ranges estimate gross-profit change when moving to the market average, under two assumed demand elasticities.
- Availability ranges estimate revenue protected by restocking.
- The total counts each product once, taking its largest action, so the question ranges should not be added up.
- Details and current values are on the Method page.

## Assumptions and limits

- The data is synthetic.
- Market figures are a demand proxy, not measured market share.
- Competitor signals are sparse: one snapshot from mixed sources.
- Demand elasticity is an assumption, not measured.
- Stock status is a single snapshot, without quantities or lead times.

## Repo layout

```
data/       input CSVs (unchanged)
review.py   rules, calculations and output writer
web/        site source (HTML, CSS, JavaScript)
output/     generated site, recommendations.md and actions.csv
```

## Next steps

- **Simplify and clarify the data with the customer:** what `inaktiv` means, which category labels are authoritative, consistent product naming, and competitor pack sizes.
- **Add richer data:** weekly sales, stock on hand and unit costs.
- **Validate assortment gaps** with the buyer before listing new products.
- **Test price changes** on a few products to measure real elasticity.
- **Add automated tests** for the calculations and the generated data.
