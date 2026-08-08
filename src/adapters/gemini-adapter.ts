import { DomAdapterBase } from "./dom-adapter-base";

// Keep Gemini DOM knowledge in this file so site changes remain isolated.
const selectors = {
  prompt: ["rich-textarea div[contenteditable='true']", "div.ql-editor[contenteditable='true']", "textarea[aria-label*='prompt' i]"],
  submit: ["button[aria-label*='Send message' i]", "button[aria-label*='发送' i]", "button.send-button"],
  stop: ["button[aria-label*='Stop response' i]", "button[aria-label*='停止' i]", "button.stop-button"],
  answer: ["model-response .markdown", "model-response", "[data-test-id='model-response']"],
  login: ["a[href*='accounts.google.com/ServiceLogin']", "a[aria-label*='Sign in' i]"],
} as const;

export class GeminiAdapter extends DomAdapterBase {
  constructor() { super({ id: "gemini", displayName: "Gemini", hosts: ["gemini.google.com"], selectors }); }
}
