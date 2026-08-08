import { AdapterError } from "../shared/errors";
import type {
  NormalizedResponse,
  PageState,
  ProviderStatus,
  WebLLMAdapter,
} from "./types";

const selectors = {
  prompt: ["#prompt-textarea", "textarea[data-id='root']", "textarea[placeholder]"],
  submit: [
    "button[data-testid='send-button']",
    "button[aria-label*='Send']",
    "button[aria-label*='发送']",
  ],
  stop: [
    "button[data-testid='stop-button']",
    "button[aria-label*='Stop']",
    "button[aria-label*='停止']",
  ],
  answer: [
    "article[data-testid^='conversation-turn'] [data-message-author-role='assistant'] .markdown",
    "[data-message-author-role='assistant'] .markdown",
    "[data-message-author-role='assistant']",
    "article[data-testid^='conversation-turn'] [data-message-author-role='assistant']",
  ],
  login: ["a[href*='auth/login']", "button[data-testid='login-button']"],
} as const;

function firstElement<T extends Element>(candidates: readonly string[]): T | null {
  for (const selector of candidates) {
    const element = document.querySelector<T>(selector);
    if (element) return element;
  }
  return null;
}

function lastElement<T extends Element>(candidates: readonly string[]): T | null {
  for (const selector of candidates) {
    const elements = document.querySelectorAll<T>(selector);
    if (elements.length > 0) return elements.item(elements.length - 1);
  }
  return null;
}

function answerElements(): HTMLElement[] {
  const elements = new Set<HTMLElement>();
  for (const selector of selectors.answer) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => elements.add(element));
  }
  return [...elements].sort((left, right) =>
    left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
}

function inputText(element: HTMLElement, prompt: string): void {
  element.focus();
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, prompt);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  element.textContent = prompt;
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
}

export class ChatGPTAdapter implements WebLLMAdapter {
  readonly id = "chatgpt" as const;
  readonly displayName = "ChatGPT";
  private answerSnapshotsBeforeSend = new Map<HTMLElement, string>();

  private changedAnswers(): HTMLElement[] {
    return answerElements().filter((element) => {
      const previousText = this.answerSnapshotsBeforeSend.get(element);
      return previousText === undefined || previousText !== element.innerText.trim();
    });
  }

  private bestAnswer(elements: HTMLElement[]): HTMLElement | undefined {
    return elements.reduce<HTMLElement | undefined>((best, candidate) => {
      if (!best) return candidate;
      const difference = candidate.innerText.trim().length - best.innerText.trim().length;
      if (difference !== 0) return difference > 0 ? candidate : best;
      return best.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING ? candidate : best;
    }, undefined);
  }

  matches(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "chat.openai.com";
    } catch {
      return false;
    }
  }

  async detectPageState(): Promise<PageState> {
    const url = location.href;
    if (!this.matches(url)) return { providerId: this.id, status: "not_open", url };
    if (firstElement(selectors.login)) return { providerId: this.id, status: "login_required", url };
    const status = await this.detectGenerationState();
    return { providerId: this.id, status, url, conversationId: location.pathname.split("/c/")[1]?.split("/")[0] };
  }

  async findPromptInput(): Promise<HTMLElement | null> {
    return firstElement<HTMLElement>(selectors.prompt);
  }

  async setPrompt(prompt: string): Promise<void> {
    const input = await this.findPromptInput();
    if (!input) throw new AdapterError("INPUT_NOT_FOUND", "ChatGPT prompt input was not found.");
    this.answerSnapshotsBeforeSend = new Map(answerElements().map((element) => [element, element.innerText.trim()]));
    inputText(input, prompt);
  }

  async submitPrompt(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const button = firstElement<HTMLButtonElement>(selectors.submit);
    if (button && !button.disabled) {
      button.click();
      return;
    }
    const input = await this.findPromptInput();
    if (!input) throw new AdapterError("SUBMIT_NOT_FOUND", "ChatGPT send control was not found.");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  }

  async detectGenerationState(): Promise<ProviderStatus> {
    if (firstElement(selectors.stop)) return "generating";
    if (lastElement(selectors.answer)) return "completed";
    return (await this.findPromptInput()) ? "ready" : "error";
  }

  async waitForCompletion(options: { timeoutMs?: number; pollingIntervalMs?: number } = {}): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 180_000;
    const pollingIntervalMs = options.pollingIntervalMs ?? 500;
    const deadline = Date.now() + timeoutMs;
    let stableChecks = 0;
    let previousText = "";
    while (Date.now() < deadline) {
      const changed = this.changedAnswers();
      const latestText = this.bestAnswer(changed)?.innerText.trim() ?? "";
      if (!firstElement(selectors.stop) && latestText) {
        stableChecks = latestText === previousText ? stableChecks + 1 : 0;
        if (stableChecks >= 20) {
          await new Promise((resolve) => setTimeout(resolve, 1_500));
          return;
        }
        previousText = latestText;
      } else stableChecks = 0;
      await new Promise((resolve) => setTimeout(resolve, pollingIntervalMs));
    }
    throw new AdapterError("TIMEOUT", "ChatGPT response timed out.");
  }

  async extractLatestResponse(): Promise<NormalizedResponse> {
    const answer = this.bestAnswer(this.changedAnswers()) ?? lastElement<HTMLElement>(selectors.answer);
    if (!answer) throw new AdapterError("RESPONSE_NOT_FOUND", "No ChatGPT response was found.");
    const codeBlocks = [...answer.querySelectorAll("pre code")].map((node) => ({
      language: [...node.classList].find((name) => name.startsWith("language-"))?.slice(9),
      code: node.textContent ?? "",
    }));
    const tables = [...answer.querySelectorAll("table")].map((table) => ({
      headers: [...table.querySelectorAll("thead th")].map((cell) => cell.textContent?.trim() ?? ""),
      rows: [...table.querySelectorAll("tbody tr")].map((row) =>
        [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim() ?? ""),
      ),
    }));
    return {
      providerId: this.id,
      contentText: answer.innerText.trim(),
      codeBlocks,
      tables,
      completedAt: new Date().toISOString(),
      sourceUrl: location.href,
    };
  }
}
