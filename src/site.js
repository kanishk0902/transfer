// Everything that depends on claude.ai's markup lives here.
// If claude.ai changes its DOM, this file is the only one you should need to fix.

export const SELECTORS = {
  // Message containers, in priority order. First group that yields nodes wins.
  // Each group is tried in order; a group wins only if it finds at least one
  // message. Groups are cumulative on purpose — claude.ai has shipped pages
  // where user turns carry a data-testid but assistant turns only have a font
  // class, so a group that knows about both survives that mismatch.
  messageGroups: [
    {
      name: 'testid',
      user: '[data-testid="user-message"]',
      assistant: '[data-testid="assistant-message"], [data-testid="conversation-turn-assistant"], .font-claude-response, .font-claude-message'
    },
    {
      name: 'font-class',
      user: '[data-testid="user-message"], .font-user-message, [class*="user-message"]',
      assistant: '.font-claude-response, .font-claude-message, [class*="claude-response"]'
    }
  ],
  // Composer
  editor: [
    'div[contenteditable="true"].ProseMirror',
    'fieldset div[contenteditable="true"]',
    'div[contenteditable="true"]'
  ],
  fileInput: ['input[type="file"]'],
  // Attachment chips that appear above the composer after a successful attach
  attachmentChip: [
    '[data-testid="file-thumbnail"]',
    '[data-testid="attachment"]',
    'div[class*="attachment"] [title$=".md"]'
  ],
  // Send / stop buttons, used to tell whether a response is still streaming
  sendButton: [
    'button[aria-label="Send message"]',
    'button[aria-label="Send Message"]',
    'button[data-testid="send-button"]'
  ],
  stopButton: [
    'button[aria-label="Stop response"]',
    'button[aria-label="Stop generating"]',
    'button[data-testid="stop-button"]'
  ],
  // Scroll container holding the transcript
  scroller: [
    'div[class*="overflow-y-auto"][class*="flex"]',
    'main div[class*="overflow-y-auto"]',
    'main'
  ],
  // Best-effort account/org label
  accountHint: [
    '[data-testid="user-menu-button"]',
    'button[aria-label*="profile" i]',
    'nav [class*="truncate"]'
  ],
  // Artifact / inline attachment markers inside messages
  artifact: '[data-testid="artifact-block"], button[aria-label*="artifact" i], div[class*="artifact"]',
  attachmentInMessage: '[data-testid="file-thumbnail"], [data-testid="attachment"]'
};

/** First element matching any selector in a list. */
export function pick(list, root = document) {
  for (const sel of list) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

/** Which selector in the list matched (for debug reporting). */
export function pickWhich(list, root = document) {
  for (const sel of list) if (root.querySelector(sel)) return sel;
  return null;
}

/**
 * Find message nodes. Tries each selector group, then falls back to a
 * structural heuristic that does not depend on class names.
 * Returns { nodes: [{el, role}], strategy }.
 */
export function findMessages(doc = document) {
  for (const group of SELECTORS.messageGroups) {
    const userEls = Array.from(doc.querySelectorAll(group.user));
    const asstEls = Array.from(doc.querySelectorAll(group.assistant));
    const all = dedupeNested([...userEls, ...asstEls]);
    // Require both roles before trusting a group: finding only user turns
    // usually means the assistant selector has gone stale, and a half-captured
    // transcript is worse than falling through to the next strategy.
    if (all.length && userEls.length && asstEls.length) {
      const userSet = new Set(userEls);
      const nodes = sortByDocumentOrder(all).map(el => ({
        el,
        role: userSet.has(el) || userEls.some(u => u.contains(el)) ? 'user' : 'assistant'
      }));
      return { nodes, strategy: group.name };
    }
  }
  // Last resort before the heuristic: accept a group that found only one role.
  // A single-turn chat legitimately looks like this.
  for (const group of SELECTORS.messageGroups) {
    const userEls = Array.from(doc.querySelectorAll(group.user));
    const asstEls = Array.from(doc.querySelectorAll(group.assistant));
    const all = dedupeNested([...userEls, ...asstEls]);
    if (all.length) {
      const userSet = new Set(userEls);
      const nodes = sortByDocumentOrder(all).map(el => ({
        el,
        role: userSet.has(el) || userEls.some(u => u.contains(el)) ? 'user' : 'assistant'
      }));
      return { nodes, strategy: group.name + '-partial' };
    }
  }

  return { nodes: heuristicMessages(doc), strategy: 'heuristic' };
}

/**
 * Structural fallback: find the deepest container whose children look like an
 * alternating list of substantial text blocks, and treat those children as turns.
 * Roles alternate starting with user, which matches how chats actually begin.
 */
function heuristicMessages(doc) {
  const main = doc.querySelector('main') || doc.body;
  if (!main) return [];
  let best = null;
  const candidates = main.querySelectorAll('div, section, ol, ul');
  for (const container of candidates) {
    const kids = Array.from(container.children).filter(
      c => c.textContent.trim().length > 20
    );
    if (kids.length < 2) continue;
    const score = kids.length * Math.min(averageLength(kids), 2000);
    if (!best || score > best.score) best = { container, kids, score };
  }
  if (!best) return [];
  return best.kids.map((el, i) => ({ el, role: guessRole(el) || (i % 2 === 0 ? 'user' : 'assistant') }));
}

function averageLength(els) {
  return els.reduce((n, e) => n + e.textContent.trim().length, 0) / els.length;
}

/** Weak per-element role signal used by the heuristic. */
function guessRole(el) {
  const hay = (el.className && String(el.className)) + ' ' + (el.getAttribute('data-testid') || '');
  if (/user/i.test(hay)) return 'user';
  if (/claude|assistant|response/i.test(hay)) return 'assistant';
  return null;
}

function dedupeNested(els) {
  const uniq = Array.from(new Set(els));
  return uniq.filter(el => !uniq.some(o => o !== el && o.contains(el)));
}

function sortByDocumentOrder(els) {
  return els.slice().sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  );
}

