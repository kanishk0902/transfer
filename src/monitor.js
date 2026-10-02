// The usage monitor. Runs in the service worker: opens the usage page in a
// background tab, reads the percentage, and auto-saves the transcript when the
// limit is close. It NEVER sends a message in a chat and never generates a
// brief — an auto-save must cost zero usage.
import { USAGE_URL, LOGIN_URL_PATTERN } from './site.js';
import {
  pollMinutes, decideTrigger, shouldSkipUnchanged, notificationText, clampThreshold
} from './trigger.js';
import {
  getSettings, getChats, saveChat, getLastUsage, setLastUsage,
  getMonitorState, setMonitorState
} from './storage.js';

export const ALARM = 'usage-monitor';
const TAB_TIMEOUT_MS = 25000;
const NOTIFY_ICON = 'icons/icon128.png';

// Structural log only — never chat content. Mirrors src/debug.js's contract.
const log = [];
function note(event, data) {
  log.push({ t: new Date().toISOString(), event, data });
  if (log.length > 100) log.shift();
}
export function monitorLog() { return log.slice(); }

// ---------------------------------------------------------------------------
// Single-flight lock. A boolean is enough: the worker is single-threaded, and
// anything it forgets on suspend is correctly forgotten (no tab survives).
// ---------------------------------------------------------------------------
let monitorBusy = false;
let pendingReading = null;   // resolver for the content script's report

/** Called from the service worker's onMessage for USAGE_READING. */
export function acceptReading(payload) {
  if (!pendingReading) return false;
  const resolve = pendingReading;
  pendingReading = null;
  resolve(payload);
  return true;
}

function notify(message, title = 'Claude Chat Transfer') {
  try {
    chrome.notifications.create({
      type: 'basic', iconUrl: NOTIFY_ICON, title, message, priority: 2
    });
  } catch (e) {
    note('notify-failed', { message: e.message });
  }
}

// ---------------------------------------------------------------------------
// Alarm scheduling
// ---------------------------------------------------------------------------

export async function scheduleNext() {
  const settings = await getSettings();
  if (!settings.usagePollEnabled) {
    await chrome.alarms.clear(ALARM);
    note('poll-disabled');
    return null;
  }
  const last = await getLastUsage();
  const minutes = pollMinutes(last && last.percent);
  // create() replaces an existing alarm of the same name, so the interval
  // retunes itself as usage climbs without needing a clear() first.
  await chrome.alarms.create(ALARM, { periodInMinutes: minutes, delayInMinutes: minutes });
  note('scheduled', { minutes });
  return minutes;
}

