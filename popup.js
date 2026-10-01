const $ = s => document.querySelector(s);
function status(text, cls) { const el = $('#status'); el.textContent = text; el.className = cls || ''; }
async function claudeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.startsWith('https://claude.ai/')) throw new Error('Open a claude.ai tab first.');
  return tab;
}
async function send(msg) {
  const tab = await claudeTab();
  let res;
  try { res = await chrome.tabs.sendMessage(tab.id, msg); }
  catch { throw new Error('Refresh the claude.ai tab, then try again.'); }
  if (!res || !res.ok) throw new Error((res && res.error) || 'Something went wrong.');
  return res;
}
