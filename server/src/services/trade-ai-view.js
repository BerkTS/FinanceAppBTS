/**
 * Schwab + news + rule-derived levels, then Claude + OpenAI structured “trade view”
 * (bias, echoed levels, thesis, risks). Per-symbol and bulk (discovery top N).
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

export const TRADE_AI_VIEW_DISCLAIMER =
  "Educational, non-advisory output. Levels are rule-derived from Schwab quotes and recent volatility; AI adds context only. Not a recommendation to buy or sell. Place trades yourself in Schwab; this app does not submit orders.";

const bulkCache = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function trimBulkCache() {
  if (bulkCache.size > 24) {
    const keys = [...bulkCache.keys()];
    for (const k of keys.slice(0, keys.length - 16)) bulkCache.delete(k);
  }
}

function levelSlice(ruleTargets) {
  return {
    entryLow: ruleTargets.entryLow,
    entryHigh: ruleTargets.entryHigh,
    stop: ruleTargets.stop,
    target1: ruleTargets.target1,
    target2: ruleTargets.target2,
  };
}

function normalizeOneView(symbol, raw, ruleTargets) {
  const sym = (symbol || "").toUpperCase();
  const biasRaw = String(raw?.bias || "").toLowerCase();
  const bias =
    biasRaw === "constructive" || biasRaw === "cautious" || biasRaw === "neutral"
      ? biasRaw
      : "neutral";
  return {
    symbol: sym,
    bias,
    levels: levelSlice(ruleTargets),
    thesis: String(raw?.thesis || "").slice(0, 1500),
    risks: String(raw?.risks || "").slice(0, 1500),
    alignment: raw?.alignment === "needs_review" ? "needs_review" : "aligned",
    invalidators: Array.isArray(raw?.invalidators)
      ? raw.invalidators.map((x) => String(x).slice(0, 280)).slice(0, 5)
      : [],
  };
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
    return parseJsonFromModel(text, "trade-ai-view anthropic");
  } catch {
    return null;
  }
}

async function openAiJson({ apiKey, model, userPrompt, maxTokens }) {
  const text = await openaiChatCompletion({
    apiKey,
    model: model || "gpt-4o-mini",
    userPrompt,
    maxTokens,
    jsonObject: true,
  });
  try {
    return parseJsonFromModel(text, "trade-ai-view openai");
  } catch {
    return null;
  }
}

const VIEW_SCHEMA_HINT = `JSON fields per symbol:
- bias: one of "constructive" | "cautious" | "neutral" (reading from momentum + headlines; still non-advisory).
- levels: MUST copy ruleTargets exactly (entryLow, entryHigh, stop, target1, target2) — same numbers.
- thesis: 2–4 sentences referencing those levels and recent headlines.
- risks: 1–3 sentences.
- alignment: "aligned" | "needs_review" if headlines conflict with a constructive read.
- invalidators: optional short strings (max 5).`;

function promptSingle(bundle) {
  return `You are a trading desk editor. Output is educational research only — not personalized investment advice; no order placement.

Respond with ONLY valid JSON (no markdown):
{"bias":"neutral","levels":{"entryLow":0,"entryHigh":0,"stop":0,"target1":0,"target2":0},"thesis":"","risks":"","alignment":"aligned","invalidators":[]}

${VIEW_SCHEMA_HINT}

Rule: levels numbers MUST equal ruleTargets below (copy exactly).

symbol: ${bundle.symbol}
last: ${bundle.last}, changePct: ${bundle.changePct}
ruleTargets: ${JSON.stringify(bundle.ruleTargets)}
headlines: ${JSON.stringify(bundle.headlines)}`;
}

function promptBulk(rows) {
  return `You are a trading desk editor. Educational only — not investment advice.

Respond with ONLY valid JSON (no markdown):
{"views":[{"symbol":"AAPL","bias":"neutral","levels":{"entryLow":0,"entryHigh":0,"stop":0,"target1":0,"target2":0},"thesis":"","risks":"","alignment":"aligned","invalidators":[]}]}

${VIEW_SCHEMA_HINT}
Include exactly one view per symbol in the data array; levels MUST copy each row's ruleTargets.

DATA:
${JSON.stringify(rows)}`;
}

/**
 * One symbol: Schwab quote + 3mo daily history + headlines from discover corpus; dual LLM views.
 */
