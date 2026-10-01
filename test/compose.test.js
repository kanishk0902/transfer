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
