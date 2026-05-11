/**
 * Schwab Developer API helpers (OAuth + data).
 * Register at https://developer.schwab.com — secrets stay server-side.
 */

const SCHWAB_AUTH = "https://api.schwabapi.com/v1/oauth/authorize";
const SCHWAB_TOKEN = "https://api.schwabapi.com/v1/oauth/token";
const SCHWAB_API = "https://api.schwabapi.com";

export function buildSchwabAuthorizeUrl({
  clientId,
  redirectUri,
  state,
}) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    ...(state ? { state } : {}),
  });
  return `${SCHWAB_AUTH}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens.
 * Schwab typically expects Basic auth with app key:secret on the token endpoint.
 */
export async function exchangeSchwabCode({
  clientId,
  clientSecret,
  code,
  redirectUri,
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(SCHWAB_TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Schwab token error ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

export async function refreshSchwabToken({ clientId, clientSecret, refreshToken }) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(SCHWAB_TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Schwab refresh error ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

/**
 * GET with Bearer — pass accessToken from token response.
 */
export async function schwabGet(path, accessToken) {
  const url = path.startsWith("http") ? path : `${SCHWAB_API}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Schwab API ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

/** Mock movers when no token (UI/dev). */
export function mockMovers() {
  return {
    index: "$SPX",
    gainers: [
      { symbol: "NVDA", pct: 3.2, last: 920.1, volume: 44_000_000 },
      { symbol: "AMD", pct: 2.1, last: 165.4, volume: 52_000_000 },
    ],
    losers: [
      { symbol: "DIS", pct: -1.8, last: 98.2, volume: 9_000_000 },
      { symbol: "BA", pct: -1.2, last: 178.0, volume: 6_500_000 },
    ],
  };
}
