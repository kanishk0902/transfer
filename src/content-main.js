import { extractChat, debugSnapshot } from './extract.js';
import { requestBriefInChat } from './brief.js';
import { composeImport, fallbackToPaste } from './compose.js';
import { insertText, attachFile } from './importer.js';
import { setDebug, note, report } from './debug.js';
import { conversationId } from './site.js';

// ---------- SPA navigation ----------
// claude.ai swaps chats without a reload, so cached state must be invalidated
// whenever the conversation id in the URL changes.
let currentId = conversationId();

function onNavigate() {
  const id = conversationId();
  if (id === currentId) return;
  currentId = id;
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
async function doImport(chat, mode) {
  let composed = composeImport(chat, mode);
  note('import:plan', { requested: mode, effective: composed.effectiveMode, attach: !!composed.attach });

  if (composed.attach) {
    const ok = await attachFile(composed.attach.filename, composed.attach.content);
    if (!ok) composed = fallbackToPaste(composed, chat);
  }
  insertText(composed.text);
  return { ok: true, method: composed.effectiveMode, reason: composed.reason };
}

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
    // The brief prompt and reply are part of this chat now; keep them out of
    // the saved transcript so the brief is not duplicated inside it.
    chat.messages = chat.messages.slice(0, -2);
    chat.messageCount = chat.messages.length;
    chat.markdown = renderAgain(chat);
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
