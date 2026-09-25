const SESSION_COOKIE = "synthora_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();

const ROUTE_LIMITS = Object.freeze({
  market: { count: 120, windowSeconds: 60 * 60 },
  history: { count: 24, windowSeconds: 60 * 60 },
  inflation: { count: 6, windowSeconds: 24 * 60 * 60 },
});

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function secretFor(env) {
  const secret = env?.API_SESSION_SIGNING_SECRET;
  return typeof secret === "string" && secret.length >= 32 ? secret : null;
}

function databaseFor(env) {
  return env?.API_USAGE_DB && typeof env.API_USAGE_DB.prepare === "function" ? env.API_USAGE_DB : null;
}

async function signingKey(secret, usages = ["sign", "verify"]) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

function base64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function cookieValue(request) {
  const header = request.headers.get("cookie") || "";
  const prefix = `${SESSION_COOKIE}=`;
  const entry = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : "";
}

function originAllowed(request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readSession(request, env) {
  const secret = secretFor(env);
  const db = databaseFor(env);
  if (!secret || !db) return { error: jsonResponse({ error: "api-security-not-configured" }, 503) };
  const token = cookieValue(request);
  const [id, expiresText, signatureText, extra] = token.split(".");
  const expiresAt = Number(expiresText);
  if (!id || extra !== undefined || !Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000))
    return { error: null };
  try {
    const signature = fromBase64Url(signatureText || "");
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(secret),
      signature,
      encoder.encode(`${id}.${expiresText}`),
    );
    if (!valid) return { error: null };
    const sessionHash = await sha256(id);
    const row = await db
      .prepare("SELECT expires_at FROM api_sessions WHERE session_hash = ?1")
      .bind(sessionHash)
      .first();
    if (!row || Number(row.expires_at) <= Math.floor(Date.now() / 1000)) return { error: null };
    return { sessionHash, expiresAt: Number(row.expires_at) };
  } catch {
    return { error: jsonResponse({ error: "api-security-unavailable" }, 503) };
  }
}

export async function issueSession(request, env) {
  if (!originAllowed(request)) return jsonResponse({ error: "same-origin-required" }, 403);
  const existing = await readSession(request, env);
  if (existing.error) return existing.error;
  if (existing.sessionHash) return jsonResponse({ ok: true, expiresAt: existing.expiresAt });
  const secret = secretFor(env);
  const db = databaseFor(env);
  if (!secret || !db) return jsonResponse({ error: "api-security-not-configured" }, 503);
  const idBytes = crypto.getRandomValues(new Uint8Array(32));
  const id = base64Url(idBytes);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const expiresText = String(expiresAt);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(`${id}.${expiresText}`)),
  );
  const token = `${id}.${expiresText}.${base64Url(signature)}`;
  const sessionHash = await sha256(id);
  try {
    await db
      .prepare("INSERT INTO api_sessions (session_hash, created_at, expires_at) VALUES (?1, ?2, ?3)")
      .bind(sessionHash, Math.floor(Date.now() / 1000), expiresAt)
      .run();
  } catch {
    return jsonResponse({ error: "api-security-unavailable" }, 503);
  }
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return jsonResponse({ ok: true, expiresAt }, 200, {
    "set-cookie": `${SESSION_COOKIE}=${token}; Path=/api; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure}`,
  });
}

export async function consumeRouteQuota(context, route) {
  const request = context.request;
  if (!request || !originAllowed(request)) return { error: jsonResponse({ error: "same-origin-required" }, 403) };
  const session = await readSession(request, context.env);
  if (session.error) return { error: session.error };
  if (!session.sessionHash) return { error: jsonResponse({ error: "session-required" }, 401) };
  const limit = ROUTE_LIMITS[route];
  if (!limit) return { error: jsonResponse({ error: "route-quota-unavailable" }, 503) };
  const db = databaseFor(context.env);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / limit.windowSeconds) * limit.windowSeconds;
  try {
    const row = await db
      .prepare(
        "INSERT INTO api_usage (session_hash, route, window_start, request_count) VALUES (?1, ?2, ?3, 1) ON CONFLICT(session_hash, route, window_start) DO UPDATE SET request_count = request_count + 1 RETURNING request_count",
      )
      .bind(session.sessionHash, route, windowStart)
      .first();
    if (!row || Number(row.request_count) > limit.count) {
      return {
        error: jsonResponse(
          { error: "rate-limit-exceeded", retryAfterSeconds: windowStart + limit.windowSeconds - now },
          429,
          { "retry-after": String(Math.max(1, windowStart + limit.windowSeconds - now)) },
        ),
      };
    }
    return { sessionHash: session.sessionHash, db };
  } catch {
    return { error: jsonResponse({ error: "api-quota-unavailable" }, 503) };
  }
}

export async function reservePlatformProviderRequest(env, provider = "coingecko") {
  const db = databaseFor(env);
  if (!db) return false;
  const configuredLimit = Number(env?.COINGECKO_PLATFORM_MONTHLY_LIMIT);
  const limit = Number.isFinite(configuredLimit) ? Math.max(1, Math.min(9500, Math.floor(configuredLimit))) : 8000;
  const month = new Date().toISOString().slice(0, 7);
  try {
    const row = await db
      .prepare(
        "INSERT INTO provider_monthly_usage (provider, month_key, request_count) VALUES (?1, ?2, 1) ON CONFLICT(provider, month_key) DO UPDATE SET request_count = request_count + 1 WHERE request_count < ?3 RETURNING request_count",
      )
      .bind(provider, month, limit)
      .first();
    return Boolean(row && Number(row.request_count) <= limit);
  } catch {
    return false;
  }
}

export function selectedProviderKey(request, env) {
  const userKey = String(request?.headers?.get("x-coingecko-api-key") || "").trim();
  if (userKey.length > 0 && userKey.length <= 300 && !/[\r\n\0]/.test(userKey))
    return { key: userKey, userSupplied: true };
  return {
    key: typeof env?.COINGECKO_DEMO_API_KEY === "string" ? env.COINGECKO_DEMO_API_KEY : "",
    userSupplied: false,
  };
}

export function securityJson(body, status = 200, headers = {}) {
  return jsonResponse(body, status, headers);
}
