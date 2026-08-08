import { requestSchema, responseSchema, type ExtensionResponse } from "../messaging/schemas";
import { errorMessage } from "../shared/errors";
import type { PageState } from "../adapters/types";

const providerOrder = ["chatgpt", "gemini", "kimi", "doubao"] as const;

function providerFromUrl(url: string): PageState["providerId"] | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "chat.openai.com" || host === "chatgpt.com" || host.endsWith(".chatgpt.com")) return "chatgpt";
    if (host === "gemini.google.com" || host.endsWith(".gemini.google.com")) return "gemini";
    if (["kimi.moonshot.cn", "kimi.com", "www.kimi.com"].includes(host)) return "kimi";
    if (["doubao.com", "www.doubao.com"].includes(host)) return "doubao";
    return undefined;
  } catch {
    return undefined;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

type ContentMessage = { type: "CONTENT_DETECT" } | { type: "CONTENT_MOCK"; prompt: string } | { type: "CONTENT_SEND_PROMPT"; prompt: string };

async function sendToContent(tabId: number, message: ContentMessage): Promise<ExtensionResponse> {
  const raw: unknown = await chrome.tabs.sendMessage(tabId, message);
  return responseSchema.parse(raw);
}

async function injectContentScript(tabId: number, providerId: Exclude<PageState["providerId"], "mock">): Promise<void> {
  const scriptIndex = providerOrder.indexOf(providerId);
  const scripts = chrome.runtime.getManifest().content_scripts?.[scriptIndex]?.js;
  if (!scripts?.length) throw new Error(`No packaged Content Script found for ${providerId}`);
  await chrome.scripting.executeScript({ target: { tabId }, files: scripts });
}

async function toContent(tabId: number, message: ContentMessage): Promise<ExtensionResponse> {
  try {
    return await sendToContent(tabId, message);
  } catch (initialError) {
    const tab = await chrome.tabs.get(tabId);
    const providerId = providerFromUrl(tab.url ?? "");
    if (!providerId || providerId === "mock") throw initialError;
    try {
      await injectContentScript(tabId, providerId);
    } catch (injectionError) {
      const detail = errorMessage(injectionError);
      if (/blocked|cannot access|permission|not allowed/i.test(detail)) {
        throw new Error(
          `Edge blocked script execution (${detail}). The selected tab may be sleeping, discarded, or restricted by browser policy.`,
        );
      }
      throw injectionError;
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try { return await sendToContent(tabId, message); } catch { /* loader imports asynchronously */ }
    }
    throw initialError;
  }
}

async function handle(raw: unknown): Promise<ExtensionResponse> {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid message payload", code: "INVALID_MESSAGE" };
  const message = parsed.data;
  try {
    if (message.type === "DETECT_PROVIDERS") {
      const allTabs = await chrome.tabs.query({});
      const tabsByProvider = new Map<PageState["providerId"], Array<chrome.tabs.Tab & { id: number }>>();
      for (const tab of allTabs) {
        const providerId = providerFromUrl(tab.url ?? "");
        if (providerId && tab.id !== undefined) {
          const providerTabs = tabsByProvider.get(providerId) ?? [];
          providerTabs.push({ ...tab, id: tab.id });
          tabsByProvider.set(providerId, providerTabs);
        }
      }
      const states = await Promise.all(providerOrder.map(async (providerId): Promise<PageState> => {
        const tabs = (tabsByProvider.get(providerId) ?? []).sort((left, right) => {
          if (left.active !== right.active) return left.active ? -1 : 1;
          if (left.discarded !== right.discarded) return left.discarded ? 1 : -1;
          return (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0);
        });
        if (!tabs.length) return { providerId, status: "not_open", url: "" };
        const failures: string[] = [];
        for (const tab of tabs) {
          try {
            const response = await toContent(tab.id, { type: "CONTENT_DETECT" });
            if (!response.ok || Array.isArray(response.data) || typeof response.data === "string" || !("status" in response.data)) {
              throw new Error(response.ok ? "Unexpected content response" : response.error);
            }
            return { ...response.data, tabId: tab.id } satisfies PageState;
          } catch (error) {
            failures.push(`tab ${tab.id} (${tab.active ? "active" : "background"}, ${tab.discarded ? "discarded" : tab.status ?? "unknown"}): ${errorMessage(error)}`);
          }
        }
        const preferredTab = tabs[0];
        return {
          providerId,
          status: "error",
          tabId: preferredTab.id,
          url: preferredTab.url ?? "",
          errorMessage: `Content Script unavailable on ${tabs.length} matching tab(s): ${failures.join(" | ")}`,
        };
      }));
      return { ok: true, data: states };
    }
    if (message.type === "PING_CONTENT") return toContent(message.tabId, { type: "CONTENT_DETECT" });
    if (message.type === "MOCK_ROUNDTRIP") return toContent(message.tabId, { type: "CONTENT_MOCK", prompt: message.prompt });
    if (message.type === "SEND_PROMPT") return toContent(message.tabId, { type: "CONTENT_SEND_PROMPT", prompt: message.prompt });
    return { ok: false, error: "Content-only message received by background", code: "WRONG_CONTEXT" };
  } catch (error) {
    return { ok: false, error: errorMessage(error), code: "ROUTING_ERROR" };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  void handle(message).then(sendResponse);
  return true;
});
