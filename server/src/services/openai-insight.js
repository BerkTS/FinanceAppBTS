/**
 * ChatGPT / OpenAI stock insight — same prompt shape as Claude (`generateInsight`).
 * Root `.env`: OPENAI_API_KEY
 */
import { openaiChatCompletion } from "./openai-chat.js";

export async function generateInsightOpenAI({ stock, newsItems, apiKey, model }) {
  if (!apiKey?.trim()) {
    return {
      provider: "local",
      text: [
        `**${stock.symbol}** at $${stock.price} (${stock.changePct ?? 0}%)`,
        stock.rsi != null ? `RSI ~ ${stock.rsi}` : null,
        `News sentiment (heuristic): ${stock.news_sentiment}`,
        "",
        "Set OPENAI_API_KEY in root .env for ChatGPT-generated narrative.",
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

  const text = await openaiChatCompletion({
    apiKey,
    model: model || "gpt-4o-mini",
    userPrompt: prompt,
    maxTokens: 512,
    jsonObject: false,
  });

  return { provider: "openai", text: text || "" };
}
