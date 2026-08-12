import { runJudge } from "../../judge-client";
import type { JudgeConfig } from "../../schemas";
import {
  JudgeEngineError,
  type JudgeInput,
  type JudgeProvider,
  type JudgeResult,
} from "../../core/judge-types";

export class OpenAICompatibleJudgeProvider implements JudgeProvider {
  readonly id = "openai-compatible";
  readonly name = "OpenAI Compatible API";
  readonly type = "api" as const;

  constructor(private readonly config: JudgeConfig) {}

  async checkAvailability(): Promise<boolean> {
    if (
      !this.config.apiKey.trim() ||
      !this.config.model.trim() ||
      this.config.requestTimeoutMs <= 0
    )
      return false;
    try {
      const url = new URL(this.config.baseUrl);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }

  async evaluate(input: JudgeInput): Promise<JudgeResult> {
    if (input.mode === "synthesize") {
      throw new JudgeEngineError(
        "INVALID_INPUT",
        "The API Judge evaluation provider does not return synthesis-only results.",
      );
    }
    const answers = input.responses.map((response) => ({
      answerId: response.id,
      text: response.content,
    }));
    const { result } = await runJudge(
      { ...this.config, weights: input.evaluationCriteria },
      input.originalPrompt,
      answers,
    );
    return result;
  }
}
