/**
 * ChatGPT (OpenAI) two-step research briefing — same logic as Claude briefing.
 */
import crypto from "crypto";
import {
  buildResearchCorpus,
  buildAllowedSymbolSet,
  corpusDigestLines,
} from "./news-corpus.js";
import { parseJsonFromModel, validateBriefingCandidates } from "./briefing-shared.js";
import { openaiChatCompletion } from "./openai-chat.js";

const NOT_ADVICE =
  "Educational research only — not investment advice. Verify facts independently; consult a licensed professional for personal decisions.";

const briefingCacheOpenAi = new Map();

function trimCache(map, max = 40) {
  if (map.size <= max) return;
  const keys = [...map.keys()];
  for (const k of keys.slice(0, keys.length - max)) map.delete(k);
}

export async function generateOpenAiResearchBriefing(payload, env = process.env) {
  const apiKey = env.OPENAI_API_KEY || env.OPENAI_API_KEY_CHATGPT;
  if (!apiKey?.trim() || env.OPENAI_BRIEFING_DISABLED === "1") {
    return {
      ok: false,
      skipped: true,
      reason: "no_api_key",
      themes: [],
      uncertainties: [],
      candidates: [],
      disclaimer: NOT_ADVICE,
      provider: "openai",
    };
  }

  const model = env.OPENAI_MODEL || "gpt-4o-mini";
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
      provider: "openai",
    };
  }

  const allowed = buildAllowedSymbolSet(corpus, payload.ranked);
  const digest = corpusDigestLines(corpus).join("\n");
  const cacheKey = `oa:${crypto.createHash("sha256").update(digest).digest("hex")}`;
  const ttl = Math.max(30_000, Number(env.AI_BRIEFING_CACHE_MS) || 120_000);
  const cached = briefingCacheOpenAi.get(cacheKey);
  if (cached && Date.now() - cached.at < ttl) {
    return { ...cached.value, cacheHit: true, provider: "openai" };
  }

  const jsonOnly =
    "Return a single JSON object only (no markdown). ";

  const step1Prompt = `${jsonOnly}You are a financial news editor. No buy/sell/hold; no personalized advice.

Headlines (use numeric ids in brackets exactly as shown):
${digest}

Return JSON with this exact shape:
{"themes":[{"id":"t1","title":"short label","summary":"1-2 sentences","headlineIds":[0,1]}],"uncertainties":["one sentence each"]}
Rules: 3-6 themes. headlineIds must be integers matching [n] from the list.`;

  let step1;
  try {
    const raw = await openaiChatCompletion({
      apiKey,
      model,
      userPrompt: step1Prompt,
      maxTokens: Math.min(2048, Number(env.AI_BRIEFING_OPENAI_MAX_TOKENS_1) || 1200),
      jsonObject: true,
    });
    step1 = parseJsonFromModel(raw, "OpenAI briefing step1");
  } catch (e) {
    return {
      ok: false,
      error: String(e.message || e),
      themes: [],
      uncertainties: [],
      candidates: [],
      disclaimer: NOT_ADVICE,
      corpusSize: corpus.length,
      provider: "openai",
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

Return JSON:
{"candidates":[{"symbol":"AAPL","thesis":"why the symbol is in the news narrative","risks":"counterpoints","verifyNext":["concrete check"],"headlineIds":[0,1]}]}
Max 5 candidates. Omit if you cannot tie to headlineIds.`;

  let step2;
  try {
    const raw2 = await openaiChatCompletion({
      apiKey,
      model,
      userPrompt: step2Prompt,
      maxTokens: Math.min(4096, Number(env.AI_BRIEFING_OPENAI_MAX_TOKENS_2) || 1600),
      jsonObject: true,
    });
    step2 = parseJsonFromModel(raw2, "OpenAI briefing step2");
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
      provider: "openai",
    };
    briefingCacheOpenAi.set(cacheKey, { at: Date.now(), value: partial });
    trimCache(briefingCacheOpenAi);
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
    provider: "openai",
  };
  briefingCacheOpenAi.set(cacheKey, {
    at: Date.now(),
    value: { ...out, cacheHit: true },
  });
  trimCache(briefingCacheOpenAi);
  return out;
}
