import { num } from "./trade-rules.js";

export const PRICE_HISTORY_RANGES = ["1D", "5D", "1M", "3M", "6M", "1Y", "5Y"];

/**
 * Map UI range to Schwab pricehistory query params.
 * @returns {{ periodType: string, period: number, frequencyType: string, frequency: number, needExtendedHours?: boolean }}
 */
export function schwabPriceHistoryParams(range) {
  const r = String(range || "1M").toUpperCase();
  switch (r) {
    case "1D":
      return {
        periodType: "day",
        period: 1,
        frequencyType: "minute",
        frequency: 5,
        needExtendedHours: true,
      };
    case "5D":
      return { periodType: "day", period: 5, frequencyType: "daily", frequency: 1 };
    case "1M":
      return { periodType: "month", period: 1, frequencyType: "daily", frequency: 1 };
    case "3M":
      return { periodType: "month", period: 3, frequencyType: "daily", frequency: 1 };
    case "6M":
      return { periodType: "month", period: 6, frequencyType: "daily", frequency: 1 };
    case "1Y":
      return { periodType: "year", period: 1, frequencyType: "daily", frequency: 1 };
    case "5Y":
      return { periodType: "year", period: 5, frequencyType: "weekly", frequency: 1 };
    default:
      return { periodType: "month", period: 1, frequencyType: "daily", frequency: 1 };
  }
}

export function normalizePriceHistoryCandles(history) {
  const raw =
    history?.candles ||
    history?.candlesList ||
    history?.chart?.candles ||
    [];
  const rows = [];
  for (const c of raw) {
    const dtRaw = c.datetime != null ? Number(c.datetime) : null;
    const time = dtRaw != null && Number.isFinite(dtRaw) ? dtRaw : null;
    const open = num(c.open);
    const high = num(c.high);
    const low = num(c.low);
    const close = num(c.close);
    const volume = num(c.volume, 0);
    if (close <= 0 || high < low) continue;
    const date = time != null ? new Date(time).toISOString() : null;
    if (!date) continue;
    rows.push({ time, date, open, high, low, close, volume });
  }
  return rows;
}
