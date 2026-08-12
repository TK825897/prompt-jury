import {
  requestSchema,
  responseSchema,
  type ExtensionResponse,
} from "../messaging/schemas";
import { errorMessage } from "../shared/errors";
import type { PageState } from "../adapters/types";
import type { JudgeSession } from "../judge/session/session-types";

const providerOrder = ["chatgpt", "gemini", "kimi", "doubao"] as const;

function providerFromUrl(url: string): PageState["providerId"] | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (
      host === "chat.openai.com" ||
      host === "chatgpt.com" ||
      host.endsWith(".chatgpt.com")
    )
      return "chatgpt";
    if (host === "gemini.google.com" || host.endsWith(".gemini.google.com"))
      return "gemini";
    if (["kimi.moonshot.cn", "kimi.com", "www.kimi.com"].includes(host))
      return "kimi";
    if (["doubao.com", "www.doubao.com"].includes(host)) return "doubao";
    return undefined;
  } catch {
    return undefined;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

type ContentMessage =
  | { type: "CONTENT_DETECT" }
  | { type: "CONTENT_MOCK"; prompt: string }
  | { type: "CONTENT_SEND_PROMPT"; prompt: string }
  | { type: "CONTENT_SEND_JUDGE_PROMPT"; prompt: string }
  | { type: "CONTENT_ENABLE_TEMPORARY_CHAT" };

const judgeSessionKey = (sessionId: string) => `judgeSession:${sessionId}`;

async function waitForTabComplete(
  tabId: number,
  timeoutMs = 30_000,
): Promise<void> {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Temporary Judge tab did not finish loading."));
    }, timeoutMs);
    const listener = (
      updatedTabId: number,
      changeInfo: { status?: string },
    ) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function createTemporaryJudgeSession(
  providerId: Exclude<PageState["providerId"], "mock">,
): Promise<JudgeSession> {
  if (providerId !== "chatgpt")
    throw new Error(
      `${providerId} Temporary Chat Judge is not implemented yet.`,
    );
  const [originalActiveTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  const existingTabs = await chrome.tabs.query({
    url: ["https://chatgpt.com/*", "https://*.chatgpt.com/*"],
  });
  const sourceTab =
    existingTabs.find(
      (candidate) => candidate.windowId === originalActiveTab?.windowId,
    ) ?? existingTabs[0];
  const tab =
    sourceTab?.id !== undefined
      ? await chrome.tabs.duplicate(sourceTab.id)
      : await chrome.tabs.create({
          url: "https://chatgpt.com/",
          active: false,
        });
  if (!tab || tab.id === undefined)
    throw new Error("ChatGPT Temporary Chat tab could not be created.");
  const tabId = tab.id;
  try {
    await chrome.tabs.update(tabId, {
      active: true,
      // A duplicated /c/... page is an existing conversation and does not
      // expose the Temporary Chat entry point. The owned tab must start from
      // ChatGPT's new-conversation route.
      url: "https://chatgpt.com/",
    });
    await chrome.windows.update(tab.windowId, { focused: true });
    let loadWarning = "";
    try {
      await waitForTabComplete(tabId, 30_000);
    } catch (error) {
      // ChatGPT can keep a navigation in `loading` while its SPA is already
      // interactive. Treat completion as a readiness hint, not a requirement.
      loadWarning = errorMessage(error);
    }
    const enableTemporaryChat = async (): Promise<void> => {
      const enabled = await toContent(tabId, {
        type: "CONTENT_ENABLE_TEMPORARY_CHAT",
      });
      if (!enabled.ok || enabled.data !== "temporary_chat_ready") {
        throw new Error(
          enabled.ok
            ? "ChatGPT Temporary Chat activation returned invalid data."
            : enabled.error,
        );
      }
    };

    try {
      await enableTemporaryChat();
    } catch (error) {
      throw new Error(
        `ChatGPT Temporary Chat activation failed in the focused tab.${loadWarning ? ` Load status: ${loadWarning}` : ""} ${errorMessage(error)}`,
      );
    }
    // ChatGPT throttles rendering in background tabs. Keep the owned Judge tab
    // active until extraction finishes so text stability cannot be mistaken
    // for response completion.
    await chrome.tabs.update(tabId, { active: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const session: JudgeSession = {
      id: crypto.randomUUID(),
      providerId,
      type: "temporary",
      tabId,
      returnToTabId:
        originalActiveTab?.id !== tabId ? originalActiveTab?.id : undefined,
      returnToWindowId:
        originalActiveTab?.windowId !== tab.windowId
          ? originalActiveTab?.windowId
          : undefined,
      createdAt: new Date().toISOString(),
    };
    await chrome.storage.session.set({
      [judgeSessionKey(session.id)]: session,
    });
    return session;
  } catch (error) {
    await chrome.tabs.remove(tabId).catch(() => undefined);
    if (originalActiveTab?.id !== undefined && originalActiveTab.id !== tabId) {
      await chrome.tabs
        .update(originalActiveTab.id, { active: true })
        .catch(() => undefined);
      if (originalActiveTab.windowId !== tab.windowId) {
        await chrome.windows
          .update(originalActiveTab.windowId, { focused: true })
          .catch(() => undefined);
      }
    }
    throw error;
  }
}

async function ownedJudgeSession(
  sessionId: string,
  tabId: number,
): Promise<JudgeSession> {
  const key = judgeSessionKey(sessionId);
  const stored = await chrome.storage.session.get(key);
  const session = stored[key] as JudgeSession | undefined;
  if (!session || session.id !== sessionId || session.tabId !== tabId) {
    throw new Error("Judge session ownership could not be verified.");
  }
  return session;
}

async function closeTemporaryJudgeSession(
  sessionId: string,
  tabId: number,
): Promise<void> {
  const session = await ownedJudgeSession(sessionId, tabId);
  const key = judgeSessionKey(sessionId);
  await chrome.tabs.remove(tabId).catch(async (error: unknown) => {
    try {
      await chrome.tabs.get(tabId);
    } catch {
      return;
    }
    throw error;
  });
  await chrome.storage.session.remove(key);
  if (session.returnToTabId !== undefined) {
    await chrome.tabs
      .update(session.returnToTabId, { active: true })
      .catch(() => undefined);
  }
  if (session.returnToWindowId !== undefined) {
    await chrome.windows
      .update(session.returnToWindowId, { focused: true })
      .catch(() => undefined);
  }
}

async function sendToContent(
  tabId: number,
  message: ContentMessage,
): Promise<ExtensionResponse> {
  const raw: unknown = await chrome.tabs.sendMessage(tabId, message);
  return responseSchema.parse(raw);
}

async function injectContentScript(
  tabId: number,
  providerId: Exclude<PageState["providerId"], "mock">,
): Promise<void> {
  const scriptIndex = providerOrder.indexOf(providerId);
  const scripts =
    chrome.runtime.getManifest().content_scripts?.[scriptIndex]?.js;
  if (!scripts?.length)
    throw new Error(`No packaged Content Script found for ${providerId}`);
  await chrome.scripting.executeScript({ target: { tabId }, files: scripts });
}

async function toContent(
  tabId: number,
  message: ContentMessage,
): Promise<ExtensionResponse> {
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
      try {
        return await sendToContent(tabId, message);
      } catch {
        /* loader imports asynchronously */
      }
    }
    throw initialError;
  }
}

async function handle(raw: unknown): Promise<ExtensionResponse> {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      error: "Invalid message payload",
      code: "INVALID_MESSAGE",
    };
  const message = parsed.data;
  try {
    if (message.type === "DETECT_PROVIDERS") {
      const allTabs = await chrome.tabs.query({});
      const tabsByProvider = new Map<
        PageState["providerId"],
        Array<chrome.tabs.Tab & { id: number }>
      >();
      for (const tab of allTabs) {
        const providerId = providerFromUrl(tab.url ?? "");
        if (providerId && tab.id !== undefined) {
          const providerTabs = tabsByProvider.get(providerId) ?? [];
          providerTabs.push({ ...tab, id: tab.id });
          tabsByProvider.set(providerId, providerTabs);
        }
      }
      const states = await Promise.all(
        providerOrder.map(async (providerId): Promise<PageState> => {
          const tabs = (tabsByProvider.get(providerId) ?? []).sort(
            (left, right) => {
              if (left.active !== right.active) return left.active ? -1 : 1;
              if (left.discarded !== right.discarded)
                return left.discarded ? 1 : -1;
              return (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0);
            },
          );
          if (!tabs.length) return { providerId, status: "not_open", url: "" };
          const failures: string[] = [];
          for (const tab of tabs) {
            try {
              const response = await toContent(tab.id, {
                type: "CONTENT_DETECT",
              });
              if (
                !response.ok ||
                Array.isArray(response.data) ||
                typeof response.data === "string" ||
                !("status" in response.data)
              ) {
                throw new Error(
                  response.ok ? "Unexpected content response" : response.error,
                );
              }
              return { ...response.data, tabId: tab.id } satisfies PageState;
            } catch (error) {
              failures.push(
                `tab ${tab.id} (${tab.active ? "active" : "background"}, ${tab.discarded ? "discarded" : (tab.status ?? "unknown")}): ${errorMessage(error)}`,
              );
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
        }),
      );
      return { ok: true, data: states };
    }
    if (message.type === "PING_CONTENT")
      return toContent(message.tabId, { type: "CONTENT_DETECT" });
    if (message.type === "MOCK_ROUNDTRIP")
      return toContent(message.tabId, {
        type: "CONTENT_MOCK",
        prompt: message.prompt,
      });
    if (message.type === "SEND_PROMPT")
      return toContent(message.tabId, {
        type: "CONTENT_SEND_PROMPT",
        prompt: message.prompt,
      });
    if (message.type === "CREATE_JUDGE_SESSION") {
      return {
        ok: true,
        data: await createTemporaryJudgeSession(message.providerId),
      };
    }
    if (message.type === "SEND_JUDGE_PROMPT") {
      await ownedJudgeSession(message.sessionId, message.tabId);
      return toContent(message.tabId, {
        type: "CONTENT_SEND_JUDGE_PROMPT",
        prompt: message.prompt,
      });
    }
    if (message.type === "CLOSE_JUDGE_SESSION") {
      await closeTemporaryJudgeSession(message.sessionId, message.tabId);
      return { ok: true, data: "pong" };
    }
    return {
      ok: false,
      error: "Content-only message received by background",
      code: "WRONG_CONTEXT",
    };
  } catch (error) {
    return { ok: false, error: errorMessage(error), code: "ROUTING_ERROR" };
  }
}

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    void handle(message).then(sendResponse);
    return true;
  },
);
