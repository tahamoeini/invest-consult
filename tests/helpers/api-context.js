import { issueSession } from "../../functions/api/_security.js";

const SESSION_SECRET = "test-session-signing-secret-that-is-long-enough-for-hmac";

function createUsageDatabase() {
  const sessions = new Map();
  const routeUsage = new Map();
  const providerUsage = new Map();

  return {
    prepare(statement) {
      let values = [];
      const query = {
        bind(...boundValues) {
          values = boundValues;
          return query;
        },
        async run() {
          if (statement.includes("INSERT INTO api_sessions")) {
            sessions.set(values[0], { expires_at: values[2] });
            return { success: true };
          }
          throw new Error(`Unexpected test database statement: ${statement}`);
        },
        async first() {
          if (statement.includes("SELECT expires_at FROM api_sessions")) return sessions.get(values[0]) || null;
          if (statement.includes("INSERT INTO api_usage")) {
            const key = values.slice(0, 3).join(":");
            const requestCount = (routeUsage.get(key) || 0) + 1;
            routeUsage.set(key, requestCount);
            return { request_count: requestCount };
          }
          if (statement.includes("INSERT INTO provider_monthly_usage")) {
            const key = values.slice(0, 2).join(":");
            const requestCount = (providerUsage.get(key) || 0) + 1;
            providerUsage.set(key, requestCount);
            return { request_count: requestCount };
          }
          throw new Error(`Unexpected test database statement: ${statement}`);
        },
      };
      return query;
    },
  };
}

export async function createSecureApiContext(url, env = {}, headers = {}) {
  const origin = new URL(url).origin;
  const secureEnv = {
    ...env,
    API_SESSION_SIGNING_SECRET: SESSION_SECRET,
    API_USAGE_DB: createUsageDatabase(),
  };
  const sessionResponse = await issueSession(
    new Request(`${origin}/api/session`, { method: "POST", headers: { origin } }),
    secureEnv,
  );
  if (!sessionResponse.ok) throw new Error(`Could not create test API session: ${sessionResponse.status}`);
  const cookie = sessionResponse.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("Test API session did not return a cookie");
  return {
    request: new Request(url, {
      headers: { cookie, origin, "sec-fetch-site": "same-origin", ...headers },
    }),
    env: secureEnv,
  };
}
