import { describe, expect, it, vi } from "vitest";
import type { NormalizedResponse } from "../../src/adapters/types";
import { JudgeEngine } from "../../src/judge/core/judge-engine";
import { JudgeRunner } from "../../src/judge/core/judge-runner";
import type { JudgeInput } from "../../src/judge/core/judge-types";
import { ChatGPTWebJudgeProvider } from "../../src/judge/providers/web/chatgpt-web-provider";
import type {
  JudgeSession,
  JudgeSessionManager,
} from "../../src/judge/session/session-types";
import { defaultJudgeConfig } from "../../src/judge/schemas";

const session: JudgeSession = {
  id: "session-1",
  providerId: "chatgpt",
  type: "temporary",
  tabId: 42,
  createdAt: "2026-08-11T00:00:00.000Z",
};

const input: JudgeInput = {
  runId: "run-web",
  originalPrompt: "Compare",
  responses: [
    {
      id: "source-a",
      provider: "chatgpt",
      model: "model-a",
      content: "First candidate",
    },
    {
      id: "source-b",
      provider: "kimi",
      model: "model-b",
      content: "Second candidate",
    },
  ],
  evaluationCriteria: defaultJudgeConfig.weights,
  mode: "evaluate",
};

const result = {
  summary: "Web evaluation",
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

function response(contentText: string): NormalizedResponse {
  return { providerId: "chatgpt", contentText, codeBlocks: [], tables: [] };
}

function manager(
  overrides: Partial<JudgeSessionManager> = {},
): JudgeSessionManager {
  return {
    checkAvailability: vi.fn(async () => true),
    createTemporarySession: vi.fn(async () => session),
    sendPrompt: vi.fn(async () =>
      response(`\`\`\`json\n${JSON.stringify(result)}\n\`\`\``),
    ),
    closeSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("ChatGPT Web Judge Provider", () => {
  it("uses a temporary session, returns a validated result, and always closes the tab", async () => {
    const sessions = manager();
    const provider = new ChatGPTWebJudgeProvider(sessions);
    const outcome = await new JudgeRunner(new JudgeEngine([provider]), {
      random: () => 0,
    }).run(provider.id, input);
    expect(outcome.providerType).toBe("web");
    expect(outcome.result.summary).toBe("Web evaluation");
    expect(sessions.createTemporarySession).toHaveBeenCalledWith("chatgpt");
    expect(sessions.closeSession).toHaveBeenCalledWith(session);
    const sentPrompt = vi.mocked(sessions.sendPrompt).mock.calls[0][1];
    expect(sentPrompt).toContain("Answer A");
    expect(sentPrompt).not.toContain("model-a");
    expect(sentPrompt).not.toContain("chatgpt");
  });

  it("closes the temporary session when response parsing fails", async () => {
    const sessions = manager({
      sendPrompt: vi.fn(async () => response("not json")),
    });
    const provider = new ChatGPTWebJudgeProvider(sessions);
    await expect(
      new JudgeRunner(new JudgeEngine([provider])).run(provider.id, input),
    ).rejects.toMatchObject({
      code: "WEB_RESPONSE_INVALID",
    });
    expect(sessions.closeSession).toHaveBeenCalledWith(session);
    expect(sessions.sendPrompt).toHaveBeenCalledTimes(2);
  });

  it("repairs malformed Judge JSON in the same temporary session", async () => {
    const sessions = manager({
      sendPrompt: vi
        .fn()
        .mockResolvedValueOnce(response('{"summary":"broken"'))
        .mockResolvedValueOnce(response(JSON.stringify(result))),
    });
    const provider = new ChatGPTWebJudgeProvider(sessions);
    await expect(provider.evaluate(input)).resolves.toMatchObject({
      summary: "Web evaluation",
    });
    expect(sessions.sendPrompt).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sessions.sendPrompt).mock.calls[1][0]).toEqual(session);
    expect(vi.mocked(sessions.sendPrompt).mock.calls[1][1]).toContain(
      "Repair formatting only",
    );
    expect(sessions.closeSession).toHaveBeenCalledWith(session);
  });

  it("reports session creation and cleanup failures with typed errors", async () => {
    const createFailure = new ChatGPTWebJudgeProvider(
      manager({
        createTemporarySession: vi.fn(async () => {
          throw new Error("create failed");
        }),
      }),
    );
    await expect(createFailure.evaluate(input)).rejects.toMatchObject({
      code: "SESSION_CREATE_FAILED",
      message: expect.stringContaining("create failed"),
    });

    const cleanupFailure = new ChatGPTWebJudgeProvider(
      manager({
        closeSession: vi.fn(async () => {
          throw new Error("close failed");
        }),
      }),
    );
    await expect(cleanupFailure.evaluate(input)).rejects.toMatchObject({
      code: "SESSION_CLEANUP_FAILED",
    });
  });

  it("uses the session manager for availability", async () => {
    const provider = new ChatGPTWebJudgeProvider(
      manager({ checkAvailability: vi.fn(async () => false) }),
    );
    await expect(provider.checkAvailability()).resolves.toBe(false);
  });
});
