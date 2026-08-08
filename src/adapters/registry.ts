import { ChatGPTAdapter } from "./chatgpt-adapter";
import { DoubaoAdapter } from "./doubao-adapter";
import { GeminiAdapter } from "./gemini-adapter";
import { KimiAdapter } from "./kimi-adapter";
import type { WebLLMAdapter } from "./types";

const adapters: WebLLMAdapter[] = [new ChatGPTAdapter(), new GeminiAdapter(), new KimiAdapter(), new DoubaoAdapter()];

export function adapterForUrl(url: string): WebLLMAdapter | undefined {
  return adapters.find((adapter) => adapter.matches(url));
}
