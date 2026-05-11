import { Router } from "express";
import {
  fetchFinanceAndGeopoliticalNews,
  fetchNewsApiEverything,
} from "../services/news.js";
import { outletConfigSummary } from "../services/outlet-feeds.js";

export const newsRouter = Router();

/** Which named-outlet integrations are enabled (no secrets returned). */
newsRouter.get("/outlets", (_req, res) => {
  res.json({
    configured: outletConfigSummary(),
    envHint:
      "Set variables in .env — see .env.example (RAPIDAPI_*, AP_MEDIA_*, NEWSAPI_OUTLET_DOMAINS, YAHOO_*).",
  });
});

/** Aggregated finance + geopolitical feeds (GDELT + optional NewsAPI + Alpha Vantage). */
newsRouter.get("/latest", async (req, res) => {
  try {
    const limit = Math.min(150, Number(req.query.limit) || 80);
    const bundle = await fetchFinanceAndGeopoliticalNews({
      newsApiKey: process.env.NEWS_API_KEY,
      alphaVantageKey: process.env.ALPHA_VANTAGE_API_KEY,
      maxGdelt: Math.min(50, Math.ceil(limit / 2)),
      maxNewsApiPerChannel: Math.min(40, Math.ceil(limit / 3)),
      maxAlphaVantage: Math.min(60, limit),
    });
    const articles = bundle.articles.slice(0, limit);
    res.json({
      articles,
      sources: bundle.sources,
      attempted: bundle.attempted,
      errors: bundle.errors,
      count: articles.length,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/** Single-provider NewsAPI search (requires NEWS_API_KEY). */
newsRouter.get("/newsapi", async (req, res) => {
  try {
    const apiKey = process.env.NEWS_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: "NEWS_API_KEY not set" });
    }
    const query = req.query.q || process.env.NEWS_QUERY;
    const result = await fetchNewsApiEverything({
      apiKey,
      query,
      pageSize: Math.min(100, Number(req.query.limit) || 30),
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});
