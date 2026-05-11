/**
 * Daily snapshots of dashboard sections (localStorage), same order as the live UI.
 */

const STORAGE_KEY = "financeBoardHistory_v1";
const SCHEMA_VERSION = 1;
const MAX_CALENDAR_DAYS = 56;
const MAX_STORAGE_CHARS = 4_200_000;

export function getLocalDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const EASTERN_TZ = "America/New_York";

/** Wall-clock parts in US Eastern (DST-aware). */
export function getEasternParts(ms) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
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
  };
}

/** Calendar date key for history rows — NYSE session calendar (Eastern), including weekends. */
export function getHistoryDateKeyET(d = new Date()) {
  const p = getEasternParts(d.getTime());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Milliseconds from `fromMs` until the next instant that is 6:00:00 PM Eastern
 * (NYSE regular close + 2h). Weekends included. Minute scan + snap to second 0.
 */
export function msUntilNext630PMET(fromMs = Date.now()) {
  const max = 10 * 24 * 60 * 60 * 1000;
  for (let delta = 60 * 1000; delta <= max; delta += 60 * 1000) {
    const t = fromMs + delta;
    const p = getEasternParts(t);
    if (p.hour === 18 && p.minute === 0) {
      const snap = t - p.second * 1000;
      if (snap > fromMs) return snap - fromMs;
    }
  }
  return 24 * 60 * 60 * 1000;
}

export function cloneJSON(obj) {
  if (obj === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return null;
  }
}

export function outletFeedLabelsFromDiscover(discover) {
  const o = discover?.news?.sources?.outlets;
  if (!o) return "";
  return Object.entries(o)
    .filter(([, v]) => v)
    .map(([k]) => {
      if (k === "yahoo_finance_rss") return "Yahoo RSS";
      if (k === "newsapi_domains") return "NewsAPI domains";
      if (k === "ap_media") return "AP";
      if (k === "rapidapi_realtime_finance") return "Rapid:Real-time finance news";
      if (k.startsWith("rapidapi_")) return `Rapid:${k.replace("rapidapi_", "")}`;
      return k;
    })
    .join(" · ");
}

function capArray(arr, n) {
  return Array.isArray(arr) ? arr.slice(0, n) : [];
}

function trimNewsSectionPayload(discover) {
  if (!discover) return null;
  const n = 72;
  return {
    news: discover.news
      ? {
          sources: cloneJSON(discover.news.sources),
          errors: cloneJSON(discover.news.errors),
        }
      : null,
    seekingAlpha: cloneJSON(capArray(discover.seekingAlpha, n)),
    cnbcMarketsNews: cloneJSON(capArray(discover.cnbcMarketsNews, n)),
    realtimeFinanceNews: cloneJSON(capArray(discover.realtimeFinanceNews, n)),
    reutersBusinessNews: cloneJSON(capArray(discover.reutersBusinessNews, n)),
    realTimeNewsData: cloneJSON(capArray(discover.realTimeNewsData, n)),
  };
}

function trimDiscoveryPayload(discover) {
  if (!discover) return null;
  return {
    ranked: cloneJSON(capArray(discover.ranked, 24)),
    newsTickers: cloneJSON(capArray(discover.newsTickers, 20)),
  };
}

/**
 * Ordered sections[] (+ children) matching main column then sidebar, top-to-bottom.
 * @param {{ dateKey?: string }} [options] — override calendar key (Eastern YYYY-MM-DD).
 */
export function buildOrderedSnapshot(state, options = {}) {
  const date = options.dateKey ?? getHistoryDateKeyET();
  const savedAt = new Date().toISOString();
  const {
    loading,
    err,
    discover,
    tradeSuggest,
    tradeSuggestErr,
    tradeSuggestLoading,
    tradeAiBulk,
    tradeAiBulkErr,
    tradeAiBulkLoading,
    briefing,
    briefingChatgpt,
    briefingErr,
    briefingLoading,
    selected,
    analysis,
    analysisLoading,
    tradeAiView,
    tradeAiViewLoading,
    chartData,
  } = state;

  const outletFeedLabels = outletFeedLabelsFromDiscover(discover);

  const sections = [
    {
      id: "dataFeeds",
      title: "Data feeds",
      data: {
        loading: Boolean(loading),
        err: err || null,
        discoverNewsPresent: Boolean(discover?.news),
        outletFeedLabels,
        feedSummary: discover?.news
          ? {
              gdeltFallback: Boolean(discover.news.sources?.fallback),
              newsapi: Boolean(discover.news.sources?.newsapi),
              alphavantage: Boolean(discover.news.sources?.alphavantage),
              errorCount: discover.news.errors?.length || 0,
            }
          : null,
      },
    },
    {
      id: "structuredAiTradeView",
      title: "Structured AI trade view",
      data: {
        payload: cloneJSON(tradeAiBulk),
        err: tradeAiBulkErr || null,
        loading: Boolean(tradeAiBulkLoading),
      },
    },
    {
      id: "claude",
      title: "Claude",
      children: [
        {
          id: "claudeLiveTradeSuggestions",
          title: "Live trade suggestions",
          data: {
            payload: cloneJSON(tradeSuggest),
            err: tradeSuggestErr || null,
            loading: Boolean(tradeSuggestLoading),
          },
        },
        {
          id: "claudeResearchBriefing",
          title: "Research briefing",
          data: {
            payload: cloneJSON(briefing),
            err: briefingErr || null,
            loading: Boolean(briefingLoading),
          },
        },
      ],
    },
    {
      id: "chatgpt",
      title: "ChatGPT",
      children: [
        {
          id: "chatgptLiveTradeSuggestions",
          title: "Live trade suggestions",
          data: {
            payload: cloneJSON(tradeSuggest),
            err: tradeSuggestErr || null,
            loading: Boolean(tradeSuggestLoading),
          },
        },
        {
          id: "chatgptResearchBriefing",
          title: "Research briefing",
          data: {
            payload: cloneJSON(briefingChatgpt),
            err: briefingErr || null,
            loading: Boolean(briefingLoading),
          },
        },
      ],
    },
    {
      id: "news",
      title: "News",
      data: {
        payload: trimNewsSectionPayload(discover),
        loading: Boolean(loading),
      },
    },
    {
      id: "discovery",
      title: "Discovery",
      children: [
        {
          id: "discoveryRanked",
          title: "Ranked discovery",
          data: { payload: trimDiscoveryPayload(discover), loading: Boolean(loading) },
        },
        {
          id: "newsMentionIntensity",
          title: "News mention intensity",
          data: { chart: cloneJSON(chartData) },
        },
      ],
    },
    {
      id: "sidebar",
      title: "Selection & analysis",
      children: [
        {
          id: "sidebarSelectedSymbol",
          title: "Selected symbol",
          data: {
            symbol: selected || null,
            analysis: cloneJSON(analysis),
            analysisLoading: Boolean(analysisLoading),
          },
        },
        {
          id: "sidebarAiInsight",
          title: "AI insight",
          data: {
            insight: cloneJSON(analysis?.insight),
            insightChatgpt: cloneJSON(analysis?.insightChatgpt),
          },
        },
        {
          id: "sidebarAiTradeView",
          title: "AI trade view (selected ticker)",
          data: {
            payload: cloneJSON(tradeAiView),
            loading: Boolean(tradeAiViewLoading),
          },
        },
        {
          id: "sidebarRelatedHeadlines",
          title: "Related headlines",
          data: { items: cloneJSON(capArray(analysis?.relatedNews, 16)) },
        },
      ],
    },
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    date,
    savedAt,
    sections,
  };
}

function readRoot() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { schemaVersion: SCHEMA_VERSION, days: {} };
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return { schemaVersion: SCHEMA_VERSION, days: {} };
    if (!p.days || typeof p.days !== "object") p.days = {};
    return p;
  } catch {
    return { schemaVersion: SCHEMA_VERSION, days: {} };
  }
}