export async function generateTradeAiViewSymbol(params) {
  const env = params.env || process.env;
  if (env.TRADE_AI_VIEW_DISABLED === "1") {
    return {
      ok: false,
      disabled: true,
      disclaimer: TRADE_AI_VIEW_DISCLAIMER,
      symbol: (params.symbol || "").toUpperCase(),
    };
  }

  const sessionId = params.sessionId || "default";
  const getToken = params.getSchwabTokenForSession;
  const accessToken = getToken(sessionId)?.access_token;
  const symbol = (params.symbol || "").toUpperCase();
  if (!symbol) {
    return { ok: false, error: "Missing symbol", disclaimer: TRADE_AI_VIEW_DISCLAIMER };
  }

  if (!accessToken) {
    return {
      ok: true,
      needsSchwab: true,
      disclaimer: TRADE_AI_VIEW_DISCLAIMER,
      symbol,
      claude: null,
      openai: null,
    };
  }

  const discoverLimit = Math.min(120, Number(params.limit) || 60);
  const payload = await fetchDiscoverPayload({
    limit: discoverLimit,
    newsApiKey: env.NEWS_API_KEY,
    alphaVantageKey: env.ALPHA_VANTAGE_API_KEY,
    newsApiFinanceQuery: params.newsApiFinanceQuery,
    newsApiGeoQuery: params.newsApiGeoQuery,
    sessionId,
    getSchwabTokenForSession: getToken,
  });

  const articles = payload._rawArticles || [];
  let qres;
  try {
    qres = await schwabGet(
      `/marketdata/v1/quotes?symbols=${encodeURIComponent(symbol)}`,
      accessToken
    );
  } catch (e) {
    return {
      ok: false,
      error: String(e.message || e),
      disclaimer: TRADE_AI_VIEW_DISCLAIMER,
      symbol,
    };
  }

  const quoteMap = parseBatchQuotes(qres, [symbol]);
  const q = quoteMap.get(symbol);
  if (!q?.lastPrice) {
    return {
      ok: false,
      error: "No Schwab quote for symbol",
      disclaimer: TRADE_AI_VIEW_DISCLAIMER,
      symbol,
    };
  }

  let history;
  try {
    history = await schwabGet(
      `/marketdata/v1/pricehistory?symbol=${encodeURIComponent(symbol)}&periodType=month&period=3&frequencyType=daily&frequency=1`,
      accessToken
    );
  } catch {
    history = null;
  }

  const candles = normalizeCandles(history);
  const atr = calculateATR(candles, 14);
  const ruleTargets = deriveTargets(q.lastPrice, atr, env);
  const headlines = headlinesForSymbol(articles, symbol);
  const score = round2(scoreSymbol(symbol, payload) + Math.min(2, Math.abs(q.changePct) * 0.12));

  const bundle = {
    symbol,
    last: q.lastPrice,
    changePct: round2(q.changePct),
    score,
    ruleTargets,
    headlines,
  };

  const quote = {
    last: q.lastPrice,
    changePct: round2(q.changePct),
    bid: q.bid,
    ask: q.ask,
    volume: q.totalVolume,
  };

  const maxClaude = Math.min(2048, Number(env.TRADE_AI_VIEW_CLAUDE_TOKENS) || 900);
  const maxOpenai = Math.min(2048, Number(env.TRADE_AI_VIEW_OPENAI_TOKENS) || 900);

  const apiKey = env.ANTHROPIC_API_KEY;
  const oaKey = env.OPENAI_API_KEY;
  const model = env.ANTHROPIC_MODEL || "claude-haiku-4-5";
  const oaModel = env.OPENAI_MODEL || "gpt-4o-mini";

  let claude = null;
  let openai = null;
  let claudeError = null;
  let openaiError = null;

  const runClaude = async () => {
    if (!apiKey?.trim()) {
      claude = null;
      return;
    }
    try {
      const parsed = await anthropicJson({
        apiKey,
        model,
        userPrompt: promptSingle(bundle),
        maxTokens: maxClaude,
      });
      if (parsed) claude = normalizeOneView(symbol, parsed, ruleTargets);
    } catch (e) {
      claudeError = String(e.message || e);
    }
  };

  const runOpenai = async () => {
    if (!oaKey?.trim() || env.TRADE_AI_VIEW_OPENAI_DISABLED === "1") {
      openai = null;
      return;
    }
    try {
      const parsed = await openAiJson({
        apiKey: oaKey,
        model: oaModel,
        userPrompt: promptSingle(bundle),
        maxTokens: maxOpenai,
      });
      if (parsed) openai = normalizeOneView(symbol, parsed, ruleTargets);
    } catch (e) {
      openaiError = String(e.message || e);
    }
  };

  await Promise.all([runClaude(), runOpenai()]);

  return {
    ok: true,
    needsSchwab: false,
    disclaimer: TRADE_AI_VIEW_DISCLAIMER,
    symbol,
    quote,
    ruleTargets,
    headlines,
    score,
    claude,
    openai,
    claudeError: claudeError || (!apiKey?.trim() ? "Set ANTHROPIC_API_KEY for Claude trade view." : null),
    openaiError:
      openaiError ||
      (!oaKey?.trim() ? "Set OPENAI_API_KEY for ChatGPT trade view." : null),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Discovery-ranked bulk: same pipeline as live trade suggestions, richer JSON per row.
 */
export async function generateTradeAiViewBulk(params) {
  const env = params.env || process.env;
  if (env.TRADE_AI_VIEW_DISABLED === "1") {
    return {
      ok: false,
      disabled: true,
      disclaimer: TRADE_AI_VIEW_DISCLAIMER,
      views: [],
    };
  }

  const sessionId = params.sessionId || "default";
  const getToken = params.getSchwabTokenForSession;
  const accessToken = getToken(sessionId)?.access_token;

  if (!accessToken) {
    return {
      ok: true,
      needsSchwab: true,
      disclaimer: TRADE_AI_VIEW_DISCLAIMER,
      views: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const discoverLimit = Math.min(120, Number(params.limit) || 60);
  const topN = Math.min(
    15,
    Math.max(1, Number(params.topN) || Number(env.TRADE_AI_VIEW_TOP_N) || Number(env.TRADE_SUGGEST_TOP_N) || 5)
  );

  const payload = await fetchDiscoverPayload({
    limit: discoverLimit,
    newsApiKey: env.NEWS_API_KEY,
    alphaVantageKey: env.ALPHA_VANTAGE_API_KEY,
    newsApiFinanceQuery: params.newsApiFinanceQuery,
    newsApiGeoQuery: params.newsApiGeoQuery,
    sessionId,
    getSchwabTokenForSession: getToken,
  });

  const universe = buildUniverse(payload, env);
  if (universe.length === 0) {
    return {
      ok: true,
      emptyUniverse: true,
      disclaimer: TRADE_AI_VIEW_DISCLAIMER,
      views: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const cacheKey = crypto
    .createHash("sha256")
    .update(
      universe.join(",") +
        accessToken.slice(0, 8) +
        `:tav:${topN}` +
        (env.OPENAI_API_KEY ? ":oa1" : ":oa0")
    )
    .digest("hex")
    .slice(0, 24);
  const ttl = Math.max(10_000, Number(env.TRADE_AI_VIEW_CACHE_MS) || Number(env.TRADE_SUGGEST_CACHE_MS) || 25_000);
  const hit = bulkCache.get(cacheKey);
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
      disclaimer: TRADE_AI_VIEW_DISCLAIMER,
      views: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const articles = payload._rawArticles || [];
  const gap = Number(env.TRADE_SUGGEST_HISTORY_GAP_MS) || 220;
  const historyCap = Math.min(18, Number(env.TRADE_SUGGEST_HISTORY_MAX_SYMBOLS) || 12);

  const preliminary = [];
  for (const sym of universe) {
    const q = quoteMap.get(sym.toUpperCase());
    if (!q?.lastPrice) continue;
    const sc =
      scoreSymbol(sym, payload) + Math.min(2, Math.abs(q.changePct) * 0.12);
    preliminary.push({ symbol: sym.toUpperCase(), q, preScore: sc });
  }
  preliminary.sort((a, b) => b.preScore - a.preScore);
  if (preliminary.length === 0) {
    return {
      ok: true,
      noQuotes: true,
      disclaimer: TRADE_AI_VIEW_DISCLAIMER,
      views: [],
      generatedAt: new Date().toISOString(),
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
    const ruleTargets = deriveTargets(row.q.lastPrice, atr, env);
    const sc = round2(row.preScore + (atr ? 0.15 : 0));

    enriched.push({
      symbol: row.symbol,
      score: sc,
      last: row.q.lastPrice,
      changePct: round2(row.q.changePct),
      ruleTargets,
      headlines: headlinesForSymbol(articles, row.symbol),
    });
  }

  enriched.sort((a, b) => b.score - a.score);
  const top = enriched.slice(0, topN);

  const rowsForPrompt = top.map((t) => ({
    symbol: t.symbol,
    score: t.score,
    last: t.last,
    changePct: t.changePct,
    ruleTargets: t.ruleTargets,
    headlines: t.headlines,
  }));

  const apiKey = env.ANTHROPIC_API_KEY;
  const oaKey = env.OPENAI_API_KEY;
  const model = env.ANTHROPIC_MODEL || "claude-haiku-4-5";
  const oaModel = env.OPENAI_MODEL || "gpt-4o-mini";
  const maxClaude = Math.min(4096, Number(env.TRADE_AI_VIEW_CLAUDE_TOKENS) || 2200);
  const maxOpenai = Math.min(4096, Number(env.TRADE_AI_VIEW_OPENAI_TOKENS) || 2200);

  const outRows = top.map((t) => ({
    symbol: t.symbol,
    score: t.score,
    quote: {
      last: t.last,
      changePct: t.changePct,
    },
    ruleTargets: t.ruleTargets,
    headlines: t.headlines,
    claude: null,
    openai: null,
    claudeError: null,
    openaiError: null,
  }));

  const bySym = (arr) =>
    new Map((arr || []).map((v) => [(v.symbol || "").toUpperCase(), v]));

  if (apiKey?.trim() && rowsForPrompt.length > 0) {
    try {
      const parsed = await anthropicJson({
        apiKey,
        model,
        userPrompt: promptBulk(rowsForPrompt),
        maxTokens: maxClaude,
      });
      const views = parsed?.views || [];
      const m = bySym(views);
      for (const row of outRows) {
        const v = m.get(row.symbol);
        row.claude = v ? normalizeOneView(row.symbol, v, row.ruleTargets) : null;
      }
    } catch (e) {
      const msg = String(e.message || e);
      for (const row of outRows) row.claudeError = msg;
    }
  } else {
    for (const row of outRows) {
      row.claudeError = !apiKey?.trim() ? "Set ANTHROPIC_API_KEY." : null;
    }
  }

  if (oaKey?.trim() && rowsForPrompt.length > 0 && env.TRADE_AI_VIEW_OPENAI_DISABLED !== "1") {
    try {
      const parsed = await openAiJson({
        apiKey: oaKey,
        model: oaModel,
        userPrompt: promptBulk(rowsForPrompt),
        maxTokens: maxOpenai,
      });
      const views = parsed?.views || [];
      const m = bySym(views);
      for (const row of outRows) {
        const v = m.get(row.symbol);
        row.openai = v ? normalizeOneView(row.symbol, v, row.ruleTargets) : null;
      }
    } catch (e) {
      const msg = String(e.message || e);
      for (const row of outRows) row.openaiError = msg;
    }
  } else {
    for (const row of outRows) {
      row.openaiError =
        !oaKey?.trim() ? "Set OPENAI_API_KEY." : env.TRADE_AI_VIEW_OPENAI_DISABLED === "1" ? "OpenAI disabled." : null;
    }
  }

  const result = {
    ok: true,
    needsSchwab: false,
    disclaimer: TRADE_AI_VIEW_DISCLAIMER,
    topN,
    views: outRows,
    generatedAt: new Date().toISOString(),
    universeSize: universe.length,
    evaluated: enriched.length,
  };
  bulkCache.set(cacheKey, { at: Date.now(), value: result });
  trimBulkCache();
  return result;
}
