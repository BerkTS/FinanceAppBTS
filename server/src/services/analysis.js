import { calculateMACD, calculateRSI } from "../lib/indicators.js";
import { scoreHeadlineSentiment } from "./news.js";

function mockCandles(symbol) {
  const base = symbol.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 40;
  let price = 100 + base;
  const out = [];
  for (let i = 0; i < 40; i++) {
    price += (Math.sin(i / 3) + (i % 5) * 0.02) * 0.8;
    out.push({
      open: price - 0.2,
      high: price + 0.6,
      low: price - 0.7,
      close: price,
      volume: 1_000_000 + i * 10_000,
    });
  }
  return out;
}

export async function analyzeStock({
  symbol,
  articles,
  schwabQuote,
  schwabHistory,
  fundamentals,
}) {
  const candles =
    schwabHistory?.candles ||
    schwabHistory?.candlesList ||
    mockCandles(symbol);

  const quote = schwabQuote || {
    lastPrice: candles[candles.length - 1]?.close ?? 100,
    netPercentChangeInDouble: 0.5,
    totalVolume: 12_000_000,
  };

  const fund = fundamentals || {
    peRatio: 24.5,
    eps: 6.2,
    vol3MonthAvg: 10_000_000,
  };

  const vol3 = fund.vol3MonthAvg || fund.averageVolume || 10_000_000;
  const volumeVsAvg =
    vol3 > 0 ? Math.round((quote.totalVolume / vol3) * 100) / 100 : null;

  const relatedNews = (articles || []).filter((a) =>
    `${a.title} ${a.description}`.includes(symbol)
  );
  const newsSentiment =
    relatedNews.length > 0
      ? Math.round(
          (relatedNews.reduce(
            (s, a) => s + scoreHeadlineSentiment(a.title, a),
            0
          ) /
            relatedNews.length) *
            100
        ) / 100
      : 0;

  return {
    symbol,
    price: quote.lastPrice,
    changePct: quote.netPercentChangeInDouble,
    pe_ratio: fund.peRatio ?? fund.peRatioTTM,
    eps: fund.eps,
    volume_vs_avg: volumeVsAvg,
    rsi: calculateRSI(candles),
    macd: calculateMACD(candles),
    news_sentiment: newsSentiment,
    newsCount: relatedNews.length,
  };
}
