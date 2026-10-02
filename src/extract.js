import { SELECTORS, findMessages, conversationId, chatTitle, accountHint, pick, pickWhich, findLimitBanner, LIMIT_BANNER_SELECTORS } from './site.js';
import { htmlToMarkdown } from './markdown.js';
import { note, noteContent } from './debug.js';
import { sleep } from './util.js';

const SCROLL_SETTLE_MS = 350;
const SCROLL_MAX_ROUNDS = 40;

/**
 * Long chats are virtualised: older turns are not in the DOM until scrolled to.
 * Scroll to the top repeatedly until the message count stops growing, then put
 * the user back where they were.
 */
export async function loadWholeConversation() {
  const scroller = pick(SELECTORS.scroller) || document.scrollingElement;
  if (!scroller) return { rounds: 0, restored: false };
  const original = scroller.scrollTop;
  let previous = -1, rounds = 0;

  while (rounds < SCROLL_MAX_ROUNDS) {
    const count = findMessages().nodes.length;
    if (count === previous && scroller.scrollTop <= 1) break;
    previous = count;
    scroller.scrollTop = 0;
    rounds++;
    await sleep(SCROLL_SETTLE_MS);
  }
  scroller.scrollTop = original;
  note('scrolled-to-load', { rounds, messages: findMessages().nodes.length });
  return { rounds, restored: true };
}

export async function extractChat({ scroll = true } = {}) {
  if (scroll) await loadWholeConversation();

  const { nodes, strategy } = findMessages();
  note('extract:selector', { strategy, found: nodes.length });
  if (!nodes.length) {
    throw new Error(
      'No messages found. Open a chat first. If a chat is open, claude.ai markup ' +
      'probably changed — turn on Debug in the popup and send the report.'
    );
  }

  const messages = nodes
    .map(({ el, role }) => ({
      role,
      content: htmlToMarkdown(el, {
        artifactSelector: SELECTORS.artifact,
        attachmentSelector: SELECTORS.attachmentInMessage
      })
    }))
    .filter(m => m.content);

  const title = chatTitle();
  const markdown = renderTranscript(title, messages);
  noteContent('extract:first-message', messages[0] && messages[0].content);

  return {
    id: conversationId() || 'chat-' + Date.now(),
    title,
    url: location.href,
    savedAt: new Date().toISOString(),
    account: accountHint(),
    messageCount: messages.length,
    strategy,
    messages,
    markdown
  };
}

export function renderTranscript(title, messages) {
  return (
    '# ' + title + '\n\n' +
    messages
      .map(m => (m.role === 'user' ? '## User\n\n' : '## Claude\n\n') + m.content)
      .join('\n\n---\n\n')
  );
}

/** Snapshot of what each selector currently matches, for bug reports. */
export function debugSnapshot() {
  const { nodes, strategy } = findMessages();
  return {
    url: location.href,
    title: document.title,
    strategy,
    messageCount: nodes.length,
    roles: nodes.reduce((acc, n) => ((acc[n.role] = (acc[n.role] || 0) + 1), acc), {}),
    matched: {
      editor: pickWhich(SELECTORS.editor),
      fileInput: pickWhich(SELECTORS.fileInput),
      sendButton: pickWhich(SELECTORS.sendButton),
      stopButton: pickWhich(SELECTORS.stopButton),
      scroller: pickWhich(SELECTORS.scroller)
    },
    limitBanner: findLimitBanner(document),
    limitBannerSelectors: LIMIT_BANNER_SELECTORS.map(sel => ({
      sel, count: document.querySelectorAll(sel).length
    })),
    groups: SELECTORS.messageGroups.map(g => ({
      name: g.name,
      user: document.querySelectorAll(g.user).length,
      assistant: document.querySelectorAll(g.assistant).length
    }))
  };
}

