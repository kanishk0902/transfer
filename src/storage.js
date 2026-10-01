// chrome.storage.local is the source of truth. Pure merge logic lives here so
// it can be unit-tested without a browser.

export const KEYS = { chats: 'chats', settings: 'settings' };

export const DEFAULT_SETTINGS = {
  debug: false,
  briefMode: 'chat',          // 'chat' (default, no key) | 'api' | 'none'
  apiKey: '',
  apiModel: 'claude-sonnet-5',
  driveEnabled: false,
  driveScope: 'drive.file',   // 'drive.file' | 'appDataFolder'
  sort: 'savedAt'
};

/**
 * Merge two chat lists, deduping by id with newest-savedAt winning.
 * Drive-only fields on the loser are preserved so a stale local copy does not
 * drop the driveFileId learned from a sync.
 */
export function mergeChats(local = [], incoming = []) {
  const byId = new Map();
  for (const chat of [...local, ...incoming]) {
    if (!chat || !chat.id) continue;
    const existing = byId.get(chat.id);
    if (!existing) { byId.set(chat.id, { ...chat }); continue; }
    const winner = newer(chat, existing) ? chat : existing;
    const loser = winner === chat ? existing : chat;
    // Spreading loser-then-winner keeps fields the winner is missing; the
    // explicit lines below cover fields the winner has but left empty.
    const merged = { ...loser, ...winner };
    for (const key of ['driveFileId', 'brief']) {
      const value = winner[key] || loser[key];
      if (value) merged[key] = value; else delete merged[key];
    }
    byId.set(chat.id, merged);
  }
  return Array.from(byId.values()).sort(byDate);
}

function newer(a, b) {
  return Date.parse(a.savedAt || 0) >= Date.parse(b.savedAt || 0);
}

export function byDate(a, b) {
  return Date.parse(b.savedAt || 0) - Date.parse(a.savedAt || 0);
}

export function byTitle(a, b) {
  return String(a.title || '').localeCompare(String(b.title || ''));
}

export function searchChats(chats, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return chats;
  return chats.filter(c =>
    String(c.title || '').toLowerCase().includes(q) ||
    String(c.brief || '').toLowerCase().includes(q) ||
    String(c.account || '').toLowerCase().includes(q)
  );
}

// ---- chrome.storage wrappers (no-ops outside the extension) ----

export async function getChats() {
  const { [KEYS.chats]: chats = [] } = await chrome.storage.local.get(KEYS.chats);
  return chats;
}

export async function setChats(chats) {
  await chrome.storage.local.set({ [KEYS.chats]: chats });
}

export async function saveChat(chat) {
  const chats = mergeChats(await getChats(), [chat]);
  await setChats(chats);
  return chats;
}

export async function removeChat(id) {
  const chats = (await getChats()).filter(c => c.id !== id);
  await setChats(chats);
  return chats;
}

export async function getSettings() {
  const { [KEYS.settings]: s = {} } = await chrome.storage.local.get(KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [KEYS.settings]: next });
  return next;
}
