import { headlineHash } from "../lib/hash.js";
import { fetchOutletBundle, outletConfigSummary } from "./outlet-feeds.js";
import { fetchRealtimeFinanceNewsBundle } from "./realtime-finance-rapidapi.js";

const STOPWORDS = new Set([
  "THE",
  "FOR",
  "AND",
  "ARE",
  "WAS",
  "HAS",
  "ITS",
  "CEO",
  "USA",
  "FED",
  "GDP",
  "IPO",
  "ETF",
  "NYSE",
  "AI",
  "UK",
  "EU",
  "UN",
]);

const GDELT_DOC = "https://api.gdeltproject.org/api/v2/doc/doc";

/** GDELT asks for ~1 request / 5s per client; we run finance then geo sequentially. */
const GDELT_INTER_REQUEST_MS = 5500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Finance-focused GDELT full-text query (OR groups). */
export const GDELT_QUERY_FINANCE =
  "(stock market OR earnings OR inflation OR federal reserve OR treasury OR IPO OR commodities OR trade deficit OR GDP OR recession OR banking)";

/** Geopolitical / macro risk query. */
export const GDELT_QUERY_GEOPOLITICAL =
  "(sanctions OR diplomacy OR NATO OR united nations OR geopolitics OR bilateral summit OR territorial OR ceasefire OR missile OR embassy OR OPEC OR BRICS)";

function normalizeTitleKey(title) {
  return (title || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 256);
}

/**
 * Cross-outlet dedupe: same headline text → one row; merges categories & providers.
 */
export function dedupeByContentKey(articles) {
  const map = new Map();
  for (const a of articles) {
    const key = a.contentKey || normalizeTitleKey(a.title);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...a,
        contentKey: key,
        categories: [...(a.categories || [])],
        providers: [a.provider].filter(Boolean),
      });
      continue;
    }
    const cats = new Set([...(existing.categories || []), ...(a.categories || [])]);
    const provs = new Set([...(existing.providers || []), a.provider].filter(Boolean));
    map.set(key, {
      ...existing,
      description: existing.description || a.description,
      url: existing.url || a.url,
      publishedAt: newerIso(existing.publishedAt, a.publishedAt),
      categories: [...cats],
      providers: [...provs],
      sentimentScore:
        a.sentimentScore != null ? a.sentimentScore : existing.sentimentScore,
    });
  }
  return [...map.values()].map((row) => ({
    ...row,
    id: headlineHash(row.title, [...(row.providers || [])].sort().join("|")),
  }));
}

function newerIso(a, b) {
  const ta = Date.parse(a) || 0;
  const tb = Date.parse(b) || 0;
  return tb > ta ? b : a;
}

/**
 * GDELT 2.0 DOC API — no key; rate-limit friendly (keep maxrecords modest).
 * @see https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 */
