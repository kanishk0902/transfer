// Google Drive sync. Off by default. Uses drive.file scope, so this extension
// can only ever see files it created itself.

const FOLDER_NAME = 'Claude Chat Transfer';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export const SCOPES = {
  'drive.file': ['https://www.googleapis.com/auth/drive.file'],
  appDataFolder: ['https://www.googleapis.com/auth/drive.appdata']
};

function getToken(interactive, scopes) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive, scopes }, token => {
      const err = chrome.runtime.lastError;
      if (err || !token) reject(new Error(err ? err.message : 'No token returned.'));
      else resolve(token);
    });
  });
}

function dropToken(token) {
  return new Promise(resolve => chrome.identity.removeCachedAuthToken({ token }, resolve));
}

/**
 * Call Drive with the cached token. On 401/403 the token is dropped and the
 * call is retried exactly once — this covers ordinary expiry. A second failure
 * means access was revoked, and the user has to re-authorise.
 */
async function driveFetch(url, options = {}, { scopes, interactive = false, _retried = false } = {}) {
  let token;
  try {
    token = await getToken(interactive, scopes);
  } catch (e) {
    throw new Error(
      interactive
        ? 'Google sign-in failed or was cancelled: ' + e.message
        : 'Not connected to Google Drive. Click "Connect Drive" in options.'
    );
  }

  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: { Authorization: 'Bearer ' + token, ...(options.headers || {}) }
    });
  } catch {
    throw new Error('Network error talking to Google Drive. Check your connection.');
  }

  if ((res.status === 401 || res.status === 403) && !_retried) {
    await dropToken(token);
    return driveFetch(url, options, { scopes, interactive, _retried: true });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new Error('Google Drive access was denied or revoked. Reconnect in options.');
    }
    throw new Error(`Drive error ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function connect(scopeName = 'drive.file') {
  const scopes = SCOPES[scopeName];
  await getToken(true, scopes);
  return true;
}

export async function disconnect() {
  try {
    const token = await getToken(false, undefined);
    // Revoke at Google first, then drop the local cache, so a later connect
    // shows the consent screen again instead of silently reusing the grant.
    await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), {
      method: 'POST'
    }).catch(() => {});
    await dropToken(token);
  } catch { /* already disconnected */ }
  return true;
}

function spaceParams(scopeName) {
  return scopeName === 'appDataFolder'
    ? { spaces: 'appDataFolder', parents: ['appDataFolder'] }
    : { spaces: 'drive', parents: null };
}

/** Find or create the destination folder. appDataFolder needs no folder. */
async function ensureFolder(ctx) {
  if (ctx.scopeName === 'appDataFolder') return 'appDataFolder';
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const found = await driveFetch(`${API}/files?q=${q}&fields=files(id,name)`, {}, ctx);
  if (found.files && found.files.length) return found.files[0].id;

  const created = await driveFetch(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
  }, ctx);
  return created.id;
}

function fileNameFor(chat) {
  const slug = (chat.title || 'chat').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 50) || 'chat';
  const date = (chat.savedAt || new Date().toISOString()).slice(0, 10);
  return `claude-chat_${slug}_${date}.json`;
}

function ctxFor(scopeName) {
  return { scopes: SCOPES[scopeName] || SCOPES['drive.file'], scopeName, interactive: false };
}

/** Upload or update one chat. Re-saving the same chat id updates its file. */
export async function uploadChat(chat, scopeName = 'drive.file') {
  const ctx = ctxFor(scopeName);
  const folderId = await ensureFolder(ctx);
  const body = JSON.stringify(chat, null, 2);
  const existingId = chat.driveFileId || (await findByChatId(chat.id, ctx, folderId));

  const metadata = {
    name: fileNameFor(chat),
    mimeType: 'application/json',
    // appProperties let us re-find the file by chat id across devices.
    appProperties: { chatId: String(chat.id) }
  };
  if (!existingId) {
    metadata.parents = [folderId];
  }

  const boundary = 'cct' + Math.random().toString(36).slice(2);
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
    body +
    `\r\n--${boundary}--`;

  const url = existingId
    ? `${UPLOAD}/files/${existingId}?uploadType=multipart&fields=id`
    : `${UPLOAD}/files?uploadType=multipart&fields=id`;

  const result = await driveFetch(url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart
  }, ctx);

  return result.id;
}

async function findByChatId(chatId, ctx, folderId) {
  const parent = ctx.scopeName === 'appDataFolder' ? 'appDataFolder' : folderId;
  const q = encodeURIComponent(`appProperties has { key='chatId' and value='${chatId}' } and trashed=false and '${parent}' in parents`);
  const spaces = ctx.scopeName === 'appDataFolder' ? '&spaces=appDataFolder' : '';
  const res = await driveFetch(`${API}/files?q=${q}&fields=files(id)${spaces}`, {}, ctx);
  return res.files && res.files.length ? res.files[0].id : null;
}

/** Download every chat JSON this extension has stored in Drive. */
export async function listChats(scopeName = 'drive.file') {
  const ctx = ctxFor(scopeName);
  const folderId = await ensureFolder(ctx);
  const parent = ctx.scopeName === 'appDataFolder' ? 'appDataFolder' : folderId;
  const q = encodeURIComponent(`'${parent}' in parents and trashed=false and mimeType='application/json'`);
  const spaces = ctx.scopeName === 'appDataFolder' ? '&spaces=appDataFolder' : '';
  const res = await driveFetch(`${API}/files?q=${q}&fields=files(id,name)&pageSize=200${spaces}`, {}, ctx);

  const chats = [];
  for (const file of res.files || []) {
    try {
      const data = await driveFetch(`${API}/files/${file.id}?alt=media`, {}, ctx);
      if (data && data.id) chats.push({ ...data, driveFileId: file.id });
    } catch { /* skip unreadable files rather than failing the whole sync */ }
  }
  return chats;
}
