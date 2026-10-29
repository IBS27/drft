// Outbound calls from actions (Clerk, Apple) must never hang the caller.
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
