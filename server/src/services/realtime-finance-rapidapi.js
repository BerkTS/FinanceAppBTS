/**
 * RapidAPI: Real-Time Finance Data — Stock News & Currency News.
 * Host: real-time-finance-data.p.rapidapi.com
 * Set RAPIDAPI_KEY in .env (never commit secrets).
 *
 * Fetched sequentially with spacing + 429 retries so it survives parallel load on other RapidAPI calls.
 */
import { headlineHash } from "../lib/hash.js";

const DEFAULT_HOST = "real-time-finance-data.p.rapidapi.com";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function titleKey(title) {
  return (title || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 256);
}

function rowArticle({
  title,
  url,
  description,
  publishedAt,
  source,
  outlet,
  categories,
  context,
}) {
  const t = title || "";
  const tag = context ? `${source} (${context})` : source;
  return {
    id: headlineHash(t, tag),
    contentKey: titleKey(t),
    title: t,
    description: description || "",
    url: url || "",
    publishedAt: publishedAt || new Date().toISOString(),
    source: tag,
    provider: "rapidapi_realtime_finance",
    outlet,
    categories,
    realtimeContext: context || null,
  };
}

function extractItemArrays(data) {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data)) return data;

  if (data.data && typeof data.data === "object") {
    const inner = data.data;
    const nestedKeys = ["news", "articles", "items", "stories", "results"];
    for (const k of nestedKeys) {
      if (Array.isArray(inner[k])) return inner[k];
    }
  }

  const keys = [
    "news",
    "data",
    "results",
    "articles",
    "items",
    "stories",
    "feed",
    "stock_news",
    "currency_news",
  ];
  for (const k of keys) {
    const v = data[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

function normalizeUtcDate(v) {
  if (!v || typeof v !== "string") return null;
  const trimmed = v.trim();
  const isoGuess = trimmed.includes("T")
    ? trimmed
    : `${trimmed.replace(" ", "T")}Z`;
  const ms = Date.parse(isoGuess);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function mapNewsItem(item, channel, context) {
  if (!item || typeof item !== "object") return null;
  const title =
    item.article_title ||
    item.title ||
    item.headline ||
    item.name ||
    (typeof item.summary === "string" ? item.summary.slice(0, 200) : null);
  if (!title) return null;
  const url =
    item.article_url ||
    item.url ||
    item.link ||
    item.news_url ||
    item.canonical_url ||
    "";
  const description =
    item.description ||
    item.summary ||
    item.snippet ||
    item.content ||
    "";
  const publishedAt =
    normalizeUtcDate(item.post_time_utc) ||
    normalizeUtcDate(item.post_time) ||
    (item.date && normalizeUtcDate(item.date)) ||
    item.datetime ||
    item.published_at ||
    item.pub_date ||
    item.time ||
    item.created_at;
  const source =
    item.source ||
    item.publisher ||
    item.site ||
    (channel === "currency" ? "Currency News" : "Stock News");

  return rowArticle({
    title,
    url,
    description,
    publishedAt,
    source,
    outlet:
      channel === "currency"
        ? "realtime_finance_currency"
        : "realtime_finance_stock",
    categories: channel === "currency" ? ["finance", "fx"] : ["finance"],
    context,
  });
}

function parseResponse(json, channel, context) {
  return extractItemArrays(json)
    .map((item) => mapNewsItem(item, channel, context))
    .filter(Boolean);
}

function parseFxPair(raw) {
  const s = raw.trim().toUpperCase();
  if (s.includes(":")) {
    const [from, to] = s.split(":").map((x) => x.trim()).filter(Boolean);
    if (from && to) return { from_symbol: from, to_symbol: to };
  }
  if (/^[A-Z]{6}$/.test(s)) {
    return { from_symbol: s.slice(0, 3), to_symbol: s.slice(3, 6) };
  }
  return null;
}

async function fetchJson(url, rapidApiKey, host, maxRetries = 2) {
  let lastText = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(1200 * attempt);
    }
    const res = await fetch(url, {
      headers: {
        "x-rapidapi-key": rapidApiKey,
        "x-rapidapi-host": host,
        Accept: "application/json",
      },
    });
    lastText = await res.text();
    if (res.status === 429 && attempt < maxRetries) {
      continue;
    }
    if (!res.ok) {
      throw new Error(`Real-Time Finance ${res.status}: ${lastText.slice(0, 280)}`);
    }
    try {
      return JSON.parse(lastText);
    } catch {
      throw new Error("Real-Time Finance: response was not JSON");
    }
  }
  throw new Error(`Real-Time Finance 429: ${lastText.slice(0, 200)}`);
}

/**
 * @returns {{ articles: Array, errors: string[] }} Never throws.
 */
export async function fetchRealtimeFinanceNewsBundle(env = process.env) {
  const rapidApiKey =
    env.RAPIDAPI_KEY || env.NEWS_RAPIDAPI_KEY || env.X_RAPIDAPI_KEY;
  if (!rapidApiKey || env.REALTIME_FINANCE_NEWS === "0") {
    return { articles: [], errors: [] };
  }

  const host = env.REALTIME_FINANCE_HOST || DEFAULT_HOST;
  const stockPath = env.REALTIME_FINANCE_STOCK_PATH || "/stock-news";
  const currencyPath = env.REALTIME_FINANCE_CURRENCY_PATH || "/currency-news";

  const symbols = (env.REALTIME_STOCK_SYMBOLS || "SPY,AAPL")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);

  const pairs = (env.REALTIME_CURRENCY_PAIRS || "EURUSD")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);

  const out = [];
  const failures = [];
  const pauseMs = Number(env.REALTIME_FINANCE_REQUEST_GAP_MS) || 1200;

  try {
    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      if (i > 0) await sleep(pauseMs);
      try {
        const qs = new URLSearchParams({ symbol });
        const url = `https://${host}${stockPath}?${qs}`;
        const json = await fetchJson(url, rapidApiKey, host);
        out.push(...parseResponse(json, "stock", symbol));
      } catch (e) {
        failures.push(`stock ${symbol}: ${e.message}`);
      }
    }

    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const fx = parseFxPair(pair);
      if (!fx) {
        failures.push(`fx ${pair}: use six-letter majors (EURUSD) or EUR:USD`);
        continue;
      }
      await sleep(pauseMs);
      try {
        const qs = new URLSearchParams(fx);
        const url = `https://${host}${currencyPath}?${qs}`;
        const json = await fetchJson(url, rapidApiKey, host);
        const label = `${fx.from_symbol}${fx.to_symbol}`;
        out.push(...parseResponse(json, "currency", label));
      } catch (e) {
        failures.push(`fx ${pair}: ${e.message}`);
      }
    }
  } catch (e) {
    failures.push(String(e.message || e));
  }

  return { articles: out, errors: failures };
}

export function realtimeFinanceConfigured(env = process.env) {
  const key =
    env.RAPIDAPI_KEY || env.NEWS_RAPIDAPI_KEY || env.X_RAPIDAPI_KEY;
  return Boolean(key && env.REALTIME_FINANCE_NEWS !== "0");
}
