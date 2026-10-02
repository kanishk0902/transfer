import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { parseUsage, percentFromText } from '../src/usage.js';
import { matchLimitPhrase, findLimitBanner, looksLoggedOut, LOGIN_URL_PATTERN } from '../src/site.js';

function load(name) {
  const html = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  return new JSDOM(html).window.document;
}

// ---- percentage parsing against fixtures ----

test('aria-valuenow bars parse, and the highest wins', () => {
  const u = parseUsage(load('usage-aria.html'), 'https://claude.ai/settings/usage');
  assert.equal(u.percent, 96);
  assert.equal(u.loggedOut, false);
  assert.equal(u.bars.length, 2);
  // Every bar is stored with its own label.
  const byLabel = Object.fromEntries(u.bars.map(b => [b.label, b.percent]));
  assert.equal(byLabel['Current session'], 42);
  assert.equal(byLabel['Weekly limit'], 96);
  assert.equal(u.label, 'Weekly limit');
  assert.ok(u.matchedSelector, 'records which selector matched');
});

test('aria min/max are honoured, not assumed to be 0-100', () => {
  const u = parseUsage(load('usage-scaled.html'));
  assert.equal(u.percent, 90);   // 180 of 200
});

test('a percentage in visible text is read when no attributes exist', () => {
  const u = parseUsage(load('usage-text.html'));
  assert.equal(u.percent, 73);
  assert.equal(u.bars.length, 2);
  assert.deepEqual(u.bars.map(b => b.percent).sort((a, b) => a - b), [12, 73]);
});

test('a CSS width percentage is read from the fill element', () => {
  const u = parseUsage(load('usage-style-width.html'));
  assert.equal(u.percent, 88);
  assert.equal(u.bars[0].source, 'style-width');
});

test('a used/total ratio is converted to a percentage', () => {
  const u = parseUsage(load('usage-ratio.html'));
  assert.equal(u.percent, 90);   // 45 of 50
});

test('the login page is reported as logged out, not as 0%', () => {
  const u = parseUsage(load('usage-login.html'), 'https://claude.ai/login?returnTo=/settings/usage');
  assert.equal(u.loggedOut, true);
  assert.equal(u.percent, null);
});

test('a login URL alone is enough to detect being logged out', () => {
  assert.equal(looksLoggedOut(load('usage-unknown.html'), 'https://claude.ai/login'), true);
  assert.equal(looksLoggedOut(load('usage-unknown.html'), 'https://claude.ai/settings/usage'), false);
});

test('the login URL pattern matches the redirects the monitor must notice', () => {
  for (const url of [
    'https://claude.ai/login',
    'https://claude.ai/login?returnTo=%2Fsettings%2Fusage',
    'https://claude.ai/sign-in',
    'https://claude.ai/oauth/authorize'
  ]) assert.ok(LOGIN_URL_PATTERN.test(url), url);

  for (const url of [
    'https://claude.ai/settings/usage',
    'https://claude.ai/chat/abc-123'
  ]) assert.equal(LOGIN_URL_PATTERN.test(url), false, url);
});

test('unrecognisable markup yields null rather than a wrong number', () => {
  const u = parseUsage(load('usage-unknown.html'));
  assert.equal(u.percent, null);
  assert.deepEqual(u.bars, []);
  assert.ok(u.rawText.includes('Nothing here resembles'), 'raw text is kept for debugging');
});

test('the reset hint is captured when the page states one', () => {
  assert.equal(parseUsage(load('usage-aria.html')).resetHint, '5:00 PM on Friday');
  assert.equal(parseUsage(load('usage-text.html')).resetHint, '2 hours');
});

// ---- the pure text helper ----

test('percentFromText handles decimals, ratios and absence', () => {
  assert.equal(percentFromText('87%').percent, 87);
  assert.equal(percentFromText('87.6 %').percent, 88);
  assert.equal(percentFromText('used 3/4 of your limit').percent, 75);
  assert.equal(percentFromText('no numbers here'), null);
  assert.equal(percentFromText(''), null);
  assert.equal(percentFromText(null), null);
});

test('percentages are clamped into 0-100', () => {
  assert.equal(percentFromText('150%').percent, 100);
  const dom = new JSDOM('<main><div role="progressbar" aria-valuenow="-20"></div></main>');
  assert.equal(parseUsage(dom.window.document).percent, 0);
});

// ---- limit banners ----

test('limit-reached phrases are matched and outrank approaching ones', () => {
  assert.equal(matchLimitPhrase('You have reached your limit reached today').kind, 'reached');
  assert.equal(matchLimitPhrase('You are approaching your limit').kind, 'approaching');
  assert.equal(
    matchLimitPhrase('You are approaching your limit — usage limit reached soon').kind,
    'reached',
    'reached wins when both appear'
  );
  assert.equal(matchLimitPhrase('A totally ordinary sentence.'), null);
  assert.equal(matchLimitPhrase(''), null);
});

test('phrase matching ignores case and collapsed whitespace', () => {
  assert.ok(matchLimitPhrase('LIMIT   REACHED'));
  assert.ok(matchLimitPhrase('You’ve reached your limit'));
});

test('findLimitBanner locates a banner and reports the selector', () => {
  const doc = new JSDOM(
    '<main><div role="alert">You are approaching your limit for this session.</div></main>'
  ).window.document;
  const hit = findLimitBanner(doc);
  assert.equal(hit.kind, 'approaching');
  assert.equal(hit.selector, '[role="alert"]');
  assert.ok(hit.text.includes('approaching'));
});

test('a long page body is not mistaken for a banner', () => {
  const doc = new JSDOM(
    '<main><div role="alert">' + 'filler '.repeat(100) + 'limit reached</div></main>'
  ).window.document;
  assert.equal(findLimitBanner(doc), null);
});

test('a page with no banner returns null', () => {
  assert.equal(findLimitBanner(load('usage-text.html')), null);
});
