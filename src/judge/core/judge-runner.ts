import { judgeResultSchema } from "../schema/judge-result-schema";
import { errorMessage } from "../../shared/errors";
import { JudgeEngine } from "./judge-engine";
import {
  judgeInputSchema,
  JudgeEngineError,
  type AnonymousJudgeCandidate,
  type JudgeInput,
  type JudgeRunOutcome,
} from "./judge-types";

export interface JudgeRunnerOptions {
  random?: () => number;
  now?: () => Date;
}

function blindInput(
  input: JudgeInput,
  random: () => number,
): {
  input: JudgeInput;
  mapping: Record<string, AnonymousJudgeCandidate>;
} {
  const shuffled = [...input.responses];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  const mapping: Record<string, AnonymousJudgeCandidate> = {};
  const responses = shuffled.map((response, index) => {
    const answerId = `Answer ${String.fromCharCode(65 + index)}`;
    mapping[answerId] = {
      responseId: response.id,
      provider: response.provider,
      model: response.model,
    };
    return { id: answerId, provider: "anonymous", content: response.content };
  });
  return { input: { ...input, responses }, mapping };
}

export class JudgeRunner {
  constructor(
    private readonly engine: JudgeEngine,
    private readonly options: JudgeRunnerOptions = {},
  ) {}

  async run(
    providerId: string,
    rawInput: JudgeInput,
  ): Promise<JudgeRunOutcome> {
    const parsed = judgeInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new JudgeEngineError(
        "INVALID_INPUT",
        `Judge input validation failed: ${parsed.error.message}`,
        { cause: parsed.error },
      );
    }
    const input = parsed.data;
    if (input.mode !== "synthesize" && input.responses.length < 2) {
      throw new JudgeEngineError(
        "INVALID_INPUT",
        "Evaluation requires at least two candidate responses.",
      );
    }
    const provider = this.engine.getRequired(providerId);
    let available = false;
    try {
      available = await provider.checkAvailability();
    } catch (error) {
      throw new JudgeEngineError(
        "PROVIDER_UNAVAILABLE",
        `Judge provider '${providerId}' availability check failed.`,
        { cause: error },
      );
    }
    if (!available)
      throw new JudgeEngineError(
        "PROVIDER_UNAVAILABLE",
        `Judge provider '${providerId}' is unavailable.`,
      );

    const { input: anonymousInput, mapping } = blindInput(
      input,
      this.options.random ?? Math.random,
    );
    const now = this.options.now ?? (() => new Date());
    const started = now();
    let rawResult: unknown;
    try {
      rawResult = await provider.evaluate(anonymousInput);
    } catch (error) {
      if (error instanceof JudgeEngineError) throw error;
      throw new JudgeEngineError(
        "PROVIDER_FAILED",
        `Judge provider '${providerId}' failed: ${errorMessage(error)}`,
        { cause: error },
      );
    }
    const result = judgeResultSchema.safeParse(rawResult);
    if (!result.success) {
      throw new JudgeEngineError(
        "INVALID_RESULT",
        `Judge provider '${providerId}' returned an invalid result.`,
        { cause: result.error },
      );
    }
    const completed = now();
    return {
      providerId: provider.id,
      providerType: provider.type,
      result: result.data,
      anonymousMapping: mapping,
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      durationMs: Math.max(0, completed.getTime() - started.getTime()),
    };
  }
}
