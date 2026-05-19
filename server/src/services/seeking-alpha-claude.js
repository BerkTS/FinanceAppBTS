import { parseJsonFromModel } from "./briefing-shared.js";

const NOT_ADVICE =
  "Educational research only — not investment advice. Verify independently; do not treat as trade instructions.";

/**
 * @param {{ apiKey: string, model?: string, maxTokens?: number, userContent: unknown[] }} params
 */
export async function anthropicVisionMessage(params) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: params.model || "claude-haiku-4-5",
      max_tokens: params.maxTokens ?? 2048,
      messages: [{ role: "user", content: params.userContent }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data.content?.map((b) => (b.type === "text" ? b.text : "")).join("") || "";
}

/**
 * @param {{ pages: { url: string, title: string, text: string, screenshotBase64?: string }[] }} input
 */
export async function claudePlanSeekingAlphaFollowUps(input, env = process.env) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) throw new Error("ANTHROPIC_API_KEY is required for Seeking Alpha browser analysis.");

  const model = env.SEEKING_ALPHA_CLAUDE_MODEL || env.ANTHROPIC_MODEL || "claude-haiku-4-5";
  const summaries = input.pages
    .map(
      (p, i) =>
        `### Page ${i + 1}: ${p.title}\nURL: ${p.url}\n\n${(p.text || "").slice(0, 6000)}`
    )
    .join("\n\n");

  const content = [];
  for (const p of input.pages.slice(0, 2)) {
    if (p.screenshotBase64) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: p.screenshotBase64,
        },
      });
    }
  }
  content.push({
    type: "text",
    text: `You are reviewing Seeking Alpha (premium-style) pages captured from a logged-in browser session for same-day US equity research.

${NOT_ADVICE}

From the page text (and screenshots if attached), identify the most actionable same-day stock ideas. Prefer tickers explicitly mentioned on Seeking Alpha (symbols, ratings, trending lists, analysis headlines).

Return ONLY valid JSON:
{
  "linksToFollow": [{"url": "https://seekingalpha.com/...", "reason": "short"}],
  "symbolsSpotted": ["AAPL"],
  "notes": "one paragraph"
}

Rules:
- linksToFollow: max 4, must be absolute https://seekingalpha.com URLs found in or implied by the content (market news, symbol pages, screeners, trending).
- symbolsSpotted: uppercase tickers only, max 12.
- Do not invent URLs outside seekingalpha.com.

Pages:
${summaries}`,
  });

  const text = await anthropicVisionMessage({
    apiKey,
    model,
    maxTokens: 1200,
    userContent: content,
  });
  return parseJsonFromModel(text, "sa-plan");
}

/**
 * @param {{ pages: object[], planNotes?: string }} input
 */
export async function claudePickTopStocks(input, env = process.env) {
  const apiKey = env.ANTHROPIC_API_KEY;
  const model = env.SEEKING_ALPHA_CLAUDE_MODEL || env.ANTHROPIC_MODEL || "claude-haiku-4-5";
  const corpus = input.pages
    .map(
      (p, i) =>
        `--- Page ${i + 1}: ${p.title} (${p.url}) ---\n${(p.text || "").slice(0, 8000)}`
    )
    .join("\n\n");

  const prompt = `You are a careful equity research editor reviewing Seeking Alpha material for the upcoming US cash session.

${NOT_ADVICE}

Using ONLY the captured page text below, pick the top 5 US-listed stocks to research for potential buys today (not guaranteed winners). Rank 1 = strongest idea.

Return ONLY valid JSON:
{
  "picks": [
    {
      "rank": 1,
      "symbol": "AAPL",
      "thesis": "2-4 sentences grounded in the captured text",
      "conviction": "high|medium|low",
      "risks": "1-2 sentences",
      "saUrl": "optional seeking alpha URL if known"
    }
  ],
  "marketContext": "1-2 sentences",
  "disclaimer": "${NOT_ADVICE}"
}

Rules:
- Exactly 5 picks if enough distinct symbols exist; otherwise return as many as are well-supported (min 1).
- Symbols: uppercase US tickers (1-5 letters); no crypto, no ETFs unless explicitly central in the text.
- Every thesis must reference themes visible in the corpus (news, ratings, upgrades, earnings, macro).
- If content is thin or login-walled, say so in marketContext and lower conviction.

Planner notes: ${input.planNotes || "(none)"}

Corpus:
${corpus}`;

  const text = await anthropicVisionMessage({
    apiKey,
    model,
    maxTokens: 2200,
    userContent: [{ type: "text", text: prompt }],
  });
  return parseJsonFromModel(text, "sa-picks");
}

export function normalizePicks(raw) {
  const list = Array.isArray(raw?.picks) ? raw.picks : [];
  const picks = [];
  for (const row of list) {
    const symbol = String(row.symbol || "")
      .toUpperCase()
      .replace(/[^A-Z.]/g, "")
      .slice(0, 6);
    if (!symbol || symbol.length < 1) continue;
    picks.push({
      rank: Number(row.rank) || picks.length + 1,
      symbol,
      thesis: String(row.thesis || "").slice(0, 1500),
      conviction: ["high", "medium", "low"].includes(String(row.conviction).toLowerCase())
        ? String(row.conviction).toLowerCase()
        : "medium",
      risks: String(row.risks || "").slice(0, 800),
      saUrl: row.saUrl ? String(row.saUrl).slice(0, 500) : null,
    });
    if (picks.length >= 5) break;
  }
  picks.sort((a, b) => a.rank - b.rank);
  return {
    picks,
    marketContext: String(raw?.marketContext || "").slice(0, 1200),
    disclaimer: raw?.disclaimer || NOT_ADVICE,
  };
}
