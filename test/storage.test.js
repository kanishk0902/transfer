import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeChats, searchChats, byDate, byTitle } from '../src/storage.js';

const chat = (id, savedAt, extra = {}) => ({ id, title: 'c' + id, savedAt, messageCount: 1, ...extra });

test('merge dedupes by id, newest wins', () => {
  const out = mergeChats(
    [chat('a', '2026-01-01T00:00:00Z', { title: 'old' })],
    [chat('a', '2026-02-01T00:00:00Z', { title: 'new' })]
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'new');
});

test('merge keeps the older entry when it is newer than the incoming one', () => {
  const out = mergeChats(
    [chat('a', '2026-03-01T00:00:00Z', { title: 'local' })],
    [chat('a', '2026-01-01T00:00:00Z', { title: 'remote' })]
  );
  assert.equal(out[0].title, 'local');
});

test('merge preserves driveFileId from the losing copy', () => {
  const out = mergeChats(
    [chat('a', '2026-01-01T00:00:00Z', { driveFileId: 'file-1' })],
    [chat('a', '2026-02-01T00:00:00Z')]
  );
  assert.equal(out[0].driveFileId, 'file-1');
});

test('merge preserves a brief the winner lacks', () => {
  const out = mergeChats(
    [chat('a', '2026-01-01T00:00:00Z', { brief: 'the brief' })],
    [chat('a', '2026-02-01T00:00:00Z')]
  );
  assert.equal(out[0].brief, 'the brief');
});

test('merge combines distinct ids and sorts newest first', () => {
  const out = mergeChats(
    [chat('a', '2026-01-01T00:00:00Z')],
    [chat('b', '2026-05-01T00:00:00Z'), chat('c', '2026-03-01T00:00:00Z')]
  );
  assert.deepEqual(out.map(c => c.id), ['b', 'c', 'a']);
});

test('merge ignores entries without an id', () => {
  const out = mergeChats([chat('a', '2026-01-01T00:00:00Z')], [null, {}, { savedAt: 'x' }]);
  assert.equal(out.length, 1);
});

test('merge is idempotent', () => {
  const once = mergeChats([chat('a', '2026-01-01T00:00:00Z')], [chat('b', '2026-02-01T00:00:00Z')]);
  assert.deepEqual(mergeChats(once, once), once);
});

test('merge does not introduce undefined keys', () => {
  const [only] = mergeChats([], [chat('a', '2026-01-01T00:00:00Z')]);
  assert.ok(!('driveFileId' in only), 'no phantom driveFileId');
  assert.ok(!('brief' in only), 'no phantom brief');
});

test('search matches title, brief and account, case-insensitively', () => {
  const chats = [
    chat('1', '2026-01-01T00:00:00Z', { title: 'Parser work' }),
    chat('2', '2026-01-01T00:00:00Z', { title: 'Other', brief: 'about the PARSER' }),
    chat('3', '2026-01-01T00:00:00Z', { title: 'Third', account: 'work@example.com' })
  ];
  assert.deepEqual(searchChats(chats, 'parser').map(c => c.id), ['1', '2']);
  assert.deepEqual(searchChats(chats, 'example.com').map(c => c.id), ['3']);
  assert.equal(searchChats(chats, '   ').length, 3);
});

test('sort comparators order as expected', () => {
  const a = chat('a', '2026-01-01T00:00:00Z', { title: 'Zebra' });
  const b = chat('b', '2026-02-01T00:00:00Z', { title: 'Apple' });
  assert.deepEqual([a, b].sort(byDate).map(c => c.id), ['b', 'a']);
  assert.deepEqual([a, b].sort(byTitle).map(c => c.id), ['b', 'a']);
});

// ---- auto-save / auto-brief settings and merge behaviour ----

import { DEFAULT_SETTINGS, DEFAULT_MONITOR_STATE } from '../src/storage.js';
import { DEFAULT_THRESHOLD } from '../src/trigger.js';
import { defaultImportMode } from '../src/compose.js';

test('auto-save and auto-brief default to on, with a 95% threshold', () => {
  assert.equal(DEFAULT_SETTINGS.autoSaveEnabled, true);
  assert.equal(DEFAULT_SETTINGS.usagePollEnabled, true);
  assert.equal(DEFAULT_SETTINGS.autoSendOnImport, true);
  assert.equal(DEFAULT_SETTINGS.captureBriefOnImport, true);
  assert.equal(DEFAULT_SETTINGS.autoSaveThreshold, DEFAULT_THRESHOLD);
  assert.equal(DEFAULT_SETTINGS.autoSaveThreshold, 95);
});

test('the monitor starts armed, so the first high reading fires', () => {
  assert.equal(DEFAULT_MONITOR_STATE.armed, true);
  assert.equal(DEFAULT_MONITOR_STATE.lastFiredAt, null);
});

test('an auto-save overwrites the previous save of the same chat id', () => {
  const older = { id: 'c1', title: 'Old', messageCount: 10, savedAt: '2026-10-01T00:00:00.000Z' };
  const newer = {
    id: 'c1', title: 'New', messageCount: 40, savedAt: '2026-10-02T00:00:00.000Z',
    autoSaved: true, usagePercent: 96
  };
  const merged = mergeChats([older], [newer]);
  assert.equal(merged.length, 1, 'one entry per chat id');
  assert.equal(merged[0].messageCount, 40);
  assert.equal(merged[0].autoSaved, true);
  assert.equal(merged[0].usagePercent, 96);
});

test('an auto-save does not wipe a brief the chat already had', () => {
  const withBrief = {
    id: 'c1', brief: 'EARLIER BRIEF', messageCount: 10,
    savedAt: '2026-10-01T00:00:00.000Z'
  };
  const autoSaved = {
    id: 'c1', messageCount: 40, autoSaved: true,
    savedAt: '2026-10-02T00:00:00.000Z'
  };
  const merged = mergeChats([withBrief], [autoSaved]);
  assert.equal(merged[0].brief, 'EARLIER BRIEF', 'the brief survives a transcript-only auto-save');
  assert.equal(merged[0].messageCount, 40);
});

test('a brief captured on import flips the default import mode for next time', () => {
  const autoSaved = { id: 'c1', title: 'T', markdown: 'BODY', autoSaved: true, savedAt: '2026-10-02T00:00:00.000Z' };
  assert.equal(defaultImportMode(autoSaved), 'auto-brief');

  const afterImport = mergeChats([autoSaved], [{
    ...autoSaved, brief: 'CAPTURED BRIEF', briefMethod: 'claude-import',
    savedAt: '2026-10-02T01:00:00.000Z'
  }]);
  assert.equal(afterImport[0].brief, 'CAPTURED BRIEF');
  assert.equal(afterImport[0].briefMethod, 'claude-import');
  assert.equal(defaultImportMode(afterImport[0]), 'brief+file');
});
