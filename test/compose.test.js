import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeImport, fallbackToPaste, LARGE_TRANSCRIPT_CHARS } from '../src/compose.js';

const withBrief = { title: 'My chat', brief: 'BRIEF BODY', markdown: 'TRANSCRIPT BODY' };
const noBrief = { title: 'My chat', markdown: 'TRANSCRIPT BODY' };
const huge = { title: 'Big', brief: 'BRIEF BODY', markdown: 'x'.repeat(LARGE_TRANSCRIPT_CHARS + 1) };

test('default mode inlines the brief and attaches the transcript', () => {
  const c = composeImport(withBrief, 'brief+file');
  assert.equal(c.effectiveMode, 'brief+file');
  assert.ok(c.text.includes('<handoff_brief>'));
  assert.ok(c.text.includes('BRIEF BODY'));
  assert.ok(!c.text.includes('TRANSCRIPT BODY'), 'transcript goes in the file, not the text');
  assert.equal(c.attach.content, 'TRANSCRIPT BODY');
  assert.match(c.attach.filename, /^previous-chat_My_chat\.md$/);
});

test('brief-only mode attaches nothing', () => {
  const c = composeImport(withBrief, 'brief');
  assert.equal(c.effectiveMode, 'brief');
  assert.equal(c.attach, null);
  assert.ok(!c.text.includes('TRANSCRIPT BODY'));
});

test('full mode inlines brief and transcript', () => {
  const c = composeImport(withBrief, 'full');
  assert.equal(c.effectiveMode, 'full');
  assert.ok(c.text.includes('BRIEF BODY'));
  assert.ok(c.text.includes('<previous_conversation>'));
  assert.ok(c.text.includes('TRANSCRIPT BODY'));
});

test('a chat with no brief falls back to the transcript instruction', () => {
  const c = composeImport(noBrief, 'brief+file');
  assert.equal(c.effectiveMode, 'full');
  assert.ok(c.text.includes('TRANSCRIPT BODY'));
  assert.ok(!c.text.includes('<handoff_brief>'));
});

test('very large transcripts degrade to brief only, with a reason', () => {
  for (const mode of ['brief+file', 'full']) {
    const c = composeImport(huge, mode);
    assert.equal(c.effectiveMode, 'brief', mode);
    assert.equal(c.attach, null);
    assert.match(c.reason, /brief only/);
  }
});

test('attach failure falls back to pasting the transcript', () => {
  const c = fallbackToPaste(composeImport(withBrief, 'brief+file'), withBrief);
  assert.equal(c.effectiveMode, 'brief+paste');
  assert.ok(c.text.includes('BRIEF BODY'));
  assert.ok(c.text.includes('TRANSCRIPT BODY'));
  assert.match(c.reason, /File attach failed/);
});

test('attach failure on a huge transcript degrades to brief only', () => {
  const c = fallbackToPaste(composeImport(huge, 'brief+file'), huge);
  assert.equal(c.effectiveMode, 'brief');
  assert.ok(!c.text.includes('x'.repeat(1000)));
});

test('titles are slugged safely for filenames', () => {
  const c = composeImport({ ...withBrief, title: 'Weird / name: v2!' }, 'brief+file');
  assert.equal(c.attach.filename, 'previous-chat_Weird_name_v2.md');
});

// ---- auto-brief on import (new account) ----

import {
  composeAutoBrief, autoBriefPasteFallback, defaultImportMode, BRIEF_SECTIONS
} from '../src/compose.js';

const noBriefChat = { id: 'c1', title: 'Parser work', markdown: 'TRANSCRIPT BODY' };

test('auto-brief attaches the transcript as a .md file', () => {
  const c = composeAutoBrief(noBriefChat);
  assert.equal(c.effectiveMode, 'auto-brief');
  assert.equal(c.attach.content, 'TRANSCRIPT BODY');
  assert.equal(c.attach.filename, 'previous-chat_Parser_work.md');
  assert.ok(!c.text.includes('TRANSCRIPT BODY'), 'the transcript rides in the file');
});

test('the auto-brief instruction says the transcript is attached and from another account', () => {
  const { text } = composeAutoBrief(noBriefChat);
  assert.match(text, /Attached is the full transcript/);
  assert.match(text, /previous conversation/i);
  assert.match(text, /another\s+Claude\s+account/);
  assert.match(text, /Read it carefully/);
});

test('the auto-brief instruction requests all six sections, in order', () => {
  const { text } = composeAutoBrief(noBriefChat);
  assert.deepEqual(BRIEF_SECTIONS, [
    'Goal', 'Key decisions', 'Current state',
    'Important code and snippets', 'Open problems', 'Next steps'
  ]);
  let cursor = -1;
  for (const section of BRIEF_SECTIONS) {
    const at = text.indexOf('## ' + section);
    assert.ok(at > cursor, `${section} appears after the previous section`);
    cursor = at;
  }
});

test('the auto-brief instruction ends by asking what to continue with', () => {
  const { text } = composeAutoBrief(noBriefChat);
  assert.match(text, /ask me what I want to continue with\.?\s*$/);
});

test('a huge transcript still attaches but is marked as requiring the file', () => {
  const big = { ...noBriefChat, markdown: 'x'.repeat(LARGE_TRANSCRIPT_CHARS + 1) };
  const c = composeAutoBrief(big);
  assert.equal(c.requiresAttach, true);
  assert.ok(c.attach);
  assert.equal(composeAutoBrief(noBriefChat).requiresAttach, false);
});

test('a chat with no transcript cannot be auto-briefed', () => {
  assert.throws(() => composeAutoBrief({ title: 'Empty', markdown: '' }), /no transcript/);
});

test('the paste fallback wraps the transcript in previous_conversation tags', () => {
  const c = autoBriefPasteFallback(noBriefChat);
  assert.equal(c.effectiveMode, 'auto-brief+paste');
  assert.equal(c.failed, false);
  assert.equal(c.attach, null);
  assert.ok(c.text.includes('<previous_conversation>'));
  assert.ok(c.text.includes('TRANSCRIPT BODY'));
  // Same instruction, reworded for an inline transcript.
  assert.match(c.text, /Below, inside <previous_conversation> tags/);
  for (const section of BRIEF_SECTIONS) assert.ok(c.text.includes('## ' + section));
  assert.match(c.reason, /File attach failed/);
});

test('the paste fallback refuses a transcript too large to paste', () => {
  const big = { ...noBriefChat, markdown: 'x'.repeat(LARGE_TRANSCRIPT_CHARS + 1) };
  const c = autoBriefPasteFallback(big);
  assert.equal(c.failed, true);
  assert.equal(c.text, null);
  assert.match(c.reason, /too large to paste/);
});

test('import mode defaults to auto-brief without a brief and brief+file with one', () => {
  assert.equal(defaultImportMode(noBriefChat), 'auto-brief');
  assert.equal(defaultImportMode({ ...noBriefChat, brief: '' }), 'auto-brief');
  assert.equal(defaultImportMode({ ...noBriefChat, brief: '   ' }), 'auto-brief');
  assert.equal(defaultImportMode({ ...noBriefChat, brief: 'BRIEF BODY' }), 'brief+file');
  assert.equal(defaultImportMode(null), 'auto-brief');
});
