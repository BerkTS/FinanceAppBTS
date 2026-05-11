/**
 * OpenAI Chat Completions API — set OPENAI_API_KEY in root `.env`.
 * https://platform.openai.com/api-keys
 */
export async function openaiChatCompletion({
  apiKey,
  model,
  userPrompt,
  maxTokens = 2048,
  jsonObject = false,
}) {
  const body = {
    model: model || "gpt-4o-mini",
    messages: [{ role: "user", content: userPrompt }],
    max_tokens: maxTokens,
  };
  if (jsonObject) {
    body.response_format = { type: "json_object" };
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data.choices?.[0]?.message?.content || "";
}
