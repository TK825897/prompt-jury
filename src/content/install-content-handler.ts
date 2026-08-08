import { adapterForUrl } from "../adapters/registry";
import { requestSchema, type ExtensionResponse } from "../messaging/schemas";
import { AdapterError, errorMessage } from "../shared/errors";

async function handle(raw: unknown): Promise<ExtensionResponse> {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid content message", code: "INVALID_MESSAGE" };
  const adapter = adapterForUrl(location.href);
  if (!adapter) return { ok: false, error: "No adapter supports this page", code: "UNSUPPORTED_PAGE" };
  try {
    if (parsed.data.type === "CONTENT_MOCK") {
      return {
        ok: true,
        data: {
          providerId: "mock",
          contentText: `Mock Provider 已通过完整消息链路收到 ${parsed.data.prompt.length} 个字符。`,
          codeBlocks: [], tables: [], completedAt: new Date().toISOString(), sourceUrl: location.href,
        },
      };
    }
    if (parsed.data.type === "CONTENT_DETECT") return { ok: true, data: await adapter.detectPageState() };
    if (parsed.data.type === "CONTENT_SEND_PROMPT") {
      await adapter.setPrompt(parsed.data.prompt);
      await adapter.submitPrompt();
      await adapter.waitForCompletion();
      return { ok: true, data: await adapter.extractLatestResponse() };
    }
    return { ok: false, error: "Background-only message received by content script", code: "WRONG_CONTEXT" };
  } catch (error) {
    return { ok: false, error: errorMessage(error), code: error instanceof AdapterError ? error.code : "ADAPTER_ERROR" };
  }
}

export function installContentHandler(): void {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    void handle(message).then(sendResponse);
    return true;
  });
}
