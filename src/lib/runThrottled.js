// Small concurrency helpers for bulk writes against base44 entities.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Does an error look like a rate-limit (429 / "rate limit")? Only those are
// worth retrying — a validation error should fail fast, not spin 6 times.
const isRateLimitError = (e) => {
  const status = e?.status ?? e?.response?.status ?? e?.code;
  if (status === 429) return true;
  return /rate limit|too many requests|429/i.test(e?.message || "");
};

// Run an array of thunks (each returns a promise) in small concurrent batches
// with a pause between them, so a bulk operation over hundreds of rows stays
// under the base44 write rate limit. Each task is retried with exponential
// backoff when it hits a rate limit, so a brief spike self-heals instead of
// aborting the whole operation.
export async function runThrottled(
  tasks,
  { batchSize = 3, delayMs = 700, maxRetries = 6 } = {},
) {
  const runOne = async (thunk) => {
    let attempt = 0;
    for (;;) {
      try {
        return await thunk();
      } catch (e) {
        if (!isRateLimitError(e) || attempt >= maxRetries) throw e;
        attempt += 1;
        // Exponential backoff, capped at 15s: 1s, 2s, 4s, 8s, 15s, 15s.
        await sleep(Math.min(15000, 1000 * 2 ** (attempt - 1)));
      }
    }
  };

  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    await Promise.all(batch.map(runOne));
    if (i + batchSize < tasks.length) await sleep(delayMs);
  }
}