// Pure decision logic for the usage monitor: how often to poll, whether to
// fire, and when to re-arm. Kept free of chrome APIs so it is unit-testable
// and so the service worker can rebuild it from storage after a suspend.

export const NORMAL_POLL_MINUTES = 5;
export const FAST_POLL_MINUTES = 1;
export const FAST_POLL_AT = 85;      // readings at or above this poll faster
export const REARM_BELOW = 80;       // usage dropping below this re-arms

export const THRESHOLD_MIN = 50;
export const THRESHOLD_MAX = 99;
export const DEFAULT_THRESHOLD = 95;

export function clampThreshold(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_THRESHOLD;
  return Math.max(THRESHOLD_MIN, Math.min(THRESHOLD_MAX, Math.round(n)));
}

/** Poll interval in minutes for the most recent reading. */
export function pollMinutes(lastPercent) {
  return Number.isFinite(lastPercent) && lastPercent >= FAST_POLL_AT
    ? FAST_POLL_MINUTES
    : NORMAL_POLL_MINUTES;
}

/**
 * Should the auto-save fire?
 *
 * state: { armed, lastFiredAt, resetAt }  (rebuilt from chrome.storage)
 * signal: { percent, banner }  — either may be absent
 * settings: { autoSaveEnabled, threshold }
 *
 * Returns { fire, reason, armed } where `armed` is the state's next value.
 * One fire per usage window: once fired we disarm until usage drops below
 * REARM_BELOW or the stored reset time passes.
 */
export function decideTrigger(state = {}, signal = {}, settings = {}, now = Date.now()) {
  const threshold = clampThreshold(settings.threshold);
  const percent = Number.isFinite(signal.percent) ? signal.percent : null;
  let armed = state.armed !== false;

  // Re-arm first, so a window that has reset can fire again on this same tick.
  if (!armed) {
    if (percent !== null && percent < REARM_BELOW) armed = true;
    else if (state.resetAt && now >= Date.parse(state.resetAt)) armed = true;
  }

  if (!settings.autoSaveEnabled) return { fire: false, reason: 'disabled', armed };
  if (!armed) return { fire: false, reason: 'already-fired-this-window', armed };

  if (signal.banner) {
    return { fire: true, reason: `banner:${signal.banner.kind}`, armed: false };
  }
  if (percent !== null && percent >= threshold) {
    return { fire: true, reason: `percent:${percent}>=${threshold}`, armed: false };
  }
  return { fire: false, reason: percent === null ? 'no-reading' : 'below-threshold', armed };
}

/**
 * Skip a save whose transcript has not moved since the last auto-save of the
 * same chat. Re-saving an identical transcript is pure noise.
 */
export function shouldSkipUnchanged(previousEntry, messageCount) {
  if (!previousEntry || !previousEntry.autoSaved) return false;
  return Number(previousEntry.messageCount) === Number(messageCount);
}

/** The notification body for a successful auto-save. */
export function notificationText(percent, title, messageCount) {
  const pct = Number.isFinite(percent) ? `${percent}%` : 'the limit';
  return `Usage at ${pct}. Saved "${title}" (${messageCount} message${
    messageCount === 1 ? '' : 's'
  }). Open your other account and click Import.`;
}
