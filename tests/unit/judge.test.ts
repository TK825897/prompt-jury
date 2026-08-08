import { describe, expect, it } from "vitest";
import { anonymizeResponses } from "../../src/judge/anonymize";
import { chatCompletionsEndpoint, parseCompletionResponse, parseJudgeJson } from "../../src/judge/judge-client";
import { weightedScore } from "../../src/judge/scoring";

const result = {
  summary: "Summary",
  ranking: [{ answerId: "Answer A", rank: 1, overallScore: 80, confidence: 75 }],
  evaluations: [{
    answerId: "Answer A",
    scores: { factuality: 100, completeness: 50, logic: 50, actionability: 50, riskAwareness: 50, writingQuality: 50 },
    overallScore: 80, strengths: [], weaknesses: [], riskFlags: [], unsupportedClaims: [],
  }],
  consensus: [], disagreements: [], missingPoints: [], recommendedAnswerId: "Answer A",
};

describe("Judge", () => {
  it("parses JSON fenced output", () => expect(parseJudgeJson(`\`\`\`json\n${JSON.stringify(result)}\n\`\`\``).summary).toBe("Summary"));
  it("calculates weighted scores", () => expect(weightedScore(result.evaluations[0].scores, { factuality: 30, completeness: 20, logic: 15, actionability: 20, riskAwareness: 10, writingQuality: 5 })).toBe(65));
  it("creates deterministic anonymous mappings with an injected random source", () => {
    const anonymous = anonymizeResponses([
      { id: "1", runId: "r", providerId: "chatgpt", text: "one", codeBlocks: [], tables: [], metadata: {} },
      { id: "2", runId: "r", providerId: "kimi", text: "two", codeBlocks: [], tables: [], metadata: {} },
    ], () => 0);
    expect(anonymous.mapping).toEqual({ "Answer A": "kimi", "Answer B": "chatgpt" });
  });
  it("accepts either an API root or a full chat completions endpoint", () => {
    expect(chatCompletionsEndpoint("https://example.com/v1")).toBe("https://example.com/v1/chat/completions");
    expect(chatCompletionsEndpoint("https://example.com/v1/chat/completions")).toBe("https://example.com/v1/chat/completions");
  });
  it("normalizes string list fields before strict validation", () => {
    const flexible = {
      ...result,
      consensus: "Shared conclusion",
      missingPoints: "- Missing one\n- Missing two",
      evaluations: [{ ...result.evaluations[0], strengths: "Accurate", weaknesses: "- Brief" }],
    };
    const parsed = parseJudgeJson(JSON.stringify(flexible));
    expect(parsed.consensus).toEqual(["Shared conclusion"]);
    expect(parsed.missingPoints).toEqual(["Missing one", "Missing two"]);
    expect(parsed.evaluations[0].strengths).toEqual(["Accurate"]);
  });
  it("normalizes descriptive objects inside string lists", () => {
    const flexible = {
      ...result,
      consensus: [
        { point: "Both agree", detail: "The action is restricted" },
        { conclusion: "Use a licensed service" },
      ],
    };
    expect(parseJudgeJson(JSON.stringify(flexible)).consensus).toEqual([
      "Both agree — The action is restricted",
      "Use a licensed service",
    ]);
  });
  it("parses standard and SSE completion responses", () => {
    expect(parseCompletionResponse(JSON.stringify({ choices: [{ message: { content: "standard" } }] }))).toBe("standard");
    const sse = 'data: {"choices":[{"delta":{"content":"stream"}}]}\n\ndata: {"choices":[{"delta":{"content":"ed"}}]}\n\ndata: [DONE]\n';
    expect(parseCompletionResponse(sse)).toBe("streamed");
  });
  it("reports an empty response clearly", () => {
    expect(() => parseCompletionResponse(" ")).toThrow("empty response body");
  });
});
