// Service worker: anything that must not run in the page — Drive calls and the
// optional Anthropic API call.
import { uploadChat, listChats, connect, disconnect } from './src/drive.js';
import { generateBrief } from './src/api-brief.js';
import { getSettings } from './src/storage.js';

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
  }
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg && msg.type];
  if (!handler) return false;
  handler(msg)
    .then(sendResponse)
    .catch(e => sendResponse({ ok: false, error: e.message }));
  return true;
});
