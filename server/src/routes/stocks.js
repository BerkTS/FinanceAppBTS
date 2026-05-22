import { Router } from "express";
import {
  fetchFinanceAndGeopoliticalNews,
  scoreHeadlineSentiment,
} from "../services/news.js";
import { analyzeStock } from "../services/analysis.js";
import { generateInsight } from "../services/claude.js";
import { generateInsightOpenAI } from "../services/openai-insight.js";
import { getSchwabTokenForSession } from "./schwab.js";
import { generateTradeAiViewSymbol } from "../services/trade-ai-view.js";
import { parseBatchQuotes } from "../services/trade-rules.js";
import { fetchStructuredLevelsForSymbols } from "../services/stock-structured-levels.js";
import {
  fetchSchwabPriceHistoryCached,
  fetchSchwabQuotesCached,
} from "../services/schwab-market-cache.js";

export const stocksRouter = Router();

/**
 * Batch NBBO-style fields for charts / SA picks: `GET /quotes?symbols=AAPL,MSFT&sessionId=…`
 * (registered before `/:symbol/...` routes.)
 */
stocksRouter.get("/quotes", async (req, res) => {
  try {
    const raw = (req.query.symbols || "").toString();
    const symbols = [
      ...new Set(
        raw
          .split(/[\s,]+/)
          .map((s) => s.trim().toUpperCase())
          .filter((s) => /^[A-Z][A-Z0-9.]{0,5}$/.test(s))
      ),
    ].slice(0, 32);
    if (symbols.length === 0) {
      return res.status(400).json({
        error: "Provide symbols as comma-separated tickers (e.g. symbols=AAPL,MSFT).",
      });
    }
    const sessionId = (req.query.sessionId || "default").toString();
    const sess = getSchwabTokenForSession(sessionId);
    const accessToken = sess?.access_token;
    if (!accessToken) {
      return res.json({ needsSchwab: true, quotes: {} });
    }
    const { data: qres } = await fetchSchwabQuotesCached(symbols, accessToken, process.env);
    const map = parseBatchQuotes(qres, symbols);
    const quotes = {};
    for (const sym of symbols) {
      const q = map.get(sym);
      quotes[sym] = q
        ? {
            last: q.lastPrice,
            bid: q.bid,
            ask: q.ask,
            changePct: q.changePct,
          }
        : null;
    }
    res.json({ quotes, needsSchwab: false });
  } catch (e) {
    res.status(200).json({
      needsSchwab: false,
      quotes: {},
      error: String(e.message || e),
    });
  }
});

/**
 * Rule-based entry / stop / targets + score (same logic as structured trade view), no LLM.
 * `GET /structured-levels?symbols=AAPL,MSFT&sessionId=…`
 */
stocksRouter.get("/structured-levels", async (req, res) => {
  try {
    const raw = (req.query.symbols || "").toString();
    const symbols = [
      ...new Set(
        raw
          .split(/[\s,]+/)
          .map((s) => s.trim().toUpperCase())
          .filter((s) => /^[A-Z][A-Z0-9.]{0,5}$/.test(s))
      ),
    ].slice(0, 8);
    if (symbols.length === 0) {
      return res.status(400).json({
        error: "Provide symbols as comma-separated tickers (e.g. symbols=AAPL,MSFT).",
      });
    }
    const sessionId = (req.query.sessionId || "default").toString();
    const result = await fetchStructuredLevelsForSymbols({
      symbols,
      sessionId,
      getSchwabTokenForSession,
      env: process.env,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

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

/** OHLC history for charts/tables; must stay before `/:symbol/analysis`. */
stocksRouter.get("/:symbol/price-history", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const sessionId = (req.query.sessionId || "default").toString();
    const rangeRaw = (req.query.range || "1M").toString();
    const range = String(rangeRaw).toUpperCase();

    const sess = getSchwabTokenForSession(sessionId);
    const accessToken = sess?.access_token;
    if (!accessToken) {
      return res.json({
        symbol,
        range,
        candles: [],
        needsSchwab: true,
      });
    }

    const { candles } = await fetchSchwabPriceHistoryCached(
      symbol,
      range,
      accessToken,
      process.env
    );
    res.json({
      symbol,
      range,
      candles,
      empty: candles.length === 0,
    });
  } catch (e) {
    res.status(200).json({
      symbol: req.params.symbol?.toUpperCase() || "",
      range: String(req.query.range || "1M").toUpperCase(),
      candles: [],
      error: String(e.message || e),
    });
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
        const { data: qres } = await fetchSchwabQuotesCached(
          [symbol],
          accessToken,
          process.env
        );
        quote = qres;
        const { candles } = await fetchSchwabPriceHistoryCached(
          symbol,
          "1M",
          accessToken,
          process.env
        );
        history = { candles };
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