/** Idempotent: safe to call on install, on startup, and after a suspend. */
export async function ensureAlarm() {
  const settings = await getSettings();
  if (!settings.usagePollEnabled) { await chrome.alarms.clear(ALARM); return; }
  const existing = await chrome.alarms.get(ALARM);
  if (!existing) await scheduleNext();
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

async function claudeTabsOpen() {
  const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
  return tabs.filter(t => !String(t.url || '').startsWith(USAGE_URL));
}

/** Most recently active claude.ai tab sitting on a /chat/ URL. */
export async function findChatTab() {
  const tabs = await chrome.tabs.query({ url: 'https://claude.ai/chat/*' });
  if (!tabs.length) return null;
  // lastAccessed is not on every Chrome build; active tabs win as a fallback.
  return tabs.slice().sort((a, b) =>
    (b.lastAccessed || (b.active ? 1 : 0)) - (a.lastAccessed || (a.active ? 1 : 0))
  )[0];
}

/**
 * Open the usage page in an inactive background tab, wait for the reading,
 * then close the tab. The tab is closed in `finally` so an error, a timeout or
 * a logged-out redirect can never leave it behind.
 */
export async function readUsageInBackgroundTab() {
  let tabId = null;
  let onUpdated = null;
  try {
    const tab = await chrome.tabs.create({ url: USAGE_URL, active: false });
    tabId = tab.id;
    const payload = await new Promise(resolve => {
      pendingReading = resolve;

      const finish = value => {
        if (pendingReading !== resolve) return;
        pendingReading = null;
        resolve(value);
      };

      // Being logged out redirects away from /settings/usage, where our content
      // script does not run — so nothing would ever report and we would burn
      // the whole timeout. Watch the tab's URL instead.
      onUpdated = (changedId, info) => {
        if (changedId !== tabId || !info.url) return;
        if (LOGIN_URL_PATTERN.test(info.url)) {
          finish({ ok: true, reading: { loggedOut: true, percent: null, bars: [] },
                   readAt: new Date().toISOString() });
        }
      };
      try { chrome.tabs.onUpdated.addListener(onUpdated); } catch { onUpdated = null; }

      setTimeout(() => finish({ ok: false, error: 'timeout' }), TAB_TIMEOUT_MS);
    });
    return payload;
  } finally {
    if (onUpdated) {
      try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch { /* ignore */ }
    }
    pendingReading = null;
    if (tabId !== null) {
      try { await chrome.tabs.remove(tabId); } catch { /* already gone */ }
    }
  }
}

// ---------------------------------------------------------------------------
// The auto-save itself
// ---------------------------------------------------------------------------

/**
 * Save the full transcript of the most recent chat tab. Transcript only:
 * no message is sent and no brief is generated.
 * Returns { ok, chat?, skipped?, error? }.
 */
export async function autoSaveTranscript({ percent = null, reason = 'manual-test' } = {}) {
  const tab = await findChatTab();
  if (!tab) {
    note('autosave:no-chat-tab', { reason });
    notify('Usage is near the limit but no Claude chat tab is open, so nothing could be saved.');
    return { ok: false, error: 'no-chat-tab' };
  }

  let res;
  try {
    // scroll:true so virtualised older turns are pulled into the DOM first.
    res = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT', scroll: true });
  } catch (e) {
    note('autosave:unreachable', { reason, message: e.message });
    notify('Could not read the Claude tab to auto-save it. Reload the claude.ai tab.');
    return { ok: false, error: 'tab-unreachable' };
  }
  if (!res || !res.ok || !res.chat) {
    const error = (res && res.error) || 'no-response';
    note('autosave:extract-failed', { reason, error });
    notify('Auto-save failed while reading the conversation: ' + error);
    return { ok: false, error };
  }

  const chat = res.chat;
  const previous = (await getChats()).find(c => c.id === chat.id);
  if (shouldSkipUnchanged(previous, chat.messageCount)) {
    note('autosave:skipped-unchanged', { messageCount: chat.messageCount });
    return { ok: true, skipped: true, chat };
  }

  // Overwrite any previous save of the same chat id. mergeChats dedupes by id
  // and this savedAt is the newest, so this entry wins. The brief field is
  // deliberately absent: a previous brief is preserved by mergeChats.
  const entry = {
    ...chat,
    autoSaved: true,
    autoSavedAt: new Date().toISOString(),
    autoSaveReason: reason,
    usagePercent: percent
  };
  await saveChat(entry);
  note('autosave:saved', { messageCount: chat.messageCount, percent, reason });
  notify(notificationText(percent, chat.title, chat.messageCount));
  return { ok: true, chat: entry };
}

// ---------------------------------------------------------------------------
// One monitor tick
// ---------------------------------------------------------------------------

export async function runMonitorTick({ force = false } = {}) {
  if (monitorBusy) { note('tick:locked'); return { ok: false, error: 'busy' }; }
  monitorBusy = true;
  try {
    const settings = await getSettings();
    if (!force && !settings.usagePollEnabled) return { ok: true, skipped: 'poll-disabled' };

    // Opening a tab when the user is not using claude.ai would be rude.
    if (!force && !(await claudeTabsOpen()).length) {
      note('tick:no-claude-tab');
      return { ok: true, skipped: 'no-claude-tab' };
    }

    const payload = await readUsageInBackgroundTab();
    if (!payload.ok) {
      note('tick:read-failed', { error: payload.error });
      await scheduleNext();
      return { ok: false, error: payload.error };
    }

    const reading = payload.reading || {};
    if (reading.loggedOut) {
      note('tick:logged-out');
      await setLastUsage({
        percent: null, label: null, readAt: payload.readAt,
        loggedOut: true, rawText: '', matchedSelector: null
      });
      await scheduleNext();
      return { ok: true, skipped: 'logged-out' };
    }

    await setLastUsage({
      percent: reading.percent,
      label: reading.label,
      readAt: payload.readAt,
      bars: reading.bars || [],
      rawText: reading.rawText || '',
      matchedSelector: reading.matchedSelector || null,
      resetHint: reading.resetHint || null
    });

    const result = await applyTrigger({ percent: reading.percent }, settings);
    await scheduleNext();
    return { ok: true, percent: reading.percent, ...result };
  } catch (e) {
    note('tick:error', { message: e.message });
    try { await scheduleNext(); } catch { /* ignore */ }
    return { ok: false, error: e.message };
  } finally {
    monitorBusy = false;
  }
}

/**
 * Feed a signal (a usage reading, or a banner seen by the content script) into
 * the trigger state machine, and auto-save if it says so.
 */
export async function applyTrigger(signal, settings = null) {
  const s = settings || await getSettings();
  const state = await getMonitorState();
  const decision = decideTrigger(
    state,
    signal,
    { autoSaveEnabled: s.autoSaveEnabled, threshold: clampThreshold(s.autoSaveThreshold) }
  );

  const patch = { armed: decision.armed };
  if (decision.fire) {
    patch.lastFiredAt = new Date().toISOString();
    const last = await getLastUsage();
    if (last && last.resetHint) patch.resetHint = last.resetHint;
  }
  await setMonitorState(patch);

  note('trigger', { fire: decision.fire, reason: decision.reason, armed: decision.armed });
  if (!decision.fire) return { fired: false, reason: decision.reason };

  const saved = await autoSaveTranscript({
    percent: Number.isFinite(signal.percent) ? signal.percent : null,
    reason: decision.reason
  });
  return { fired: true, reason: decision.reason, save: saved };
}
