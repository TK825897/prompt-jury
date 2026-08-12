import type { ProviderId } from "../adapters/types";
import type { JudgeResult } from "../judge/schemas";

export interface ResponseDocument {
  id: string;
  runId: string;
  providerId: ProviderId;
  modelName?: string;
  text: string;
  markdown?: string;
  codeBlocks: Array<{ language?: string; code: string }>;
  tables: Array<{ headers: string[]; rows: string[][] }>;
  metadata: {
    sourceUrl?: string;
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
  };
}

export interface ProviderRunResult {
  providerId: ProviderId;
  status: "completed" | "failed" | "timeout";
  durationMs?: number;
  errorMessage?: string;
}

export interface EvaluationRun {
  id: string;
  prompt: string;
  selectedProviders: ProviderId[];
  status: "running" | "completed" | "partial" | "failed";
  providerResults: ProviderRunResult[];
  createdAt: string;
  completedAt?: string;
}

export interface EvaluationBundle {
  run: EvaluationRun;
  responses: ResponseDocument[];
  judgeResult?: StoredJudgeResult;
  judgeRuns?: StoredJudgeResult[];
  synthesizedAnswers?: SynthesizedAnswer[];
}

export interface StoredJudgeResult {
  id: string;
  runId: string;
  model: string;
  provider?: string;
  type?: "api" | "web";
  anonymousMapping: Record<string, ProviderId>;
  rawJson: string;
  result: JudgeResult;
  createdAt: string;
}

export interface SynthesizedAnswer {
  id: string;
  runId: string;
  mode: "best" | "repair" | "disagreements";
  content: string;
  createdAt: string;
}
