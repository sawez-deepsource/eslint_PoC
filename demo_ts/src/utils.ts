import { Maybe } from "./types";

export function isNonEmptyString(value: Maybe<string>): boolean {
  return !!value && value.trim().length > 0;
}

export async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function fireAndForget(p: Promise<unknown>): void {
  // Intentionally not awaited
  p.then(() => {}).catch(() => {});
}

export function riskyBoolean(value: unknown): boolean {
  // strict-boolean-expressions will complain
  if (value) {
    return true;
  }
  return false;
}
