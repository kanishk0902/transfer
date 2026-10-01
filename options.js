import { getSettings, setSettings } from './src/storage.js';

const $ = s => document.querySelector(s);
function status(text, cls = '') { const el = $('#status'); el.textContent = text; el.className = cls; }

function syncVisibility() {
  $('#apiFields').hidden = $('#briefMode').value !== 'api';
}

async function save(patch) {
  await setSettings(patch);
  status('Saved.', 'ok');
}

async function init() {
  const s = await getSettings();
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
