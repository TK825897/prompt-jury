import { AdapterError } from "../shared/errors";
import type { NormalizedResponse, PageState, ProviderId, ProviderStatus, WebLLMAdapter } from "./types";

export interface DomAdapterConfig {
  id: Exclude<ProviderId, "mock" | "chatgpt">;
  displayName: string;
  hosts: string[];
  selectors: {
    prompt: readonly string[];
    submit: readonly string[];
    stop: readonly string[];
    answer: readonly string[];
    answerExclude?: readonly string[];
    login: readonly string[];
  };
  allowStableCompletionWhileStopVisible?: boolean;
  minimumChangedAnswers?: number;
  preferLatestChangedAnswer?: boolean;
  defaultTimeoutMs?: number;
  stableChecksForCompletion?: number;
  stableChecksWhileStopVisible?: number;
  completionGraceMs?: number;
}

function first<T extends Element>(selectors: readonly string[]): T | null {
  for (const selector of selectors) {
    const element = document.querySelector<T>(selector);
    if (element) return element;
  }
  return null;
}

function all(selectors: readonly string[]): HTMLElement[] {
  const elements = new Set<HTMLElement>();
  for (const selector of selectors) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => elements.add(element));
  }
  return [...elements].sort((left, right) => {
    if (left === right) return 0;
    return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}

function writePrompt(element: HTMLElement, prompt: string): void {
  element.focus();
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, prompt);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  element.textContent = prompt;
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
}

export abstract class DomAdapterBase implements WebLLMAdapter {
  readonly id: DomAdapterConfig["id"];
  readonly displayName: string;
  protected readonly config: DomAdapterConfig;
  private answerCountBeforeSend = 0;
  private answerTextBeforeSend = "";
  private answerSnapshotsBeforeSend = new Map<HTMLElement, string>();

  protected answerElements(): HTMLElement[] {
    const excludes = this.config.selectors.answerExclude ?? [];
    return all(this.config.selectors.answer).filter(
      (element) =>
        !excludes.some(
          (selector) => element.matches(selector) || element.closest(selector) || element.querySelector(selector),
        ),
    );
  }

  private changedAnswers(answers: HTMLElement[]): HTMLElement[] {
    return answers.filter((element) => {
      const previousText = this.answerSnapshotsBeforeSend.get(element);
      return previousText === undefined || previousText !== element.innerText.trim();
    });
  }

  private bestAnswer(answers: HTMLElement[]): HTMLElement | undefined {
    if (this.config.preferLatestChangedAnswer) return answers.at(-1);
    return answers.reduce<HTMLElement | undefined>((best, candidate) => {
      if (!best) return candidate;
      const bestLength = best.innerText.trim().length;
      const candidateLength = candidate.innerText.trim().length;
      if (candidateLength !== bestLength) return candidateLength > bestLength ? candidate : best;
      return best.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING ? candidate : best;
    }, undefined);
  }

  constructor(config: DomAdapterConfig) {
    this.config = config;
    this.id = config.id;
    this.displayName = config.displayName;
  }

  matches(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return this.config.hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
    } catch { return false; }
  }

  async detectPageState(): Promise<PageState> {
    const url = location.href;
    if (!this.matches(url)) return { providerId: this.id, status: "not_open", url };
    if (first(this.config.selectors.login)) return { providerId: this.id, status: "login_required", url };
    return { providerId: this.id, status: await this.detectGenerationState(), url };
  }

  async findPromptInput(): Promise<HTMLElement | null> {
    return first<HTMLElement>(this.config.selectors.prompt);
  }

  async setPrompt(prompt: string): Promise<void> {
    const input = await this.findPromptInput();
    if (!input) throw new AdapterError("INPUT_NOT_FOUND", `${this.displayName} prompt input was not found.`);
    const answers = this.answerElements();
    this.answerCountBeforeSend = answers.length;
    this.answerTextBeforeSend = answers.at(-1)?.innerText.trim() ?? "";
    this.answerSnapshotsBeforeSend = new Map(answers.map((element) => [element, element.innerText.trim()]));
    writePrompt(input, prompt);
  }

  async submitPrompt(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const button = first<HTMLButtonElement>(this.config.selectors.submit);
    if (button && !button.disabled) { button.click(); return; }
    const input = await this.findPromptInput();
    if (!input) throw new AdapterError("SUBMIT_NOT_FOUND", `${this.displayName} send control was not found.`);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
  }

  async detectGenerationState(): Promise<ProviderStatus> {
    if (first(this.config.selectors.stop)) return "generating";
    if (this.answerElements().length) return "completed";
    return (await this.findPromptInput()) ? "ready" : "error";
  }

  async waitForCompletion(options: { timeoutMs?: number; pollingIntervalMs?: number } = {}): Promise<void> {
    const deadline = Date.now() + (options.timeoutMs ?? this.config.defaultTimeoutMs ?? 180_000);
    const interval = options.pollingIntervalMs ?? 600;
    let stableChecks = 0;
    let previousText = "";
    while (Date.now() < deadline) {
      const answers = this.answerElements();
      const changedAnswers = this.changedAnswers(answers);
      const latestText = this.bestAnswer(changedAnswers)?.innerText.trim() ?? "";
      const hasEnoughChangedAnswers = changedAnswers.length >= (this.config.minimumChangedAnswers ?? 1);
      const hasNewAnswer =
        hasEnoughChangedAnswers &&
        (changedAnswers.length > 0 ||
          answers.length > this.answerCountBeforeSend ||
          answers.at(-1)?.innerText.trim() !== this.answerTextBeforeSend);
      const stopVisible = Boolean(first(this.config.selectors.stop));
      if (hasNewAnswer && latestText) {
        stableChecks = latestText === previousText ? stableChecks + 1 : 0;
        const stableTarget = this.config.stableChecksForCompletion ?? 2;
        const stopVisibleTarget = this.config.stableChecksWhileStopVisible ?? 5;
        const completed =
          (!stopVisible && stableChecks >= stableTarget) ||
          (this.config.allowStableCompletionWhileStopVisible && stableChecks >= stopVisibleTarget);
        if (completed) {
          if (this.config.completionGraceMs) {
            await new Promise((resolve) => setTimeout(resolve, this.config.completionGraceMs));
          }
          return;
        }
        previousText = latestText;
      } else stableChecks = 0;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new AdapterError("TIMEOUT", `${this.displayName} response timed out.`);
  }

  async extractLatestResponse(): Promise<NormalizedResponse> {
    const answers = this.answerElements();
    const answer = this.bestAnswer(this.changedAnswers(answers)) ?? this.bestAnswer(answers);
    if (!answer) throw new AdapterError("RESPONSE_NOT_FOUND", `No ${this.displayName} response was found.`);
    return {
      providerId: this.id,
      contentText: answer.innerText.trim(),
      codeBlocks: [...answer.querySelectorAll("pre code")].map((node) => ({
        language: [...node.classList].find((name) => name.startsWith("language-"))?.slice(9),
        code: node.textContent ?? "",
      })),
      tables: [...answer.querySelectorAll("table")].map((table) => ({
        headers: [...table.querySelectorAll("thead th")].map((cell) => cell.textContent?.trim() ?? ""),
        rows: [...table.querySelectorAll("tbody tr")].map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim() ?? "")),
      })),
      completedAt: new Date().toISOString(),
      sourceUrl: location.href,
    };
  }
}
