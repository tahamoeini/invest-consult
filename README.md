# invest-consult

A conservative monthly investment planner based on a percentage of monthly salary.

## Project overview

- Persian, right-to-left user interface using the Vazirmatn font
- Client-side calculation; salary and history are not sent to the server
- Configurable monthly contribution between 15% and 25%, starting at 20%
- Generic asset categories instead of provider or fund names that may change
- Live market data from public sources:
  - Currency, gold, and silver prices from TGJU market pages
  - Published fund information from official Charisma pages
- A Cloudflare Pages Function at functions/api/market.js that reads live sources server-side and avoids browser CORS issues
- If a source is temporarily unavailable, the application does not invent a value; it uses the browser's last cached response or falls back to the base model

## Local development

The static interface can be opened directly, but the live-data endpoint requires the Pages Function runtime.

~~~~bash
npx wrangler pages dev . --compatibility-date=2026-09-18
~~~~

Open the local URL printed by Wrangler.

## Deploy with Cloudflare Pages and GitHub

1. In Cloudflare, open **Workers & Pages**, choose **Create application**, and select **Pages**.
2. Connect the tahamoeini/invest-consult repository.
3. Set the production branch to main.
4. Use the following build settings:
   - Framework preset: None
   - Root directory: leave empty
   - Build command: leave empty; if the dashboard requires a command, use exit 0
   - Build output directory: .
5. Deploy the project. Cloudflare Pages automatically detects functions/api/market.js and exposes it at /api/market.
6. After deployment, test:

~~~~text
https://YOUR-PAGES-DOMAIN.pages.dev/api/market
~~~~

The endpoint should return JSON containing updatedAt, assets, and funds. A temporary source failure may cause only the affected object to be absent.

To add a custom domain, use Pages → Custom domains. This project does not require an API key or secret.

## Optional manual deployment

If you prefer a manual deployment instead of the GitHub integration, run the deployment command outside the Cloudflare build command:

~~~~bash
npx wrangler pages deploy . --project-name invest-consult
~~~~

Do not put wrangler pages deploy inside the Pages build command. That can cause nested deployment or authentication failures.

## Data and model notes

Public market pages can be unavailable, rate-limited, or change their HTML structure. The application treats missing data as missing data and does not replace it with fabricated numbers. The allocation weights are intentionally bounded so that a single daily price movement does not cause an extreme monthly decision.

This is an educational planning tool, not financial advice. Review fees, liquidity, risk, regulations, and current conditions before using any investment product.
