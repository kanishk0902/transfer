import { extractChat, debugSnapshot } from './extract.js';
import { requestBriefInChat, awaitReplyMarkdown, submit } from './brief.js';
import {
  composeImport, fallbackToPaste, composeAutoBrief, autoBriefPasteFallback
} from './compose.js';
import { insertText, attachFile, editorText } from './importer.js';
import { setDebug, note, report } from './debug.js';
import { conversationId, findLimitBanner } from './site.js';
import { findMessages } from './site.js';
import { getSettings } from './storage.js';

// ---------- SPA navigation ----------
// claude.ai swaps chats without a reload, so cached state must be invalidated
// whenever the conversation id in the URL changes.
let currentId = conversationId();

function onNavigate() {
  const id = conversationId();
  if (id === currentId) return;
  currentId = id;
  autoSent.clear();
  bannerReported = null;
  note('spa-navigate', { id });
}

(function watchNavigation() {
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) {
      const r = original.apply(this, args);
      queueMicrotask(onNavigate);
      return r;
    };
  }
  window.addEventListener('popstate', onNavigate);
  // Belt and braces: some transitions only show up as a title/DOM change.
  new MutationObserver(onNavigate).observe(document.head, { childList: true, subtree: true });
})();

// ---------- Progress reporting back to the popup ----------
function progress(text) {
  chrome.runtime.sendMessage({ type: 'PROGRESS', text }).catch(() => {});
}

// ---------- Import ----------

// One auto-send per import click, keyed by chat id. Guards against a
// double-click or a retried message producing two submissions.
const autoSent = new Set();

async function doImport(chat, mode) {
  if (mode === 'auto-brief') return doAutoBriefImport(chat);

  let composed = composeImport(chat, mode);
  note('import:plan', { requested: mode, effective: composed.effectiveMode, attach: !!composed.attach });

  if (composed.attach) {
    const ok = await attachFile(composed.attach.filename, composed.attach.content);
    if (!ok) composed = fallbackToPaste(composed, chat);
  }
  insertText(composed.text);
  return { ok: true, method: composed.effectiveMode, reason: composed.reason };
}

/**
 * Import a chat that has no brief: attach the transcript and ask THIS chat to
 * write the handoff brief. The old account never spends usage on a brief.
 */
async function doAutoBriefImport(chat) {
  const settings = await getSettings();

  // Never clobber something the user typed themselves.
  const typed = editorText().trim();
  if (typed) {
    return {
      ok: false,
      error: 'The message box already has text in it. Clear it, then click Import again.'
    };
  }

  let composed = composeAutoBrief(chat);
  note('import:auto-brief:plan', { requiresAttach: composed.requiresAttach });

  progress('Attaching the transcript…');
  let attached = await attachFile(composed.attach.filename, composed.attach.content);

  if (!attached) {
    if (composed.requiresAttach) {
      const fb = autoBriefPasteFallback(chat);
      note('import:auto-brief:attach-failed-too-big');
      return { ok: false, error: fb.reason };
    }
    composed = autoBriefPasteFallback(chat);
    note('import:auto-brief:paste-fallback');
  }

  progress('Writing the instruction…');
  insertText(composed.text);

  // Verification: either the chip showed up, or the text really landed.
  const inserted = editorText().includes('handoff brief');
  const verified = attached || inserted;
  if (!verified) {
    note('import:auto-brief:unverified');
    return {
      ok: false,
      error: 'Could not confirm the transcript or instruction reached the message box. ' +
             'Nothing was sent — check the draft and press send yourself.'
    };
  }

  if (!settings.autoSendOnImport) {
    return {
      ok: true, method: composed.effectiveMode, sent: false,
      reason: (composed.reason || '') + ' Auto-send is off — review it and press send.'
    };
  }

  if (autoSent.has(chat.id)) {
    return {
      ok: true, method: composed.effectiveMode, sent: false,
      reason: 'Already auto-sent this chat in this tab — the draft is ready, press send if you want it again.'
    };
  }
  autoSent.add(chat.id);

  const before = findMessages().nodes.length;
  progress('Sending…');
  if (!(await submit())) {
    autoSent.delete(chat.id);
    return {
      ok: false,
      error: 'Could not submit the message. The draft is still there — press Enter in the chat.'
    };
  }

  if (!settings.captureBriefOnImport) {
    return { ok: true, method: composed.effectiveMode, sent: true, reason: composed.reason };
  }

  // Capture the brief Claude writes and store it onto the saved entry, so the
  // next import of this chat can default to "Brief + file".
  try {
    progress('Waiting for the handoff brief…');
    const brief = await awaitReplyMarkdown(before, progress);
    await chrome.runtime.sendMessage({
      type: 'SAVE_BRIEF', id: chat.id, brief, briefMethod: 'claude-import'
    });
    note('import:auto-brief:captured', { chars: brief.length });
    return {
      ok: true, method: composed.effectiveMode, sent: true, briefCaptured: true,
      reason: composed.reason
    };
  } catch (e) {
    note('import:auto-brief:capture-failed', { message: e.message });
    return {
      ok: true, method: composed.effectiveMode, sent: true, briefCaptured: false,
      reason: 'Sent, but the brief could not be captured back automatically: ' + e.message
    };
  }
}

