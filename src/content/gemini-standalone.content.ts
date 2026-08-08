import { GeminiAdapter } from "../adapters/gemini-adapter";
import { AdapterError, errorMessage } from "../shared/errors";
import type { ExtensionResponse } from "../messaging/schemas";

type GeminiContentRequest =
  | { type: "CONTENT_DETECT" }
  | { type: "CONTENT_MOCK"; prompt: string }
  | { type: "CONTENT_SEND_PROMPT"; prompt: string };

function parseRequest(value: unknown): GeminiContentRequest | undefined {
  if (typeof value !== "object" || value === null || !("type" in value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.type === "CONTENT_DETECT") return { type: "CONTENT_DETECT" };
  if (
    (record.type === "CONTENT_MOCK" || record.type === "CONTENT_SEND_PROMPT") &&
    typeof record.prompt === "string" &&
    record.prompt.trim().length > 0 &&
    record.prompt.length <= 100_000
  ) {
    return { type: record.type, prompt: record.prompt };
  }
  return undefined;
}

const adapter = new GeminiAdapter();

async function handle(raw: unknown): Promise<ExtensionResponse> {
  const message = parseRequest(raw);
  if (!message) return { ok: false, error: "Invalid content message", code: "INVALID_MESSAGE" };
  try {
    if (message.type === "CONTENT_DETECT") return { ok: true, data: await adapter.detectPageState() };
    if (message.type === "CONTENT_MOCK") {
      return {
        ok: true,
        data: {
          providerId: "mock",
          contentText: `Mock Provider 已通过完整消息链路收到 ${message.prompt.length} 个字符。`,
          codeBlocks: [],
          tables: [],
          completedAt: new Date().toISOString(),
          sourceUrl: location.href,
        },
      };
    }
    await adapter.setPrompt(message.prompt);
    await adapter.submitPrompt();
    await adapter.waitForCompletion();
    return { ok: true, data: await adapter.extractLatestResponse() };
  } catch (error) {
    return { ok: false, error: errorMessage(error), code: error instanceof AdapterError ? error.code : "ADAPTER_ERROR" };
  }
}

// Register synchronously, before any page inspection or asynchronous work.
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  void handle(message).then(sendResponse);
  return true;
});
