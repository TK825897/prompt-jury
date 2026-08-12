import type { NormalizedResponse, PageState } from "../../adapters/types";
import { sendMessage } from "../../messaging/client";
import type {
  JudgeSession,
  JudgeSessionManager,
  WebJudgeProviderId,
} from "./session-types";

function isPageStates(value: unknown): value is PageState[] {
  return Array.isArray(value);
}

function isJudgeSession(value: unknown): value is JudgeSession {
  return Boolean(
    value &&
    typeof value === "object" &&
    "id" in value &&
    "tabId" in value &&
    "providerId" in value &&
    "type" in value,
  );
}

function isNormalizedResponse(value: unknown): value is NormalizedResponse {
  return Boolean(
    value &&
    typeof value === "object" &&
    "contentText" in value &&
    "providerId" in value,
  );
}

export class BrowserJudgeSessionManager implements JudgeSessionManager {
  async checkAvailability(providerId: WebJudgeProviderId): Promise<boolean> {
    const response = await sendMessage({ type: "DETECT_PROVIDERS" });
    if (!response.ok || !isPageStates(response.data)) return false;
    const state = response.data.find(
      (candidate) => candidate.providerId === providerId,
    );
    return state?.status === "ready" || state?.status === "completed";
  }

  async createTemporarySession(
    providerId: WebJudgeProviderId,
  ): Promise<JudgeSession> {
    const response = await sendMessage({
      type: "CREATE_JUDGE_SESSION",
      providerId,
    });
    if (!response.ok) throw new Error(response.error);
    if (!isJudgeSession(response.data))
      throw new Error("Judge session creation returned invalid data.");
    return response.data;
  }

  async sendPrompt(
    session: JudgeSession,
    prompt: string,
  ): Promise<NormalizedResponse> {
    const response = await sendMessage({
      type: "SEND_JUDGE_PROMPT",
      sessionId: session.id,
      tabId: session.tabId,
      prompt,
    });
    if (!response.ok) throw new Error(response.error);
    if (!isNormalizedResponse(response.data))
      throw new Error("Web Judge returned invalid response data.");
    return response.data;
  }

  async closeSession(session: JudgeSession): Promise<void> {
    const response = await sendMessage({
      type: "CLOSE_JUDGE_SESSION",
      sessionId: session.id,
      tabId: session.tabId,
    });
    if (!response.ok) throw new Error(response.error);
  }
}
