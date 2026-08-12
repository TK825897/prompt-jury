import { describe, expect, it } from "vitest";
import { JudgeEngine } from "../../src/judge/core/judge-engine";
import { JudgeRunner } from "../../src/judge/core/judge-runner";
import {
  JudgeEngineError,
  type JudgeInput,
  type JudgeProvider,
} from "../../src/judge/core/judge-types";
import { MockJudgeProvider } from "../../src/judge/providers/mock/mock-judge-provider";

const input: JudgeInput = {
  runId: "run-1",
  originalPrompt: "Compare the answers",
  responses: [
    {
      id: "response-chatgpt",
      provider: "chatgpt",
      model: "model-a",
      content: "Short answer.",
    },
    {
      id: "response-kimi",
      provider: "kimi",
      model: "model-b",
      content: "A longer and more complete candidate answer for comparison.",
    },
  ],
  evaluationCriteria: {
    factuality: 30,
    completeness: 20,
    logic: 15,
    actionability: 20,
    riskAwareness: 10,
    writingQuality: 5,
  },
  mode: "evaluate",
};

describe("Judge Core", () => {
  it("registers and resolves providers without allowing duplicate ids", () => {
    const engine = new JudgeEngine([new MockJudgeProvider()]);
    expect(engine.getRequired("mock").name).toBe("Mock Judge");
    expect(() => engine.register(new MockJudgeProvider())).toThrow(
      "already registered",
    );
    try {
      engine.getRequired("missing");
      throw new Error("Expected getRequired to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "PROVIDER_NOT_FOUND" });
    }
  });

  it("reports provider availability without failing the whole list", async () => {
    const unavailableProvider: JudgeProvider = {
      id: "unavailable",
      name: "Unavailable provider",
      type: "mock",
      checkAvailability: () => Promise.resolve(false),
      evaluate: (candidateInput) =>
        new MockJudgeProvider().evaluate(candidateInput),
    };
    const throwingProvider: JudgeProvider = {
      id: "throwing",
      name: "Throwing provider",
      type: "mock",
      checkAvailability: () => Promise.reject(new Error("failure")),
      evaluate: () => Promise.reject(new Error("unused")),
    };
    const availability = await new JudgeEngine([
      new MockJudgeProvider(),
      unavailableProvider,
      throwingProvider,
    ]).listAvailability();
    expect(
      availability.map(({ provider, available }) => [provider.id, available]),
    ).toEqual([
      ["mock", true],
      ["unavailable", false],
      ["throwing", false],
    ]);
  });

  it("preserves the provider failure detail", async () => {
    const provider: JudgeProvider = {
      id: "failing",
      name: "Failing provider",
      type: "mock",
      checkAvailability: () => Promise.resolve(true),
      evaluate: () => Promise.reject(new Error("prompt input disappeared")),
    };
    await expect(
      new JudgeRunner(new JudgeEngine([provider])).run("failing", input),
    ).rejects.toMatchObject({
      code: "PROVIDER_FAILED",
      message: expect.stringContaining("prompt input disappeared"),
    });
  });

  it("blinds candidate identity before invoking a provider and returns the private mapping", async () => {
    let received: JudgeInput | undefined;
    const mock = new MockJudgeProvider();
    const capturingProvider: JudgeProvider = {
      id: "capture",
      name: "Capture Judge",
      type: "mock",
      checkAvailability: () => Promise.resolve(true),
      evaluate: async (candidateInput) => {
        received = candidateInput;
        return mock.evaluate(candidateInput);
      },
    };
    const times = [
      new Date("2026-08-11T00:00:00.000Z"),
      new Date("2026-08-11T00:00:01.250Z"),
    ];
    const result = await new JudgeRunner(new JudgeEngine([capturingProvider]), {
      random: () => 0,
      now: () => times.shift() ?? new Date("2026-08-11T00:00:01.250Z"),
    }).run("capture", input);

    expect(received?.responses).toEqual([
      {
        id: "Answer A",
        provider: "anonymous",
        content: input.responses[1].content,
      },
      {
        id: "Answer B",
        provider: "anonymous",
        content: input.responses[0].content,
      },
    ]);
    expect(result.anonymousMapping).toEqual({
      "Answer A": {
        responseId: "response-kimi",
        provider: "kimi",
        model: "model-b",
      },
      "Answer B": {
        responseId: "response-chatgpt",
        provider: "chatgpt",
        model: "model-a",
      },
    });
    expect(result.durationMs).toBe(1250);
    expect(result.result.ranking[0].answerId).toBe("Answer A");
  });

  it("rejects evaluation with fewer than two responses", async () => {
    const runner = new JudgeRunner(new JudgeEngine([new MockJudgeProvider()]));
    await expect(
      runner.run("mock", { ...input, responses: input.responses.slice(0, 1) }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("returns a typed error when the selected provider is unavailable", async () => {
    const runner = new JudgeRunner(
      new JudgeEngine([new MockJudgeProvider(false)]),
    );
    await expect(runner.run("mock", input)).rejects.toEqual(
      expect.objectContaining<Partial<JudgeEngineError>>({
        code: "PROVIDER_UNAVAILABLE",
      }),
    );
  });
});
