import type { JudgeResult, JudgeWeights } from "./schemas";

export function weightedScore(scores: JudgeResult["evaluations"][number]["scores"], weights: JudgeWeights): number {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (total <= 0) throw new Error("Judge weights must total more than zero.");
  const value = Object.entries(weights).reduce((sum, [key, weight]) => sum + scores[key as keyof typeof scores] * weight, 0) / total;
  return Math.round(value * 100) / 100;
}

export function applyWeights(result: JudgeResult, weights: JudgeWeights): JudgeResult {
  const evaluations = result.evaluations.map((evaluation) => ({ ...evaluation, overallScore: weightedScore(evaluation.scores, weights) }));
  const scores = new Map(evaluations.map((evaluation) => [evaluation.answerId, evaluation.overallScore]));
  const ranking = [...result.ranking]
    .map((item) => ({ ...item, overallScore: scores.get(item.answerId) ?? item.overallScore }))
    .sort((left, right) => right.overallScore - left.overallScore)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return { ...result, evaluations, ranking, recommendedAnswerId: ranking[0]?.answerId ?? result.recommendedAnswerId };
}
