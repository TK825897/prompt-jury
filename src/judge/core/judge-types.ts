import { z } from "zod";
import type { JudgeResult, JudgeWeights } from "../schemas";

export const judgeModeSchema = z.enum(["evaluate", "synthesize", "full"]);

export const judgeInputSchema = z.object({
  runId: z.string().trim().min(1),
  originalPrompt: z.string().trim().min(1),
  responses: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        provider: z.string().trim().min(1),
        model: z.string().trim().min(1).optional(),
        content: z.string().trim().min(1),
      }),
    )
    .min(1),
  evaluationCriteria: z
    .object({
      factuality: z.number().min(0),
      completeness: z.number().min(0),
      logic: z.number().min(0),
      actionability: z.number().min(0),
      riskAwareness: z.number().min(0),
      writingQuality: z.number().min(0),
    })
    .refine(
      (weights) => Object.values(weights).some((weight) => weight > 0),
      "At least one evaluation weight must be greater than zero.",
    ),
  mode: judgeModeSchema,
});

export type JudgeMode = z.infer<typeof judgeModeSchema>;
export type JudgeInput = z.infer<typeof judgeInputSchema>;
export type JudgeProviderType = "api" | "web" | "mock";

export interface JudgeProvider {
  readonly id: string;
  readonly name: string;
  readonly type: JudgeProviderType;
  checkAvailability(): Promise<boolean>;
  evaluate(input: JudgeInput): Promise<JudgeResult>;
}

export interface AnonymousJudgeCandidate {
  responseId: string;
  provider: string;
  model?: string;
}

export interface JudgeRunOutcome {
  providerId: string;
  providerType: JudgeProviderType;
  result: JudgeResult;
  anonymousMapping: Record<string, AnonymousJudgeCandidate>;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export type { JudgeResult, JudgeWeights };

export type JudgeErrorCode =
  | "INVALID_INPUT"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_FAILED"
  | "INVALID_RESULT"
  | "SESSION_CREATE_FAILED"
  | "SESSION_CLEANUP_FAILED"
  | "WEB_RESPONSE_INVALID";

export class JudgeEngineError extends Error {
  constructor(
    public readonly code: JudgeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "JudgeEngineError";
  }
}
