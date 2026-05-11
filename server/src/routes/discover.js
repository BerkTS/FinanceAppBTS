import { Router } from "express";
import { fetchDiscoverPayload } from "../services/discover-payload.js";
import { generateResearchBriefing } from "../services/claude-briefing.js";
import { generateOpenAiResearchBriefing } from "../services/openai-briefing.js";
import { generateLiveTradeSuggestions } from "../services/trade-suggestions.js";
import { generateTradeAiViewBulk } from "../services/trade-ai-view.js";
import { getSchwabTokenForSession } from "./schwab.js";

export const discoverRouter = Router();

discoverRouter.get("/top", async (req, res) => {
  try {
    const limit = Math.min(120, Number(req.query.limit) || 60);
    const sessionId = (req.query.sessionId || "default").toString();
    const payload = await fetchDiscoverPayload({
      limit,
      newsApiKey: process.env.NEWS_API_KEY,
      alphaVantageKey: process.env.ALPHA_VANTAGE_API_KEY,
      newsApiFinanceQuery: req.query.financeQ || process.env.NEWSAPI_FINANCE_QUERY,
      newsApiGeoQuery: req.query.geoQ || process.env.NEWSAPI_GEO_QUERY,
      sessionId,
      getSchwabTokenForSession,
    });
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/**
 * Second request after /top: same news load + two-step Claude briefing (themes + evidenced tickers).
 */
discoverRouter.get("/briefing", async (req, res) => {
  try {
    const limit = Math.min(120, Number(req.query.limit) || 60);
    const sessionId = (req.query.sessionId || "default").toString();
    const payload = await fetchDiscoverPayload({
      limit,
      newsApiKey: process.env.NEWS_API_KEY,
      alphaVantageKey: process.env.ALPHA_VANTAGE_API_KEY,
      newsApiFinanceQuery: req.query.financeQ || process.env.NEWSAPI_FINANCE_QUERY,
      newsApiGeoQuery: req.query.geoQ || process.env.NEWSAPI_GEO_QUERY,
      sessionId,
      getSchwabTokenForSession,
    });
    const [briefing, briefingChatgpt] = await Promise.all([
      generateResearchBriefing(payload),
      generateOpenAiResearchBriefing(payload),
    ]);
    res.json({ briefing, briefingChatgpt });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/**
 * Schwab quotes + ATR rule targets + Claude narration. Does not submit orders.
 */
discoverRouter.get("/trade-suggestions", async (req, res) => {
  try {
    const limit = Math.min(120, Number(req.query.limit) || 60);
    const sessionId = (req.query.sessionId || "default").toString();
    const result = await generateLiveTradeSuggestions({
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

/** Discovery top N: same universe as trade-suggestions, richer JSON (bias + levels + thesis) per provider */
discoverRouter.get("/trade-ai-view", async (req, res) => {
  try {
    const limit = Math.min(120, Number(req.query.limit) || 60);
    const topN = Math.min(15, Math.max(1, Number(req.query.topN) || 5));
    const sessionId = (req.query.sessionId || "default").toString();
    const result = await generateTradeAiViewBulk({
      sessionId,
      limit,
      topN,
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
