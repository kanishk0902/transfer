import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pollMinutes, decideTrigger, shouldSkipUnchanged, notificationText, clampThreshold,
  NORMAL_POLL_MINUTES, FAST_POLL_MINUTES, DEFAULT_THRESHOLD
} from '../src/trigger.js';

const on = { autoSaveEnabled: true, threshold: 95 };
const armed = { armed: true };

// ---- thresholds ----

test('thresholds are clamped to the configurable range', () => {
  assert.equal(clampThreshold(95), 95);
  assert.equal(clampThreshold(10), 50);
  assert.equal(clampThreshold(200), 99);
  assert.equal(clampThreshold('80'), 80);
  assert.equal(clampThreshold(80.6), 81);
  assert.equal(clampThreshold('nonsense'), DEFAULT_THRESHOLD);
  assert.equal(clampThreshold(undefined), DEFAULT_THRESHOLD);
});

// ---- poll cadence ----

test('polling speeds up at 85% and above', () => {
  assert.equal(pollMinutes(10), NORMAL_POLL_MINUTES);
  assert.equal(pollMinutes(84), NORMAL_POLL_MINUTES);
  assert.equal(pollMinutes(85), FAST_POLL_MINUTES);
  assert.equal(pollMinutes(99), FAST_POLL_MINUTES);
  assert.equal(pollMinutes(null), NORMAL_POLL_MINUTES);
  assert.equal(pollMinutes(undefined), NORMAL_POLL_MINUTES);
});

// ---- firing ----

test('firing happens at or above the threshold, not below', () => {
  assert.equal(decideTrigger(armed, { percent: 94 }, on).fire, false);
  assert.equal(decideTrigger(armed, { percent: 95 }, on).fire, true);
  assert.equal(decideTrigger(armed, { percent: 100 }, on).fire, true);
});

test('the threshold is configurable', () => {
  const low = { autoSaveEnabled: true, threshold: 60 };
  assert.equal(decideTrigger(armed, { percent: 65 }, low).fire, true);
  assert.equal(decideTrigger(armed, { percent: 55 }, low).fire, false);
});

test('a banner fires regardless of the percentage', () => {
  const d = decideTrigger(armed, { percent: 10, banner: { kind: 'reached' } }, on);
  assert.equal(d.fire, true);
  assert.match(d.reason, /banner:reached/);
  assert.equal(decideTrigger(armed, { banner: { kind: 'approaching' } }, on).fire, true);
});

test('nothing fires while auto-save is off', () => {
  const off = { autoSaveEnabled: false, threshold: 95 };
  assert.equal(decideTrigger(armed, { percent: 99 }, off).fire, false);
  assert.equal(decideTrigger(armed, { banner: { kind: 'reached' } }, off).fire, false);
  assert.equal(decideTrigger(armed, { percent: 99 }, off).reason, 'disabled');
});

test('a missing reading never fires', () => {
  const d = decideTrigger(armed, {}, on);
  assert.equal(d.fire, false);
  assert.equal(d.reason, 'no-reading');
});

// ---- de-duplication, one fire per usage window ----

test('firing disarms, so the same window does not fire twice', () => {
  const first = decideTrigger(armed, { percent: 97 }, on);
  assert.equal(first.fire, true);
  assert.equal(first.armed, false, 'disarmed after firing');

  const second = decideTrigger({ armed: false }, { percent: 98 }, on);
  assert.equal(second.fire, false);
  assert.equal(second.reason, 'already-fired-this-window');
});

test('usage dropping below 80% re-arms the trigger', () => {
  assert.equal(decideTrigger({ armed: false }, { percent: 80 }, on).armed, false, '80 is not below 80');
  const rearmed = decideTrigger({ armed: false }, { percent: 79 }, on);
  assert.equal(rearmed.armed, true);
  assert.equal(rearmed.fire, false, 're-arming alone does not fire');
});

test('a re-armed window can fire again on a later reading', () => {
  const rearmed = decideTrigger({ armed: false }, { percent: 20 }, on);
  assert.equal(decideTrigger({ armed: rearmed.armed }, { percent: 96 }, on).fire, true);
});

test('passing the stored reset time re-arms even while usage stays high', () => {
  const state = { armed: false, resetAt: '2026-10-02T12:00:00.000Z' };
  const before = Date.parse('2026-10-02T11:00:00.000Z');
  const after = Date.parse('2026-10-02T13:00:00.000Z');
  assert.equal(decideTrigger(state, { percent: 99 }, on, before).fire, false);
  // After the reset the window is new, so a high reading fires again.
  const d = decideTrigger(state, { percent: 99 }, on, after);
  assert.equal(d.fire, true);
  assert.match(d.reason, /percent:99/);
});

test('a banner cannot fire twice in one window either', () => {
  assert.equal(
    decideTrigger({ armed: false }, { banner: { kind: 'reached' } }, on).fire,
    false
  );
});

test('an absent armed flag is treated as armed', () => {
  assert.equal(decideTrigger({}, { percent: 99 }, on).fire, true);
  assert.equal(decideTrigger(undefined, { percent: 99 }, on).fire, true);
});

// ---- unchanged-transcript skip ----

test('an auto-saved chat at the same message count is skipped', () => {
  assert.equal(shouldSkipUnchanged({ autoSaved: true, messageCount: 40 }, 40), true);
  assert.equal(shouldSkipUnchanged({ autoSaved: true, messageCount: 40 }, 42), false);
});

test('a manually saved chat is never skipped, so auto-save can still run', () => {
  assert.equal(shouldSkipUnchanged({ messageCount: 40 }, 40), false);
  assert.equal(shouldSkipUnchanged({ autoSaved: false, messageCount: 40 }, 40), false);
  assert.equal(shouldSkipUnchanged(null, 40), false);
  assert.equal(shouldSkipUnchanged(undefined, 0), false);
});

// ---- the notification ----

test('the notification names the usage, title and message count', () => {
  assert.equal(
    notificationText(97, 'Parser work', 42),
    'Usage at 97%. Saved "Parser work" (42 messages). Open your other account and click Import.'
  );
});

test('the notification degrades gracefully with no percentage and singular counts', () => {
  assert.match(notificationText(null, 'X', 1), /^Usage at the limit\. Saved "X" \(1 message\)\./);
});
