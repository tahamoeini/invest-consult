# Cloudflare market API setup

The market, history, and inflation endpoints require a Cloudflare Pages Functions deployment. Market data requests are session-limited; the browser portfolio, recommendation history, and user API key are not stored in D1.

## 1. Create and bind the D1 database

1. In Cloudflare, open **Workers & Pages**, select the Pages project, then open **Settings → Functions → D1 database bindings**.
2. Create a D1 database for this project, then add a binding with the exact variable name `API_USAGE_DB`.
3. Apply [`functions/api/migrations/0001_api_quotas.sql`](../functions/api/migrations/0001_api_quotas.sql) to that database using the D1 console or your normal migration workflow.
4. Add the binding for production and preview environments. Deploy again after changing bindings.

The migration stores a SHA-256 session identifier, expiry, and request counters. It does not contain portfolio data or provider API keys.

## 2. Add encrypted secrets

In the Pages project, open **Settings → Variables and Secrets** and add these as **Secrets**, for each environment that should use the API:

| Secret                       | Required | Purpose                                                                                                                                      |
| ---------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_SESSION_SIGNING_SECRET` | Yes      | HMAC signing key for the HttpOnly session cookie. Use a password manager or secure random generator to create at least 32 random characters. |
| `COINGECKO_DEMO_API_KEY`     | Optional | Platform CoinGecko Demo key. A valid user key takes precedence when the request includes one.                                                |

Do not place either value in `app.js`, HTML, source control, build variables exposed to the browser, a URL, or a support screenshot. Pages Functions read the secrets from the server-side environment. Redeploy after adding or rotating a secret.

Optional, under **Variables** (not Secrets):

| Variable                           | Default | Allowed behavior                                                                                                                   |
| ---------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `COINGECKO_PLATFORM_MONTHLY_LIMIT` | `8000`  | Monthly request ceiling for the platform key. Values are clamped to 1–9,500 to leave headroom under the published Demo plan limit. |

The platform key is used only when no valid user key is supplied. Once its D1 counter reaches the configured ceiling, requests stop using it until the next month.

## 3. Per-session request limits

The signed cookie is `HttpOnly`, `SameSite=Lax`, scoped to `/api`, and marked `Secure` on HTTPS. Its random identifier is HMAC-signed and only its SHA-256 digest is stored in D1. Refreshing a page keeps the browser session and does not reset its counters.

Current server-side limits are:

- `/api/market`: 120 requests per hour per signed session.
- `/api/history`: 24 requests per hour per signed session.
- `/api/inflation`: 6 requests per day per signed session.
- Platform CoinGecko key: 8,000 requests per month by default, capped at 9,500 by the application.

The browser also reuses market responses for 90 seconds and history responses for one hour. Clearing cookies creates a new browser session, so per-session quotas are not an identity system; the shared monthly provider ceiling protects the platform key from aggregate overuse.

## 4. User-owned CoinGecko key

Users can add a [CoinGecko Demo key](https://support.coingecko.com/hc/en-us/articles/21880397454233-User-Guide-How-to-sign-up-for-CoinGecko-Demo-API-and-generate-an-API-key) under **Settings → Market sources**. The app sends it to the Pages Function in the `X-CoinGecko-API-Key` header; the function forwards it to CoinGecko in its required header and never places it in the URL or API response. User keys are not written to D1 or included in exported portfolio data.

The user chooses whether the key stays only in the open page, in session storage until the browser session ends, or in local storage on that device. The default is session storage. A key saved on the device is readable by JavaScript running on that same origin, so users should only choose that option on a device and browser profile they control.

## 5. Verify configuration

After deployment, load the app and check these same-origin endpoints:

- `POST /api/session` should return `{ "ok": true }` and set the session cookie.
- `GET /api/market` should return market data or a partial-data response.
- `GET /api/inflation` should return a World Bank annual CPI observation and its year.
- `GET /api/history?assets=gold,dollar&range=1y` should return observed points and coverage details.

A `503` response with `api-security-not-configured` means the D1 binding or signing secret is missing. `429` means a session or provider quota was reached. Do not disable the checks to work around either response.

## Operational security

- Keep Pages deployments on HTTPS and rotate a secret immediately if it is exposed.
- Never log request headers containing `X-CoinGecko-API-Key`; the Pages Function code intentionally omits the key from diagnostics and responses.
- The application enforces same-origin requests, a signed session cookie, route counters in D1, and an atomic monthly counter before spending the platform provider key.
- These controls reduce accidental refresh consumption and key exposure. They do not replace Cloudflare account MFA, least-privilege access, secret rotation, or provider-side usage alerts.

References: [Pages Functions bindings](https://developers.cloudflare.com/pages/functions/bindings/), [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/), [CoinGecko API plans](https://www.coingecko.com/en/api/pricing), and [World Bank API guidance](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392).
