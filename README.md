# Claude Chat Transfer

A personal, unpacked Chrome extension (Manifest V3) that moves the context of **one**
claude.ai chat from one account to another, so the new account's Claude can pick up
where the old one left off.

The headline feature is the **handoff brief**: rather than dumping a raw transcript
into a new chat and burning context, the extension asks Claude to write a structured
brief (goal, decisions, state, code, open problems, next steps) and leads with that.

---

## Install

```bash
npm install          # only needed to run the tests
npm test             # 44 unit tests, no browser required
npm run check        # parses every file, validates the manifest
```

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Pin the extension so its icon is visible.

Drive sync needs extra setup — see [Google Drive setup](#google-drive-setup). Everything
else works immediately.

## Usage

### Save a chat (account A)

1. Open the chat you want to move on claude.ai.
2. Click the extension icon.
3. **Save with handoff brief** — types a brief request into that chat, submits it, waits
   for the reply, and saves the brief alongside the full transcript.
   **Save transcript only** skips the brief and does not touch the chat.

The brief request becomes a real turn in the source chat. That is unavoidable with a
DOM-only approach; it is excluded from the saved transcript so it is not duplicated.

### Import into account B

1. Switch to account B and open a **new** chat.
2. Click the extension icon, find the chat, choose a mode, click **Import**:
   - **Brief + file** (default) — brief inline, transcript attached as `.md`.
   - **Brief only** — smallest footprint.
   - **Full transcript** — brief and transcript both pasted inline.
3. Review the composer and press send yourself. The extension never sends for you.

Automatic degradation: if the file attach fails, the transcript is pasted instead; if
the transcript is over ~150,000 characters, it falls back to brief only. The popup
tells you when either happened.

## Google Drive setup

Optional and off by default. Scope is `drive.file`, so the extension can only ever see
files it created itself — never the rest of your Drive.

**1. Pin the extension ID.** Chrome gives unpacked extensions a new ID each time the
folder moves, and the OAuth client is bound to one ID. Generate a stable key:

```bash
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out key.pem
openssl rsa -in key.pem -pubout -outform DER | base64 -w0   # macOS: | base64
```

Add the printed base64 string to `manifest.json` as a top-level `"key"` field, reload
the extension, and copy the now-stable ID from `chrome://extensions`. Keep `key.pem`
out of version control.

**2. Google Cloud project.**
- Go to <https://console.cloud.google.com/> and create a project (any name).
- **APIs & Services → Library** → search "Google Drive API" → **Enable**.

**3. OAuth consent screen.**
- **APIs & Services → OAuth consent screen** → User type **External** → Create.
- Fill in app name, your email as support contact, your email as developer contact.
- **Scopes**: add `https://www.googleapis.com/auth/drive.file`.
- **Test users**: add your own Google address.
- Leave publishing status as **Testing**. That is correct for personal use; you never
  need verification. Tokens expire every 7 days in Testing mode, so you will re-consent
  about weekly — the extension handles this and prompts you.

**4. OAuth client ID.**
- **APIs & Services → Credentials → Create credentials → OAuth client ID**.
- Application type: **Chrome Extension**.
- Item ID: the stable extension ID from step 1.
- Copy the generated client ID into `manifest.json` under `oauth2.client_id`, replacing
  `REPLACE_WITH_YOUR_CHROME_EXTENSION_OAUTH_CLIENT_ID...`.

**5. Turn it on.** Reload the extension → extension **Options** → tick **Enable Drive
sync** → **Connect Drive**. Saved chats upload to a `Claude Chat Transfer` folder as
`claude-chat_<slug>_<date>.json`. Re-saving the same chat updates its existing file
rather than creating a duplicate. **Sync from Drive** in the popup merges Drive chats
into the local list (dedupe by id, newest wins); synced entries show a `▲ Drive` badge.

Choosing the `appDataFolder` scope instead stores files in hidden app storage that does
not appear in your Drive UI at all.

## Privacy model

- Chat content lives in `chrome.storage.local` on this machine. There is no backend.
- Nothing leaves your machine **unless you explicitly enable** Drive sync (goes to your
  own Drive) or the API brief option (goes to `api.anthropic.com` under your own key).
- The default brief mode sends nothing outside claude.ai — it just types into the chat
  you already have open.
- An Anthropic API key, if you set one, is stored in `chrome.storage.local` only. It is
  never synced and never sent anywhere but the Anthropic API.
- Chat content is **never** written to the console unless debug mode is on.
- No analytics, no remote code, no third-party servers, no claude.ai internal APIs —
  extraction is DOM-only.

## When claude.ai changes its markup

Every claude.ai-specific selector lives in one file: [`src/site.js`](src/site.js). That
is the only file you should need to edit.

To report or diagnose breakage:

1. Popup → tick **Debug**.
2. Reload the claude.ai tab and open the chat.
3. Popup → **Copy report**. You get JSON showing which selector group matched, how many
   nodes each selector found, and which editor/send/stop/scroller selectors resolved.
4. Paste that report into a bug report, or use it to fix `SELECTORS` directly.

With debug on, extraction details and content samples also go to the page console
(DevTools on the claude.ai tab).

The extraction has four tiers, tried in order: the `testid` selector group, the
`font-class` group, a partial match (one role only — a legitimate single-turn chat),
and finally a structural heuristic that finds the container whose children look like an
alternating list of substantial text blocks, with no class names involved. So a markup
change usually degrades rather than breaks outright.

## Known limitations

- **The brief request appears in the source chat.** DOM-only means typing into the real
  composer. It is filtered out of the saved transcript, but it is a real turn in A.
- **Virtualised long chats.** Before extracting, the extension scrolls to the top until
  the message count stops growing (max 40 rounds), then restores your scroll position.
  Extremely long chats may still hit that ceiling; the debug report shows the count.
- **Artifacts are captured as visible text**, not as the underlying artifact document.
  Open artifacts you care about so their content is in the DOM.
- **Images** are recorded as `[attachment: name]` rather than transferred.
- **Attachments in the source chat** are noted by filename only; the files themselves do
  not move.
- **Drive in Testing mode** expires tokens every ~7 days; you will re-consent.
- **You always press send.** The extension prefills the composer and stops there.

## Layout

```
manifest.json         MV3 manifest
content.js            thin loader (MV3 content scripts cannot be ES modules)
background.js         service worker: Drive + optional Anthropic API calls
popup.html/.css/.js   the popup UI
options.html/.js      brief mode, API key, Drive settings, debug
src/site.js           ALL claude.ai-specific selectors and DOM heuristics
src/markdown.js       HTML -> Markdown (pure, unit-tested)
src/extract.js        scroll-to-load, extraction, debug snapshot
src/importer.js       ProseMirror insertion, verified file attach
src/brief.js          in-chat brief request and streaming-completion detection
src/compose.js        what gets typed on import (pure, unit-tested)
src/storage.js        chrome.storage wrappers + merge/search (pure parts tested)
src/drive.js          Drive sync with token-expiry retry
src/api-brief.js      optional Anthropic Messages API brief
test/                 node:test + jsdom, with HTML fixtures
tools/make-icons.mjs  generates the PNG icons with zlib only
tools/check.mjs       parse + manifest pre-flight
```
