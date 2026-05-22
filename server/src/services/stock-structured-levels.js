import {
  fetchSchwabPriceHistoryCached,
  fetchSchwabQuotesCached,
} from "./schwab-market-cache.js";
import { calculateATR } from "../lib/indicators.js";
import { fetchDiscoverPayload } from "./discover-payload.js";
import {
  deriveTargets,
  normalizeCandles,
  parseBatchQuotes,
  round2,
  scoreSymbol,
} from "./trade-rules.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Rule-derived entry/stop/targets + discovery-weighted score (same math as structured trade view),
 * for arbitrary symbols — no LLM calls.
 *
 * @param {{ symbols: string[], sessionId: string, getSchwabTokenForSession: Function, env?: NodeJS.ProcessEnv }} params
 */
export async function fetchStructuredLevelsForSymbols({
  symbols,
  sessionId,
  getSchwabTokenForSession,
  env = process.env,
}) {
  const list = [
    ...new Set(
      (symbols || [])
        .map((s) => String(s || "").trim().toUpperCase())
        .filter((s) => /^[A-Z][A-Z0-9.]{0,5}$/.test(s))
    ),
  ].slice(0, 8);

  if (list.length === 0) {
    return { ok: true, needsSchwab: false, bySymbol: {} };
  }

  const sess = getSchwabTokenForSession(sessionId);
  const accessToken = sess?.access_token;
  if (!accessToken) {
    return { ok: true, needsSchwab: true, bySymbol: {} };
  }

  const payload = await fetchDiscoverPayload({
    limit: 60,
    newsApiKey: env.NEWS_API_KEY,
    alphaVantageKey: env.ALPHA_VANTAGE_API_KEY,
    newsApiFinanceQuery: env.NEWSAPI_FINANCE_QUERY,
    newsApiGeoQuery: env.NEWSAPI_GEO_QUERY,
    sessionId,
    getSchwabTokenForSession,
  });

  let quoteMap;
  try {
    const { data: qres } = await fetchSchwabQuotesCached(list, accessToken, env);
    quoteMap = parseBatchQuotes(qres, list);
  } catch (e) {
    return {
      ok: false,
      error: String(e.message || e),
      needsSchwab: false,
      bySymbol: {},
    };
  }

  const gap = Number(env.TRADE_SUGGEST_HISTORY_GAP_MS) || 220;
  const bySymbol = {};

  for (let i = 0; i < list.length; i++) {
    const symbol = list[i];
    const q = quoteMap.get(symbol);
    if (!q?.lastPrice) {
      bySymbol[symbol] = { ok: false, error: "No Schwab quote for symbol" };
      continue;
    }
    if (i > 0) await sleep(gap);

    let candles = [];
    try {
      const { candles: cached } = await fetchSchwabPriceHistoryCached(
        symbol,
        "3M",
        accessToken,
        env
      );
      candles = normalizeCandles({ candles: cached });
    } catch {
      candles = [];
    }
    const atr = calculateATR(candles, 14);
    const ruleTargets = deriveTargets(q.lastPrice, atr, env);
    const preScore =
      scoreSymbol(symbol, payload) + Math.min(2, Math.abs(q.changePct) * 0.12);
    const score = round2(preScore + (atr ? 0.15 : 0));

    bySymbol[symbol] = {
      ok: true,
      score,
      ruleTargets,
    };
  }

  return { ok: true, needsSchwab: false, bySymbol };
}
