import { buildJudgePrompt, buildSynthesisPrompt, type AnonymousAnswer } from "./prompts";
import { judgeResultSchema, type JudgeConfig, type JudgeResult } from "./schemas";
import { applyWeights } from "./scoring";

export function chatCompletionsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

async function completion(config: JudgeConfig, prompt: string, jsonMode: boolean): Promise<string> {
  const endpoint = chatCompletionsEndpoint(config.baseUrl);
  const body: Record<string, unknown> = {
    model: config.model, temperature: config.temperature, max_tokens: config.maxTokens,
    messages: [{ role: "user", content: prompt }],
  };
  if (jsonMode) body.response_format = { type: "json_object" };
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify(body) });
  const rawBody = await response.text();
  if (!response.ok) throw new Error(`Judge API ${response.status}: ${rawBody}`);
  return parseCompletionResponse(rawBody);
}

export function parseCompletionResponse(rawBody: string): string {
  if (!rawBody.trim()) throw new Error("Judge API returned an empty response body.");
  if (rawBody.trimStart().startsWith("data:")) {
    const chunks: string[] = [];
    for (const line of rawBody.split(/\r?\n/)) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      try {
        const event = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }> };
        const content = event.choices?.[0]?.delta?.content ?? event.choices?.[0]?.message?.content;
        if (typeof content === "string") chunks.push(content);
      } catch {
        // A proxy may leave a partial final SSE event; complete events remain usable.
      }
    }
    const content = chunks.join("");
    if (!content.trim()) throw new Error("Judge API returned SSE data without message content.");
    return content;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new Error(`Judge API returned incomplete or invalid JSON (${rawBody.length} characters).`);
  }
  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("Judge API returned no message content.");
  return content;
}

export function parseJudgeJson(raw: string): JudgeResult {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  return judgeResultSchema.parse(JSON.parse(fenced ?? raw));
}

export async function runJudge(config: JudgeConfig, question: string, answers: AnonymousAnswer[]): Promise<{ result: JudgeResult; raw: string }> {
  const prompt = buildJudgePrompt(question, answers, config.weights);
  let lastRaw = "";
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lastRaw = await completion(config, prompt, attempt === 0);
      return { result: applyWeights(parseJudgeJson(lastRaw), config.weights), raw: lastRaw };
    }
    catch (error) { lastError = error; }
  }
  throw new Error(`Judge JSON validation failed: ${lastError instanceof Error ? lastError.message : "unknown error"}${lastRaw ? `; raw: ${lastRaw.slice(0, 500)}` : ""}`);
}

export async function runSynthesis(config: JudgeConfig, mode: string, question: string, answers: AnonymousAnswer[], judge: JudgeResult): Promise<string> {
  const prompt = buildSynthesisPrompt(mode, question, answers, judge);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return await completion(config, prompt, false); }
    catch (error) { lastError = error; }
  }
  throw new Error(`Synthesis API failed after retry: ${lastError instanceof Error ? lastError.message : "unknown error"}`);
}
