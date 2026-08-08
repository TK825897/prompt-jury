import { describe, expect, it } from "vitest";
import { DoubaoAdapter } from "../../src/adapters/doubao-adapter";
import { GeminiAdapter } from "../../src/adapters/gemini-adapter";
import { KimiAdapter } from "../../src/adapters/kimi-adapter";

describe.each([
  ["Gemini", new GeminiAdapter(), ["https://gemini.google.com/app/abc"], ["https://google.com/"]],
  ["Kimi", new KimiAdapter(), ["https://kimi.moonshot.cn/chat/abc", "https://www.kimi.com/chat/abc"], ["https://moonshot.cn/"]],
  ["Doubao", new DoubaoAdapter(), ["https://www.doubao.com/chat/abc", "https://doubao.com/"], ["https://example.com/"]],
] as const)("%s URL matching", (_name, adapter, accepted, rejected) => {
  it.each(accepted)("matches %s", (url) => expect(adapter.matches(url)).toBe(true));
  it.each(rejected)("rejects %s", (url) => expect(adapter.matches(url)).toBe(false));
});
