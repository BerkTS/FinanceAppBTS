/** Shared JSON parse + candidate validation for Claude / ChatGPT research briefings. */

export function parseJsonFromModel(text, label = "briefing") {
  const t = (text || "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      throw new Error(`${label}: could not parse JSON (step output)`);
    }
  }
  try {
    return JSON.parse(t);
  } catch {
    throw new Error(`${label}: could not parse JSON (step output)`);
  }
}

export function validateBriefingCandidates(corpus, allowed, rawCandidates) {
  const validated = [];
  for (const c of rawCandidates) {
    const sym = String(c.symbol || "")
      .toUpperCase()
      .replace(/[^A-Z0-9.-]/g, "");
    if (!sym || !allowed.has(sym)) continue;
    const ids = Array.isArray(c.headlineIds) ? c.headlineIds : [];
    const evidence = [];
    for (const id of ids) {
      const n = Number(id);
      if (!Number.isInteger(n)) continue;
      const item = corpus.find((x) => x.bid === n);
      if (item?.title) {
        evidence.push({
          bid: item.bid,
          title: item.title,
          url: item.url || "",
          source: item.corpusSource || item.source,
        });
      }
    }
    if (evidence.length === 0) continue;
    validated.push({
      symbol: sym,
      thesis: String(c.thesis || "").slice(0, 1200),
      risks: String(c.risks || "").slice(0, 1200),
      verifyNext: (Array.isArray(c.verifyNext) ? c.verifyNext : [])
        .map((x) => String(x).slice(0, 240))
        .slice(0, 5),
      evidence,
    });
    if (validated.length >= 5) break;
  }
  return validated;
}
