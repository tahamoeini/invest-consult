# invest-consult

A conservative monthly investment planner based on a percentage of monthly salary.

## Project overview

- Persian, right-to-left user interface using the Vazirmatn font
- Persian page copy is isolated in `content/fa.json`
- Source code, configuration, README files, and setup documentation are written in English
- Client-side calculation; salary and history are not sent to the server
- Configurable monthly contribution between 15% and 25%, starting at 20%
- Generic asset categories instead of provider or fund names that may change
- Live market data is read server-side through a Cloudflare Pages Function
- Asset prices use multiple public sources and aggregate valid quotes with a median
- A failed source is omitted; the application never substitutes a fabricated price
- Historical metal reference series and locally saved monthly snapshots influence the allocation model
- Local history includes cumulative investment, estimated current value, category-level value, and estimated gain/loss

## Data sources and aggregation

`functions/api/market.js` currently uses these public sources:

- TGJU profile pages for Iranian market reference prices
- Bonbast's public page data request for dollar and 18-karat gold values
- The public Navasan-API GitHub mirror for currency and gold values
- ChartGoldPrice's free JSON endpoint for global gold and silver spot prices and daily reference history
- Public official provider pages for published fixed-income metrics

For each asset, valid numeric quotes are sorted and the middle value is used. With an even number of quotes, the two middle values are averaged. Gold and silver global spot quotes are converted to IRR using the aggregated dollar quote before being included in the median. The API response includes `sourceCount`, `sources`, `sourceValues`, and `diagnostics` so the UI and future development can inspect coverage.

The browser stores recommendation snapshots in local storage. Those snapshots represent the prices observed when the user generated a monthly plan. They are used to estimate the current value of each category as if the recommended contribution had been executed at that time. Fixed income is marked using the published effective annual return when available. The result is an educational tracking estimate, not a broker statement or fund NAV.

## Local development

The static interface can be opened directly, but the live-data endpoint requires the Pages Function runtime.

```bash
npx wrangler pages dev . --compatibility-date=2026-09-18
```

Open the local URL printed by Wrangler.

## Deploy with Cloudflare Pages and GitHub

1. In Cloudflare, open **Workers & Pages**, choose **Create application**, and select **Pages**.
2. Connect the `tahamoeini/invest-consult` repository.
3. Set the production branch to `main`.
4. Use these build settings:
   - Framework preset: None
   - Root directory: leave empty
   - Build command: leave empty; if the dashboard requires a command, use `exit 0`
   - Build output directory: `.`
5. Deploy the project. Cloudflare Pages automatically detects `functions/api/market.js` and exposes it at `/api/market`.
6. After deployment, test:

```text
https://YOUR-PAGES-DOMAIN.pages.dev/api/market
```

The endpoint should return JSON containing `updatedAt`, `assets`, `funds`, `history`, `diagnostics`, and `sources`. A temporary source failure may reduce `sourceCount` or cause the affected object to be absent.

To add a custom domain, use **Pages → Custom domains**. This project does not require an API key or secret.

## Optional manual deployment

If you prefer a manual deployment instead of the GitHub integration, run the deployment command outside the Cloudflare build command:

```bash
npx wrangler pages deploy . --project-name invest-consult
```

Do not put `wrangler pages deploy` inside the Pages build command. That can cause nested deployment or authentication failures.

## Verification

Run these checks before publishing:

```bash
node --check app.js
sed 's/^export //' functions/api/market.js | node --check
node -e "JSON.parse(require('fs').readFileSync('content/fa.json', 'utf8')); console.log('content/fa.json is valid JSON')"
```

The user-facing HTML and `content/fa.json` contain Persian copy. Executable code, CSS, README files, and deployment documentation remain English.

## Limitations

Public market pages and free JSON services can be rate-limited, delayed, unavailable, or change their response shape. The endpoint treats missing data as missing data and exposes the remaining source coverage. Global metal prices converted to IRR are reference estimates and should not be used to settle a transaction. Review fees, liquidity, risk, regulations, and current conditions before using any investment product.

This is an educational planning tool, not financial advice.
