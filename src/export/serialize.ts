import type { EvaluationBundle } from "../storage/types";

const providerNames = {
  mock: "Mock",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  kimi: "Kimi",
  doubao: "豆包",
} as const;

export function serializeMarkdown(bundle: EvaluationBundle): string {
  const lines = [
    "# Prompt Jury",
    "",
    `- 时间：${bundle.run.createdAt}`,
    `- 状态：${bundle.run.status}`,
    `- 参与模型：${bundle.run.selectedProviders.map((id) => providerNames[id]).join("、")}`,
    "",
    "## 原始提示词",
    "",
    bundle.run.prompt,
  ];
  for (const response of bundle.responses) {
    lines.push(
      "",
      `## ${providerNames[response.providerId]}${response.modelName ? ` · ${response.modelName}` : ""}`,
      "",
      response.markdown ?? response.text,
    );
  }
  const failures = bundle.run.providerResults.filter(
    (result) => result.status !== "completed",
  );
  if (failures.length) {
    lines.push("", "## 失败记录", "");
    failures.forEach((failure) =>
      lines.push(
        `- ${providerNames[failure.providerId]}：${failure.errorMessage ?? failure.status}`,
      ),
    );
  }
  const judgeRuns = bundle.judgeRuns?.length
    ? bundle.judgeRuns
    : bundle.judgeResult
      ? [bundle.judgeResult]
      : [];
  judgeRuns.forEach((judgeRun, index) => {
    const heading =
      judgeRuns.length > 1
        ? `## Judge 结果 ${index + 1} · ${judgeRun.model}`
        : "## Judge 结果";
    lines.push("", heading, "", judgeRun.result.summary, "", "### 排名", "");
    [...judgeRun.result.ranking]
      .sort((a, b) => a.rank - b.rank)
      .forEach((item) => {
        const provider = judgeRun.anonymousMapping[item.answerId];
        lines.push(
          `- #${item.rank} ${provider ? providerNames[provider] : item.answerId}：${item.overallScore}（置信度 ${item.confidence}）`,
        );
      });
    lines.push(
      "",
      "### 共识",
      "",
      ...judgeRun.result.consensus.map((item) => `- ${item}`),
      "",
      "### 分歧",
      "",
      ...judgeRun.result.disagreements.map(
        (item) => `- ${item.topic}：${item.judgeAssessment}`,
      ),
    );
  });
  if (bundle.synthesizedAnswers?.length) {
    lines.push("", "## 综合答案");
    const modeNames = {
      best: "最优综合版",
      repair: "修正最佳回答",
      disagreements: "保留分歧版",
    } as const;
    bundle.synthesizedAnswers.forEach((answer) =>
      lines.push(
        "",
        `### ${modeNames[answer.mode]} · ${answer.createdAt}`,
        "",
        answer.content,
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function serializeJson(bundle: EvaluationBundle): string {
  return `${JSON.stringify({ ...bundle, metadata: { exportedAt: new Date().toISOString(), formatVersion: 1 } }, null, 2)}\n`;
}

export function exportFilename(
  extension: "md" | "json",
  date = new Date(),
): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const timestamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `prompt-jury-${timestamp}.${extension}`;
}

export function downloadText(
  content: string,
  filename: string,
  type: string,
): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
