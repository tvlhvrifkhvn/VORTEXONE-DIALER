// Sending something that must not be lost — a disposition, a note, a hangup.
// A 429 (rate limit), a network failure or a 502-504 is retried automatically
// (waiting for Retry-After when the server gives one, otherwise backing off
// 1 s, 2 s, 4 s, 8 s), up to MAX_SEND_ATTEMPTS tries in all. Before every
// resend, alreadySaved() (when given) checks whether the earlier try did reach
// the server, so nothing is ever saved twice.

export const MAX_SEND_ATTEMPTS = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isRetryable(err) {
  return Boolean(err && (err.network || err.status === 429 || err.status === 502 || err.status === 503 || err.status === 504));
}

export function retryDelayMs(err, attempt) {
  if (err?.retryAfter > 0) return Math.min(err.retryAfter * 1000, 60_000);
  return Math.min(1000 * 2 ** (attempt - 1), 10_000);
}

/**
 * send(): performs the request. alreadySaved(): resolves to a result when the
 * thing is already stored (then no resend), or null. onRetrying(attempt, max,
 * err): called before each wait, so the UI can say "Not saved yet, retrying".
 * Throws the last error when every try failed (or the error isn't retryable).
 */
export async function sendWithRetry(send, { alreadySaved, onRetrying, maxAttempts = MAX_SEND_ATTEMPTS } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1 && alreadySaved) {
      try {
        const saved = await alreadySaved();
        if (saved) return saved;
      } catch {
        // Couldn't check (same outage) — the server refuses a true duplicate anyway.
      }
    }
    try {
      return await send(attempt);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxAttempts) break;
      onRetrying?.(attempt, maxAttempts, err);
      await sleep(retryDelayMs(err, attempt));
    }
  }
  throw lastErr;
}