function pruneByAge(days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_CALENDAR_DAYS);
  const cutoffKey = getLocalDateKey(cutoff);
  for (const k of Object.keys(days)) {
    if (k < cutoffKey) delete days[k];
  }
}

function writeRoot(root) {
  let json = JSON.stringify(root);
  while (json.length > MAX_STORAGE_CHARS && Object.keys(root.days).length > 1) {
    const oldest = Object.keys(root.days).sort()[0];
    delete root.days[oldest];
    json = JSON.stringify(root);
  }
  localStorage.setItem(STORAGE_KEY, json);
}

export function mergeTodaySnapshot(snapshot) {
  if (typeof localStorage === "undefined") return;
  const root = readRoot();
  root.schemaVersion = SCHEMA_VERSION;
  root.days[snapshot.date] = snapshot;
  pruneByAge(root.days);
  writeRoot(root);
}

export function listSnapshotDates() {
  if (typeof localStorage === "undefined") return [];
  return Object.keys(readRoot().days).sort().reverse();
}

export function getSnapshotForDate(dateKey) {
  if (typeof localStorage === "undefined") return null;
  return readRoot().days[dateKey] || null;
}

/** Distinct filename for sorting in Downloads or any folder. */
export function buildExportFilename() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `FinanceSignalBoard-history-${y}-${m}-${day}-${hh}${mm}${ss}.json`;
}

export function getHistoryExportPayload() {
  const root = readRoot();
  return {
    exportType: "financeSignalBoardHistory",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    days: cloneJSON(root.days) || {},
  };
}

export function serializeHistoryExport() {
  return JSON.stringify(getHistoryExportPayload());
}

function isValidDaySnapshot(val) {
  return val && typeof val === "object" && Array.isArray(val.sections);
}

/**
 * @param {unknown} parsed
 * @returns {object} normalized import object with .days
 */
export function parseHistoryImportText(text) {
  let p;
  try {
    p = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON.");
  }
  if (!p || typeof p !== "object") throw new Error("Invalid file structure.");
  if (!p.days || typeof p.days !== "object") throw new Error('Missing "days" object (not a history export).');
  if (
    p.exportType &&
    p.exportType !== "financeSignalBoardHistory" &&
    p.exportType !== "financeBoardHistory"
  ) {
    throw new Error("Unrecognized export type in file.");
  }
  return p;
}

/**
 * Merges imported days into localStorage. Same calendar date is overwritten by import.
 * @returns {{ merged: number, skipped: number }}
 */
export function mergeHistoryImport(parsed) {
  if (typeof localStorage === "undefined") return { merged: 0, skipped: 0 };
  if (!parsed?.days || typeof parsed.days !== "object") {
    throw new Error("Missing days.");
  }
  const root = readRoot();
  let merged = 0;
  let skipped = 0;
  for (const [date, snap] of Object.entries(parsed.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      skipped += 1;
      continue;
    }
    if (!isValidDaySnapshot(snap)) {
      skipped += 1;
      continue;
    }
    const copy = cloneJSON(snap);
    if (!copy) {
      skipped += 1;
      continue;
    }
    copy.date = date;
    root.days[date] = copy;
    merged += 1;
  }
  pruneByAge(root.days);
  writeRoot(root);
  return { merged, skipped };
}
