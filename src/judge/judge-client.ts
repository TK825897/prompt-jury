import {
  buildJudgePrompt,
  buildSynthesisPrompt,
  assertJudgeResultLanguage,
  type AnonymousAnswer,
} from "./prompts";
import {
  judgeResultSchema,
  type JudgeConfig,
  type JudgeResult,
} from "./schemas";
import { applyWeights } from "./scoring";

export function chatCompletionsEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  url.pathname = normalizedPath.endsWith("/chat/completions")
    ? normalizedPath
    : `${normalizedPath}/chat/completions`;
  return url.toString();
}

export type JudgeApiErrorCode =
  | "AUTHENTICATION"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "HTTP_ERROR"
  | "NETWORK"
  | "INVALID_RESPONSE";

export class JudgeApiError extends Error {
  constructor(
    public readonly code: JudgeApiErrorCode,
    message: string,
    public readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "JudgeApiError";
  }
}

function responseErrorDetail(rawBody: string, apiKey: string): string {
  let detail = "The provider did not return an error message.";
  try {
    const parsed = JSON.parse(rawBody) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    const candidate =
      typeof parsed.error === "object"
        ? parsed.error?.message
        : (parsed.error ?? parsed.message);
    if (typeof candidate === "string" && candidate.trim())
      detail = candidate.trim();
  } catch {
    if (rawBody.trim()) detail = rawBody.trim();
  }
  const redacted = apiKey ? detail.replaceAll(apiKey, "[REDACTED]") : detail;
  return redacted.replace(/[\r\n]+/g, " ").slice(0, 300);
}

function apiErrorForStatus(status: number, detail: string): JudgeApiError {
  if (status === 401 || status === 403) {
    return new JudgeApiError(
      "AUTHENTICATION",
      `Judge API authentication failed (${status}). Check the API Key and endpoint.`,
      status,
    );
  }
  if (status === 429) {
    return new JudgeApiError(
      "RATE_LIMIT",
      `Judge API rate limit reached (429). Please retry later. ${detail}`,
      status,
    );
  }
  return new JudgeApiError(
    "HTTP_ERROR",
    `Judge API request failed (${status}). ${detail}`,
    status,
  );
}

export function judgeApiHeaders(
  endpoint: string,
  apiKey: string,
): Record<string, string> {
  const url = new URL(endpoint);
  const azure =
    url.hostname.endsWith(".openai.azure.com") ||
    url.pathname.includes("/openai/deployments/");
  return azure
    ? { "Content-Type": "application/json", "api-key": apiKey }
    : { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
}

async function completion(
  config: JudgeConfig,
  prompt: string,
  jsonMode: boolean,
): Promise<string> {
  const endpoint = chatCompletionsEndpoint(config.baseUrl);
  const body: Record<string, unknown> = {
    model: config.model,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    messages: [{ role: "user", content: prompt }],
  };
  if (jsonMode) body.response_format = { type: "json_object" };
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    config.requestTimeoutMs,
  );
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: judgeApiHeaders(endpoint, config.apiKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const rawBody = await response.text();
    if (!response.ok)
      throw apiErrorForStatus(
        response.status,
        responseErrorDetail(rawBody, config.apiKey),
      );
    try {
      return parseCompletionResponse(rawBody);
    } catch (error) {
      throw new JudgeApiError(
        "INVALID_RESPONSE",
        error instanceof Error
          ? error.message
          : "Judge API returned an invalid response.",
        response.status,
        { cause: error },
      );
    }
  } catch (error) {
    if (error instanceof JudgeApiError) throw error;
    if (controller.signal.aborted) {
      throw new JudgeApiError(
        "TIMEOUT",
        `Judge API request timed out after ${config.requestTimeoutMs} ms.`,
        undefined,
        { cause: error },
      );
    }
    throw new JudgeApiError(
      "NETWORK",
      "Judge API network request failed. Check the endpoint and network connection.",
      undefined,
      { cause: error },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export function parseCompletionResponse(rawBody: string): string {
  if (!rawBody.trim())
    throw new Error("Judge API returned an empty response body.");
  if (rawBody.trimStart().startsWith("data:")) {
    const chunks: string[] = [];
    for (const line of rawBody.split(/\r?\n/)) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      try {
        const event = JSON.parse(data) as {
          choices?: Array<{
            delta?: { content?: unknown };
            message?: { content?: unknown };
          }>;
        };
        const content =
          event.choices?.[0]?.delta?.content ??
          event.choices?.[0]?.message?.content;
        if (typeof content === "string") chunks.push(content);
      } catch {
        // A proxy may leave a partial final SSE event; complete events remain usable.
      }
    }
    const content = chunks.join("");
    if (!content.trim())
      throw new Error("Judge API returned SSE data without message content.");
    return content;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new Error(
      `Judge API returned incomplete or invalid JSON (${rawBody.length} characters).`,
    );
  }
  const content = (
    payload as { choices?: Array<{ message?: { content?: unknown } }> }
  ).choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim())
    throw new Error("Judge API returned no message content.");
  return content;
}

export function parseJudgeJson(raw: string): JudgeResult {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? raw).trim();
  try {
    return judgeResultSchema.parse(JSON.parse(candidate));
  } catch (initialError) {
    // Web UIs sometimes wrap an otherwise valid JSON object in a short
    // explanatory sentence without using a Markdown fence.
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return judgeResultSchema.parse(
        JSON.parse(candidate.slice(firstBrace, lastBrace + 1)),
      );
    }
    throw initialError;
  }
}

