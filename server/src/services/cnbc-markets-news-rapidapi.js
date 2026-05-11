/**
 * CNBC Markets & News Data via RapidAPI
 * https://rapidapi.com — host: cnbc-markets-and-news-data.p.rapidapi.com
 * GET /news/{category} — valid categories include: latest, business, finance, economy, politics, technology.
 * Uses the same RAPIDAPI_KEY as your other RapidAPI subscriptions.
 */
import { headlineHash } from "../lib/hash.js";

const DEFAULT_HOST = "cnbc-markets-and-news-data.p.rapidapi.com";

const DEFAULT_CATEGORIES = [
  "latest",
  "business",
  "finance",
  "economy",
  "politics",
  "technology",
];

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
      },
    });
    lastText = await res.text();
    if (res.status === 429 && attempt < maxRetries) continue;
    if (!res.ok) {
      throw new Error(`CNBC Markets & News ${res.status}: ${lastText.slice(0, 280)}`);
    }
    try {
      return JSON.parse(lastText);
    } catch {
      throw new Error("CNBC Markets & News: response was not JSON");
    }
  }
  throw new Error(`CNBC Markets & News 429: ${lastText.slice(0, 200)}`);
}

function mapRow(row, category) {
  const title = row?.headline?.trim();
  if (!title) return null;
  const url = row.link || "";
  const id = headlineHash(title, `cnbc-${category}-${url}`);
  return {
    id,
    title,
    url,
    timeLabel: row.time || "",
    tag: row.tag || null,
    source: "CNBC",
    provider: "rapidapi_cnbc_markets_news",
    outlet: "cnbc_markets_news",
    cnbcCategory: category,
    categories: ["finance", category],
  };
}

function parseCategories(env) {
  const raw =
    env.CNBC_MARKETS_NEWS_CATEGORIES ||
    env.CNBC_NEWS_CATEGORIES ||
    DEFAULT_CATEGORIES.join(",");
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * @returns {{ items: object[], errors: string[] }}
 */
export async function fetchCnbcMarketsNews(env = process.env) {
  const rapidApiKey =
    env.RAPIDAPI_KEY || env.NEWS_RAPIDAPI_KEY || env.X_RAPIDAPI_KEY;
  if (!rapidApiKey || env.CNBC_MARKETS_NEWS_DISABLED === "1") {
    return { items: [], errors: [] };
  }

  const host = env.CNBC_MARKETS_NEWS_HOST || DEFAULT_HOST;
  const categories = parseCategories(env);
  const limit = Math.min(
    48,
    Math.max(8, Number(env.CNBC_MARKETS_NEWS_LIMIT) || 24)
  );
  const gap = Number(env.CNBC_MARKETS_NEWS_REQUEST_GAP_MS) || 550;

  const items = [];
  const errors = [];
  const seen = new Set();

  for (let i = 0; i < categories.length; i++) {
    const category = categories[i];
    if (i > 0) await sleep(gap);
    try {
      const url = `https://${host}/news/${encodeURIComponent(category)}`;
      const json = await fetchJson(url, rapidApiKey, host);
      const rows = Array.isArray(json?.data) ? json.data : [];
      for (const row of rows) {
        const mapped = mapRow(row, category);
        if (!mapped) continue;
        const key = mapped.url || mapped.title;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(mapped);
        if (items.length >= limit) break;
      }
    } catch (e) {
      errors.push(`${category}: ${e.message}`);
    }
    if (items.length >= limit) break;
  }

  return { items, errors };
}

export function cnbcMarketsNewsConfigured(env = process.env) {
  const key =
    env.RAPIDAPI_KEY || env.NEWS_RAPIDAPI_KEY || env.X_RAPIDAPI_KEY;
  return Boolean(key && env.CNBC_MARKETS_NEWS_DISABLED !== "1");
}