export async function fetchGdeltArticles({
  query,
  maxRecords = 40,
  category = "general",
}) {
  const params = new URLSearchParams({
    query,
    mode: "ArtList",
    format: "json",
    maxrecords: String(Math.min(75, Math.max(1, maxRecords))),
  });
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 25_000);
  let res;
  try {
    res = await fetch(`${GDELT_DOC}?${params}`, { signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GDELT error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const rawList = data.articles || data.artlist || [];
  const articles = rawList.map((row) => normalizeGdeltArticle(row, category));
  return dedupeArticles(articles);
}

function gdeltSeenToIso(seen) {
  if (!seen || String(seen).length < 14) return new Date().toISOString();
  const s = String(seen);
  const y = s.slice(0, 4);
  const m = s.slice(4, 6);
  const d = s.slice(6, 8);
  const H = s.slice(8, 10);
  const M = s.slice(10, 12);
  const S = s.slice(12, 14);
  return `${y}-${m}-${d}T${H}:${M}:${S}Z`;
}

function normalizeGdeltArticle(row, category) {
  const title = row.title || row.Title || "";
  const domain = row.domain || row.Domain || "gdelt";
  const base = normalizeArticle(
    {
      title,
      description: row.excerpt || row.description || "",
      url: row.url || row.URL || "",
      publishedAt: gdeltSeenToIso(row.seendate || row.seenDate || row.date),
      source: { name: domain },
    },
    "gdelt",
    { categories: [category] }
  );
  return { ...base, contentKey: normalizeTitleKey(title) };
}

/**
 * Alpha Vantage NEWS_SENTIMENT — optional; free tier is rate-limited.
 * @see https://www.alphavantage.co/documentation/#news-sentiment
 */
export async function fetchAlphaVantageNews({
  apiKey,
  topics = "financial_markets,economy_macro",
  limit = 50,
  tickers = "",
}) {
  if (!apiKey) return [];
  const params = new URLSearchParams({
    function: "NEWS_SENTIMENT",
    apikey: apiKey,
    limit: String(Math.min(200, Math.max(1, limit))),
  });
  if (topics) params.set("topics", topics);
  if (tickers) params.set("tickers", tickers);

  const res = await fetch(`https://www.alphavantage.co/query?${params}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpha Vantage error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data["Error Message"] || data["Note"]) {
    throw new Error(
      `Alpha Vantage: ${data["Error Message"] || data["Note"] || "unknown"}`
    );
  }
  const feed = data.feed || [];
  return feed.map((item) => normalizeAlphaArticle(item));
}

function avTimeToIso(tp) {
  if (!tp || tp.length < 15) return new Date().toISOString();
  const y = tp.slice(0, 4);
  const m = tp.slice(4, 6);
  const d = tp.slice(6, 8);
  const H = tp.slice(9, 11);
  const M = tp.slice(11, 13);
  const S = tp.slice(13, 15);
  return `${y}-${m}-${d}T${H}:${M}:${S}Z`;
}

function normalizeAlphaArticle(item) {
  const title = item.title || "";
  const topics = (item.topics || []).map((t) => t.topic || t).filter(Boolean);
  const cats = [];
  const tjoined = topics.join(" ").toLowerCase();
  if (
    /financial|market|earnings|economy|monetary|fiscal|ipo|mergers/i.test(tjoined)
  ) {
    cats.push("finance");
  }
  if (/macro|economy|politics|energy|transport/i.test(tjoined)) {
    cats.push("geopolitical");
  }
  if (cats.length === 0) cats.push("finance");

  const score = parseFloat(item.overall_sentiment_score, 10);
  const base = normalizeArticle(
    {
      title,
      description: item.summary || "",
      url: item.url || "",
      publishedAt: avTimeToIso(item.time_published),
      source: { name: item.source || "alphavantage" },
    },
    "alphavantage",
    {
      categories: cats,
      sentimentScore: Number.isFinite(score) ? score : null,
    }
  );
  return { ...base, contentKey: normalizeTitleKey(title) };
}

/**
 * NewsAPI everything — one query; requires key.
 */
export async function fetchNewsApiEverything({ apiKey, query, pageSize = 30, category }) {
  if (!apiKey) {
    return { source: "mock", articles: mockFinancialHeadlines() };
  }
  const params = new URLSearchParams({
    q: query || "stocks economy geopolitical",
    sortBy: "publishedAt",
    pageSize: String(Math.min(100, pageSize)),
    language: "en",
    apiKey,
  });
  const res = await fetch(`https://newsapi.org/v2/everything?${params}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NewsAPI error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const articles = (data.articles || []).map((a) =>
    normalizeArticle(a, "newsapi", {
      categories: category ? [category] : ["finance", "geopolitical"],
    })
  );
  return {
    source: "newsapi",
    articles: dedupeArticles(
      articles.map((a) => ({ ...a, contentKey: normalizeTitleKey(a.title) }))
    ),
  };
}

/**
 * Parallel finance + geopolitical pulls from NewsAPI (two queries).
 */
export async function fetchNewsApiFinanceAndGeo({
  apiKey,
  financeQuery = "(stocks OR earnings OR inflation OR IPO OR \"stock market\" OR fed OR treasury)",
  geoQuery = "(geopolitical OR sanctions OR NATO OR diplomacy OR \"United Nations\" OR conflict OR ceasefire)",
  pageSize = 25,
}) {
  if (!apiKey) return [];
  const [fin, geo] = await Promise.all([
    fetchNewsApiEverything({
      apiKey,
      query: financeQuery,
      pageSize,
      category: "finance",
    }).then((r) => r.articles),
    fetchNewsApiEverything({
      apiKey,
      query: geoQuery,
      pageSize,
      category: "geopolitical",
    }).then((r) => r.articles),
  ]);
  return [...fin, ...geo];
}

function normalizeArticle(raw, provider, extra = {}) {
  const title = raw.title || "";
  const sourceName =
    raw.source?.name || raw.source_id || raw.domain || provider || "unknown";
  const categories = extra.categories || [];
  const sentimentScore =
    extra.sentimentScore != null ? extra.sentimentScore : undefined;
  return {
    id: headlineHash(title, sourceName),
    contentKey: normalizeTitleKey(title),
    title,
    description: raw.description || "",
    url: raw.url || raw.link || "",
    publishedAt: raw.publishedAt || raw.pubDate || new Date().toISOString(),
    source: sourceName,
    provider,
    categories,
    ...(sentimentScore != null ? { sentimentScore } : {}),
  };
}

function dedupeArticles(articles) {
  const seen = new Map();
  for (const a of articles) {
    if (!seen.has(a.id)) seen.set(a.id, a);
  }
  return [...seen.values()];
}

function mockFinancialHeadlines() {
  const now = Date.now();
  return dedupeByContentKey(
    [
      {
        title: "AAPL suppliers report strong Q demand as services grow",
        source: { name: "MockWire" },
        publishedAt: new Date(now - 3600_000).toISOString(),
        url: "https://example.com/aapl",
        description: "",
        categories: ["finance"],
        provider: "mock",
      },
      {
        title: "NVDA sees data center momentum; MSFT cloud ties in focus",
        source: { name: "MockWire" },
        publishedAt: new Date(now - 7200_000).toISOString(),
        url: "https://example.com/nvda",
        description: "",
        categories: ["finance"],
        provider: "mock",
      },
      {
        title: "TSLA delivery numbers watched as EV competition heats up",
        source: { name: "MockWire" },
        publishedAt: new Date(now - 10_800_000).toISOString(),
        url: "https://example.com/tsla",
        description: "",
        categories: ["finance"],
        provider: "mock",
      },
      {
        title: "Major economies weigh sanctions after regional security incident",
        source: { name: "MockWire" },
        publishedAt: new Date(now - 5400_000).toISOString(),
        url: "https://example.com/geo",
        description: "",
        categories: ["geopolitical"],
        provider: "mock",
      },
    ].map((a) => ({
      ...normalizeArticle(a, a.provider || "mock", { categories: a.categories }),
    }))
  );
}

/**
 * Aggregate finance + geopolitical news from GDELT, NewsAPI, and optional Alpha Vantage.
 * Works without NewsAPI key (GDELT only); uses mock only if every source fails or returns empty.
 */
export async function fetchFinanceAndGeopoliticalNews({
  newsApiKey = process.env.NEWS_API_KEY,
  alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY,
  maxGdelt = 35,
  maxNewsApiPerChannel = 28,
  maxAlphaVantage = 40,
  newsApiFinanceQuery = process.env.NEWSAPI_FINANCE_QUERY,
  newsApiGeoQuery = process.env.NEWSAPI_GEO_QUERY,
} = {}) {
  const errors = [];

  const gdeltFinance = await (async () => {
    try {
      return await fetchGdeltArticles({
        query: GDELT_QUERY_FINANCE,
        maxRecords: maxGdelt,
        category: "finance",
      });
    } catch (e) {
      errors.push({ source: "gdelt", channel: "finance", error: String(e.message || e) });
      return [];
    }
  })();

  await sleep(GDELT_INTER_REQUEST_MS);

  const gdeltGeo = await (async () => {
    try {
      return await fetchGdeltArticles({
        query: GDELT_QUERY_GEOPOLITICAL,
        maxRecords: maxGdelt,
        category: "geopolitical",
      });
    } catch (e) {
      errors.push({
        source: "gdelt",
        channel: "geopolitical",
        error: String(e.message || e),
      });
      return [];
    }
  })();

  const otherJobs = [];

  if (newsApiKey) {
    otherJobs.push(
      (async () => {
        try {
          return await fetchNewsApiFinanceAndGeo({
            apiKey: newsApiKey,
            financeQuery:
              newsApiFinanceQuery ||
              '(stocks OR earnings OR inflation OR IPO OR "stock market" OR fed OR treasury OR commodities)',
            geoQuery:
              newsApiGeoQuery ||
              '(geopolitical OR sanctions OR NATO OR diplomacy OR "United Nations" OR conflict OR ceasefire OR OPEC)',
            pageSize: maxNewsApiPerChannel,
          });
        } catch (e) {
          errors.push({ source: "newsapi", error: String(e.message || e) });
          return [];
        }
      })()
    );
  }

  if (alphaVantageKey) {
    otherJobs.push(
      (async () => {
        try {
          return await fetchAlphaVantageNews({
            apiKey: alphaVantageKey,
            topics: "financial_markets,economy_macro,finance",
            limit: maxAlphaVantage,
          });
        } catch (e) {
          errors.push({ source: "alphavantage", error: String(e.message || e) });
          return [];
        }
      })()
    );
  }

  const allJobs = [fetchOutletBundle(), ...otherJobs];
  const jobResults = await Promise.all(allJobs);
  const outletBundle = jobResults[0];
  const restParts = jobResults.slice(1);
  errors.push(...outletBundle.errors);

  /** After other feeds (avoids RapidAPI 429 from parallel calls on the same key). */
  const realtimeResult = await fetchRealtimeFinanceNewsBundle();
  if (realtimeResult.errors?.length) {
    errors.push({
      source: "rapidapi_realtime_finance",
      error: realtimeResult.errors.slice(0, 5).join(" | "),
    });
  }

  let merged = dedupeByContentKey([
    ...gdeltFinance,
    ...gdeltGeo,
    ...outletBundle.articles,
    ...(realtimeResult.articles || []),
    ...restParts.flat(),
  ]);

  const outletCfg = outletConfigSummary();
  const attempted = [
    "gdelt_finance",
    "gdelt_geopolitical",
    ...Object.entries(outletCfg)
      .filter(([, on]) => on)
      .map(([k]) => `outlet:${k}`),
    ...(newsApiKey ? ["newsapi_finance_geo"] : []),
    ...(alphaVantageKey ? ["alphavantage"] : []),
  ];

  let sourceSummary = {
    gdelt: true,
    newsapi: Boolean(newsApiKey),
    alphavantage: Boolean(alphaVantageKey),
    outlets: outletCfg,
  };

  if (merged.length === 0) {
    merged = mockFinancialHeadlines();
    sourceSummary = { ...sourceSummary, fallback: "mock" };
  }

  merged.sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));

  return {
    articles: merged,
    attempted,
    sources: sourceSummary,
    errors,
  };
}