export async function runJudge(
  config: JudgeConfig,
  question: string,
  answers: AnonymousAnswer[],
): Promise<{ result: JudgeResult; raw: string }> {
  const prompt = buildJudgePrompt(question, answers, config.weights);
  let lastRaw = "";
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lastRaw = await completion(config, prompt, attempt === 0);
      return {
        result: (() => {
          const result = applyWeights(parseJudgeJson(lastRaw), config.weights);
          assertJudgeResultLanguage(question, result);
          return result;
        })(),
        raw: lastRaw,
      };
    } catch (error) {
      lastError = error;
      if (
        error instanceof JudgeApiError &&
        (error.code === "AUTHENTICATION" || error.code === "RATE_LIMIT")
      )
        throw error;
    }
  }
  if (lastError instanceof JudgeApiError) throw lastError;
  throw new Error(
    `Judge JSON validation failed: ${lastError instanceof Error ? lastError.message : "unknown error"}${lastRaw ? `; raw: ${lastRaw.slice(0, 500)}` : ""}`,
  );
}

export async function runSynthesis(
  config: JudgeConfig,
  mode: string,
  question: string,
  answers: AnonymousAnswer[],
  judge: JudgeResult,
): Promise<string> {
  const prompt = buildSynthesisPrompt(mode, question, answers, judge);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const attemptPrompt =
        attempt === 0
          ? prompt
          : `${prompt}\n\nCORRECTION: Your previous response reproduced Judge JSON instead of answering the user. Return only the synthesized natural-language Markdown answer now. Do not use a JSON code fence or JSON object.`;
      const content = await completion(config, attemptPrompt, false);
      assertSynthesisIsNaturalLanguage(content);
      return content;
    } catch (error) {
      lastError = error;
      if (
        error instanceof JudgeApiError &&
        (error.code === "AUTHENTICATION" || error.code === "RATE_LIMIT")
      )
        throw error;
    }
  }
  if (lastError instanceof JudgeApiError) throw lastError;
  throw new Error(
    `Synthesis API failed after retry: ${lastError instanceof Error ? lastError.message : "unknown error"}`,
  );
}

export function assertSynthesisIsNaturalLanguage(content: string): void {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? trimmed).trim();
  const judgeKeys =
    /["'](?:summary|ranking|evaluations|consensus|missingPoints|recommendedAnswerId)["']\s*:/;
  if (
    /^```\s*json/i.test(trimmed) ||
    (/^\s*\{/.test(candidate) && judgeKeys.test(candidate))
  ) {
    throw new Error(
      "Synthesis returned Judge JSON instead of a natural-language answer.",
    );
  }
}
