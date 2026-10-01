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
