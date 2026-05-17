export const isAbortError = (e: unknown): boolean =>
  e instanceof DOMException && e.name === "AbortError";
