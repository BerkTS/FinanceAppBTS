/**
 * YH Finance (RapidAPI) — market news.
 *
 * SteadyAPI-style paths use **markets** (plural) + `ticker=` query, e.g.
 *   GET /v1/markets/news?ticker=AAPL,TSLA
 * Older snippets used **market** (singular) — those often 404 on current gateways.
 *
 * Optional: set `YH_FINANCE_REQUEST_URL` to the full URL from RapidAPI “Code snippets”
 * (including query string) for a guaranteed match.
 */
import { headlineHash } from "../lib/hash.js";

const DEFAULT_HOST_CANDIDATES = [
  "yahoo-finance15.p.rapidapi.com",
  "yh-finance.p.rapidapi.com",
];

/** Tried when YH_FINANCE_MARKET_NEWS_PATH is unset (markets plural first). */
const DEFAULT_PATH_BASES = [
  "/v1/markets/news",
  "/api/v1/markets/news",
  "/v2/markets/news",
  "/api/v2/markets/news",
  "/v1/market/news",
  "/api/v1/market/news",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function titleKey(title) {
  return (title || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 256);
}

function cleanHost(h) {
  return String(h || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

function normalizePathBase(p) {
  let path = String(p || "").trim();
  if (!path.startsWith("/")) path = `/${path}`;
  return path;
}

function isNotSubscribed403(status, text) {
  return status === 403 && /not subscribed/i.test(text || "");
}

async function fetchOnce(url, rapidApiKey, host) {
  const res = await fetch(url, {
    headers: {
      "x-rapidapi-key": rapidApiKey,
      "x-rapidapi-host": host,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let json = null;
  if (text?.trim()) {
    try {
      json = JSON.parse(text);
    } catch {
      /* leave json null */
    }
  }
  return { ok: res.ok, status: res.status, text, json };
}

function extractNewsRows(json) {
  if (!json || typeof json !== "object") return [];
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.body)) return json.body;
  if (Array.isArray(json.data?.body)) return json.data.body;
  if (Array.isArray(json.result?.body)) return json.result.body;
  if (Array.isArray(json.news)) return json.news;
  if (Array.isArray(json.data)) return json.data;
  return [];
}

function parsePubDate(raw) {
  if (!raw) return new Date().toISOString();
  const t = Date.parse(raw);
  if (Number.isFinite(t)) return new Date(t).toISOString();
  return new Date().toISOString();
}

function mapRow(row) {
  const title = (row.title || row.headline || "").trim();
  if (!title) return null;
  const url = row.link || row.url || "";
  const description = (row.description || row.summary || "").trim();
  const publishedAt = parsePubDate(row.pubDate || row.publishedAt || row.date);
  return {
    id: headlineHash(title, `yh-finance-${url}`),
    contentKey: titleKey(title),
    title,
    description,
    url,
    publishedAt,
    source: "Yahoo Finance",
    provider: "rapidapi_yh_finance",
    outlet: "yh_finance_market_news",
    categories: ["finance"],
  };
}

function rapidApiKey(env) {
  return (
    env.YH_FINANCE_RAPIDAPI_KEY ||
    env.RAPIDAPI_KEY ||
    env.NEWS_RAPIDAPI_KEY ||
    env.X_RAPIDAPI_KEY
  );
}

function buildHostList(env) {
  const hosts = [];
  const explicit = cleanHost(env.YH_FINANCE_HOST);
  if (explicit) hosts.push(explicit);
  for (const h of DEFAULT_HOST_CANDIDATES) {
    if (h && !hosts.includes(h)) hosts.push(h);
  }
  return hosts;
}

/** Append ticker=… when path looks like a news endpoint and caller did not set a query. */
function ensureTickerQuery(pathAndQuery, env) {
  const pathOnly = pathAndQuery.split("?")[0] || pathAndQuery;
  if (!/\/news/i.test(pathOnly)) return pathAndQuery;
  if (/[?&](ticker|tickers|symbols)=/i.test(pathAndQuery)) return pathAndQuery;
  const t = (env.YH_FINANCE_NEWS_TICKERS || "AAPL,TSLA").trim();
  if (!t) return pathAndQuery;
  const q = new URLSearchParams({ ticker: t }).toString();
  return pathAndQuery.includes("?")
    ? `${pathAndQuery}&${q}`
    : `${pathAndQuery}?${q}`;
}

function buildCandidateRequests(env) {
  const rawUrl = (env.YH_FINANCE_REQUEST_URL || "").trim();
  if (rawUrl) {
    try {
      const u = new URL(rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`);
      return [
        {
          host: u.hostname,
          pathAndQuery: u.pathname + (u.search || ""),
          label: "YH_FINANCE_REQUEST_URL",
        },
      ];
    } catch {
      /* fall through to defaults */
    }
  }

  const hosts = buildHostList(env);
  const bases =
    env.YH_FINANCE_MARKET_NEWS_PATH != null &&
    String(env.YH_FINANCE_MARKET_NEWS_PATH).trim() !== ""
      ? [normalizePathBase(env.YH_FINANCE_MARKET_NEWS_PATH)]
      : [...DEFAULT_PATH_BASES];

  const seen = new Set();
  const out = [];
  for (const host of hosts) {
    for (const base of bases) {
      const pathAndQuery = ensureTickerQuery(base, env);
      const key = `${host}|${pathAndQuery}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ host, pathAndQuery, label: key });
    }
  }
  return out;
}

/**
 * @returns {{ items: object[], errors: string[] }}
 */
export async function fetchYahooFinanceMarketNews(env = process.env) {
  const key = rapidApiKey(env);
  if (!key || env.YH_FINANCE_DISABLED === "1") {
    return { items: [], errors: [] };
  }

  const limit = Math.min(
    48,
    Math.max(8, Number(env.YH_FINANCE_NEWS_LIMIT) || 24)
  );

  const candidates = buildCandidateRequests(env);
  const notes = [];

  for (const { host, pathAndQuery } of candidates) {
    const url = `https://${host}${pathAndQuery}`;

    let lastText = "";
    let json = null;
    let status = 0;
    let ok = false;

    for (let attempt = 0; attempt <= 2; attempt++) {
      if (attempt > 0) await sleep(1000 * attempt);
      const r = await fetchOnce(url, key, host);
      status = r.status;
      lastText = r.text || "";
      json = r.json;
      ok = r.ok;
      if (status === 429 && attempt < 2) continue;
      break;
    }

    if (ok) {
      if (!json) {
        return {
          items: [],
          errors: [`YH Finance ${status}: response was not JSON (${host}${pathAndQuery})`],
        };
      }
      const rows = extractNewsRows(json);
      const items = rows
        .map(mapRow)
        .filter(Boolean)
        .slice(0, limit);
      return { items, errors: [] };
    }

    if (isNotSubscribed403(status, lastText)) {
      notes.push(`${host}: not subscribed (skip if you only subscribe to the other Yahoo listing).`);
      continue;
    }

    if (status === 403) {
      return {
        items: [],
        errors: [
          `YH Finance 403: ${(lastText || "").slice(0, 240)} (${host}${pathAndQuery})`,
        ],
      };
    }

    if (status === 404) {
      notes.push(`${host}${pathAndQuery}: 404`);
      continue;
    }

    if (!ok) {
      return {
        items: [],
        errors: [`YH Finance ${status}: ${(lastText || "").slice(0, 280)} (${host}${pathAndQuery})`],
      };
    }
  }

  return {
    items: [],
    errors: [
      notes.length
        ? `${notes.join(" | ")} — no working route. Paste the full request URL from RapidAPI Code snippets into YH_FINANCE_REQUEST_URL in root .env, or set YH_FINANCE_MARKET_NEWS_PATH + YH_FINANCE_NEWS_TICKERS.`
        : "YH Finance: no request candidates.",
    ],
  };
}

export function yahooFinanceRapidConfigured(env = process.env) {
  const k = rapidApiKey(env);
  return Boolean(k && env.YH_FINANCE_DISABLED !== "1");
}
