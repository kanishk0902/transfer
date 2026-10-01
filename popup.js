import {
  getChats, setChats, saveChat, removeChat, mergeChats,
  getSettings, setSettings, searchChats, byDate, byTitle
} from './src/storage.js';

const $ = s => document.querySelector(s);
let settings = null;
let pendingDelete = null;

// ---------- status ----------
function status(text, cls = '') {
  const el = $('#status');
  el.textContent = text;
  el.className = cls;
}

// Live progress from the content script while the brief is being generated.
chrome.runtime.onMessage.addListener(msg => {
  if (msg && msg.type === 'PROGRESS') status(msg.text, 'busy');
});

// ---------- talking to the page ----------
async function claudeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.startsWith('https://claude.ai/')) {
    throw new Error('Open a claude.ai tab first.');
  }
  return tab;
}

async function send(msg) {
  const tab = await claudeTab();
  let res;
  try {
    res = await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    throw new Error('Could not reach the page. Reload the claude.ai tab, then try again.');
  }
  if (!res) throw new Error('No response from the page. Reload the tab and try again.');
  if (!res.ok) throw new Error(res.error || 'Something went wrong.');
  return res;
}

async function sendBackground(msg) {
  const res = await chrome.runtime.sendMessage(msg);
  if (!res) throw new Error('No response from the extension background.');
  if (!res.ok) throw new Error(res.error || 'Something went wrong.');
  return res;
}

// ---------- saving ----------
async function afterSave(chat, note) {
  await saveChat(chat);
  let extra = '';
  if (settings.driveEnabled) {
    try {
      const { fileId } = await sendBackground({ type: 'DRIVE_UPLOAD', chat });
      await saveChat({ ...chat, driveFileId: fileId });
      extra = ' Synced to Drive.';
    } catch (e) {
      extra = ' (Drive sync failed: ' + e.message + ')';
    }
  }
  status(`Saved "${chat.title}" — ${chat.messageCount} messages.${note || ''}${extra}`, 'ok');
  await render();
}

