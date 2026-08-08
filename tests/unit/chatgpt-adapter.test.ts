import { describe, expect, it } from "vitest";
import { ChatGPTAdapter } from "../../src/adapters/chatgpt-adapter";

describe("ChatGPTAdapter URL matching", () => {
  const adapter = new ChatGPTAdapter();

  it.each(["https://chatgpt.com/", "https://chatgpt.com/c/abc", "https://team.chatgpt.com/", "https://chat.openai.com/"])("matches %s", (url) => {
    expect(adapter.matches(url)).toBe(true);
  });

  it.each(["https://example.com/chatgpt.com", "https://chatgpt.com.example.org/", "invalid"])("rejects %s", (url) => {
    expect(adapter.matches(url)).toBe(false);
  });
});
