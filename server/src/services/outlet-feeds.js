/**
 * Named-outlet news wiring: Yahoo RSS (no key), NewsAPI domains, RapidAPI URLs, AP Media API.
 * Bloomberg / Reuters / CNBC rarely offer a single public “outlet API key”; this module uses
 * practical paths (RSS, NewsAPI domain filter, RapidAPI hubs, AP contract key).
 */
import RSSParser from "rss-parser";
import { headlineHash } from "../lib/hash.js";
import { realtimeFinanceConfigured } from "./realtime-finance-rapidapi.js";

const parser = new RSSParser({
  timeout: 20_000,
  headers: {
    "User-Agent": "FinanceApp/1.0 (news aggregation)",
  },
});

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
  provider,
  categories = ["finance"],
  outlet,
}) {
  const sourceName = source || outlet || provider;
  const t = title || "";
  return {
    id: headlineHash(t, sourceName),
    contentKey: titleKey(t),
    title: t,
    description: description || "",
    url: url || "",
    publishedAt: publishedAt || new Date().toISOString(),
    source: sourceName,
    provider,
    outlet: outlet || provider,
    categories,
  };
}

/**
 * Yahoo Finance headline RSS — no API key.
 * @see https://finance.yahoo.com (RSS linked from ticker pages)
 */
export async function fetchYahooFinanceRss({
  tickers = "AAPL,MSFT,GOOGL,^GSPC",
  maxItemsPerFeed = 12,
} = {}) {
  const list = tickers
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return [];

  const urls = list.map(
    (sym) =>
      `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(
        sym
      )}&region=US&lang=en-US`
  );

  const acc = [];
  for (const feedUrl of urls.slice(0, 8)) {
    try {
      const feed = await parser.parseURL(feedUrl);
      for (const item of feed.items || []) {
        acc.push(
          rowArticle({
            title: item.title,
            url: item.link,
            description: item.contentSnippet || item.summary || "",
            publishedAt: item.pubDate || item.isoDate,
            source: "Yahoo Finance",
            provider: "yahoo_finance_rss",
            outlet: "yahoo_finance",
            categories: ["finance"],
          })
        );
        if (acc.length >= maxItemsPerFeed * urls.length) break;
      }
    } catch {
      /* one ticker feed may fail; continue */
    }
  }
  return acc.slice(0, maxItemsPerFeed * Math.min(urls.length, 8));
}

/**
 * NewsAPI /v2/everything with domains= — one key, outlet-branded articles.
 * Works for CNBC, etc., when your NewsAPI plan allows those domains.
 */
