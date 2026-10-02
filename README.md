# Claude Chat Transfer

A personal, unpacked Chrome extension (Manifest V3) that moves the context of **one**
claude.ai chat from one account to another, so the new account's Claude can pick up
where the old one left off.

The headline feature is the **handoff brief**: rather than dumping a raw transcript
into a new chat and burning context, the extension asks Claude to write a structured
brief (goal, decisions, state, code, open problems, next steps) and leads with that.

It can also do the whole handoff on its own:

- **Auto-save** watches your usage in account A and saves the transcript by itself when
  you are about to hit the limit — transcript only, so it costs **zero usage**.
- **Auto-brief** writes the brief in account B instead, on import, where you have budget.

---

## Install

```bash
npm install          # only needed to run the tests
npm test             # 91 unit tests, no browser required
npm run check        # parses every file, validates the manifest
```

Chrome APIs and real claude.ai markup cannot be unit-tested; the manual pass for those
is [`MANUAL-TESTS.md`](MANUAL-TESTS.md).

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
   - **Ask this chat for the brief** — the default for a chat with no brief. See
     [auto-brief](#auto-brief-on-import-account-b).
3. For the manual modes, review the composer and press send yourself.

Automatic degradation: if the file attach fails, the transcript is pasted instead; if
the transcript is over ~150,000 characters, it falls back to brief only. The popup
tells you when either happened.

Every manual mode behaves exactly as it always has: nothing is sent for you unless you
chose the auto-brief mode and left auto-send on.

---

## Auto-save near the usage limit (account A)

The problem auto-save solves: you hit the cap mid-conversation and lose the chance to
produce a handoff before you are locked out. So the extension does the one thing that
costs nothing — it saves the transcript.

**It never sends a message in your chat and never generates a brief.** No in-chat brief,
no API call, no local summary. An auto-save is pure DOM reading, so it is free.

### How the usage monitor works

1. A `chrome.alarms` alarm fires **every 5 minutes**, and **every 1 minute** once the
   last reading was **85% or higher**.
2. On each tick, *only if you already have a claude.ai tab open*, it opens
   `https://claude.ai/settings/usage` in a **background tab** (`active: false`) — it
   never steals focus.
3. A content script on that page (`usage-reader.js`) reads the usage meters and reports
   the percentage back. The tab is then closed — always, including on error or timeout,
   because the close happens in a `finally`.
4. A single-flight lock means only one monitor tab can exist at a time.
5. If several meters exist (session, weekly, Opus…), **the highest wins**, and every bar
   is stored with its own label so you can see which limit is the tight one.
6. The reading is stored as `lastUsage { percent, label, readAt, bars, rawText,
   matchedSelector }` and shown in the popup and on the options page.

### What triggers a save

Either signal fires it:

- the usage percentage reaches the **threshold** (default **95%**, configurable 50–99), or
- claude.ai shows an **"approaching limit"** or **"limit reached"** banner in the chat,
  which the content script spots and reports.

Then:

1. It targets the **most recently active** claude.ai tab on a `/chat/` URL. If there is
   none, you get a notification saying nothing could be saved.
2. It saves the **full transcript only**, overwriting any previous save of the same chat
   id. A brief the chat already had is preserved.
3. The entry is marked `autoSaved: true` with the usage percentage and a timestamp — the
   popup shows it as an `auto @ 96%` badge.
4. A notification says:
   *"Usage at 96%. Saved 'Parser work' (42 messages). Open your other account and click
   Import."*

### De-duplication

It fires **at most once per usage window**. After firing it disarms, and re-arms when
either usage drops **below 80%** or the reset time stated on the usage page passes. A
save is also skipped when the chat's message count has not changed since its last
auto-save, so an idle chat is not re-saved on every tick.

### Settings

Options page → **Auto-save near the usage limit**:

| Setting | Default | What it does |
| --- | --- | --- |
| Auto-save near the limit | **on** | Master switch for the save. |
| Check usage periodically | **on** | Whether to poll the usage page at all. |
| Trigger threshold | **95%** | Fire at this percentage (50–99). |
| **Test auto-save now** | — | Runs the save once for the current chat, whatever your usage is. |
| **Check usage now** | — | Reads the usage page immediately and shows the result. |

---

## Auto-brief on import (account B)

Because account A only ever saved a transcript, the brief gets written in B, where you
have budget.

Importing a saved chat **that has no brief** uses the full-transcript mode:

1. The transcript is attached as a `.md` file (if the attach fails, it is pasted inside
   `<previous_conversation>` tags instead).
2. An instruction is inserted asking Claude to read the attached transcript of a previous
   conversation from another account, write a structured handoff brief with the sections
   **Goal, Key decisions, Current state, Important code and snippets, Open problems,
   Next steps**, and then ask you what to continue with. The exact wording lives in
   [`src/compose.js`](src/compose.js) and is covered by tests.
3. With **auto-send on import** on (default), it submits **only after verifying** that
   the attachment chip appeared or the text really landed in the composer. If
   verification fails, **nothing is sent** — you get a clear popup message and the draft
   is left in place.
4. After the reply finishes streaming (the same three-signal completion detection the
   manual brief uses: stop button gone, send button back, last message quiet for 2.5s),
   the reply is captured and saved onto the stored chat as `brief` with
   `briefMethod: "claude-import"`. This is a setting, default on.
5. On later imports of that chat, the mode defaults to **Brief + file**, since a brief
   now exists.

Two things it will never do: auto-send **twice for the same import click**, or auto-send
when **the composer already contains text you typed** (it tells you to clear it first).

| Setting | Default | What it does |
| --- | --- | --- |
| Send automatically on import | **on** | Submit after verification succeeds. |
| Capture Claude's brief back | **on** | Store the reply onto the saved chat. |

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
- Chat content is **never** written to the console unless debug mode is on. This applies
  to the usage monitor too: it logs structural facts (percentages, selectors, decisions),
  never chat text.
- **Auto-save makes no network calls at all.** It reads the DOM and writes to local
  storage. The optional API-key brief path is unchanged and still the only thing that
  can reach `api.anthropic.com`.
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

The report also carries the usage monitor's state: the **raw usage text**, the
**selector that matched**, every bar with its label and percentage, the reset hint, and
the service worker's recent decisions. That is what you need to fix the usage selectors.

### Tuning the usage selectors

The usage page is parsed by [`src/usage.js`](src/usage.js) using `USAGE_SELECTORS` from
[`src/site.js`](src/site.js). Only `site.js` needs editing.

```js
export const USAGE_SELECTORS = {
  bar: [ /* containers holding one meter, most specific first */ ],
  percentAttrs: ['aria-valuenow', 'data-percent', 'data-value'],
  label: [ /* where that meter's name lives */ ],
  region: ['main', '[role="main"]', 'body']   // text-scan fallback
};
```

The parser reads a percentage from each bar in this order, and the first that works wins:

1. **attributes** — `aria-valuenow`, honouring `aria-valuemin`/`aria-valuemax` (so
   `180` of `200` becomes 90%, not 100%);
2. **inline style** — `style="width: 88%"`;
3. **text** — `"88%"`, or a ratio like `"45 of 50 messages"` converted to a percentage.

If no `bar` selector matches at all, it scans the whole `region` as plain text for a
percentage. That yields one number rather than per-limit bars, which is why it is last.

To fix a break:

1. Options page → **Check usage now**, then look at the reading shown there.
2. If it says it could not read a percentage, open `claude.ai/settings/usage`, inspect a
   meter, and add a selector to the **front** of `USAGE_SELECTORS.bar` matching the
   element that carries the number (or its container).
3. If the number is right but labels are wrong, add a selector to `label`. Labels are
   searched on the bar itself and then up to four ancestors, since claude.ai often puts
   the heading as a *sibling* of the meter.
4. `npm test` — `test/usage.test.js` runs the parser against HTML fixtures in
   `test/fixtures/usage-*.html`. Add a fixture for the markup you just fixed.

Being logged out is detected two ways, because the login page is outside the usage
content script's match pattern and so could never report for itself: the service worker
watches the monitor tab for a redirect to a login URL, and the parser also treats a
password/email field as logged out. Either way it is reported as `loggedOut` rather than
as 0%, so a signed-out browser never looks like "plenty of usage left" and never
triggers a save.

Limit **banner** phrases live in `LIMIT_PHRASES` in `site.js`, split into `reached` and
`approaching`; `reached` wins when both appear. Matching is lowercased and
whitespace-collapsed, and anything longer than 400 characters is ignored so the whole
page body is never mistaken for a banner.

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
- **You always press send** for the manual import modes. The only exception is the
  auto-brief mode with auto-send left on, which submits after verifying the attachment.
- **Auto-save needs a claude.ai tab open.** The monitor deliberately does nothing when
  you are not using claude.ai, so it will not open tabs in the background all day.
- **Auto-save needs a `/chat/` tab** to save from. If your only claude.ai tab is on the
  home page, the notification tells you nothing could be saved.
- **The usage page markup is the most fragile part.** It is less stable than the chat
  markup and has no `data-testid` hooks to rely on. See
  [Tuning the usage selectors](#tuning-the-usage-selectors).
- **Usage polling costs a background tab load** every 5 minutes (every minute above
  85%). Turn off "Check usage periodically" if that bothers you; the banner trigger
  still works, since it needs no tab.
- **A suspended service worker** cannot be mid-read. State is rebuilt from
  `chrome.storage.local` on every wake-up, and the alarm is re-armed on install,
  on startup, and on every worker load, so a suspend costs at most one tick.

## Layout

```
manifest.json         MV3 manifest
content.js            thin loader (MV3 content scripts cannot be ES modules)
background.js         service worker: Drive, optional API call, usage monitor + alarm
popup.html/.css/.js   the popup UI
options.html/.js      brief mode, API key, Drive, auto-save, auto-brief, debug
usage-reader.js       content script for claude.ai/settings/usage (reads the meters)
src/site.js           ALL claude.ai-specific selectors, phrases and DOM heuristics
src/usage.js          usage-page percentage parsing (pure, unit-tested)
src/trigger.js        poll cadence / fire / re-arm decisions (pure, unit-tested)
src/monitor.js        the usage monitor: background tab, lock, auto-save, notify
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
MANUAL-TESTS.md       the checklist for everything unit tests cannot reach
```
