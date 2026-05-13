/**
 * Server-side scheduled refresh + 6 PM ET history finalize.
 * Runs independently of any browser tab being open.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchDiscoverPayload } from "./discover-payload.js";
import { clearAllCaches } from "./feed-cache.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_DIR = path.resolve(__dirname, "../../data/history");
const EASTERN_TZ = "America/New_York";

function getEasternParts(ms = Date.now()) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
    weekday: "short",
  });
  const o = {};
  for (const x of f.formatToParts(new Date(ms))) {
    if (x.type !== "literal") o[x.type] = x.value;
  }
  return {
    year: Number(o.year),
    month: Number(o.month),
    day: Number(o.day),
    hour: Number(o.hour),
    minute: Number(o.minute),
    second: Number(o.second),
    weekday: o.weekday,
  };
}

function getETDateKey(ms = Date.now()) {
  const p = getEasternParts(ms);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function isMarketHours(p) {
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  if (!weekdays.includes(p.weekday)) return false;
  const mins = p.hour * 60 + p.minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function isWeekend(p) {
  return p.weekday === "Sat" || p.weekday === "Sun";
}

function getRefreshIntervalMs(env = process.env) {
  const p = getEasternParts();
  if (isMarketHours(p)) {
    return Math.max(60_000, Number(env.REFRESH_MARKET_HOURS_MS) || 1_800_000);
  }
  if (isWeekend(p)) {
    return Math.max(60_000, Number(env.REFRESH_WEEKEND_MS) || 14_400_000);
  }
  return Math.max(60_000, Number(env.REFRESH_OFF_HOURS_MS) || 7_200_000);
}

function msUntilNext6PMET(fromMs = Date.now()) {
  const max = 2 * 24 * 60 * 60 * 1000;
  for (let delta = 60_000; delta <= max; delta += 60_000) {
    const p = getEasternParts(fromMs + delta);
    if (p.hour === 18 && p.minute === 0) {
      const snap = fromMs + delta - p.second * 1000;
      if (snap > fromMs) return snap - fromMs;
    }
  }
  return 24 * 60 * 60 * 1000;
}

function ensureHistoryDir() {
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }
}

function saveHistorySnapshot(dateKey, payload) {
  try {
    ensureHistoryDir();
    const filePath = path.join(HISTORY_DIR, `${dateKey}.json`);
    const snapshot = {
      date: dateKey,
      savedAt: new Date().toISOString(),
      savedBy: "server-scheduler",
      discover: payload
        ? {
            ranked: (payload.ranked || []).slice(0, 24),
            newsTickers: (payload.newsTickers || []).slice(0, 20),
            news: payload.news || null,
            seekingAlpha: (payload.seekingAlpha || []).slice(0, 72),
            realtimeFinanceNews: (payload.realtimeFinanceNews || []).slice(0, 72),
            yahooFinanceNews: (payload.yahooFinanceNews || []).slice(0, 72),
            cnbcMarketsNews: (payload.cnbcMarketsNews || []).slice(0, 72),
            reutersBusinessNews: (payload.reutersBusinessNews || []).slice(0, 72),
            realTimeNewsData: (payload.realTimeNewsData || []).slice(0, 72),
          }
        : null,
    };
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
    console.log(`[scheduler] History saved: ${filePath}`);
  } catch (e) {
    console.error("[scheduler] History save error:", e.message);
  }
}

let refreshTimer = null;
let historyTimer = null;
let lastPayload = null;

async function doRefresh(getSchwabTokenForSession, env) {
  try {
    const label = getEasternParts();
    const ctx = isMarketHours(label) ? "market-hours" : isWeekend(label) ? "weekend" : "off-hours";
    console.log(
      `[scheduler] Refresh (${ctx}) at ${label.hour}:${String(label.minute).padStart(2, "0")} ET`
    );
    clearAllCaches();
    const payload = await fetchDiscoverPayload({
      limit: 60,
      newsApiKey: env.NEWS_API_KEY,
      alphaVantageKey: env.ALPHA_VANTAGE_API_KEY,
      newsApiFinanceQuery: env.NEWSAPI_FINANCE_QUERY,
      newsApiGeoQuery: env.NEWSAPI_GEO_QUERY,
      sessionId: "default",
      getSchwabTokenForSession,
    });
    lastPayload = payload;
    console.log(
      `[scheduler] Refresh done — ${payload.news?.articleCount || 0} articles, ${(payload.ranked || []).length} ranked`
    );
  } catch (e) {
    console.error("[scheduler] Refresh error (non-fatal):", e.message);
  }
}

function scheduleNextRefresh(getSchwabTokenForSession, env) {
  clearTimeout(refreshTimer);
  const ms = getRefreshIntervalMs(env);
  console.log(`[scheduler] Next refresh in ${Math.round(ms / 60_000)} min`);
  refreshTimer = setTimeout(async () => {
    try {
      await doRefresh(getSchwabTokenForSession, env);
    } catch (e) {
      console.error("[scheduler] Unexpected refresh error:", e.message);
    }
    scheduleNextRefresh(getSchwabTokenForSession, env);
  }, ms);
}

function scheduleHistory6PMET(getSchwabTokenForSession, env) {
  clearTimeout(historyTimer);
  const ms = msUntilNext6PMET();
  const nextP = getEasternParts(Date.now() + ms);
  console.log(
    `[scheduler] Next 6 PM ET history save in ${Math.round(ms / 60_000)} min (${nextP.month}/${nextP.day})`
  );
  historyTimer = setTimeout(async () => {
    try {
      if (!lastPayload) {
        await doRefresh(getSchwabTokenForSession, env);
      }
      const dateKey = getETDateKey();
      saveHistorySnapshot(dateKey, lastPayload);
    } catch (e) {
      console.error("[scheduler] History timer error:", e.message);
    }
    scheduleHistory6PMET(getSchwabTokenForSession, env);
  }, ms);
}

export function startServerScheduler(getSchwabTokenForSession, env = process.env) {
  if (env.SERVER_SCHEDULER_DISABLED === "1") {
    console.log("[scheduler] Disabled via SERVER_SCHEDULER_DISABLED=1");
    return;
  }

  console.log("[scheduler] Starting server-side scheduled refresh + 6 PM ET history save");

  const initialDelayMs = Math.max(5_000, Number(env.SCHEDULER_INITIAL_DELAY_MS) || 15_000);
  setTimeout(async () => {
    try {
      await doRefresh(getSchwabTokenForSession, env);
    } catch (e) {
      console.error("[scheduler] Initial refresh error:", e.message);
    }
    scheduleNextRefresh(getSchwabTokenForSession, env);
  }, initialDelayMs);

  scheduleHistory6PMET(getSchwabTokenForSession, env);
}

export function getLastSchedulerPayload() {
  return lastPayload;
}
