// Debug logging. Off by default; chat content is never logged unless on.
let enabled = false;
const entries = [];

export function setDebug(on) { enabled = !!on; }
export function isDebug() { return enabled; }

/** Structural facts — always recorded, cheap, no chat content. */
export function note(event, data) {
  entries.push({ t: new Date().toISOString(), event, data });
  if (entries.length > 200) entries.shift();
  if (enabled) console.log('[chat-transfer]', event, data ?? '');
}

/** Chat content — only ever reaches the console in debug mode. */
export function noteContent(event, text) {
  if (!enabled) return;
  console.log('[chat-transfer]', event, String(text).slice(0, 500));
}

export function report() { return entries.slice(); }
export function clearReport() { entries.length = 0; }
