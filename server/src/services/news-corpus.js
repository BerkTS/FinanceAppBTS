import { dedupeByContentKey, extractTickersFromArticles } from "./news.js";

function normalizeTitleKey(title) {
  return (title || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 256);
}

/**
 * Map heterogeneous outlet rows to article-like rows for dedupe + ticker extraction.
 */
function asArticle(row, sourceLabel) {
  const title = row.title || row.headline || row.articlesName || "";
  const description =
    row.description || row.articlesShortDescription || row.snippet || "";
  const url = row.url || row.link || "";
  let publishedAt = "";
  if (typeof row.publishedAt === "string") publishedAt = row.publishedAt;
  else if (row.publishedAt?.date)
    publishedAt = row.publishedAt.date.replace(" ", "T") + "Z";
  const contentKey = row.contentKey || normalizeTitleKey(title);
  return {
    ...row,
    title,
    description,
    url,
    publishedAt,
    contentKey,
    source: row.source || sourceLabel,
    provider: row.provider || sourceLabel,
    corpusSource: sourceLabel,
  };
}

function takeCap(items, n) {
  return (items || []).slice(0, Math.max(0, n));
}

/**
 * Merge main + outlet feeds, per-source caps, cross-source dedupe.
 * Each item gets `bid` (brief id) for Claude headline references.
 */
export function buildResearchCorpus(payload, env = process.env) {
  const mainCap = Number(env.CORPUS_MAIN_CAP) || 40;
  const cnbcCap = Number(env.CORPUS_CNBC_CAP) || 14;
  const reutersCap = Number(env.CORPUS_REUTERS_CAP) || 14;
  const saCap = Number(env.CORPUS_SEEKING_ALPHA_CAP) || 8;
  const rtCap = Number(env.CORPUS_REALTIME_NEWS_CAP) || 12;
  const finCap = Number(env.CORPUS_REALTIME_FINANCE_CAP) || 12;

  const chunks = [];

  const fromMain = (payload._rawArticles || []).map((a) =>
    asArticle(a, a.provider || a.outlet || "main")
  );
  takeCap(fromMain, mainCap).forEach((a) => chunks.push(a));

  takeCap(
    (payload.cnbcMarketsNews || []).map((x) => asArticle(x, "cnbc")),
    cnbcCap
  ).forEach((a) => chunks.push(a));

  takeCap(
    (payload.reutersBusinessNews || []).map((x) => asArticle(x, "reuters")),
    reutersCap
  ).forEach((a) => chunks.push(a));

  takeCap(
    (payload.seekingAlpha || []).map((x) => asArticle(x, "seeking_alpha")),
    saCap
  ).forEach((a) => chunks.push(a));

  takeCap(
    (payload.realTimeNewsData || []).map((x) => asArticle(x, "realtime_news_data")),
    rtCap
  ).forEach((a) => chunks.push(a));

  takeCap(
    (payload.realtimeFinanceNews || []).map((x) =>
      asArticle(x, "realtime_finance")
    ),
    finCap
  ).forEach((a) => chunks.push(a));

  const deduped = dedupeByContentKey(chunks);
  const maxItems = Math.min(80, Number(env.CORPUS_MAX_ITEMS) || 64);
  const limited = deduped.slice(0, maxItems);

  return limited.map((row, bid) => ({
    ...row,
    bid,
  }));
}

/**
 * @param {object} payload - discover payload; pass `_rawArticles` for main bundle (optional).
 */
/** Allowed ticker symbols: mentioned in corpus text + ranked discovery symbols. */
export function buildAllowedSymbolSet(corpus, ranked) {
  const articles = corpus.map((c) => ({
    title: c.title,
    description: c.description || "",
  }));
  const fromText = extractTickersFromArticles(articles).map((t) => t.symbol);
  const fromRanked = (ranked || []).map((r) => r.symbol).filter(Boolean);
  const set = new Set();
  for (const s of fromRanked) set.add(String(s).toUpperCase());
  for (const s of fromText) set.add(String(s).toUpperCase());
  const noise = new Set(["SPY", "QQQ", "IWM", "USA", "CEO", "IPO", "FED", "THE"]);
  for (const x of noise) set.delete(x);
  return set;
}

export function corpusDigestLines(corpus) {
  return corpus.map(
    (c) =>
      `[${c.bid}] (${c.corpusSource || c.source}) ${c.title}`.slice(0, 400)
  );
}
