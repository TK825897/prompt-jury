import { afterEach, describe, expect, it, vi } from "vitest";
import { JudgeEngine } from "../../src/judge/core/judge-engine";
import { JudgeRunner } from "../../src/judge/core/judge-runner";
import type { JudgeInput } from "../../src/judge/core/judge-types";
import {
  chatCompletionsEndpoint,
  judgeApiHeaders,
  JudgeApiError,
  runJudge,
} from "../../src/judge/judge-client";
import { OpenAICompatibleJudgeProvider } from "../../src/judge/providers/api/openai-compatible-provider";
import { defaultJudgeConfig, type JudgeConfig } from "../../src/judge/schemas";

const input: JudgeInput = {
  runId: "run-api",
  originalPrompt: "Which answer is better?",
  responses: [
    {
      id: "original-a",
      provider: "chatgpt",
      model: "secret-model-a",
      content: "Candidate one",
    },
    {
      id: "original-b",
      provider: "kimi",
      model: "secret-model-b",
      content: "Candidate two is longer",
    },
  ],
  evaluationCriteria: defaultJudgeConfig.weights,
  mode: "evaluate",
};

const apiResult = {
  summary: "API evaluation",
  ranking: [
    { answerId: "Answer A", rank: 1, overallScore: 80, confidence: 90 },
    { answerId: "Answer B", rank: 2, overallScore: 70, confidence: 90 },
  ],
  evaluations: ["Answer A", "Answer B"].map((answerId, index) => ({
    answerId,
    scores: {
      factuality: 80 - index * 10,
      completeness: 80 - index * 10,
      logic: 80 - index * 10,
      actionability: 80 - index * 10,
      riskAwareness: 80 - index * 10,
      writingQuality: 80 - index * 10,
    },
    overallScore: 80 - index * 10,
    strengths: [],
    weaknesses: [],
    riskFlags: [],
    unsupportedClaims: [],
  })),
  consensus: [],
  disagreements: [],
  missingPoints: [],
  recommendedAnswerId: "Answer A",
};

function config(overrides: Partial<JudgeConfig> = {}): JudgeConfig {
  return {
    ...defaultJudgeConfig,
    baseUrl: "https://judge.example/v1",
    apiKey: "top-secret-key",
    model: "judge-model",
    requestTimeoutMs: 1000,
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenAI Compatible Judge Provider", () => {
  it("supports full Azure-style endpoints while preserving query parameters", () => {
    expect(
      chatCompletionsEndpoint(
        "https://azure.example/openai/deployments/judge/chat/completions?api-version=2026-01-01",
      ),
    ).toBe(
      "https://azure.example/openai/deployments/judge/chat/completions?api-version=2026-01-01",
    );
  });

  it("runs through Judge Core without exposing candidate brands or models", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(apiResult) } }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatibleJudgeProvider(config());
    const outcome = await new JudgeRunner(new JudgeEngine([provider]), {
      random: () => 0,
    }).run(provider.id, input);
    expect(outcome.providerType).toBe("api");
    expect(outcome.result.summary).toBe("API evaluation");

    const [url, request] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://judge.example/v1/chat/completions");
    expect(request.headers).toMatchObject({
      Authorization: "Bearer top-secret-key",
    });
    expect(request.headers).not.toHaveProperty("api-key");
    const body = JSON.parse(String(request.body)) as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages[0].content).toContain("Answer A");
    expect(body.messages[0].content).not.toContain("chatgpt");
    expect(body.messages[0].content).not.toContain("kimi");
    expect(body.messages[0].content).not.toContain("secret-model");
    expect(String(request.body)).not.toContain("top-secret-key");
  });

  it("uses the Azure api-key header only for Azure-style endpoints", () => {
    expect(
      judgeApiHeaders(
        "https://account.openai.azure.com/openai/deployments/judge/chat/completions?api-version=2026-01-01",
        "azure-secret",
      ),
    ).toEqual({
      "Content-Type": "application/json",
      "api-key": "azure-secret",
    });
  });

  it("reports authentication errors without leaking the API key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { message: "Invalid credential top-secret-key" },
            }),
            { status: 401 },
          ),
      ),
    );
    let received: unknown;
    try {
      await runJudge(config(), "Question", [
        { answerId: "Answer A", text: "Answer" },
      ]);
    } catch (error) {
      received = error;
    }
    expect(received).toBeInstanceOf(JudgeApiError);
    expect(received).toMatchObject({ code: "AUTHENTICATION", status: 401 });
    expect((received as Error).message).not.toContain("top-secret-key");
  });

  it("aborts requests at the configured timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, request: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            request.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      ),
    );
    await expect(
      runJudge(config({ requestTimeoutMs: 5 }), "Question", [
        { answerId: "Answer A", text: "Answer" },
      ]),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("is unavailable when required configuration is missing", async () => {
    await expect(
      new OpenAICompatibleJudgeProvider(
        config({ apiKey: "" }),
      ).checkAvailability(),
    ).resolves.toBe(false);
    await expect(
      new OpenAICompatibleJudgeProvider(
        config({ model: "" }),
      ).checkAvailability(),
    ).resolves.toBe(false);
    await expect(
      new OpenAICompatibleJudgeProvider(
        config({ baseUrl: "not-a-url" }),
      ).checkAvailability(),
    ).resolves.toBe(false);
  });
});
