import { getSettings, setSettings, getLastUsage } from './src/storage.js';
import { clampThreshold } from './src/trigger.js';

const $ = s => document.querySelector(s);
function status(text, cls = '') { const el = $('#status'); el.textContent = text; el.className = cls; }

function syncVisibility() {
  $('#apiFields').hidden = $('#briefMode').value !== 'api';
}

async function save(patch) {
  await setSettings(patch);
  status('Saved.', 'ok');
}

async function sendBg(msg) {
  const res = await chrome.runtime.sendMessage(msg);
  if (!res) throw new Error('No response from the extension background.');
  return res;
}

async function showUsage() {
  const el = $('#usageNow');
  try {
    const u = await getLastUsage();
    if (!u) { el.textContent = 'Usage: not checked yet.'; return; }
    if (u.loggedOut) { el.textContent = 'Usage: not signed in to claude.ai.'; return; }
    if (!Number.isFinite(u.percent)) {
      el.textContent = 'Usage: could not read a percentage from the usage page. ' +
        'See "Tuning the usage selectors" in the README.';
      return;
    }
    const bars = (u.bars || [])
      .map(b => `${b.label || 'unlabelled'}: ${b.percent}%`).join(' · ');
    el.textContent = `Usage: ${u.percent}%${u.label ? ' (' + u.label + ')' : ''} — read ` +
      new Date(u.readAt).toLocaleString() + (bars ? ' — all bars: ' + bars : '');
  } catch (e) {
    el.textContent = 'Usage: ' + e.message;
  }
}

async function init() {
  const s = await getSettings();
  $('#autoSaveEnabled').checked = s.autoSaveEnabled;
  $('#usagePollEnabled').checked = s.usagePollEnabled;
  $('#autoSaveThreshold').value = clampThreshold(s.autoSaveThreshold);
  $('#thresholdValue').textContent = clampThreshold(s.autoSaveThreshold);
  $('#autoSendOnImport').checked = s.autoSendOnImport;
  $('#captureBriefOnImport').checked = s.captureBriefOnImport;
  await showUsage();
  $('#briefMode').value = s.briefMode;
  $('#apiKey').value = s.apiKey || '';
  $('#apiModel').value = s.apiModel;
  $('#driveEnabled').checked = s.driveEnabled;
  $('#driveScope').value = s.driveScope;
  $('#debug').checked = s.debug;
  syncVisibility();

  $('#briefMode').addEventListener('change', e => { syncVisibility(); save({ briefMode: e.target.value }); });
  $('#apiKey').addEventListener('change', e => save({ apiKey: e.target.value.trim() }));
  $('#apiModel').addEventListener('change', e => save({ apiModel: e.target.value }));
  $('#driveEnabled').addEventListener('change', e => save({ driveEnabled: e.target.checked }));
  $('#driveScope').addEventListener('change', e => save({ driveScope: e.target.value }));
  $('#debug').addEventListener('change', e => save({ debug: e.target.checked }));

  $('#autoSaveEnabled').addEventListener('change', e => save({ autoSaveEnabled: e.target.checked }));
  $('#autoSendOnImport').addEventListener('change', e => save({ autoSendOnImport: e.target.checked }));
  $('#captureBriefOnImport').addEventListener('change', e => save({ captureBriefOnImport: e.target.checked }));

  $('#usagePollEnabled').addEventListener('change', async e => {
    await save({ usagePollEnabled: e.target.checked });
    // Re-arm or clear the alarm immediately rather than at the next tick.
    try { await sendBg({ type: 'RESCHEDULE' }); } catch { /* worker will catch up */ }
  });

  $('#autoSaveThreshold').addEventListener('input', e => {
    $('#thresholdValue').textContent = clampThreshold(e.target.value);
  });
  $('#autoSaveThreshold').addEventListener('change', e =>
    save({ autoSaveThreshold: clampThreshold(e.target.value) }));

  $('#testAutoSave').addEventListener('click', async () => {
    status('Saving the current chat…', 'busy');
    try {
      const res = await sendBg({ type: 'TEST_AUTOSAVE' });
      if (res.ok && res.skipped) {
        status('Nothing to do — that chat is already auto-saved at the same message count.', 'ok');
      } else if (res.ok) {
        status(`Saved "${res.chat.title}" — ${res.chat.messageCount} messages. ` +
               'No message was sent and no brief was generated.', 'ok');
      } else if (res.error === 'no-chat-tab') {
        status('Open a claude.ai chat tab (a /chat/ URL) first, then try again.', 'err');
      } else {
        status(res.error || 'Auto-save failed.', 'err');
      }
    } catch (e) {
      status(e.message, 'err');
    }
  });

  $('#checkUsage').addEventListener('click', async () => {
    status('Opening the usage page in a background tab…', 'busy');
    try {
      const res = await sendBg({ type: 'CHECK_USAGE_NOW' });
      await showUsage();
      if (res.skipped === 'logged-out') status('Not signed in to claude.ai.', 'err');
      else if (!res.ok) status('Could not read usage: ' + (res.error || 'unknown'), 'err');
      else status('Usage checked.', 'ok');
    } catch (e) {
      status(e.message, 'err');
    }
  });

  $('#connect').addEventListener('click', async () => {
    status('Opening Google sign-in…', 'busy');
    const scopeName = $('#driveScope').value;
    const res = await chrome.runtime.sendMessage({ type: 'DRIVE_CONNECT', scopeName });
    if (res && res.ok) {
      await setSettings({ driveEnabled: true });
      $('#driveEnabled').checked = true;
      status('Connected to Google Drive.', 'ok');
    } else {
      status((res && res.error) || 'Could not connect.', 'err');
    }
  });

  $('#disconnect').addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: 'DRIVE_DISCONNECT' });
    await setSettings({ driveEnabled: false });
    $('#driveEnabled').checked = false;
    status(res && res.ok ? 'Disconnected.' : 'Disconnected locally.', 'ok');
  });
}

init();
