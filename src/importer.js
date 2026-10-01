import { SELECTORS, pick } from './site.js';
import { note } from './debug.js';
import { waitFor } from './util.js';

const ATTACH_VERIFY_MS = 4000;

/**
 * ProseMirror ignores direct textContent writes. execCommand('insertText')
 * produces real beforeinput/input events, which is what the editor listens to;
 * a manual InputEvent is the fallback for when execCommand is unavailable.
 */
export function insertText(text) {
  const editor = pick(SELECTORS.editor);
  if (!editor) throw new Error('Could not find the message box. Open a chat and try again.');
  editor.focus();

  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);

  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }

  if (!ok) {
    editor.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true, cancelable: true, inputType: 'insertText', data: text
    }));
    const p = document.createElement('p');
    p.textContent = text;
    editor.appendChild(p);
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true, inputType: 'insertText', data: text
    }));
  }
  note('insert-text', { chars: text.length, viaExecCommand: ok });
  return editor;
}

export function editorText() {
  const editor = pick(SELECTORS.editor);
  return editor ? editor.textContent : '';
}

/**
 * Attach a generated file. The input is populated through DataTransfer, then we
 * wait for an attachment chip to confirm the app actually ingested it, because
 * a silently-ignored input is the common failure mode.
 */
export async function attachFile(filename, content) {
  const input = pick(SELECTORS.fileInput);
  if (!input) { note('attach:no-input'); return false; }

  const before = countChips();
  const dt = new DataTransfer();
  dt.items.add(new File([content], filename, { type: 'text/markdown' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  const ok = await waitFor(() => countChips() > before, ATTACH_VERIFY_MS);
  note('attach:verified', { ok, filename, bytes: content.length });
  return ok;
}

function countChips() {
  return SELECTORS.attachmentChip.reduce(
    (n, sel) => n + document.querySelectorAll(sel).length, 0
  );
}

export function slug(title) {
  return (title || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'chat';
}
