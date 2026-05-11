/**
 * Live trade *suggestions* (not order execution): Schwab quotes + rule-derived levels + Claude + ChatGPT narration.
 */
import crypto from "crypto";
import { schwabGet } from "./schwab.js";
import { calculateATR } from "../lib/indicators.js";
import { fetchDiscoverPayload } from "./discover-payload.js";
import { parseJsonFromModel } from "./briefing-shared.js";
import { openaiChatCompletion } from "./openai-chat.js";
import {
  buildUniverse,
  deriveTargets,
  headlinesForSymbol,
  normalizeCandles,
  parseBatchQuotes,
  round2,
  scoreSymbol,
} from "./trade-rules.js";

const DISCLAIMER =
  "Educational, non-advisory output. Suggested levels are rules-based heuristics from live quotes and recent volatility — not a recommendation to buy or sell. You must place any trade yourself in Schwab; this app does not submit orders. Consult a licensed professional for personal financial decisions.";

const suggestCache = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function anthropicJson({ apiKey, model, userPrompt, maxTokens }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-haiku-4-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${JSON.stringify(data).slice(0, 400)}`);
  }
  const text =
    data.content?.map((b) => (b.type === "text" ? b.text : "")).join("") || "";
  try {
    return parseJsonFromModel(text, "trade narr anthropic");
  } catch {
    return null;
  }
}

async function openAiTradeNarrativesJson({ apiKey, model, userPrompt, maxTokens }) {
  const text = await openaiChatCompletion({
    apiKey,
    model: model || "gpt-4o-mini",
    userPrompt,
    maxTokens,
    jsonObject: true,
  });
  try {
    return parseJsonFromModel(text, "trade narr openai");
  } catch {
    return null;
  }
}

function trimCache() {
  if (suggestCache.size > 30) {
    const keys = [...suggestCache.keys()];
    for (const k of keys.slice(0, keys.length - 20)) suggestCache.delete(k);
  }
}

/**
 * @param {object} params
 * @param {string} params.sessionId
 * @param {function} params.getSchwabTokenForSession
 * @param {object} [params.env]
 */
export async function generateLiveTradeSuggestions(params) {
  const env = params.env || process.env;
  const sessionId = params.sessionId || "default";
  const getToken = params.getSchwabTokenForSession;
  const accessToken = getToken(sessionId)?.access_token;

  if (!accessToken) {
    return {
      ok: true,
      needsSchwab: true,
      disclaimer: DISCLAIMER,
      suggestions: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const limit = Math.min(120, Number(params.limit) || 60);
  const payload = await fetchDiscoverPayload({
    limit,
    newsApiKey: env.NEWS_API_KEY,
    alphaVantageKey: env.ALPHA_VANTAGE_API_KEY,
    newsApiFinanceQuery: params.newsApiFinanceQuery,
    newsApiGeoQuery: params.newsApiGeoQuery,
    getSchwabTokenForSession: getToken,
    sessionId,
  });

  const universe = buildUniverse(payload, env);
  if (universe.length === 0) {
    return {
      ok: true,
      emptyUniverse: true,
      disclaimer: DISCLAIMER,
      suggestions: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const cacheKey = crypto
    .createHash("sha256")
    .update(
      universe.join(",") +
        accessToken.slice(0, 8) +
        (env.OPENAI_API_KEY ? ":oa1" : ":oa0")
    )
    .digest("hex")
    .slice(0, 24);
  const ttl = Math.max(10_000, Number(env.TRADE_SUGGEST_CACHE_MS) || 25_000);
  const hit = suggestCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ttl) {
    return { ...hit.value, cacheHit: true };
  }

  const symParam = universe.map(encodeURIComponent).join("%2C");
  let quoteMap;
  try {
    const qres = await schwabGet(
      `/marketdata/v1/quotes?symbols=${symParam}`,
      accessToken
    );
    quoteMap = parseBatchQuotes(qres, universe);
  } catch (e) {
    return {
      ok: false,
      error: String(e.message || e),
      disclaimer: DISCLAIMER,
      suggestions: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const articles = payload._rawArticles || [];
  const gap = Number(env.TRADE_SUGGEST_HISTORY_GAP_MS) || 220;
  const historyCap = Math.min(18, Number(env.TRADE_SUGGEST_HISTORY_MAX_SYMBOLS) || 12);

  const preliminary = [];
  for (const symbol of universe) {
    const q = quoteMap.get(symbol.toUpperCase());
    if (!q?.lastPrice) continue;
    const sc =
      scoreSymbol(symbol, payload) + Math.min(2, Math.abs(q.changePct) * 0.12);
    preliminary.push({ symbol: symbol.toUpperCase(), q, preScore: sc });
  }
  preliminary.sort((a, b) => b.preScore - a.preScore);
  if (preliminary.length === 0) {
    return {
      ok: true,
      noQuotes: true,
      hint: "No Schwab quotes matched the discovery universe. Connect Schwab and ensure market data access for your app.",
      disclaimer: DISCLAIMER,
      suggestions: [],
      generatedAt: new Date().toISOString(),
      universeSize: universe.length,
    };
  }

  const forHistory = preliminary.slice(0, historyCap);

  const enriched = [];
  for (const row of forHistory) {
    let history;
    try {
      history = await schwabGet(
        `/marketdata/v1/pricehistory?symbol=${encodeURIComponent(row.symbol)}&periodType=month&period=3&frequencyType=daily&frequency=1`,
        accessToken
      );
    } catch {
      history = null;
    }
    await sleep(gap);

    const candles = normalizeCandles(history);
    const atr = calculateATR(candles, 14);
    const targets = deriveTargets(row.q.lastPrice, atr, env);
    const sc = round2(row.preScore + (atr ? 0.15 : 0));

    enriched.push({
      symbol: row.symbol,
      score: sc,
      quote: {
        last: row.q.lastPrice,
        changePct: round2(row.q.changePct),
        bid: row.q.bid,
        ask: row.q.ask,
        volume: row.q.totalVolume,
      },
      ruleTargets: targets,
      headlines: headlinesForSymbol(articles, row.symbol),
    });
  }

  const topN = Math.min(10, Number(env.TRADE_SUGGEST_TOP_N) || 5);
  enriched.sort((a, b) => b.score - a.score);
  const top = enriched.slice(0, topN);

  const apiKey = env.ANTHROPIC_API_KEY;
  const model = env.ANTHROPIC_MODEL || "claude-haiku-4-5";

  if (apiKey?.trim() && top.length > 0) {
    const bundle = top.map((t) => ({
      symbol: t.symbol,
      score: t.score,
      last: t.quote.last,
      changePct: t.quote.changePct,
      ruleTargets: t.ruleTargets,
      headlines: t.headlines,
    }));

    const prompt = `You are a trading desk editor. Output is educational only — not personalized investment advice; no order placement.

You MUST respond with ONLY valid JSON (no markdown):
{"narratives":[{"symbol":"AAPL","thesis":"one short paragraph","risks":"one short paragraph","alignment":"aligned","invalidators":["optional"]}]}

Rules:
- Include exactly one entry per symbol below.
- Do NOT invent prices or change ruleTargets; reference levels only by repeating the numbers already given if needed.
- alignment must be "aligned" or "needs_review" if headlines conflict with a momentum-long framing.

Data:
${JSON.stringify(bundle)}`;

    try {
      const parsed = await anthropicJson({
        apiKey,
        model,
        userPrompt: prompt,
        maxTokens: Math.min(4096, Number(env.TRADE_SUGGEST_CLAUDE_TOKENS) || 1800),
      });
      const narratives = parsed?.narratives || [];
      const bySym = new Map(
        narratives.map((n) => [(n.symbol || "").toUpperCase(), n])
      );
      for (const row of top) {
        const n = bySym.get(row.symbol);
        row.claude = n
          ? {
              thesis: String(n.thesis || "").slice(0, 1200),
              risks: String(n.risks || "").slice(0, 1200),
              alignment: n.alignment === "needs_review" ? "needs_review" : "aligned",
              invalidators: Array.isArray(n.invalidators) ? n.invalidators.slice(0, 5) : [],
            }
          : null;
      }
    } catch (e) {
      for (const row of top) {
        row.claudeError = String(e.message || e);
      }
    }
  } else {
    for (const row of top) {
      row.claude = null;
      if (!apiKey?.trim()) row.claudeNote = "Set ANTHROPIC_API_KEY for narration.";
    }
  }

  const oaKey = env.OPENAI_API_KEY;
  const oaModel = env.OPENAI_MODEL || "gpt-4o-mini";
  if (oaKey?.trim() && top.length > 0 && env.TRADE_SUGGEST_OPENAI_DISABLED !== "1") {
    const bundle = top.map((t) => ({
      symbol: t.symbol,
      score: t.score,
      last: t.quote.last,
      changePct: t.quote.changePct,
      ruleTargets: t.ruleTargets,
      headlines: t.headlines,
    }));
    const prompt = `You are a trading desk editor. Output is educational only — not personalized investment advice; no order placement.

Return a JSON object with key "narratives" only. Each entry: symbol, thesis, risks, alignment ("aligned" | "needs_review"), invalidators (optional array).

Do NOT invent prices; ruleTargets in data are authoritative.

Data:
${JSON.stringify(bundle)}`;

    try {
      const parsed = await openAiTradeNarrativesJson({
        apiKey: oaKey,
        model: oaModel,
        userPrompt: prompt,
        maxTokens: Math.min(4096, Number(env.TRADE_SUGGEST_OPENAI_TOKENS) || 1800),
      });
      const narratives = parsed?.narratives || [];
      const bySym = new Map(
        narratives.map((n) => [(n.symbol || "").toUpperCase(), n])
      );
      for (const row of top) {
        const n = bySym.get(row.symbol);
        row.chatgpt = n
          ? {
              thesis: String(n.thesis || "").slice(0, 1200),
              risks: String(n.risks || "").slice(0, 1200),
              alignment: n.alignment === "needs_review" ? "needs_review" : "aligned",
              invalidators: Array.isArray(n.invalidators) ? n.invalidators.slice(0, 5) : [],
            }
          : null;
      }
    } catch (e) {
      for (const row of top) {
        row.chatgptError = String(e.message || e);
      }
    }
  } else {
    for (const row of top) {
      if (!row.chatgpt) row.chatgpt = null;
      if (!oaKey?.trim())
        row.chatgptNote = row.chatgptNote || "Set OPENAI_API_KEY for ChatGPT narration.";
    }
  }

  const out = {
    ok: true,
    needsSchwab: false,
    disclaimer: DISCLAIMER,
    suggestions: top,
    generatedAt: new Date().toISOString(),
    universeSize: universe.length,
    evaluated: enriched.length,
  };
  suggestCache.set(cacheKey, { at: Date.now(), value: out });
  trimCache();
  return out;
}
