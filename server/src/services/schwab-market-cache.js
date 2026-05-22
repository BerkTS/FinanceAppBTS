/**
 * In-memory cache for Schwab market-data calls (quotes, price history, movers).
 * Reduces duplicate hits when multiple endpoints load the same symbols in one session.
 */
import { schwabGet } from "./schwab.js";
import {
  normalizePriceHistoryCandles,
  schwabPriceHistoryParams,
} from "./schwab-price-history.js";

const cache = new Map();

function ttlMs(env) {
  return Math.max(30_000, Number(env.SCHWAB_MARKET_CACHE_MS) || 300_000);
}

function getEntry(key, ttl) {
  const row = cache.get(key);
  if (!row) return null;
  if (Date.now() - row.at > ttl) {
    cache.delete(key);
    return null;
  }
  return row.value;
}

function setEntry(key, value) {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 120) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < oldest.length - 100; i++) cache.delete(oldest[i][0]);
  }
}

export function clearSchwabMarketCache() {
  for (const k of [...cache.keys()]) {
    if (k.startsWith("schwab:")) cache.delete(k);
  }
}

/**
 * @param {string[]} symbols
 * @param {string} accessToken
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function fetchSchwabQuotesCached(symbols, accessToken, env = process.env) {
  const list = [
    ...new Set(
      (symbols || [])
        .map((s) => String(s || "").trim().toUpperCase())
        .filter((s) => /^[A-Z][A-Z0-9.]{0,5}$/.test(s))
    ),
  ].sort();
  if (!list.length || !accessToken) return { fromCache: false, data: null };
  const key = `schwab:quotes:${accessToken.slice(0, 12)}:${list.join(",")}`;
  const hit = getEntry(key, ttlMs(env));
  if (hit) return { fromCache: true, data: hit };
  const symParam = list.map(encodeURIComponent).join("%2C");
  const data = await schwabGet(
    `/marketdata/v1/quotes?symbols=${encodeURIComponent(symParam)}`,
    accessToken
  );
  setEntry(key, data);
  return { fromCache: false, data };
}

/**
 * @param {string} symbol
 * @param {string} rangeRaw
 * @param {string} accessToken
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function fetchSchwabPriceHistoryCached(
  symbol,
  rangeRaw,
  accessToken,
  env = process.env
) {
  const sym = String(symbol || "").toUpperCase();
  const range = String(rangeRaw || "1M").toUpperCase();
  if (!sym || !accessToken) return { fromCache: false, candles: [] };
  const key = `schwab:ph:${accessToken.slice(0, 12)}:${sym}:${range}`;
  const hit = getEntry(key, ttlMs(env));
  if (hit) return { fromCache: true, candles: hit };

  const params = schwabPriceHistoryParams(range);
  const qs = new URLSearchParams({
    symbol: sym,
    periodType: params.periodType,
    period: String(params.period),
    frequencyType: params.frequencyType,
    frequency: String(params.frequency),
  });
  if (params.needExtendedHours) qs.set("needExtendedHoursData", "true");

  const history = await schwabGet(
    `/marketdata/v1/pricehistory?${qs.toString()}`,
    accessToken
  );
  const candles = normalizePriceHistoryCandles(history);
  setEntry(key, candles);
  return { fromCache: false, candles };
}

export async function fetchSchwabMoversCached(accessToken, env = process.env) {
  if (!accessToken) return { fromCache: false, data: null };
  const key = `schwab:movers:${accessToken.slice(0, 12)}:$SPX`;
  const hit = getEntry(key, ttlMs(env));
  if (hit) return { fromCache: true, data: hit };
  const data = await schwabGet("/marketdata/v1/movers/$SPX", accessToken);
  setEntry(key, data);
  return { fromCache: false, data };
}
