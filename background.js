// Service worker: anything that must not run in the page — Drive calls, the
// optional Anthropic API call, and the usage monitor.
//
// The worker is suspended aggressively, so it holds no durable state in
// memory: every wake-up rebuilds what it needs from chrome.storage.local.
import { uploadChat, listChats, connect, disconnect } from './src/drive.js';
import { generateBrief } from './src/api-brief.js';
import { getSettings, getLastUsage, saveChat, getChats } from './src/storage.js';
import {
  ALARM, ensureAlarm, scheduleNext, runMonitorTick, applyTrigger,
  autoSaveTranscript, acceptReading, monitorLog
} from './src/monitor.js';

const HANDLERS = {
  DRIVE_CONNECT: async msg => ({ ok: true, connected: await connect(msg.scopeName) }),
  DRIVE_DISCONNECT: async () => ({ ok: true, connected: !(await disconnect()) }),

  DRIVE_UPLOAD: async msg => {
    const s = await getSettings();
    return { ok: true, fileId: await uploadChat(msg.chat, s.driveScope) };
  },

  DRIVE_LIST: async () => {
    const s = await getSettings();
    return { ok: true, chats: await listChats(s.driveScope) };
  },

  API_BRIEF: async msg => {
    const s = await getSettings();
    return {
      ok: true,
      brief: await generateBrief({
        apiKey: s.apiKey,
        model: s.apiModel,
        transcript: msg.transcript,
        title: msg.title
      })
    };
  },

  // ---- usage monitor ----

  // The content script saw a limit banner in a chat.
  LIMIT_BANNER: async msg => {
    const result = await applyTrigger({ banner: msg.banner });
    return { ok: true, ...result };
  },

  // Options page: "Test auto-save now" — runs the save regardless of usage.
  TEST_AUTOSAVE: async () => {
    const result = await autoSaveTranscript({ percent: null, reason: 'manual-test' });
    return { ok: !!result.ok, ...result };
  },

  // Options page: read the usage page once, right now.
  CHECK_USAGE_NOW: async () => ({ ok: true, ...(await runMonitorTick({ force: true })) }),

  LAST_USAGE: async () => ({ ok: true, lastUsage: await getLastUsage() }),

  RESCHEDULE: async () => ({ ok: true, minutes: await scheduleNext() }),

  MONITOR_LOG: async () => ({ ok: true, log: monitorLog() }),

  // The new account captured a brief for an imported chat.
  SAVE_BRIEF: async msg => {
    const chats = await getChats();
    const existing = chats.find(c => c.id === msg.id);
    if (!existing) return { ok: false, error: 'That chat is no longer saved locally.' };
    await saveChat({
      ...existing,
      brief: msg.brief,
      briefMethod: msg.briefMethod || 'claude-import',
      briefSavedAt: new Date().toISOString()
    });
    return { ok: true };
  }
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // The usage reader fires and forgets; resolve the waiting promise and stop.
  if (msg && msg.type === 'USAGE_READING') { acceptReading(msg); return false; }

  const handler = HANDLERS[msg && msg.type];
  if (!handler) return false;
  handler(msg)
    .then(sendResponse)
    .catch(e => sendResponse({ ok: false, error: e.message }));
  return true;
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== ALARM) return;
  runMonitorTick().catch(e => console.error('[chat-transfer] monitor tick failed:', e.message));
});

// Re-arm the alarm on every lifecycle event the worker can observe. All three
// are idempotent, which is what makes suspend/resume safe.
chrome.runtime.onInstalled.addListener(() => { ensureAlarm().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm().catch(() => {}); });
ensureAlarm().catch(() => {});
