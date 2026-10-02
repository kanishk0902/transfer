# Manual test checklist

The 91 automated tests (`npm test`) cover the pure logic: usage parsing, trigger
decisions, compose wording, markdown, storage merges. They cannot cover Chrome APIs,
real claude.ai markup, or timing. This is the list for that.

Run `npm test && npm run check` first — if either fails, stop.

Reload the extension at `chrome://extensions` after every code change, and reload the
claude.ai tab too (content scripts do not hot-reload).

---

## 0. Setup

- [ ] `npm test` — 91 passing.
- [ ] `npm run check` — parses, manifest valid, permissions present.
- [ ] Load unpacked, no errors on the card.
- [ ] Click **service worker** on the extension card — console is clean.
- [ ] Chrome asked for / shows the **notifications** permission.

## 1. Existing manual features still work (regression)

Nothing below should have changed. Any difference is a bug.

- [ ] **Save transcript only** on a real chat → correct title, plausible message count,
      no message typed into the chat.
- [ ] **Save with handoff brief** → prompt typed, submitted, reply captured, brief shown
      in the popup, and the brief exchange is *not* duplicated inside the transcript.
- [ ] Import **Brief + file** → brief inline, `.md` chip appears, nothing auto-sent.
- [ ] Import **Brief only** → no attachment, nothing auto-sent.
- [ ] Import **Full transcript** → everything inline, nothing auto-sent.
- [ ] Search, sort, Download, Delete (with its confirm step) all behave as before.
- [ ] Drive sync, if configured: connect, upload, **Sync from Drive**.
- [ ] Options: brief mode, API key field, Drive scope — all still save.

## 2. Usage monitor

- [ ] Options → **Check usage now** → a background tab flashes open and closes, and the
      reading appears ("Usage: 42% (Weekly limit) — read …").
- [ ] **Focus is never stolen**: type in another tab while it runs; your caret stays put.
- [ ] The monitor tab is **always closed** — check for orphans after several runs.
- [ ] The percentage matches what `claude.ai/settings/usage` shows by eye.
- [ ] With several meters, the number shown is the **highest**, and the options page
      lists every bar with its own label.
- [ ] Popup shows the same reading.
- [ ] `chrome.storage.local` holds `lastUsage` with `percent`, `label`, `readAt`,
      `bars`, `rawText`, `matchedSelector`. (DevTools → Application → Storage.)

### Cadence

- [ ] With usage low: `chrome.alarms` shows `usage-monitor` at a **5 minute** period.
      (Service worker console: `await chrome.alarms.get('usage-monitor')`.)
- [ ] With a reading of 85%+: the period becomes **1 minute**.
- [ ] Options → turn **Check usage periodically** off → the alarm is cleared.
- [ ] Turn it back on → the alarm returns without needing a browser restart.

### Politeness

- [ ] Close **every** claude.ai tab, wait for a tick → **no** monitor tab opens.
- [ ] Open one claude.ai tab → the next tick reads usage again.

### Logged out

- [ ] Sign out of claude.ai, then **Check usage now** → "not signed in to claude.ai".
- [ ] It is **not** reported as 0%, and no save is triggered.
- [ ] The monitor tab still closed.

## 3. Auto-save trigger

The cheap way to test the save without burning real usage: set the threshold to **50%**
(or lower than your current usage) and wait for a tick.

- [ ] Options → **Test auto-save now** with a `/chat/` tab open → saves, and the popup
      shows an `auto @ …%` badge on the entry.
- [ ] **Nothing was typed into the chat** and **no brief was generated** — this is the
      critical one. The chat in account A must be untouched.
- [ ] The notification appears with the right title and message count.
- [ ] Threshold at 50% → a real tick fires the save on its own.
- [ ] Threshold slider shows its value live and persists across a reopen.
- [ ] **Test auto-save now** with no claude.ai tab → clear "open a claude.ai chat tab"
      message, no crash.
- [ ] With a claude.ai tab open but **not** on `/chat/` → notification says nothing could
      be saved.
- [ ] Auto-save **off** → a tick above the threshold saves nothing.