async function doSave({ withBrief }) {
  setBusy(true);
  try {
    if (!withBrief) {
      status('Reading the conversation…', 'busy');
      const { chat } = await send({ type: 'EXTRACT' });
      return await afterSave(chat, '');
    }

    if (settings.briefMode === 'api') {
      status('Reading the conversation…', 'busy');
      const { chat } = await send({ type: 'EXTRACT' });
      status('Asking the Anthropic API for a brief…', 'busy');
      const { brief } = await sendBackground({
        type: 'API_BRIEF', transcript: chat.markdown, title: chat.title
      });
      return await afterSave({ ...chat, brief }, ' Brief generated via API.');
    }

    // Default: ask the open chat itself. Progress arrives via PROGRESS messages.
    status('Asking Claude for a handoff brief…', 'busy');
    const { chat } = await send({ type: 'EXTRACT_WITH_BRIEF' });
    return await afterSave(chat, ' Brief captured from the chat.');
  } catch (e) {
    status(e.message, 'err');
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  for (const id of ['#save', '#saveBrief', '#sync']) $(id).disabled = busy;
}

// ---------- importing ----------
async function doImport(chat, mode) {
  setBusy(true);
  try {
    status('Preparing the new chat…', 'busy');
    const res = await send({ type: 'IMPORT', chat, mode });
    const how = {
      'brief': 'Brief inserted.',
      'brief+file': 'Brief inserted and transcript attached.',
      'brief+paste': 'Brief and transcript pasted.',
      'full': 'Full transcript pasted.'
    }[res.method] || 'Inserted.';
    status(how + (res.reason ? ' ' + res.reason : '') + ' Review it, then press send.', 'ok');
  } catch (e) {
    status(e.message, 'err');
  } finally {
    setBusy(false);
  }
}

function download(chat) {
  const blob = new Blob([chat.markdown || ''], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (chat.title || 'chat').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.md';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- Drive ----------
async function syncFromDrive() {
  setBusy(true);
  try {
    status('Fetching chats from Drive…', 'busy');
    const { chats: remote } = await sendBackground({ type: 'DRIVE_LIST' });
    const merged = mergeChats(await getChats(), remote);
    await setChats(merged);
    status(`Synced. ${remote.length} chat${remote.length === 1 ? '' : 's'} in Drive, ${merged.length} total locally.`, 'ok');
    await render();
  } catch (e) {
    status(e.message, 'err');
  } finally {
    setBusy(false);
  }
}

// ---------- rendering ----------
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const k of kids) n.append(k);
  return n;
}

function btn(label, onClick, cls = '') {
  const b = el('button', { textContent: label, className: 'small ' + cls });
  b.addEventListener('click', onClick);
  return b;
}

function briefPreview(brief) {
  const text = brief.replace(/\s*\n\s*/g, '\n').trim();
  const d = el('details');
  d.append(el('summary', { textContent: 'Handoff brief' }));
  d.append(el('div', { className: 'brief', textContent: text }));
  return d;
}

function chatCard(chat) {
  const box = el('div', { className: 'chat' });

  const title = el('div', { className: 't' }, el('span', { textContent: chat.title || 'Untitled' }));
  const badges = [];
  if (chat.brief) badges.push('brief');
  if (chat.driveFileId) badges.push('▲ Drive');
  if (badges.length) title.append(el('span', { className: 'badges', textContent: badges.join(' · ') }));
  box.append(title);

  const meta = [
    `${chat.messageCount || 0} messages`,
    new Date(chat.savedAt).toLocaleString(),
    chat.account
  ].filter(Boolean).join(' · ');
  box.append(el('div', { className: 'm', textContent: meta }));

  if (chat.brief) box.append(briefPreview(chat.brief));

  const row = el('div', { className: 'row' });
  const mode = el('select');
  for (const [v, label] of [
    ['brief+file', 'Brief + file'],
    ['brief', 'Brief only'],
    ['full', 'Full transcript']
  ]) mode.append(el('option', { value: v, textContent: label }));
  if (!chat.brief) { mode.value = 'full'; mode.querySelector('option[value=brief]').disabled = true; }

  row.append(
    btn('Import', () => doImport(chat, mode.value), 'primary'),
    mode,
    btn('Download', () => download(chat))
  );

  if (pendingDelete === chat.id) {
    const confirm = el('div', { className: 'confirm' }, el('span', { textContent: 'Delete this chat?' }));
    confirm.append(
      btn('Yes, delete', async () => {
        await removeChat(chat.id);
        pendingDelete = null;
        status('Deleted. (The Drive copy, if any, is untouched.)', 'ok');
        render();
      }, 'danger'),
      btn('Cancel', () => { pendingDelete = null; render(); })
    );
    row.append(confirm);
  } else {
    row.append(btn('Delete', () => { pendingDelete = chat.id; render(); }, 'danger'));
  }

  box.append(row);
  return box;
}

async function render() {
  const list = $('#list');
  list.textContent = '';
  const all = await getChats();

  if (!all.length) {
    list.append(el('div', { className: 'empty', textContent:
      'Nothing saved yet. Open a chat in claude.ai and click "Save with handoff brief".' }));
    return;
  }

  const shown = searchChats(all, $('#search').value)
    .slice()
    .sort($('#sort').value === 'title' ? byTitle : byDate);

  if (!shown.length) {
    list.append(el('div', { className: 'empty', textContent: 'No saved chats match that search.' }));
    return;
  }
  for (const chat of shown) list.append(chatCard(chat));
}

// ---------- debug ----------
async function toggleDebug(on) {
  settings = await setSettings({ debug: on });
  $('#copyDebug').hidden = !on;
  try { await send({ type: 'SET_DEBUG', enabled: on }); } catch { /* tab may not be claude.ai */ }
  status(on ? 'Debug on. Open DevTools on the claude.ai tab to see logs.' : 'Debug off.', '');
}

async function copyDebugReport() {
  try {
    const res = await send({ type: 'DEBUG_REPORT' });
    const text = JSON.stringify({ snapshot: res.snapshot, log: res.log }, null, 2);
    await navigator.clipboard.writeText(text);
    status('Debug report copied. Paste it into a bug report.', 'ok');
  } catch (e) {
    status(e.message, 'err');
  }
}

// ---------- wiring ----------
async function init() {
  settings = await getSettings();
  $('#sort').value = settings.sort || 'savedAt';
  $('#debug').checked = !!settings.debug;
  $('#copyDebug').hidden = !settings.debug;
  $('#sync').hidden = !settings.driveEnabled;
  if (settings.debug) { try { await send({ type: 'SET_DEBUG', enabled: true }); } catch {} }

  $('#saveBrief').addEventListener('click', () => doSave({ withBrief: true }));
  $('#save').addEventListener('click', () => doSave({ withBrief: false }));
  $('#sync').addEventListener('click', syncFromDrive);
  $('#search').addEventListener('input', render);
  $('#sort').addEventListener('change', async () => {
    settings = await setSettings({ sort: $('#sort').value });
    render();
  });
  $('#debug').addEventListener('change', e => toggleDebug(e.target.checked));
  $('#copyDebug').addEventListener('click', copyDebugReport);
  $('#options').addEventListener('click', () => chrome.runtime.openOptionsPage());

  await render();
}

init();
