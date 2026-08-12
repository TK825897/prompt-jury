import type { WebJudgeProviderId } from "../../session/session-types";
import type {
  JudgeSession,
  JudgeSessionManager,
} from "../../session/session-types";
import {
  assertJudgeResultLanguage,
  buildJudgePrompt,
  judgeLanguageInstruction,
} from "../../prompts";
import { parseJudgeJson } from "../../judge-client";
import { applyWeights } from "../../scoring";
import { errorMessage } from "../../../shared/errors";
import {
  JudgeEngineError,
  type JudgeInput,
  type JudgeProvider,
  type JudgeResult,
} from "../../core/judge-types";

export class TemporaryWebJudgeProvider implements JudgeProvider {
  readonly id: string;
  readonly type = "web" as const;

  constructor(
    readonly providerId: WebJudgeProviderId,
    readonly name: string,
    private readonly sessions: JudgeSessionManager,
  ) {
    this.id = `${providerId}-web-temporary`;
  }

  async checkAvailability(): Promise<boolean> {
    try {
      return await this.sessions.checkAvailability(this.providerId);
    } catch {
      return false;
    }
  }

  async evaluate(input: JudgeInput): Promise<JudgeResult> {
    if (input.mode === "synthesize") {
      throw new JudgeEngineError(
        "INVALID_INPUT",
        `${this.name} does not return synthesis-only results.`,
      );
    }

    let session: JudgeSession;
    try {
      session = await this.sessions.createTemporarySession(this.providerId);
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : "";
      throw new JudgeEngineError(
        "SESSION_CREATE_FAILED",
        `${this.name} could not be created. Please retry.${detail}`,
        { cause: error },
      );
    }

    let result: JudgeResult | undefined;
    let evaluationError: unknown;
    try {
      const prompt = buildJudgePrompt(
        input.originalPrompt,
        input.responses.map((response) => ({
          answerId: response.id,
          text: response.content,
        })),
        input.evaluationCriteria,
      );
      const response = await this.sessions.sendPrompt(session, prompt);
      try {
        result = applyWeights(
          parseJudgeJson(response.contentText),
          input.evaluationCriteria,
        );
        assertJudgeResultLanguage(input.originalPrompt, result);
      } catch (initialError) {
        const repairPrompt = `The JSON in your previous response is invalid, does not match the required schema, or uses the wrong output language. Repair it while preserving the evaluation, scores, and conclusions. ${judgeLanguageInstruction(input.originalPrompt)} Return exactly one complete JSON object with no Markdown fence or commentary.\n\nValidation error:\n${errorMessage(initialError)}\n\nInvalid JSON:\n${response.contentText}`;
        try {
          const repaired = await this.sessions.sendPrompt(
            session,
            repairPrompt,
          );
          result = applyWeights(
            parseJudgeJson(repaired.contentText),
            input.evaluationCriteria,
          );
          assertJudgeResultLanguage(input.originalPrompt, result);
        } catch (repairError) {
          evaluationError = new JudgeEngineError(
            "WEB_RESPONSE_INVALID",
            `${this.name} returned invalid JSON and its automatic repair failed. ${errorMessage(repairError)} Raw response: ${response.contentText.slice(0, 500)}`,
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
        `${this.name} finished, but its temporary tab could not be closed. Close it manually.`,
        { cause: evaluationError ?? cleanupError },
      );
    }
    if (evaluationError) throw evaluationError;
    if (!result) {
      throw new JudgeEngineError(
        "WEB_RESPONSE_INVALID",
        `${this.name} returned no result. Please retry.`,
      );
    }
    return result;
  }
}
