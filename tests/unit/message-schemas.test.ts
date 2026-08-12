import { describe, expect, it } from "vitest";
import { requestSchema } from "../../src/messaging/schemas";

describe("message schema", () => {
  it("accepts a valid prompt message", () => {
    expect(
      requestSchema.safeParse({
        type: "SEND_PROMPT",
        tabId: 7,
        prompt: "Hello",
      }).success,
    ).toBe(true);
  });

  it("rejects an empty prompt and unknown fields", () => {
    expect(
      requestSchema.safeParse({ type: "SEND_PROMPT", tabId: 7, prompt: " " })
        .success,
    ).toBe(false);
    expect(requestSchema.safeParse({ type: "DELETE_EVERYTHING" }).success).toBe(
      false,
    );
  });

  it("validates owned temporary Judge session lifecycle messages", () => {
    expect(
      requestSchema.safeParse({
        type: "CREATE_JUDGE_SESSION",
        providerId: "chatgpt",
      }).success,
    ).toBe(true);
    expect(
      requestSchema.safeParse({
        type: "SEND_JUDGE_PROMPT",
        sessionId: "session-1",
        tabId: 42,
        prompt: "Judge candidates",
      }).success,
    ).toBe(true);
    expect(
      requestSchema.safeParse({
        type: "CLOSE_JUDGE_SESSION",
        sessionId: "session-1",
        tabId: 42,
      }).success,
    ).toBe(true);
    expect(
      requestSchema.safeParse({
        type: "CLOSE_JUDGE_SESSION",
        sessionId: "",
        tabId: 42,
      }).success,
    ).toBe(false);
  });
});
