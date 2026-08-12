import { AdapterError } from "../../shared/errors";

const toggleSelectors = [
  "button[data-testid*='temporary-chat' i]",
  "button[aria-label*='temporary' i]",
  "button[title*='temporary' i]",
] as const;

const temporaryPattern =
  /temporary(?:\s+chat)?|临时(?:聊天|对话)|暫時(?:聊天|對話)/i;
const activePattern =
  /turn off.*temporary|disable.*temporary|关闭.*临时|停用.*暫時/i;

function temporaryButtons(): HTMLButtonElement[] {
  const buttons = new Set<HTMLButtonElement>();
  for (const selector of toggleSelectors) {
    document
      .querySelectorAll<HTMLButtonElement>(selector)
      .forEach((button) => buttons.add(button));
  }
  document.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    const label = `${button.getAttribute("aria-label") ?? ""} ${button.title} ${button.innerText}`;
    if (temporaryPattern.test(label)) buttons.add(button);
  });
  return [...buttons];
}

function isVisible(button: HTMLButtonElement): boolean {
  const style = getComputedStyle(button);
  return (
    !button.hidden &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    button.getClientRects().length > 0
  );
}

function isActive(button: HTMLButtonElement): boolean {
  const state = button.getAttribute("data-state")?.toLowerCase();
  const label = `${button.getAttribute("aria-label") ?? ""} ${button.title}`;
  return (
    button.getAttribute("aria-pressed") === "true" ||
    button.getAttribute("aria-checked") === "true" ||
    state === "on" ||
    state === "checked" ||
    state === "active" ||
    activePattern.test(label)
  );
}

function hasTemporaryBanner(): boolean {
  const selectors = [
    "[data-testid*='temporary-chat-banner' i]",
    "[role='status']",
    "[role='alert']",
  ];
  return selectors.some((selector) =>
    [...document.querySelectorAll<HTMLElement>(selector)].some((element) =>
      temporaryPattern.test(element.innerText),
    ),
  );
}

function diagnosticSnapshot(): string {
  const buttons = temporaryButtons().map((button) => ({
    label:
      button.getAttribute("aria-label") ?? button.title ?? button.innerText,
    visible: isVisible(button),
    disabled: button.disabled,
    pressed: button.getAttribute("aria-pressed"),
    checked: button.getAttribute("aria-checked"),
    state: button.getAttribute("data-state"),
  }));
  const dialogs = [...document.querySelectorAll<HTMLElement>("[role='dialog']")]
    .map((dialog) => dialog.innerText.trim().slice(0, 300))
    .filter(Boolean);
  return JSON.stringify({ url: location.href, buttons, dialogs }).slice(
    0,
    1500,
  );
}

export async function enableChatGptTemporaryChat(
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let clickCount = 0;
  let lastClickAt = 0;
  while (Date.now() < deadline) {
    const buttons = temporaryButtons();
    if (buttons.some(isActive)) return;
    if (hasTemporaryBanner()) return;
    const button =
      buttons.find(
        (candidate) => isVisible(candidate) && !candidate.disabled,
      ) ?? buttons.find((candidate) => !candidate.disabled);
    if (
      button &&
      clickCount < 10 &&
      (clickCount === 0 || Date.now() - lastClickAt >= 2_000)
    ) {
      button.scrollIntoView({ block: "center", inline: "center" });
      button.focus();
      button.click();
      clickCount += 1;
      lastClickAt = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new AdapterError(
    clickCount > 0 ? "TEMPORARY_CHAT_FAILED" : "TEMPORARY_CHAT_NOT_FOUND",
    clickCount > 0
      ? `ChatGPT Temporary Chat could not be confirmed after ${clickCount} click attempts. Diagnostic: ${diagnosticSnapshot()}`
      : "ChatGPT Temporary Chat control was not found. The temporary session was closed.",
  );
}
