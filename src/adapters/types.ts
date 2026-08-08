export type ProviderId = "mock" | "chatgpt" | "gemini" | "kimi" | "doubao";

export type ProviderStatus =
  | "not_open"
  | "ready"
  | "sending"
  | "generating"
  | "completed"
  | "error"
  | "login_required";

export interface PageState {
  providerId: ProviderId;
  status: ProviderStatus;
  tabId?: number;
  url: string;
  conversationId?: string;
  modelName?: string;
  errorMessage?: string;
}

export interface NormalizedResponse {
  providerId: ProviderId;
  modelName?: string;
  contentText: string;
  contentMarkdown?: string;
  codeBlocks: Array<{ language?: string; code: string }>;
  tables: Array<{ headers: string[]; rows: string[][] }>;
  startedAt?: string;
  completedAt?: string;
  sourceUrl?: string;
}

export interface WebLLMAdapter {
  id: ProviderId;
  displayName: string;
  matches(url: string): boolean;
  detectPageState(): Promise<PageState>;
  findPromptInput(): Promise<HTMLElement | null>;
  setPrompt(prompt: string): Promise<void>;
  submitPrompt(): Promise<void>;
  detectGenerationState(): Promise<ProviderStatus>;
  waitForCompletion(options?: {
    timeoutMs?: number;
    pollingIntervalMs?: number;
  }): Promise<void>;
  extractLatestResponse(): Promise<NormalizedResponse>;
  stopGeneration?(): Promise<void>;
}
