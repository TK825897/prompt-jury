import { z } from "zod";

const score = z.number().min(0).max(100);
function descriptiveText(value: unknown): unknown {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return value;
  const textParts = Object.values(value).filter(
    (part): part is string =>
      typeof part === "string" && part.trim().length > 0,
  );
  return textParts.length ? textParts.join(" — ") : JSON.stringify(value);
}

const stringArray = z.preprocess((value) => {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) return value.map(descriptiveText);
  if (typeof value === "object") return [descriptiveText(value)];
  if (typeof value === "string") {
    return value
      .split(/\r?\n+/)
      .map((item) => item.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
      .filter(Boolean);
  }
  return value;
}, z.array(z.string()));

export const riskFlagSchema = z.object({
  severity: z.enum(["low", "medium", "high"]),
  type: z.string(),
  description: z.string(),
});
export const judgeResultSchema = z.object({
  summary: z.string(),
  ranking: z.array(
    z.object({
      answerId: z.string(),
      rank: z.number().int().positive(),
      overallScore: score,
      confidence: score,
    }),
  ),
  evaluations: z.array(
    z.object({
      answerId: z.string(),
      scores: z.object({
        factuality: score,
        completeness: score,
        logic: score,
        actionability: score,
        riskAwareness: score,
        writingQuality: score,
      }),
      overallScore: score,
      strengths: stringArray,
      weaknesses: stringArray,
      riskFlags: z.array(riskFlagSchema),
      unsupportedClaims: stringArray,
    }),
  ),
  consensus: stringArray,
  disagreements: z.array(
    z.object({
      topic: z.string(),
      positions: z.array(
        z.object({ answerId: z.string(), position: z.string() }),
      ),
      judgeAssessment: z.string(),
    }),
  ),
  missingPoints: stringArray,
  recommendedAnswerId: z.string().optional(),
});

export type JudgeResult = z.infer<typeof judgeResultSchema>;

export interface JudgeWeights {
  factuality: number;
  completeness: number;
  logic: number;
  actionability: number;
  riskAwareness: number;
  writingQuality: number;
}

export interface JudgeConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  requestTimeoutMs: number;
  weights: JudgeWeights;
}

export const defaultJudgeConfig: JudgeConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "",
  temperature: 0.1,
  maxTokens: 4000,
  requestTimeoutMs: 180_000,
  weights: {
    factuality: 30,
    completeness: 20,
    logic: 15,
    actionability: 20,
    riskAwareness: 10,
    writingQuality: 5,
  },
};
