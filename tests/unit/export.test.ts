import { describe, expect, it } from "vitest";
import { exportFilename, serializeJson, serializeMarkdown } from "../../src/export/serialize";
import type { EvaluationBundle } from "../../src/storage/types";

const bundle: EvaluationBundle = {
  run: {
    id: "run-1",
    prompt: "Compare A and B",
    selectedProviders: ["chatgpt", "kimi"],
    status: "partial",
    providerResults: [
      { providerId: "chatgpt", status: "completed", durationMs: 1200 },
      { providerId: "kimi", status: "failed", errorMessage: "Unavailable" },
    ],
    createdAt: "2026-08-07T03:00:00.000Z",
    completedAt: "2026-08-07T03:00:02.000Z",
  },
  responses: [{
    id: "response-1", runId: "run-1", providerId: "chatgpt", text: "Answer A",
    codeBlocks: [], tables: [], metadata: { durationMs: 1200 },
  }],
};

describe("exports", () => {
  it("serializes a readable Markdown report", () => {
    const output = serializeMarkdown(bundle);
    expect(output).toContain("## 原始提示词\n\nCompare A and B");
    expect(output).toContain("## ChatGPT\n\nAnswer A");
    expect(output).toContain("- Kimi：Unavailable");
  });

  it("serializes structured JSON", () => {
    const output = JSON.parse(serializeJson(bundle)) as { run: { id: string }; metadata: { formatVersion: number } };
    expect(output.run.id).toBe("run-1");
    expect(output.metadata.formatVersion).toBe(1);
  });

  it("creates the documented filename", () => {
    expect(exportFilename("md", new Date(2026, 7, 7, 9, 5, 3))).toBe("prompt-jury-20260807-090503.md");
  });
});
