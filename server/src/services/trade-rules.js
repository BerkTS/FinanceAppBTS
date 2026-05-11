/** Shared Schwab quote parsing, ATR targets, and discovery universe helpers for trade features. */

export function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function round2(x) {
  return Math.round(x * 100) / 100;
}

export function extractQuoteFields(raw) {
  if (!raw || typeof raw !== "object") return null;
  const q = raw.quote && typeof raw.quote === "object" ? raw.quote : raw;
  const lastPrice = num(
    q.lastPrice ?? q.last ?? q.closePrice ?? q.mark ?? raw.lastPrice,
    0
  );
  if (lastPrice <= 0) return null;
  const bid = num(q.bidPrice ?? q.bid ?? raw.bidPrice, 0) || null;
  const ask = num(q.askPrice ?? q.ask ?? raw.askPrice, 0) || null;
  const changePct = num(
    q.netPercentChangeInDouble ??
      q.netChangePercent ??
      q.regularMarketPercentChange ??
      raw.netPercentChangeInDouble,
    0
  );
  const vol = num(q.totalVolume ?? q.volume ?? raw.totalVolume, 0) || null;
  return { lastPrice, bid, ask, changePct, totalVolume: vol, raw: raw };
}

export function parseBatchQuotes(response, symbols) {
  const out = new Map();
  if (!response) return out;
  if (Array.isArray(response)) {
    for (const row of response) {
      const s = (row.symbol || row.Symbol || "").toUpperCase();
      if (s) out.set(s, extractQuoteFields(row));
    }
    return out;
  }
  for (const sym of symbols) {
    const u = sym.toUpperCase();
    if (response[u]) {
      out.set(u, extractQuoteFields(response[u]));
      continue;
    }
  }
  for (const k of Object.keys(response)) {
    if (k === "quotes" || k === "errors") continue;
    const v = response[k];
    if (v && typeof v === "object" && (v.lastPrice != null || v.last != null)) {
      out.set(k.toUpperCase(), extractQuoteFields(v));
    }
  }
  const qlist = response.quotes;
  if (Array.isArray(qlist)) {
    for (const row of qlist) {
      const s = (row.symbol || row.Symbol || "").toUpperCase();
      if (s) out.set(s, extractQuoteFields(row));
    }
  }
  return out;
}

export function normalizeCandles(history) {
  const raw =
    history?.candles ||
    history?.candlesList ||
    history?.chart?.candles ||
    [];
  return raw
    .map((c) => ({
      open: num(c.open),
      high: num(c.high),
      low: num(c.low),
      close: num(c.close),
      volume: num(c.volume, 0),
    }))
    .filter((c) => c.close > 0 && c.high >= c.low);
}

export function headlinesForSymbol(articles, symbol) {
  const sym = symbol.toUpperCase();
  const re = new RegExp(`\\b${sym}\\b`);
  return (articles || [])
    .filter((a) => re.test(`${a.title || ""} ${a.description || ""}`))
    .slice(0, 4)
    .map((a) => ({
      title: (a.title || "").slice(0, 200),
      url: a.url || "",
      source: a.source || a.provider || "",
    }));
}

export function buildUniverse(payload, env) {
  const seen = new Set();
  const ordered = [];
  const seed = (env.TRADE_SUGGEST_SEED_SYMBOLS || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  for (const s of seed) {
    if (!seen.has(s)) {
      seen.add(s);
      ordered.push(s);
    }
  }
  for (const r of payload.ranked || []) {
    const s = (r.symbol || "").toUpperCase();
    if (s && !seen.has(s)) {
      seen.add(s);
      ordered.push(s);
    }
  }
  for (const t of payload.newsTickers || []) {
    const s = (t.symbol || "").toUpperCase();
    if (s && !seen.has(s)) {
      seen.add(s);
      ordered.push(s);
    }
  }
  const maxU = Math.min(30, Number(env.TRADE_SUGGEST_UNIVERSE_MAX) || 25);
  return ordered.slice(0, maxU);
}

export function scoreSymbol(symbol, payload) {
  let score = 0;
  const ranked = payload.ranked || [];
  const idx = ranked.findIndex(
    (r) => (r.symbol || "").toUpperCase() === symbol
  );
  if (idx >= 0) score += Math.max(0, 8 - idx * 0.25);
  const nt = (payload.newsTickers || []).find(
    (t) => (t.symbol || "").toUpperCase() === symbol
  );
  if (nt) score += Math.min(6, (nt.mentions || 0) * 0.8 + (nt.avgSentiment || 0));
  return Math.round(score * 100) / 100;
}

export function deriveTargets(last, atr, env) {
  const bandLow = num(env.TRADE_ENTRY_BAND_LOW_ATR, 0.35);
  const bandHigh = num(env.TRADE_ENTRY_BAND_HIGH_ATR, 0.2);
  const stopMult = num(env.TRADE_STOP_ATR_MULT, 1.45);
  const t1m = num(env.TRADE_TARGET1_ATR_MULT, 1.05);
  const t2m = num(env.TRADE_TARGET2_ATR_MULT, 2.1);
  const fallbackPct = num(env.TRADE_ATR_FALLBACK_PCT, 0.018);

  const effAtr = atr > 0 ? atr : last * fallbackPct;
  const entryLow = round2(last - bandLow * effAtr);
  const entryHigh = round2(last + bandHigh * effAtr);
  const stop = round2(last - stopMult * effAtr);
  const target1 = round2(last + t1m * effAtr);
  const target2 = round2(last + t2m * effAtr);

  let fixed = { entryLow, entryHigh, stop, target1, target2 };
  if (stop >= entryLow) fixed.stop = round2(entryLow - 0.01 * last - 0.01 * effAtr);
  if (fixed.stop >= fixed.entryLow) fixed.stop = round2(fixed.entryLow * 0.98);
  if (target1 <= last) fixed.target1 = round2(last + 0.5 * effAtr);
  if (target2 <= fixed.target1) fixed.target2 = round2(fixed.target1 + effAtr);

  return {
    ...fixed,
    atr: round2(effAtr),
    atrIsEstimate: !atr || atr <= 0,
  };
}
