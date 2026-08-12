import type { JudgeResult } from "../../schema/judge-result-schema";
import type { JudgeInput, JudgeProvider } from "../../core/judge-types";
import { weightedScore } from "../../scoring";

function scoresFor(
  content: string,
): JudgeResult["evaluations"][number]["scores"] {
  const base = Math.min(90, 55 + Math.floor(content.length / 20));
  return {
    factuality: base,
    completeness: Math.min(100, base + 4),
    logic: Math.min(100, base + 2),
    actionability: Math.max(0, base - 2),
    riskAwareness: Math.max(0, base - 5),
    writingQuality: Math.min(100, base + 1),
  };
}

export class MockJudgeProvider implements JudgeProvider {
  readonly id = "mock";
  readonly name = "Mock Judge";
  readonly type = "mock" as const;

  constructor(private readonly available = true) {}

  async checkAvailability(): Promise<boolean> {
    return this.available;
  }

  async evaluate(input: JudgeInput): Promise<JudgeResult> {
    const evaluations = input.responses.map((response) => {
      const scores = scoresFor(response.content);
      return {
        answerId: response.id,
        scores,
        overallScore: weightedScore(scores, input.evaluationCriteria),
        strengths: ["Deterministic mock evaluation completed."],
        weaknesses: [],
        riskFlags: [],
        unsupportedClaims: [],
      };
    });
    const ranking = [...evaluations]
      .sort(
        (left, right) =>
          right.overallScore - left.overallScore ||
          left.answerId.localeCompare(right.answerId),
      )
      .map((evaluation, index) => ({
        answerId: evaluation.answerId,
        rank: index + 1,
        overallScore: evaluation.overallScore,
        confidence: 100,
      }));
    return {
      summary: "Deterministic mock Judge result.",
      ranking,
      evaluations,
      consensus: [],
      disagreements: [],
      missingPoints: [],
      recommendedAnswerId: ranking[0]?.answerId,
    };
  }
}
