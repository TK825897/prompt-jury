import { DomAdapterBase } from "./dom-adapter-base";

// Keep Doubao DOM knowledge in this file so site changes remain isolated.
const selectors = {
  prompt: ["div[contenteditable='true'][data-lexical-editor='true']", "textarea[placeholder*='豆包']", "div[contenteditable='true']", "textarea"],
  submit: ["button[aria-label*='发送']", "button[data-testid='send-button']", "button[class*='send']:not([disabled])"],
  stop: [
    "button[aria-label*='停止生成']",
    "button[aria-label*='停止回答']",
    "button[title*='停止生成']",
    "button[data-testid='stop-button']",
  ],
  answer: [
    ".md-box-root",
    "[data-testid='receive_message'] .flow-markdown-body",
    "[data-testid='receive_message']",
    "[data-testid*='receive-message']",
    "[data-role='assistant'] .flow-markdown-body",
    "[data-role='assistant']",
    ".message-content[data-message-role='assistant']",
    ".flow-markdown-body",
  ],
  answerExclude: ["[class*='think' i]", "[class*='reason' i]", "[data-testid*='think' i]", "[data-testid*='reason' i]"],
  login: ["button[aria-label*='登录']", "button[class*='login']"],
} as const;

export class DoubaoAdapter extends DomAdapterBase {
  constructor() {
    super({
      id: "doubao",
      displayName: "豆包",
      hosts: ["www.doubao.com", "doubao.com"],
      selectors,
      allowStableCompletionWhileStopVisible: true,
      minimumChangedAnswers: 2,
      preferLatestChangedAnswer: true,
      stableChecksForCompletion: 12,
      stableChecksWhileStopVisible: 15,
      completionGraceMs: 1_500,
    });
  }
}
