import { SELECTORS, pick, findMessages } from './site.js';
import { htmlToMarkdown } from './markdown.js';
import { insertText } from './importer.js';
import { sleep, waitFor } from './util.js';
import { note } from './debug.js';

export const BRIEF_PROMPT = [
  'Before we stop: write a HANDOFF BRIEF for a fresh Claude instance that has',
  'no memory of this conversation. Use exactly these sections as markdown headings:',
  '',
  '## Goal',
  '## Key decisions',
  '## Current state',
  '## Important code and snippets',
  '## Open problems',
  '## Next steps',
  '',
  'Be concrete and specific. Include file names, identifiers, and short code',
  'snippets where they matter. Do not ask me any questions in this reply —',
  'output only the brief.'
].join('\n');

const SUBMIT_TIMEOUT_MS = 15000;
const STREAM_START_MS = 20000;
const STREAM_MAX_MS = 5 * 60 * 1000;
const QUIET_MS = 2500;

/** Streaming is in progress when a stop button is present. */
function isStreaming() {
  return !!pick(SELECTORS.stopButton);
}

function lastAssistantEl() {
  const { nodes } = findMessages();
  for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i].role === 'assistant') return nodes[i].el;
  return null;
}

/**
 * Ask the current chat for a brief, wait for the answer, return it as markdown.
 * onProgress reports a short status string the popup can display.
 */
export async function requestBriefInChat(onProgress = () => {}) {
  const before = findMessages().nodes.length;

  onProgress('Typing the handoff prompt…');
  insertText(BRIEF_PROMPT);
  await sleep(300);

  onProgress('Submitting…');
  if (!(await submit())) throw new Error('Could not submit the prompt. Press Enter in the chat manually, then save again.');

  onProgress('Waiting for Claude to start…');
  // Either the stop button appears, or a new message node shows up.
  const started = await waitFor(
    () => isStreaming() || findMessages().nodes.length > before,
    STREAM_START_MS
  );
  if (!started) throw new Error('Claude did not start replying. Check the chat and try again.');

  onProgress('Claude is writing the brief…');
  await waitForStreamEnd(onProgress);

  const el = lastAssistantEl();
  if (!el) throw new Error('Could not read the brief back from the chat.');
  const brief = htmlToMarkdown(el, {
    artifactSelector: SELECTORS.artifact,
    attachmentSelector: SELECTORS.attachmentInMessage
  });
  if (!brief.trim()) throw new Error('The brief came back empty.');
  note('brief:captured', { chars: brief.length });
  return brief;
}

/**
 * Finished means: no stop button, the send button is back, and the last
 * message stopped growing for a quiet period. The quiet check covers UIs where
 * the buttons swap before the final tokens land.
 */
async function waitForStreamEnd(onProgress) {
  const deadline = Date.now() + STREAM_MAX_MS;
  let lastLen = -1, quietSince = null;

  while (Date.now() < deadline) {
    await sleep(500);
    const el = lastAssistantEl();
    const len = el ? el.textContent.length : 0;

    if (len !== lastLen) {
      lastLen = len;
      quietSince = null;
      onProgress(`Claude is writing the brief… (${len} chars)`);
      continue;
    }
    const buttonsIdle = !isStreaming() && !!pick(SELECTORS.sendButton);
    if (quietSince === null) quietSince = Date.now();
    if (Date.now() - quietSince >= QUIET_MS && (buttonsIdle || !isStreaming())) {
      note('brief:stream-end', { chars: len });
      return;
    }
  }
  throw new Error('Timed out waiting for the brief. It may still be generating — try saving again in a moment.');
}

/** Click send if we can find it; otherwise press Enter in the editor. */
async function submit() {
  const btn = pick(SELECTORS.sendButton);
  if (btn && !btn.disabled) {
    btn.click();
  } else {
    const editor = pick(SELECTORS.editor);
    if (!editor) return false;
    editor.focus();
    for (const type of ['keydown', 'keypress', 'keyup']) {
      editor.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
      }));
    }
  }
  // Submission worked if the composer emptied or streaming began.
  return waitFor(() => {
    const ed = pick(SELECTORS.editor);
    return isStreaming() || (ed && ed.textContent.trim().length === 0);
  }, SUBMIT_TIMEOUT_MS);
}
