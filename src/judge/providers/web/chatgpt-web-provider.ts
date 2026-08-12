import type { JudgeSessionManager } from "../../session/session-types";
import { TemporaryWebJudgeProvider } from "./temporary-web-provider";

export class ChatGPTWebJudgeProvider extends TemporaryWebJudgeProvider {
  constructor(sessions: JudgeSessionManager) {
    super("chatgpt", "ChatGPT Temporary Chat", sessions);
  }
}

export class GeminiWebJudgeProvider extends TemporaryWebJudgeProvider {
  constructor(sessions: JudgeSessionManager) {
    super("gemini", "Gemini Temporary Chat", sessions);
  }
}

export class KimiWebJudgeProvider extends TemporaryWebJudgeProvider {
  constructor(sessions: JudgeSessionManager) {
    super("kimi", "Kimi Temporary Chat", sessions);
  }

  override checkAvailability(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

export class DoubaoWebJudgeProvider extends TemporaryWebJudgeProvider {
  constructor(sessions: JudgeSessionManager) {
    super("doubao", "Doubao Temporary Chat", sessions);
  }

  override checkAvailability(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
