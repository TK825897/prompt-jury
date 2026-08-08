import { defaultJudgeConfig, type JudgeConfig } from "./schemas";

const key = "judgeConfig";

export async function loadJudgeConfig(): Promise<JudgeConfig> {
  const stored = await chrome.storage.local.get(key);
  return { ...defaultJudgeConfig, ...(stored[key] as Partial<JudgeConfig> | undefined), weights: { ...defaultJudgeConfig.weights, ...(stored[key] as Partial<JudgeConfig> | undefined)?.weights } };
}

export async function saveJudgeConfig(config: JudgeConfig): Promise<void> {
  await chrome.storage.local.set({ [key]: config });
}

export function apiOriginPattern(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.origin}/*`;
}
