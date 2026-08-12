import { buildJudgePrompt } from "../../prompts";
import { parseJudgeJson } from "../../judge-client";
import { applyWeights } from "../../scoring";
import { errorMessage } from "../../../shared/errors";
import type {
  JudgeSession,
  JudgeSessionManager,
} from "../../session/session-types";
import {
  JudgeEngineError,
  type JudgeInput,
  type JudgeProvider,
  type JudgeResult,
} from "../../core/judge-types";

export class ChatGPTWebJudgeProvider implements JudgeProvider {
  readonly id = "chatgpt-web-temporary";
  readonly name = "ChatGPT Temporary Chat";
  readonly type = "web" as const;

  constructor(private readonly sessions: JudgeSessionManager) {}

  async checkAvailability(): Promise<boolean> {
    try {
      return await this.sessions.checkAvailability("chatgpt");
    } catch {
      return false;
    }
  }

  async evaluate(input: JudgeInput): Promise<JudgeResult> {
    if (input.mode === "synthesize") {
      throw new JudgeEngineError(
        "INVALID_INPUT",
        "The ChatGPT Web Judge does not return synthesis-only results.",
      );
    }
    let session: JudgeSession;
    try {
      session = await this.sessions.createTemporarySession("chatgpt");
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : "";
      throw new JudgeEngineError(
        "SESSION_CREATE_FAILED",
        `ChatGPT Temporary Chat could not be created. Please retry.${detail}`,
        { cause: error },
      );
    }

    let result: JudgeResult | undefined;
    let evaluationError: unknown;
    try {
      const answers = input.responses.map((response) => ({
        answerId: response.id,
        text: response.content,
      }));
      const prompt = buildJudgePrompt(
        input.originalPrompt,
        answers,
        input.evaluationCriteria,
      );
      const response = await this.sessions.sendPrompt(session, prompt);
      try {
        result = applyWeights(
          parseJudgeJson(response.contentText),
          input.evaluationCriteria,
        );
      } catch (initialError) {
        const repairPrompt = `The JSON in your previous response is syntactically invalid or does not match the required schema. Repair formatting only; preserve the evaluation, scores, and conclusions. Return exactly one complete JSON object with no Markdown fence or commentary.\n\nParser error:\n${errorMessage(initialError)}\n\nInvalid JSON:\n${response.contentText}`;
        try {
          const repaired = await this.sessions.sendPrompt(
            session,
            repairPrompt,
          );
          result = applyWeights(
            parseJudgeJson(repaired.contentText),
            input.evaluationCriteria,
          );
        } catch (repairError) {
          evaluationError = new JudgeEngineError(
            "WEB_RESPONSE_INVALID",
            `ChatGPT Web Judge returned invalid JSON and its automatic repair failed. ${errorMessage(repairError)} Raw response: ${response.contentText.slice(0, 500)}`,
            { cause: repairError },
          );
        }
      }
    } catch (error) {
      evaluationError = error;
    }

    try {
      await this.sessions.closeSession(session);
    } catch (cleanupError) {
      throw new JudgeEngineError(
        "SESSION_CLEANUP_FAILED",
        "ChatGPT Judge finished, but its temporary tab could not be closed. Close the tab manually.",
        { cause: evaluationError ?? cleanupError },
      );
    }
    if (evaluationError) throw evaluationError;
    if (!result) {
      throw new JudgeEngineError(
        "WEB_RESPONSE_INVALID",
        "ChatGPT Web Judge returned no result. Please retry.",
      );
    }
    return result;
  }
}
