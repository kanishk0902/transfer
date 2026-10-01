export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Poll a predicate until it is true or the timeout expires. */
export async function waitFor(predicate, timeoutMs, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (predicate()) return true; } catch { /* keep polling */ }
    await sleep(intervalMs);
  }
  return false;
}
