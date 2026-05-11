/**
 * Claude (Anthropic) Messages API — calls https://api.anthropic.com/v1/messages
 *
 * Add claude API key here: project root `.env` next to the root package.json:
 *   ANTHROPIC_API_KEY=sk-ant-api03-...
 * Do not put keys in this file; `.env` is gitignored (see `.env.example`).
 */
export async function generateInsight({ stock, newsItems, apiKey, model }) {
  if (!apiKey) {
    return {
      provider: "local",
      text: [
        `**${stock.symbol}** at $${stock.price} (${stock.changePct ?? 0}%)`,
        stock.rsi != null ? `RSI ~ ${stock.rsi}` : null,
        `News sentiment (heuristic): ${stock.news_sentiment}`,
        "",
        "Add claude API key here: set ANTHROPIC_API_KEY in the root .env file, then restart the server.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  const headlines = (newsItems || []).map((n) => n.title).slice(0, 12).join("\n");
  const prompt = `You are a careful financial editor. No investment advice; cite uncertainty.

Stock: ${stock.symbol} at $${stock.price} (${stock.changePct}%)
PE: ${stock.pe_ratio}, RSI: ${stock.rsi}, news sentiment score: ${stock.news_sentiment}

Recent headlines:
${headlines}

Provide: 1) Why the stock might be in focus, 2) Key risks, 3) Neutral outlook bullets. Under 180 words.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-haiku-4-5",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Anthropic error ${res.status}: ${JSON.stringify(data).slice(0, 500)}`
    );
  }
  const text =
    data.content?.map((b) => (b.type === "text" ? b.text : "")).join("") || "";
  return { provider: "anthropic", text };
}
