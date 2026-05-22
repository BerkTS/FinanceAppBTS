import { extractTickersFromArticles } from "./news.js";
import { mockMovers } from "./schwab.js";
import { fetchSchwabMoversCached } from "./schwab-market-cache.js";

function normalizeMoverList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((m) => {
      const symbol =
        m.symbol || m.Symbol || m.ticker || m["1"] || m.instrument?.symbol;
      const pct =
        m.pct ??
        m.percentChange ??
        m.netPercentChangeInDouble ??
        m.changePct ??
        0;
      return symbol ? { symbol, pct: Number(pct) || 0 } : null;
    })
    .filter(Boolean);
}

function compositeRank({ movers, newsTickers }) {
  const scoreMap = new Map();
  const bump = (sym, delta, reason) => {
    const cur = scoreMap.get(sym) || { symbol: sym, score: 0, reasons: [] };
    cur.score += delta;
    cur.reasons.push(reason);
    scoreMap.set(sym, cur);
  };

  for (const g of movers.gainers || []) {
    bump(g.symbol, 2 + Math.min(3, Math.abs(g.pct || 0) / 2), "mover_gainer");
  }
  for (const l of movers.losers || []) {
    bump(l.symbol, 1 + Math.min(2, Math.abs(l.pct || 0) / 3), "mover_loser");
  }
  for (const n of newsTickers) {
    bump(n.symbol, 1.5 * n.mentions + (n.avgSentiment || 0), "news_mentions");
  }

  return [...scoreMap.values()].sort((a, b) => b.score - a.score);
}

export async function discoverTopStocks({ articles, accessToken }) {
  let movers;
  if (accessToken) {
    try {
      const { data } = await fetchSchwabMoversCached(accessToken);
      movers = data;
    } catch {
      movers = mockMovers();
    }
  } else {
    movers = mockMovers();
  }

  const newsTickers = extractTickersFromArticles(articles);
  const rawGainers = movers.gainers || movers.Gainers || [];
  const rawLosers = movers.losers || movers.Losers || [];
  const ranked = compositeRank({
    movers: {
      gainers: normalizeMoverList(rawGainers),
      losers: normalizeMoverList(rawLosers),
    },
    newsTickers,
  });

  return {
    movers,
    newsTickers: newsTickers.slice(0, 20),
    ranked: ranked.slice(0, 25),
  };
}
