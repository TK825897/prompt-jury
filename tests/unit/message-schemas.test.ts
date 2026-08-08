import { describe, expect, it } from "vitest";
import { requestSchema } from "../../src/messaging/schemas";

describe("message schema", () => {
  it("accepts a valid prompt message", () => {
    expect(requestSchema.safeParse({ type: "SEND_PROMPT", tabId: 7, prompt: "Hello" }).success).toBe(true);
  });

  it("rejects an empty prompt and unknown fields", () => {
    expect(requestSchema.safeParse({ type: "SEND_PROMPT", tabId: 7, prompt: " " }).success).toBe(false);
    expect(requestSchema.safeParse({ type: "DELETE_EVERYTHING" }).success).toBe(false);
  });
});
