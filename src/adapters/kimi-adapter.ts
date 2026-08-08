import { DomAdapterBase } from "./dom-adapter-base";

// Keep Kimi DOM knowledge in this file so site changes remain isolated.
const selectors = {
  prompt: ["div[contenteditable='true'][data-lexical-editor='true']", "div.chat-input-editor[contenteditable='true']", "textarea[placeholder*='Kimi' i]", "textarea"],
  submit: ["button[aria-label*='发送']", "button[data-testid='send-button']", ".send-button:not([disabled])"],
  stop: ["button[aria-label*='停止生成']", "button[title*='停止生成']", "button[data-testid='stop-button']", ".stop-button"],
  answer: [
    ".chat-content-item-assistant .markdown-body",
    ".chat-content-item-assistant [class*='markdown']",
    "[data-role='assistant'] .markdown-body",
    "[data-role='assistant'] [class*='markdown']",
    ".segment-assistant .markdown-body",
    ".segment-assistant .markdown",
    ".chat-content-item-assistant",
  ],
  answerExclude: [
    "[class*='think' i]",
    "[class*='reason' i]",
    "[class*='analysis' i]",
    "[data-testid*='think' i]",
    "[data-testid*='reason' i]",
  ],
  login: ["button[data-testid='login-button']", "button[class*='login']"],
} as const;

export class KimiAdapter extends DomAdapterBase {
  constructor() {
    super({
      id: "kimi",
      displayName: "Kimi",
      hosts: ["kimi.moonshot.cn", "www.kimi.com", "kimi.com"],
      selectors,
      defaultTimeoutMs: 300_000,
    });
  }
}
