import { z } from "zod";

const providerIdSchema = z.enum([
  "mock",
  "chatgpt",
  "gemini",
  "kimi",
  "doubao",
]);
const pageStateSchema = z.object({
  providerId: providerIdSchema,
  status: z.enum([
    "not_open",
    "ready",
    "sending",
    "generating",
    "completed",
    "error",
    "login_required",
  ]),
  tabId: z.number().optional(),
  url: z.string(),
  conversationId: z.string().optional(),
  modelName: z.string().optional(),
  errorMessage: z.string().optional(),
});
const normalizedResponseSchema = z.object({
  providerId: providerIdSchema,
  modelName: z.string().optional(),
  contentText: z.string(),
  contentMarkdown: z.string().optional(),
  codeBlocks: z.array(
    z.object({ language: z.string().optional(), code: z.string() }),
  ),
  tables: z.array(
    z.object({
      headers: z.array(z.string()),
      rows: z.array(z.array(z.string())),
    }),
  ),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  sourceUrl: z.string().optional(),
});
const judgeSessionSchema = z.object({
  id: z.string(),
  providerId: z.enum(["chatgpt", "gemini", "kimi", "doubao"]),
  type: z.literal("temporary"),
  tabId: z.number(),
  createdAt: z.string(),
});

export const requestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("DETECT_PROVIDERS") }),
  z.object({ type: z.literal("PING_CONTENT"), tabId: z.number() }),
  z.object({
    type: z.literal("MOCK_ROUNDTRIP"),
    tabId: z.number(),
    prompt: z.string().trim().min(1).max(100_000),
  }),
  z.object({
    type: z.literal("SEND_PROMPT"),
    tabId: z.number(),
    prompt: z.string().trim().min(1).max(100_000),
  }),
  z.object({
    type: z.literal("CREATE_JUDGE_SESSION"),
    providerId: z.enum(["chatgpt", "gemini", "kimi", "doubao"]),
  }),
  z.object({
    type: z.literal("SEND_JUDGE_PROMPT"),
    sessionId: z.string().trim().min(1),
    tabId: z.number(),
    prompt: z.string().trim().min(1).max(500_000),
  }),
  z.object({
    type: z.literal("CLOSE_JUDGE_SESSION"),
    sessionId: z.string().trim().min(1),
    tabId: z.number(),
  }),
  z.object({ type: z.literal("CONTENT_DETECT") }),
  z.object({
    type: z.literal("CONTENT_MOCK"),
    prompt: z.string().trim().min(1).max(100_000),
  }),
  z.object({
    type: z.literal("CONTENT_SEND_PROMPT"),
    prompt: z.string().trim().min(1).max(100_000),
  }),
  z.object({ type: z.literal("CONTENT_ENABLE_TEMPORARY_CHAT") }),
  z.object({
    type: z.literal("CONTENT_SEND_JUDGE_PROMPT"),
    prompt: z.string().trim().min(1).max(500_000),
  }),
]);

export const responseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    data: z.union([
      z.literal("pong"),
      z.literal("temporary_chat_ready"),
      pageStateSchema,
      normalizedResponseSchema,
      judgeSessionSchema,
      z.array(pageStateSchema),
    ]),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
    code: z.string().optional(),
  }),
]);

export type ExtensionRequest = z.infer<typeof requestSchema>;
export type ExtensionResponse = z.infer<typeof responseSchema>;
