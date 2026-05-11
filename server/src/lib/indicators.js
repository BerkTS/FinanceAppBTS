/**
 * @param {{ open: number, high: number, low: number, close: number }[]} candles oldest → newest
 * @param {number} period default 14
 * @returns {number|null} last ATR value in price units
 */
export function calculateATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(tr);
  }
  if (trs.length < period) return null;
  const slice = trs.slice(-period);
  const atr = slice.reduce((a, b) => a + b, 0) / period;
  return Math.round(atr * 10000) / 10000;
}

/**
 * @param {{ close: number }[]} candles oldest → newest
 */
export function calculateRSI(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  const closes = candles.map((c) => c.close);
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
}

/**
 * Simple MACD line vs signal (EMA12 - EMA26, signal EMA9 of MACD)
 * @param {{ close: number }[]} candles oldest → newest
 */
export function calculateMACD(candles) {
  if (!candles || candles.length < 35) return null;
  const closes = candles.map((c) => c.close);
  const ema = (data, span) => {
    const k = 2 / (span + 1);
    let emaVal = data[0];
    for (let i = 1; i < data.length; i++) {
      emaVal = data[i] * k + emaVal * (1 - k);
    }
    return emaVal;
  };
  const macdLine = ema(closes, 12) - ema(closes, 26);
  return {
    macd: Math.round(macdLine * 10000) / 10000,
    note: "Simplified single-point MACD snapshot (full series needs rolling EMA)",
  };
}
