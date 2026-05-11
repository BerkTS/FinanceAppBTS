/**
 * RapidAPI **Real-Time News Data** API
 * https://rapidapi.com — host: real-time-news-data.p.rapidapi.com
 * Uses the same RAPIDAPI_KEY as your other RapidAPI subscriptions.
 *
 * Default: GET /top-headlines (US, English, business category).
 */
import { headlineHash } from "../lib/hash.js";

const DEFAULT_HOST = "real-time-news-data.p.rapidapi.com";

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

async function fetchJson(url, rapidApiKey, host, maxRetries = 2) {
  let lastText = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(1000 * attempt);
    const res = await fetch(url, {
      headers: {
        "x-rapidapi-key": rapidApiKey,
        "x-rapidapi-host": host,
        Accept: "application/json",
      },
    });
    lastText = await res.text();
    if (res.status === 429 && attempt < maxRetries) continue;
    if (!res.ok) {
      throw new Error(`Real-Time News Data ${res.status}: ${lastText.slice(0, 280)}`);
    }
    try {
      return JSON.parse(lastText);
    } catch {
      throw new Error("Real-Time News Data: response was not JSON");
    }
  }
  throw new Error(`Real-Time News Data 429: ${lastText.slice(0, 200)}`);
}

function mapArticle(row) {
  if (!row?.title) return null;
  const source = row.source_name || "News";
  const title = row.title;
  return {
    id: headlineHash(title, row.article_id || source),
    contentKey: titleKey(title),
    title,
    description: row.snippet || "",
    url: row.link || "",
    publishedAt: row.published_datetime_utc || new Date().toISOString(),
    source,
    provider: "rapidapi_realtime_news_data",
    outlet: "real_time_news_data",
    categories: ["finance"],
  };
}

function envStr(env, primary, ...fallbacks) {
  for (const k of [primary, ...fallbacks]) {
    if (env[k] != null && String(env[k]).trim() !== "") return env[k];
  }
  return undefined;
}

/**
 * @returns {{ items: object[], errors: string[] }}
 */
export async function fetchRealTimeNewsDataHeadlines(env = process.env) {
  const rapidApiKey =
    env.RAPIDAPI_KEY || env.NEWS_RAPIDAPI_KEY || env.X_RAPIDAPI_KEY;
  const disabled =
    env.REALTIME_NEWS_DATA_DISABLED === "1" ||
    env.YAHOO_FINANCE_RAPIDAPI_DISABLED === "1";
  if (!rapidApiKey || disabled) {
    return { items: [], errors: [] };
  }

  const host =
    envStr(env, "REALTIME_NEWS_DATA_HOST", "YAHOO_FINANCE_RAPIDAPI_HOST") ||
    DEFAULT_HOST;
  const path =
    envStr(env, "REALTIME_NEWS_DATA_PATH", "YAHOO_FINANCE_RAPIDAPI_PATH") ||
    "/top-headlines";
  const country =
    envStr(env, "REALTIME_NEWS_DATA_COUNTRY", "YAHOO_FINANCE_RAPIDAPI_COUNTRY") ||
    "US";
  const lang =
    envStr(env, "REALTIME_NEWS_DATA_LANG", "YAHOO_FINANCE_RAPIDAPI_LANG") || "en";
  const category =
    envStr(
      env,
      "REALTIME_NEWS_DATA_CATEGORY",
      "YAHOO_FINANCE_RAPIDAPI_CATEGORY"
    ) ?? "business";
  const limitRaw =
    env.REALTIME_NEWS_DATA_LIMIT ?? env.YAHOO_FINANCE_RAPIDAPI_LIMIT;
  const limit = Math.min(
    40,
    Math.max(5, Number(limitRaw) || 15)
  );

  try {
    const qs = new URLSearchParams({
      country,
      lang,
      ...(category ? { category } : {}),
    });
    const url = `https://${host}${path}?${qs}`;
    const json = await fetchJson(url, rapidApiKey, host);
    if (json.status && json.status !== "OK") {
      throw new Error(JSON.stringify(json.error || json).slice(0, 300));
    }
    const data = Array.isArray(json.data) ? json.data : [];
    const items = data
      .slice(0, limit)
      .map(mapArticle)
      .filter(Boolean);
    return { items, errors: [] };
  } catch (e) {
    return { items: [], errors: [String(e.message || e)] };
  }
}

export function realTimeNewsDataConfigured(env = process.env) {
  const key =
    env.RAPIDAPI_KEY || env.NEWS_RAPIDAPI_KEY || env.X_RAPIDAPI_KEY;
  const disabled =
    env.REALTIME_NEWS_DATA_DISABLED === "1" ||
    env.YAHOO_FINANCE_RAPIDAPI_DISABLED === "1";
  return Boolean(key && !disabled);
}