export async function fetchNewsApiByDomains({
  apiKey,
  domains,
  pageSize = 30,
}) {
  if (!apiKey || !domains?.length) return [];
  const params = new URLSearchParams({
    domains: domains.join(","),
    language: "en",
    sortBy: "publishedAt",
    pageSize: String(Math.min(100, pageSize)),
    apiKey,
  });
  const res = await fetch(`https://newsapi.org/v2/everything?${params}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NewsAPI domains ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.articles || []).map((a) => {
    const host = (() => {
      try {
        return new URL(a.url || "").hostname.replace(/^www\./, "");
      } catch {
        return a.source?.name || "newsapi";
      }
    })();
    return rowArticle({
      title: a.title,
      url: a.url,
      description: a.description || "",
      publishedAt: a.publishedAt,
      source: a.source?.name || host,
      provider: "newsapi_domains",
      outlet: host,
      categories: ["finance"],
    });
  });
}

/**
 * RapidAPI: paste the full GET URL from the RapidAPI “Code snippets” tab.
 * Headers: x-rapidapi-key, x-rapidapi-host (host from URL).
 */
export async function fetchRapidApiGet(fullUrl, rapidApiKey, outletLabel) {
  if (!fullUrl?.trim() || !rapidApiKey) return [];
  const u = new URL(fullUrl);
  const host = u.hostname;
  const res = await fetch(fullUrl, {
    headers: {
      "x-rapidapi-key": rapidApiKey,
      "x-rapidapi-host": host,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `RapidAPI ${outletLabel} ${res.status}: ${text.slice(0, 200)}`
    );
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`RapidAPI ${outletLabel}: expected JSON`);
  }
  return normalizeRapidApiPayload(data, outletLabel);
}

function normalizeRapidApiPayload(data, outletLabel) {
  let arr = null;
  if (Array.isArray(data)) arr = data;
  else {
    for (const key of [
      "articles",
      "data",
      "results",
      "news",
      "items",
      "stories",
      "feed",
    ]) {
      const v = data?.[key];
      if (Array.isArray(v)) {
        arr = v;
        break;
      }
    }
  }
  if (!arr) return [];

  return arr
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const title =
        item.title || item.headline || item.name || item.shortHeadline;
      const url =
        item.url ||
        item.link ||
        item.canonicalUrl ||
        item.shareUrl ||
        item.webUrl;
      if (!title) return null;
      return rowArticle({
        title,
        url,
        description:
          item.description ||
          item.summary ||
          item.teaser ||
          item.abstract ||
          "",
        publishedAt:
          item.pubDate ||
          item.publishedAt ||
          item.date ||
          item.datetime ||
          item.updatedAt,
        source: item.source || item.provider || outletLabel,
        provider: `rapidapi_${outletLabel}`,
        outlet: outletLabel,
        categories: ["finance"],
      });
    })
    .filter(Boolean);
}

/**
 * Associated Press Media API (contract / x-api-key).
 * @see https://developer.ap.org/ap-media-api/
 */
export async function fetchApMediaFeed({ apiKey, feedUrl }) {
  if (!apiKey || !feedUrl?.trim()) return [];
  const res = await fetch(feedUrl, {
    headers: {
      "x-api-key": apiKey,
      Accept: "application/atom+xml, application/xml, text/xml, */*",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`AP Media ${res.status}: ${text.slice(0, 200)}`);
  }
  const feed = await parser.parseString(text);
  return (feed.items || []).map((item) =>
    rowArticle({
      title: item.title,
      url: item.link,
      description: item.contentSnippet || item.summary || "",
      publishedAt: item.pubDate || item.isoDate,
      source: "Associated Press",
      provider: "ap_media",
      outlet: "ap",
      categories: ["finance", "geopolitical"],
    })
  );
}

function parseDomainList(raw) {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,|\s]+/)
    .map((d) => d.trim().toLowerCase().replace(/^www\./, ""))
    .filter(Boolean);
}

/**
 * Pull all configured outlet feeds; failures are collected per source.
 */
export async function fetchOutletBundle(env = process.env) {
  const errors = [];
  const articles = [];

  const push = (label, rows) => {
    articles.push(...rows);
  };

  const run = async (label, fn) => {
    try {
      const rows = await fn();
      push(label, rows);
    } catch (e) {
      errors.push({ source: label, error: String(e.message || e) });
    }
  };

  const rapidKey =
    env.RAPIDAPI_KEY || env.NEWS_RAPIDAPI_KEY || env.X_RAPIDAPI_KEY;

  await Promise.all([
    run("yahoo_finance_rss", () =>
      env.DISABLE_YAHOO_RSS === "1"
        ? []
        : fetchYahooFinanceRss({
            tickers: env.YAHOO_FINANCE_RSS_TICKERS || "AAPL,MSFT,GOOGL,^GSPC",
            maxItemsPerFeed: Number(env.YAHOO_RSS_MAX_PER_FEED) || 12,
          })
    ),
    run("newsapi_domains", () => {
      const domains = parseDomainList(env.NEWSAPI_OUTLET_DOMAINS);
      if (!env.NEWS_API_KEY || domains.length === 0) return [];
      return fetchNewsApiByDomains({
        apiKey: env.NEWS_API_KEY,
        domains,
        pageSize: Number(env.NEWSAPI_OUTLET_PAGE_SIZE) || 30,
      });
    }),
    run("rapidapi_cnbc", () =>
      env.RAPIDAPI_CNBC_URL
        ? fetchRapidApiGet(env.RAPIDAPI_CNBC_URL, rapidKey, "cnbc")
        : []
    ),
    run("rapidapi_reuters", () =>
      env.RAPIDAPI_REUTERS_URL
        ? fetchRapidApiGet(env.RAPIDAPI_REUTERS_URL, rapidKey, "reuters")
        : []
    ),
    run("rapidapi_bloomberg", () =>
      env.RAPIDAPI_BLOOMBERG_URL
        ? fetchRapidApiGet(env.RAPIDAPI_BLOOMBERG_URL, rapidKey, "bloomberg")
        : []
    ),
    run("ap_media", () => {
      const key = env.AP_MEDIA_API_KEY;
      const url =
        env.AP_MEDIA_FEED_URL ||
        (env.AP_MEDIA_FEED_QUERY
          ? `https://api.ap.org/media/v/content/feed?q=${encodeURIComponent(
              env.AP_MEDIA_FEED_QUERY
            )}`
          : "");
      if (!key || !url) return [];
      return fetchApMediaFeed({ apiKey: key, feedUrl: url });
    }),
  ]);

  return { articles, errors };
}

export function outletConfigSummary(env = process.env) {
  const rapidKey = Boolean(
    env.RAPIDAPI_KEY || env.NEWS_RAPIDAPI_KEY || env.X_RAPIDAPI_KEY
  );
  return {
    yahoo_finance_rss: env.DISABLE_YAHOO_RSS !== "1",
    newsapi_domains: Boolean(
      env.NEWS_API_KEY && parseDomainList(env.NEWSAPI_OUTLET_DOMAINS).length
    ),
    rapidapi_cnbc: rapidKey && Boolean(env.RAPIDAPI_CNBC_URL),
    rapidapi_reuters: rapidKey && Boolean(env.RAPIDAPI_REUTERS_URL),
    rapidapi_bloomberg: rapidKey && Boolean(env.RAPIDAPI_BLOOMBERG_URL),
    rapidapi_realtime_finance: realtimeFinanceConfigured(env),
    ap_media: Boolean(env.AP_MEDIA_API_KEY && (env.AP_MEDIA_FEED_URL || env.AP_MEDIA_FEED_QUERY)),
  };
}
