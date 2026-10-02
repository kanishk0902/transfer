// Runs only on https://claude.ai/settings/usage, in the background tab the
// service worker opens. Reads the usage meters and reports them back.
// MV3 content scripts cannot be modules, so the parser is imported dynamically.
(async () => {
  const report = payload => {
    try { chrome.runtime.sendMessage({ type: 'USAGE_READING', ...payload }); } catch { /* worker gone */ }
  };

  try {
    const { parseUsage } = await import(chrome.runtime.getURL('src/usage.js'));

    // The meters render after hydration; retry briefly before giving up.
    let reading = null;
    for (let i = 0; i < 20; i++) {
      reading = parseUsage(document, location.href);
      if (reading.loggedOut || reading.percent !== null) break;
      await new Promise(r => setTimeout(r, 300));
    }

    report({ ok: true, reading, readAt: new Date().toISOString() });
  } catch (e) {
    report({ ok: false, error: String((e && e.message) || e) });
  }
})();
