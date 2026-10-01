// Thin loader: MV3 content scripts cannot be ES modules, so the real code is
// loaded as a module from web-accessible resources.
(async () => {
  try {
    await import(chrome.runtime.getURL('src/content-main.js'));
  } catch (e) {
    console.error('[chat-transfer] failed to load:', e);
  }
})();
