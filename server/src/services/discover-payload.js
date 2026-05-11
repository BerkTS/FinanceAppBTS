import { fetchFinanceAndGeopoliticalNews } from "./news.js";
import { discoverTopStocks } from "./discovery.js";
import { fetchSeekingAlphaInsights } from "./seeking-alpha-rapidapi.js";
import { fetchRealTimeNewsDataHeadlines } from "./realtime-news-data-rapidapi.js";
import { fetchCnbcMarketsNews } from "./cnbc-markets-news-rapidapi.js";
import { fetchReutersBusinessNews } from "./reuters-business-news-rapidapi.js";

/**
 * Loads the same data as GET /api/discover/top (news + rankings + outlet feeds).
 * Used by the discover route and by the AI briefing endpoint.
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
  const cap = Math.min(120, Number(limit) || 60);
  const news = await fetchFinanceAndGeopoliticalNews({
    newsApiKey,
    alphaVantageKey,
    maxGdelt: Math.min(45, Math.ceil(cap / 2)),
    maxNewsApiPerChannel: Math.min(35, Math.ceil(cap / 3)),
    maxAlphaVantage: Math.min(50, cap),
    newsApiFinanceQuery,
    newsApiGeoQuery,
  });

  const sess = getSchwabTokenForSession(sessionId);
  const accessToken = sess?.access_token;
  const result = await discoverTopStocks({
    articles: news.articles.slice(0, cap),
    accessToken,
  });

  const realtimeFinanceNews = news.articles
    .filter((a) => a.provider === "rapidapi_realtime_finance")
    .slice(0, 24);

  const seekingAlpha = await fetchSeekingAlphaInsights();
  const realTimeNewsData = await fetchRealTimeNewsDataHeadlines();
  const cnbcMarketsNews = await fetchCnbcMarketsNews();
  const reutersBusinessNews = await fetchReutersBusinessNews();

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

  return {
    _rawArticles: news.articles.slice(0, cap),
    news: newsMeta,
    cnbcMarketsNews: cnbcMarketsNews.items || [],
    reutersBusinessNews: reutersBusinessNews.items || [],
    realtimeFinanceNews,
    seekingAlpha: seekingAlpha.items || [],
    realTimeNewsData: realTimeNewsData.items || [],
    ...result,
  };
}