/** Conversation id from the URL, or a stable-ish fallback. */
export function conversationId(loc = location) {
  const m = loc.pathname.match(/\/chat\/([\w-]+)/);
  return m ? m[1] : null;
}

export function chatTitle(doc = document) {
  return doc.title.replace(/\s*[-–|]\s*Claude\s*$/i, '').trim() || 'Untitled chat';
}

/** Best-effort account label; never throws. */
export function accountHint(doc = document) {
  try {
    const el = pick(SELECTORS.accountHint, doc);
    const text = el && (el.getAttribute('aria-label') || el.textContent || '').trim();
    return text && text.length < 80 ? text : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Usage page (https://claude.ai/settings/usage)
// ---------------------------------------------------------------------------
// claude.ai renders usage as one or more progress bars. The markup has moved
// around, so we try hooks in order of how specific they are and fall back to
// scanning text for a percentage. Everything site-shaped stays in this file.

export const USAGE_URL = 'https://claude.ai/settings/usage';

export const USAGE_SELECTORS = {
  // Containers that hold a single usage meter plus its label.
  bar: [
    '[data-testid*="usage" i]',
    '[role="progressbar"]',
    '[class*="usage"] [class*="progress"]',
    '[class*="usage-bar"]',
    'main [class*="progress"]',
    // Row-level fallback: one labelled row per limit, with the number in text.
    '[class*="usage"] [class*="row"]',
    '[class*="usage"] li',
    '[class*="usage"] > div'
  ],
  // Where a bar's percentage may be stated, in priority order.
  percentAttrs: ['aria-valuenow', 'data-percent', 'data-value'],
  // Label for a bar (which limit it is: session, weekly, Opus, …).
  label: [
    '[data-testid*="label" i]',
    'h2', 'h3', 'h4',
    '[class*="title"]',
    '[class*="label"]'
  ],
  // Fallback: the whole usage region, scanned as text.
  region: ['main', '[role="main"]', 'body']
};

// Login redirect detection: if any of these match, we are not signed in.
export const LOGIN_SELECTORS = [
  'input[type="password"]',
  'input[name="email"]',
  'button[data-testid="login-button"]',
  'a[href*="/login"][class*="button"]'
];

export const LOGIN_URL_PATTERN = /\/(login|signin|sign-in|oauth|auth)\b/i;

// ---------------------------------------------------------------------------
// Limit banners shown inside a chat
// ---------------------------------------------------------------------------

export const LIMIT_BANNER_SELECTORS = [
  '[data-testid*="limit" i]',
  '[role="alert"]',
  '[role="status"]',
  '[class*="banner"]',
  '[class*="warning"]',
  '[class*="rate-limit"]'
];

// Lowercased substrings. `reached` phrases mean the limit is already hit;
// `approaching` phrases mean it is close. Both are triggers.
export const LIMIT_PHRASES = {
  reached: [
    'limit reached',
    'you’ve reached your limit',
    "you've reached your limit",
    'you are out of',
    'usage limit reached',
    'message limit reached',
    'your limit resets'
  ],
  approaching: [
    'approaching your limit',
    'approaching the limit',
    'nearing your limit',
    'running low on',
    'you have used',
    'left until your limit resets'
  ]
};

/** Reset-time phrasing, e.g. "resets at 5 PM". Used to re-arm the trigger. */
export const RESET_PATTERN = /resets?\s+(?:at|on|in)\s+([^.<\n]{1,40})/i;

/**
 * Pure: does this text look like a limit banner? Returns
 * { kind: 'reached' | 'approaching', phrase } or null.
 * `reached` wins over `approaching` when both appear.
 */
export function matchLimitPhrase(text) {
  const hay = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  if (!hay) return null;
  for (const kind of ['reached', 'approaching']) {
    for (const phrase of LIMIT_PHRASES[kind]) {
      if (hay.includes(phrase.toLowerCase())) return { kind, phrase };
    }
  }
  return null;
}

/**
 * Find a limit banner in the page. Returns
 * { kind, phrase, selector, text } or null. Never throws.
 */
export function findLimitBanner(doc = document) {
  try {
    for (const sel of LIMIT_BANNER_SELECTORS) {
      for (const el of doc.querySelectorAll(sel)) {
        const text = (el.textContent || '').trim();
        // Banners are short. A long match is almost certainly the whole page.
        if (!text || text.length > 400) continue;
        const hit = matchLimitPhrase(text);
        if (hit) return { ...hit, selector: sel, text: text.slice(0, 200) };
      }
    }
  } catch { /* fall through */ }
  return null;
}

/** True when the document looks like the login page rather than the app. */
export function looksLoggedOut(doc = document, href = '') {
  try {
    if (LOGIN_URL_PATTERN.test(String(href))) return true;
    return LOGIN_SELECTORS.some(sel => doc.querySelector(sel));
  } catch { return false; }
}