### Overwrite and de-duplication

- [ ] Auto-save the same chat twice without sending new messages → the second is
      **skipped** ("already auto-saved at the same message count").
- [ ] Send a message in the chat, auto-save again → it saves, and there is still exactly
      **one** entry for that chat, with the new count.
- [ ] A chat that already had a brief: auto-save it → the **brief survives**, the
      transcript updates.
- [ ] After a fire, a second tick still above the threshold does **not** fire again.
- [ ] Set the threshold above your usage so a reading lands below 80%, then back down →
      it can fire again (re-armed).

### Banner trigger

Hard to produce on demand. To test the path without hitting a real limit, temporarily add
a phrase you can trigger, e.g. add `'test banner phrase'` to `LIMIT_PHRASES.approaching`
in `src/site.js`, reload, then in the claude.ai tab console:

```js
const d = document.createElement('div');
d.setAttribute('role', 'alert');
d.textContent = 'test banner phrase';
document.body.appendChild(d);
```

- [ ] The save fires from the banner alone, with usage well below the threshold.
- [ ] Adding the same banner again does **not** fire a second time.
- [ ] Remove the test phrase from `site.js` afterwards.

## 4. Auto-brief on import (account B)

- [ ] A chat saved by auto-save (so: no brief) defaults to **"Ask this chat for the
      brief"** in the dropdown.
- [ ] Import it into a **new, empty** chat in account B → the `.md` chip appears, the
      instruction is inserted, and it **sends by itself**.
- [ ] The instruction asks for all six sections, in order: Goal, Key decisions, Current
      state, Important code and snippets, Open problems, Next steps.
- [ ] Claude's reply is a brief with those headings, and it **ends by asking what to
      continue with**.
- [ ] When streaming finishes, the popup says the brief was captured.
- [ ] Reopen the popup → that chat now shows a **brief** badge and the brief preview.
- [ ] Import it again → the mode now defaults to **Brief + file**.

### Guards

- [ ] **Type something in the composer yourself**, then click Import → it refuses with
      "the message box already has text in it", and your text is untouched.
- [ ] Double-click Import fast → it sends **once**; the second click says it already
      auto-sent.
- [ ] Options → **Send automatically on import** off → the draft is prepared and
      **nothing is sent**; you press send.
- [ ] Options → **Capture Claude's brief back** off → it sends but stores no brief.
- [ ] Navigate to a different chat and import again → the per-chat guard reset, so it
      sends.

### Verification failure

- [ ] Block the attach: in the claude.ai tab console, remove the file input
      (`document.querySelector('input[type=file]').remove()`), then import → it falls
      back to pasting inside `<previous_conversation>` tags and still works.
- [ ] A very large transcript (>150k chars) whose attach fails → it refuses to send and
      says so, rather than pasting something enormous.

## 5. Robustness

- [ ] Service worker: `chrome://extensions` → **service worker** → wait for it to go
      idle (or click **Stop**), then trigger a tick → it wakes, rebuilds state from
      storage, and still honours the armed/disarmed state (no duplicate fire).
- [ ] Reload the extension mid-monitor-tick → no orphan tab is left behind.
- [ ] Import against a claude.ai tab that was never loaded with the content script
      (open before installing) → clear "reload the claude.ai tab" message.
- [ ] A chat with no transcript, mode "Ask this chat for the brief" → clear message, no
      crash.
- [ ] Every error surface above shows a readable sentence in the popup or a notification
      — no raw stack traces, no silent failures.

## 6. Privacy

- [ ] Debug **off**: use every feature, then check the page console and the service
      worker console → **no chat text anywhere**.
- [ ] Debug **on** → content samples appear, and only then.
- [ ] DevTools → **Network** on the claude.ai tab and the service worker: run an
      auto-save → **no requests** to anything (no `api.anthropic.com`, no Drive) unless
      you explicitly enabled those features.
- [ ] Popup → **Copy report** → the JSON includes `usage.rawText`,
      `usage.matchedSelector`, every bar, and `monitorLog`, but **no chat content**.
