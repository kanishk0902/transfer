import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { findMessages, conversationId, chatTitle } from '../src/site.js';

function load(name) {
  const html = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  const dom = new JSDOM(html);
  // site.js reads Node.DOCUMENT_POSITION_FOLLOWING from the global.
  globalThis.Node = dom.window.Node;
  return dom.window.document;
}

test('primary selectors find both roles in document order', () => {
  const { nodes, strategy } = findMessages(load('chat.html'));
  assert.equal(strategy, 'testid');
  assert.deepEqual(nodes.map(n => n.role), ['user', 'assistant', 'user']);
});

test('messages are returned in reading order', () => {
  const { nodes } = findMessages(load('chat.html'));
  assert.ok(nodes[0].el.textContent.includes('Can you help'));
  assert.ok(nodes[2].el.textContent.includes('ship it'));
});

test('heuristic fallback finds turns when every known hook is gone', () => {
  const { nodes, strategy } = findMessages(load('chat-unknown-markup.html'));
  assert.equal(strategy, 'heuristic');
  assert.equal(nodes.length, 3);
  assert.deepEqual(nodes.map(n => n.role), ['user', 'assistant', 'user']);
});

test('a single-turn chat is accepted via the partial tier', () => {
  const dom = new JSDOM('<main><div data-testid="user-message"><p>only one turn here</p></div></main>');
  globalThis.Node = dom.window.Node;
  const { nodes, strategy } = findMessages(dom.window.document);
  assert.equal(nodes.length, 1);
  assert.match(strategy, /partial/);
});

test('a group that finds only user turns does not win outright', () => {
  // Assistant turns present but under markup none of the groups know about.
  const dom = new JSDOM(
    '<main><div data-testid="user-message"><p>question text that is long enough</p></div>' +
    '<div class="mystery"><p>answer text that is also long enough</p></div></main>');
  globalThis.Node = dom.window.Node;
  const { strategy } = findMessages(dom.window.document);
  assert.notEqual(strategy, 'testid');
});

test('an empty page yields no messages rather than throwing', () => {
  const doc = new JSDOM('<main></main>').window.document;
  globalThis.Node = new JSDOM('').window.Node;
  assert.deepEqual(findMessages(doc).nodes, []);
});

test('conversation id comes from the URL path', () => {
  assert.equal(conversationId({ pathname: '/chat/abc-123' }), 'abc-123');
  assert.equal(conversationId({ pathname: '/new' }), null);
});

test('title strips the Claude suffix', () => {
  assert.equal(chatTitle({ title: 'Parser work - Claude' }), 'Parser work');
  assert.equal(chatTitle({ title: '' }), 'Untitled chat');
});