// ---------- Limit banner watch (old account) ----------
// A banner is the second trigger signal, independent of the usage page.
let bannerReported = null;

function checkLimitBanner() {
  try {
    const hit = findLimitBanner(document);
    if (!hit) return;
    const key = hit.kind + '|' + hit.phrase;
    if (bannerReported === key) return;      // one report per distinct banner
    bannerReported = key;
    note('limit-banner', { kind: hit.kind, selector: hit.selector });
    chrome.runtime
      .sendMessage({ type: 'LIMIT_BANNER', banner: { kind: hit.kind, phrase: hit.phrase } })
      .catch(() => {});
  } catch (e) {
    note('limit-banner:error', { message: e.message });
  }
}

(function watchForLimitBanner() {
  try {
    const observer = new MutationObserver(() => {
      clearTimeout(watchForLimitBanner.timer);
      watchForLimitBanner.timer = setTimeout(checkLimitBanner, 500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    checkLimitBanner();
  } catch (e) {
    note('limit-banner:watch-failed', { message: e.message });
  }
})();

// ---------- Message handling ----------
const HANDLERS = {
  PING: async () => ({ ok: true, id: conversationId() }),

  SET_DEBUG: async msg => { setDebug(msg.enabled); return { ok: true }; },

  DEBUG_REPORT: async () => ({ ok: true, snapshot: debugSnapshot(), log: report() }),

  EXTRACT: async msg => ({ ok: true, chat: await extractChat({ scroll: msg.scroll !== false }) }),

  EXTRACT_WITH_BRIEF: async () => {
    const brief = await requestBriefInChat(progress);
    progress('Reading the conversation…');
    const chat = await extractChat();
    // The brief prompt and its reply are turns in this chat now. Drop them
    // from the saved transcript so the brief is not duplicated inside it —
    // but only if they are actually the last two turns, so a mis-detection
    // never silently eats real conversation.
    const tail = chat.messages.slice(-2);
    const looksLikeBriefExchange =
      tail.length === 2 &&
      tail[0].role === 'user' &&
      tail[1].role === 'assistant' &&
      tail[0].content.includes('HANDOFF BRIEF');
    if (looksLikeBriefExchange) {
      chat.messages = chat.messages.slice(0, -2);
      chat.messageCount = chat.messages.length;
      chat.markdown = renderAgain(chat);
    }
    note('brief:trimmed', { trimmed: looksLikeBriefExchange });
    chat.brief = brief;
    return { ok: true, chat };
  },

  IMPORT: async msg => doImport(msg.chat, msg.mode)
};

function renderAgain(chat) {
  return (
    '# ' + chat.title + '\n\n' +
    chat.messages
      .map(m => (m.role === 'user' ? '## User\n\n' : '## Claude\n\n') + m.content)
      .join('\n\n---\n\n')
  );
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg && msg.type];
  if (!handler) return false;
  handler(msg)
    .then(sendResponse)
    .catch(e => {
      note('error', { type: msg.type, message: e.message });
      sendResponse({ ok: false, error: e.message });
    });
  return true; // async response
});

note('content-script-ready', { id: currentId });
