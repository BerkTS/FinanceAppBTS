/**
 * Reuters Business and Financial News via RapidAPI
 * https://rapidapi.com/makingdatameaningful/api/reuters-business-and-financial-news
 * Host: reuters-business-and-financial-news.p.rapidapi.com
 *
 * GET /get-articles-between-dates/{fromDate}/{toDate}/{page}/{limit}
 * Dates: YYYY-MM-DD (UTC). Uses the same RAPIDAPI_KEY as your other RapidAPI subscriptions.
 */
import { headlineHash } from "../lib/hash.js";

const DEFAULT_HOST = "reuters-business-and-financial-news.p.rapidapi.com";
const REUTERS_ORIGIN = "https://www.reuters.com";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function utcYmd(d) {
  return d.toISOString().slice(0, 10);
}

function decodeEntities(htmlish) {
  if (!htmlish) return "";
  return String(htmlish)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number(n);
      return c >= 32 && c < 0x110000 ? String.fromCodePoint(c) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const c = parseInt(h, 16);
      return c >= 32 && c < 0x110000 ? String.fromCodePoint(c) : " ";
    })
    .replace(/\s+/g, " ")
    .trim();
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
      throw new Error(`Reuters Business News ${res.status}: ${lastText.slice(0, 280)}`);
    }
    try {
      return JSON.parse(lastText);
    } catch {
      throw new Error("Reuters Business News: response was not JSON");
    }
  }
  throw new Error(`Reuters Business News 429: ${lastText.slice(0, 200)}`);
}

function articleUrl(row) {
  const p = row?.urlSupplier || row?.canonicalSupplier;
  if (!p) return "";
  if (p.startsWith("http")) return p;
  const path = p.startsWith("/") ? p : `/${p}`;
  return `${REUTERS_ORIGIN}${path}`;
}

function mapArticle(row) {
  const title = row?.articlesName?.trim();
  if (!title) return null;
  const id = String(row.articlesId ?? headlineHash(title, "reuters"));
  const pub = row.publishedAt?.date;
  const publishedAt = pub
    ? new Date(pub.replace(" ", "T") + "Z").toISOString()
    : new Date().toISOString();
  return {
    id: `reuters-${id}`,
    title,
    description: decodeEntities(row.articlesShortDescription || ""),
    url: articleUrl(row),
    publishedAt,
    source: "Reuters",
    provider: "rapidapi_reuters_business_news",
    outlet: "reuters_business_news",
    categoryName: row.categoryName || "",
    categoryId: row.categoryId,
  };
}

/**
 * @returns {{ items: object[], errors: string[] }}
 */
export async function fetchReutersBusinessNews(env = process.env) {
  const rapidApiKey =
    env.RAPIDAPI_KEY || env.NEWS_RAPIDAPI_KEY || env.X_RAPIDAPI_KEY;
  if (!rapidApiKey || env.REUTERS_BUSINESS_NEWS_DISABLED === "1") {
    return { items: [], errors: [] };
  }

  const host = env.REUTERS_BUSINESS_NEWS_HOST || DEFAULT_HOST;
  const limit = Math.min(
    40,
    Math.max(5, Number(env.REUTERS_BUSINESS_NEWS_LIMIT) || 18)
  );
  const days = Math.min(
    14,
    Math.max(1, Number(env.REUTERS_BUSINESS_NEWS_LOOKBACK_DAYS) || 5)
  );
  const page = Math.max(0, Number(env.REUTERS_BUSINESS_NEWS_PAGE) || 0);

  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const toDate = utcYmd(end);
  const fromDate = utcYmd(start);

  try {
    const path = `/get-articles-between-dates/${fromDate}/${toDate}/${page}/${limit}`;
    const url = `https://${host}${path}`;
    const json = await fetchJson(url, rapidApiKey, host);
    const rows = Array.isArray(json?.articles) ? json.articles : [];
    const items = rows.map(mapArticle).filter(Boolean);
    return { items, errors: [] };
  } catch (e) {
    return { items: [], errors: [String(e.message || e)] };
  }
}

export function reutersBusinessNewsConfigured(env = process.env) {
  const key =
    env.RAPIDAPI_KEY || env.NEWS_RAPIDAPI_KEY || env.X_RAPIDAPI_KEY;
  return Boolean(key && env.REUTERS_BUSINESS_NEWS_DISABLED !== "1");
}