/**
 * Crude sentiment: keyword buckets; uses API score when present.
 */
export function scoreHeadlineSentiment(title, article) {
  if (article?.sentimentScore != null && Number.isFinite(article.sentimentScore)) {
    return Math.max(-1, Math.min(1, article.sentimentScore));
  }
  const t = (title || "").toLowerCase();
  const pos = ["beat", "growth", "strong", "surge", "record", "upgrade", "bull"];
  const neg = ["miss", "lawsuit", "probe", "downgrade", "layoff", "weak", "bear", "crash"];
  let score = 0;
  for (const w of pos) if (t.includes(w)) score += 0.15;
  for (const w of neg) if (t.includes(w)) score -= 0.15;
  return Math.max(-1, Math.min(1, Math.round(score * 100) / 100));
}

const TICKER_RE = /\b([A-Z]{1,5})\b/g;

export function extractTickersFromArticles(articles) {
  const counts = new Map();
  const sentimentByTicker = new Map();
  for (const a of articles) {
    const text = `${a.title} ${a.description || ""}`;
    const sent = scoreHeadlineSentiment(a.title, a);
    let m;
    const seenInArticle = new Set();
    TICKER_RE.lastIndex = 0;
    while ((m = TICKER_RE.exec(text)) !== null) {
      const sym = m[1];
      if (sym.length < 2 || STOPWORDS.has(sym)) continue;
      if (!seenInArticle.has(sym)) {
        seenInArticle.add(sym);
        counts.set(sym, (counts.get(sym) || 0) + 1);
        sentimentByTicker.set(sym, (sentimentByTicker.get(sym) || 0) + sent);
      }
    }
  }
  return [...counts.entries()]
    .map(([symbol, mentions]) => ({
      symbol,
      mentions,
      avgSentiment:
        Math.round((sentimentByTicker.get(symbol) / mentions) * 100) / 100,
    }))
    .sort((a, b) => b.mentions - a.mentions);
}
