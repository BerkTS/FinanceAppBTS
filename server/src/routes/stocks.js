import { Router } from "express";
import {
  fetchFinanceAndGeopoliticalNews,
  scoreHeadlineSentiment,
} from "../services/news.js";
import { analyzeStock } from "../services/analysis.js";
import { generateInsight } from "../services/claude.js";
import { generateInsightOpenAI } from "../services/openai-insight.js";
import { schwabGet } from "../services/schwab.js";
import { getSchwabTokenForSession } from "./schwab.js";
import { generateTradeAiViewSymbol } from "../services/trade-ai-view.js";

export const stocksRouter = Router();

/** Selected ticker: Schwab + rules + Claude + OpenAI structured trade view */
stocksRouter.get("/trade-ai-view/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol;
    const sessionId = (req.query.sessionId || "default").toString();
    const limit = Math.min(120, Number(req.query.limit) || 60);
    const result = await generateTradeAiViewSymbol({
      symbol,
      sessionId,
      limit,
      newsApiFinanceQuery: req.query.financeQ || process.env.NEWSAPI_FINANCE_QUERY,
      newsApiGeoQuery: req.query.geoQ || process.env.NEWSAPI_GEO_QUERY,
      getSchwabTokenForSession,
      env: process.env,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

stocksRouter.get("/:symbol/analysis", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const sessionId = (req.query.sessionId || "default").toString();
    const sess = getSchwabTokenForSession(sessionId);
    const accessToken = sess?.access_token;

    const news = await fetchFinanceAndGeopoliticalNews({
      newsApiKey: process.env.NEWS_API_KEY,
      alphaVantageKey: process.env.ALPHA_VANTAGE_API_KEY,
      maxGdelt: 30,
      maxNewsApiPerChannel: 22,
      maxAlphaVantage: 35,
    });

    let quote;
    let history;
    let fundamentals;
    if (accessToken) {
      try {
        quote = await schwabGet(
          `/marketdata/v1/quotes?symbols=${encodeURIComponent(symbol)}`,
          accessToken
        );
        history = await schwabGet(
          `/marketdata/v1/pricehistory?symbol=${encodeURIComponent(symbol)}&periodType=month&period=1&frequencyType=daily&frequency=1`,
          accessToken
        );
      } catch {
        /* fall through to mock inside analyzeStock */
      }
    }

    const flatQuote =
      quote?.[symbol] ||
      quote?.quotes?.[0] ||
      (quote && typeof quote === "object" ? Object.values(quote)[0] : null);

    const analysis = await analyzeStock({
      symbol,
      articles: news.articles.slice(0, 90),
      schwabQuote: flatQuote,
      schwabHistory: history,
      fundamentals: null,
    });

    const related = (news.articles || [])
      .filter((a) => `${a.title} ${a.description}`.includes(symbol))
      .slice(0, 12);

    let insight = null;
    let insightChatgpt = null;
    if (req.query.insight === "1" || req.query.insight === "true") {
      insight = await generateInsight({
        stock: {
          ...analysis,
          changePct: analysis.changePct,
        },
        newsItems: related,
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL,
      });
      insightChatgpt = await generateInsightOpenAI({
        stock: {
          ...analysis,
          changePct: analysis.changePct,
        },
        newsItems: related,
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL,
      });
    }

    res.json({
      symbol,
      analysis,
      relatedNews: related.slice(0, 8),
      insight,
      insightChatgpt,
      newsFeed: {
        sources: news.sources,
        errors: news.errors,
      },
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/** Batch sentiment for headline list (optional UI helper). */
stocksRouter.post("/sentiment", (req, res) => {
  const titles = req.body?.titles;
  if (!Array.isArray(titles)) {
    return res.status(400).json({ error: "Expected { titles: string[] }" });
  }
  res.json({
    scores: titles.map((t) => ({
      title: t,
      score: scoreHeadlineSentiment(t, null),
    })),
  });
});
