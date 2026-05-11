/**
 * Two-step Claude briefing: themes → evidenced research candidates.
 * Uses merged news corpus only; validates tickers against extracted + ranked symbols.
 */
import crypto from "crypto";
import {
  buildResearchCorpus,
  buildAllowedSymbolSet,
  corpusDigestLines,
} from "./news-corpus.js";
import { parseJsonFromModel, validateBriefingCandidates } from "./briefing-shared.js";

const NOT_ADVICE =
  "Educational research only — not investment advice. Verify facts independently; consult a licensed professional for personal decisions.";

const briefingCache = new Map();

async function anthropicMessage({ apiKey, model, userPrompt, maxTokens }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-haiku-4-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return (
    data.content?.map((b) => (b.type === "text" ? b.text : "")).join("") || ""
  );
}

function trimCache(max = 40) {
  if (briefingCache.size <= max) return;
  const keys = [...briefingCache.keys()];
  for (const k of keys.slice(0, keys.length - max)) briefingCache.delete(k);
}

/**
 * @param {object} payload - discover payload including _rawArticles, ranked, feeds
 */
export async function generateResearchBriefing(payload, env = process.env) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) {
    return {
      ok: false,
      skipped: true,
      reason: "no_api_key",
      themes: [],
      uncertainties: [],
      candidates: [],
      disclaimer: NOT_ADVICE,
    };
  }

  const model = env.ANTHROPIC_MODEL || "claude-haiku-4-5";
  const corpus = buildResearchCorpus(payload, env);
  if (corpus.length < 4) {
    return {
      ok: true,
      skipped: true,
      reason: "thin_corpus",
      corpusSize: corpus.length,
      themes: [],
      uncertainties: [],
      candidates: [],
      disclaimer: NOT_ADVICE,
    };
  }

  const allowed = buildAllowedSymbolSet(corpus, payload.ranked);
  const digest = corpusDigestLines(corpus).join("\n");
  const cacheKey = crypto.createHash("sha256").update(digest).digest("hex");
  const ttl = Math.max(30_000, Number(env.AI_BRIEFING_CACHE_MS) || 120_000);
  const cached = briefingCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ttl) {
    return { ...cached.value, cacheHit: true };
  }

  const jsonOnly =
    "Respond with ONLY a single JSON object (no markdown fences, no commentary). ";

  const step1Prompt = `${jsonOnly}You are a financial news editor. No buy/sell/hold; no personalized advice.

Headlines (use numeric ids in brackets exactly as shown):
${digest}

Return JSON shape:
{"themes":[{"id":"t1","title":"short label","summary":"1-2 sentences","headlineIds":[0,1]}],"uncertainties":["one sentence each"]}
Rules: 3-6 themes. headlineIds must be integers matching [n] from the list.`;

  let step1;
  try {
    const raw = await anthropicMessage({
      apiKey,
      model,
      userPrompt: step1Prompt,
      maxTokens: Math.min(2048, Number(env.AI_BRIEFING_MAX_TOKENS_1) || 1200),
    });
    step1 = parseJsonFromModel(raw, "Claude briefing step1");
  } catch (e) {
    return {
      ok: false,
      error: String(e.message || e),
      themes: [],
      uncertainties: [],
      candidates: [],
      disclaimer: NOT_ADVICE,
      corpusSize: corpus.length,
    };
  }

  const themes = Array.isArray(step1.themes) ? step1.themes : [];
  const uncertainties = Array.isArray(step1.uncertainties)
    ? step1.uncertainties
    : [];

  const allowedList = [...allowed].slice(0, 48).join(", ");
  const step2Prompt = `${jsonOnly}You are a financial news editor. No buy/sell/hold.

Themes JSON: ${JSON.stringify(themes)}
Uncertainties: ${JSON.stringify(uncertainties)}

Headlines:
${digest}

Allowed ticker symbols ONLY (each candidate symbol must be in this set verbatim): ${allowedList}

Return JSON shape:
{"candidates":[{"symbol":"AAPL","thesis":"why the symbol is in the news narrative","risks":"counterpoints or uncertainty","verifyNext":["concrete check"],"headlineIds":[0,1]}]}
Max 5 candidates. Omit a candidate if you cannot tie it to headlineIds. headlineIds must exist in the headline list.`;

  let step2;
  try {
    const raw2 = await anthropicMessage({
      apiKey,
      model,
      userPrompt: step2Prompt,
      maxTokens: Math.min(4096, Number(env.AI_BRIEFING_MAX_TOKENS_2) || 1600),
    });
    step2 = parseJsonFromModel(raw2, "Claude briefing step2");
  } catch (e) {
    const partial = {
      ok: true,
      partial: true,
      error: String(e.message || e),
      corpusSize: corpus.length,
      themes,
      uncertainties,
      candidates: [],
      disclaimer: NOT_ADVICE,
    };
    briefingCache.set(cacheKey, { at: Date.now(), value: partial });
    trimCache();
    return partial;
  }

  const rawCandidates = Array.isArray(step2.candidates) ? step2.candidates : [];
  const validated = validateBriefingCandidates(corpus, allowed, rawCandidates);

  const out = {
    ok: true,
    cacheHit: false,
    corpusSize: corpus.length,
    themes,
    uncertainties,
    candidates: validated,
    disclaimer: NOT_ADVICE,
  };
  briefingCache.set(cacheKey, { at: Date.now(), value: { ...out, cacheHit: true } });
  trimCache();
  return out;
}
