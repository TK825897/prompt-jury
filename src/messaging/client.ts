import { responseSchema, type ExtensionRequest, type ExtensionResponse } from "./schemas";

export async function sendMessage(message: ExtensionRequest): Promise<ExtensionResponse> {
  const raw: unknown = await chrome.runtime.sendMessage(message);
  return responseSchema.parse(raw);
}
