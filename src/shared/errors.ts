export type AdapterErrorCode =
  | "UNSUPPORTED_PAGE"
  | "LOGIN_REQUIRED"
  | "INPUT_NOT_FOUND"
  | "SUBMIT_NOT_FOUND"
  | "RESPONSE_NOT_FOUND"
  | "TEMPORARY_CHAT_NOT_FOUND"
  | "TEMPORARY_CHAT_FAILED"
  | "TIMEOUT";

export class AdapterError extends Error {
  constructor(
    public readonly code: AdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown extension error";
}
