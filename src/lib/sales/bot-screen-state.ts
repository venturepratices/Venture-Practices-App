import { copyMessage } from "@/lib/sales/bot-draft";

// The Bots screen's click rules, as small pure functions the components call
// (and the tests check, since the project has no browser test setup).

export type ShownKey = { botId: string; botName: string; secret: string };

/** Done closes the key box only after "I have saved it" is ticked. */
export function canCloseReveal(saved: boolean): boolean {
  return saved;
}

/** Why New bot and Make a new key are off right now, or null when they may be used. */
export function keyActionBlocked({ keyOnScreen, paused }: { keyOnScreen: boolean; paused: boolean }): string | null {
  if (keyOnScreen) return "Save the key first.";
  if (paused) return "Bot keys are switched off.";
  return null;
}

/** A key that is not saved yet is never replaced by another one. */
export function showKey(current: ShownKey | null, next: ShownKey): { shown: ShownKey; refused: boolean } {
  return current ? { shown: current, refused: true } : { shown: next, refused: false };
}

/** Copies the key; when the browser refuses, says so and the caller selects the key for a manual copy. */
export async function copyKey(
  secret: string,
  clipboard: { writeText: (text: string) => Promise<void> } | undefined,
): Promise<{ copied: boolean; message: string }> {
  try {
    if (!clipboard) throw new Error("no clipboard");
    await clipboard.writeText(secret);
    return { copied: true, message: copyMessage(true) };
  } catch {
    return { copied: false, message: copyMessage(false) };
  }
}

export type DeleteStep = "idle" | "asking" | "deleting";

/** Delete asks first; only "confirm" while asking deletes. */
export function deleteStep(step: DeleteStep, event: "delete" | "keep" | "confirm"): DeleteStep {
  if (event === "delete") return step === "idle" ? "asking" : step;
  if (event === "keep") return step === "asking" ? "idle" : step;
  return step === "asking" ? "deleting" : step;
}

/** Lets one submit through at a time, even for a double click before the screen updates. */
export function submitGate(): { start: () => boolean; finish: () => void } {
  let busy = false;
  return {
    start() {
      if (busy) return false;
      busy = true;
      return true;
    },
    finish() {
      busy = false;
    },
  };
}

export function passwordProblem({ needsPassword, password }: { needsPassword: boolean; password: string }): string | null {
  return needsPassword && !password ? "Type your password to do this." : null;
}

/** The browser's "Leave site?" warning while a key is on screen. */
export function warnBeforeLeaving(event: { preventDefault: () => void; returnValue: unknown }): void {
  event.preventDefault();
  event.returnValue = "";
}
