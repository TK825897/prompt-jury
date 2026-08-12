import type { NormalizedResponse, ProviderId } from "../../adapters/types";

export type WebJudgeProviderId = Exclude<ProviderId, "mock">;

export interface JudgeSession {
  id: string;
  providerId: WebJudgeProviderId;
  type: "temporary";
  tabId: number;
  returnToTabId?: number;
  returnToWindowId?: number;
  createdAt: string;
}

export interface JudgeSessionManager {
  checkAvailability(providerId: WebJudgeProviderId): Promise<boolean>;
  createTemporarySession(providerId: WebJudgeProviderId): Promise<JudgeSession>;
  sendPrompt(
    session: JudgeSession,
    prompt: string,
  ): Promise<NormalizedResponse>;
  closeSession(session: JudgeSession): Promise<void>;
}
