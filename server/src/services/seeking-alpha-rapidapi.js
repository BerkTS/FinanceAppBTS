/**
 * Seeking Alpha via RapidAPI — https://seeking-alpha.p.rapidapi.com
 * Uses the same RAPIDAPI_KEY as other RapidAPI products (subscribe to Seeking Alpha on RapidAPI).
 *
 * Many “news/list” style endpoints return 204 on some tiers; get-ratings returns rich JSON and
 * is used here as the primary Seeking Alpha signal for the dashboard.
 */
const DEFAULT_HOST = "seeking-alpha.p.rapidapi.com";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, rapidApiKey, host, maxRetries = 2) {
  let lastText = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(900 * attempt);
    const res = await fetch(url, {
      headers: {
        "x-rapidapi-key": rapidApiKey,
        "x-rapidapi-host": host,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    lastText = await res.text();
    if (res.status === 429 && attempt < maxRetries) continue;
    if (res.status === 204) {
      return null;
    }
    if (!res.ok) {
      if (res.status === 500) {
        throw new Error(
          "HTTP 500 — Seeking Alpha upstream error (RapidAPI / provider). Try later, check your plan on RapidAPI, or set SEEKING_ALPHA_DISABLED=1 in .env."
        );
      }
      throw new Error(`Seeking Alpha ${res.status}: ${lastText.slice(0, 200)}`);
    }
    if (!lastText?.trim()) return null;
    try {
      return JSON.parse(lastText);
    } catch {
      throw new Error("Seeking Alpha: response was not JSON");
    }
  }
  throw new Error(`Seeking Alpha 429: ${lastText.slice(0, 200)}`);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function latestRatingRow(json) {
  const rows = json?.data;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

/**
 * @returns {{ items: object[], errors: string[] }}
 */
export async function fetchSeekingAlphaInsights(env = process.env) {
  const rapidApiKey =
    env.RAPIDAPI_KEY || env.NEWS_RAPIDAPI_KEY || env.X_RAPIDAPI_KEY;
  if (!rapidApiKey || env.SEEKING_ALPHA_DISABLED === "1") {
    return { items: [], errors: [] };
  }

  const host = env.SEEKING_ALPHA_HOST || DEFAULT_HOST;
  const path = env.SEEKING_ALPHA_RATINGS_PATH || "/symbols/get-ratings";
  const symbols = (env.SEEKING_ALPHA_SYMBOLS || "AAPL,MSFT,SPY")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);

  const items = [];
  const errors = [];
  const gap = Number(env.SEEKING_ALPHA_REQUEST_GAP_MS) || 800;

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    if (i > 0) await sleep(gap);
    try {
      const qs = new URLSearchParams({ symbol });
      const url = `https://${host}${path}?${qs}`;
      const json = await fetchJson(url, rapidApiKey, host);
      if (!json) {
        errors.push(`${symbol}: empty response (204 or no body — check subscription/plan)`);
        continue;
      }
      const row = latestRatingRow(json);
      if (!row?.attributes) {
        errors.push(`${symbol}: no rating data`);
        continue;
      }
      const a = row.attributes;
      const r = a.ratings || {};
      const asDate = a.asDate || "";
      const symU = symbol.toUpperCase();
      const quant = num(r.quantRating);
      const authors = num(r.authorsRating);
      const sellSide = num(r.sellSideRating);
      const title = `${symU} — Seeking Alpha consensus (${asDate || "latest"})`;
      const parts = [];
      if (quant != null) parts.push(`Quant ${quant.toFixed(2)}`);
      if (authors != null) parts.push(`Authors ${authors.toFixed(2)}`);
      if (sellSide != null) parts.push(`Sell-side ${sellSide.toFixed(2)}`);
      const description = [
        parts.join(" · "),
        `Strong buy ${r.authorsRatingStrongBuyCount ?? 0}, Buy ${r.authorsRatingBuyCount ?? 0}, Hold ${r.authorsRatingHoldCount ?? 0}, Sell ${r.authorsRatingSellCount ?? 0}`,
      ]
        .filter(Boolean)
        .join(" · ");

      items.push({
        id: `seeking-alpha-${symU}-${asDate}`,
        title,
        description,
        url: `https://seekingalpha.com/symbol/${symU}/ratings/summary`,
        publishedAt: asDate ? `${asDate}T15:00:00.000Z` : new Date().toISOString(),
        source: "Seeking Alpha",
        provider: "rapidapi_seeking_alpha",
        symbol: symU,
        ratings: {
          quantRating: quant,
          authorsRating: authors,
          sellSideRating: sellSide,
          asDate,
        },
      });
    } catch (e) {
      errors.push(`${symbol}: ${e.message}`);
    }
  }

  return { items, errors };
}

export function seekingAlphaConfigured(env = process.env) {
  const key =
    env.RAPIDAPI_KEY || env.NEWS_RAPIDAPI_KEY || env.X_RAPIDAPI_KEY;
  return Boolean(key && env.SEEKING_ALPHA_DISABLED !== "1");
}
