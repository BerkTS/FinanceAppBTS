import { fetchFinanceAndGeopoliticalNews } from "./news.js";
import { discoverTopStocks } from "./discovery.js";
import { fetchSeekingAlphaInsights } from "./seeking-alpha-rapidapi.js";
import { fetchRealTimeNewsDataHeadlines } from "./realtime-news-data-rapidapi.js";
import { fetchCnbcMarketsNews } from "./cnbc-markets-news-rapidapi.js";
import { fetchReutersBusinessNews } from "./reuters-business-news-rapidapi.js";
import { fetchYahooFinanceMarketNews } from "./yahoo-finance-rapidapi.js";
import {
  getCachedOrNull,
  setCache,
  getFeedCacheTtl,
  getDiscoverPayloadCacheTtl,
} from "./feed-cache.js";

async function cachedFeed(key, fetchFn, env) {
  const ttl = getFeedCacheTtl(env);
  const hit = getCachedOrNull(key, ttl);
  if (hit) return hit;
  const result = await fetchFn();
  setCache(key, result);
  return result;
}

/**
 * Loads the same data as GET /api/discover/top (news + rankings + outlet feeds).
 * Used by the discover route and by the AI briefing endpoint.
 * Results are cached to avoid redundant RapidAPI calls across endpoints.
 */
export async function fetchDiscoverPayload({
  limit = 60,
  newsApiKey,
  alphaVantageKey,
  newsApiFinanceQuery,
  newsApiGeoQuery,
  sessionId,
  getSchwabTokenForSession,
}) {
  const env = process.env;
  const payloadTtl = getDiscoverPayloadCacheTtl(env);
  const payloadKey = `discover_payload:${sessionId || "default"}`;
  const cached = getCachedOrNull(payloadKey, payloadTtl);
  if (cached) return cached;

  const cap = Math.min(120, Number(limit) || 60);
  const news = await cachedFeed(
    "feed:news_main",
    () =>
      fetchFinanceAndGeopoliticalNews({
        newsApiKey,
        alphaVantageKey,
        maxGdelt: Math.min(45, Math.ceil(cap / 2)),
        maxNewsApiPerChannel: Math.min(35, Math.ceil(cap / 3)),
        maxAlphaVantage: Math.min(50, cap),
        newsApiFinanceQuery,
        newsApiGeoQuery,
      }),
    env
  );

  const sess = getSchwabTokenForSession(sessionId);
  const accessToken = sess?.access_token;
  const result = await discoverTopStocks({
    articles: news.articles.slice(0, cap),
    accessToken,
  });

  const realtimeFinanceNews = news.articles
    .filter((a) => a.provider === "rapidapi_realtime_finance")
    .slice(0, 24);

  const [
    seekingAlpha,
    yahooFinanceNews,
    realTimeNewsData,
    cnbcMarketsNews,
    reutersBusinessNews,
  ] = await Promise.all([
    cachedFeed("feed:seeking_alpha", () => fetchSeekingAlphaInsights(), env),
    cachedFeed("feed:yahoo_finance_market_news", () => fetchYahooFinanceMarketNews(), env),
    cachedFeed("feed:realtime_news_data", () => fetchRealTimeNewsDataHeadlines(), env),
    cachedFeed("feed:cnbc_markets_news", () => fetchCnbcMarketsNews(), env),
    cachedFeed("feed:reuters_business_news", () => fetchReutersBusinessNews(), env),
  ]);

  const newsMeta = {
    sources: news.sources,
    attempted: news.attempted,
    errors: [...news.errors],
    articleCount: news.articles.length,
  };
  if (seekingAlpha.errors?.length) {
    newsMeta.errors.push({
      source: "seeking_alpha",
      error: seekingAlpha.errors.slice(0, 5).join(" | "),
    });
  }
  if (realTimeNewsData.errors?.length) {
    newsMeta.errors.push({
      source: "realtime_news_data_api",
      error: realTimeNewsData.errors.slice(0, 3).join(" | "),
    });
  }
  if (yahooFinanceNews.errors?.length) {
    newsMeta.errors.push({
      source: "yahoo_finance_api",
      error: yahooFinanceNews.errors.slice(0, 3).join(" | "),
    });
  }
  if (cnbcMarketsNews.errors?.length) {
    newsMeta.errors.push({
      source: "cnbc_markets_news_api",
      error: cnbcMarketsNews.errors.slice(0, 4).join(" | "),
    });
  }
  if (reutersBusinessNews.errors?.length) {
    newsMeta.errors.push({
      source: "reuters_business_news_api",
      error: reutersBusinessNews.errors.slice(0, 3).join(" | "),
    });
  }

  const payload = {
    _rawArticles: news.articles.slice(0, cap),
    news: newsMeta,
    cnbcMarketsNews: cnbcMarketsNews.items || [],
    reutersBusinessNews: reutersBusinessNews.items || [],
    yahooFinanceNews: yahooFinanceNews.items || [],
    realtimeFinanceNews,
    seekingAlpha: seekingAlpha.items || [],
    realTimeNewsData: realTimeNewsData.items || [],
    ...result,
  };

  setCache(payloadKey, payload);
  return payload;
}
