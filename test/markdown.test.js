import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { htmlToMarkdown } from '../src/markdown.js';

const OPTS = {
  artifactSelector: '[data-testid="artifact-block"]',
  attachmentSelector: '[data-testid="file-thumbnail"]'
};

function frag(html) {
  return new JSDOM(`<body>${html}</body>`).window.document.body;
}

function fixture(name) {
  const html = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  return new JSDOM(html).window.document;
}

test('inline formatting', () => {
  const md = htmlToMarkdown(frag('<p>a <strong>b</strong> and <em>c</em> and <code>d</code></p>'), OPTS);
  assert.equal(md, 'a **b** and *c* and `d`');
});

test('emphasis keeps surrounding spaces outside the markers', () => {
  const md = htmlToMarkdown(frag('<p>x<strong> bold </strong>y</p>'), OPTS);
  assert.equal(md, 'x **bold** y');
});

test('code block keeps its language and content', () => {
  const md = htmlToMarkdown(frag('<pre><code class="language-python">x = 1\ny = 2</code></pre>'), OPTS);
  assert.equal(md, '```python\nx = 1\ny = 2\n```');
});

test('code block without a language still fences', () => {
  const md = htmlToMarkdown(frag('<pre><code>plain</code></pre>'), OPTS);
  assert.equal(md, '```\nplain\n```');
});

test('code containing a fence uses a longer fence', () => {
  const md = htmlToMarkdown(frag('<pre><code>```\nnested\n```</code></pre>'), OPTS);
  assert.ok(md.startsWith('````'), md);
});

test('data-language attribute is read as the language', () => {
  const md = htmlToMarkdown(frag('<pre data-language="rust"><code>fn main() {}</code></pre>'), OPTS);
  assert.equal(md, '```rust\nfn main() {}\n```');
});

test('nested lists are indented', () => {
  const md = htmlToMarkdown(frag('<ul><li>one<ul><li>deep</li></ul></li><li>two</li></ul>'), OPTS);
  assert.equal(md, '- one\n  - deep\n- two');
});

test('ordered lists number from start', () => {
  const md = htmlToMarkdown(frag('<ol start="3"><li>c</li><li>d</li></ol>'), OPTS);
  assert.equal(md, '3. c\n4. d');
});

test('tables render with a header separator and escaped pipes', () => {
  const md = htmlToMarkdown(frag('<table><tr><th>a|b</th><th>c</th></tr><tr><td>1</td><td>2</td></tr></table>'), OPTS);
  assert.equal(md, '| a\\|b | c |\n| --- | --- |\n| 1 | 2 |');
});

test('ragged table rows are padded to the widest row', () => {
  const md = htmlToMarkdown(frag('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>'), OPTS);
  assert.equal(md.split('\n').pop(), '| c |  |');
});

test('links keep text and href; empty links are dropped', () => {
  assert.equal(htmlToMarkdown(frag('<a href="https://x.test">go</a>'), OPTS), '[go](https://x.test)');
  assert.equal(htmlToMarkdown(frag('<a href="https://x.test"></a>'), OPTS), '');
});

test('images become markdown, data URLs become attachments', () => {
  assert.equal(htmlToMarkdown(frag('<img src="https://x.test/a.png" alt="pic">'), OPTS), '![pic](https://x.test/a.png)');
  assert.equal(htmlToMarkdown(frag('<img src="data:image/png;base64,AAA" alt="pasted">'), OPTS), '[attachment: pasted]');
});

test('attachment chips are noted by name', () => {
  const md = htmlToMarkdown(frag('<div data-testid="file-thumbnail" title="report.pdf">report.pdf</div>'), OPTS);
  assert.equal(md, '[attachment: report.pdf]');
});

test('artifacts keep a label and their visible text', () => {
  const md = htmlToMarkdown(frag('<div data-testid="artifact-block" aria-label="app.js">const a = 1;</div>'), OPTS);
  assert.ok(md.startsWith('[artifact: app.js]'), md);
  assert.ok(md.includes('const a = 1;'), md);
});

test('scripts, styles and buttons are dropped', () => {
  const md = htmlToMarkdown(frag('<div><p>keep</p><script>bad()</script><style>x{}</style><button>Copy</button></div>'), OPTS);
  assert.equal(md, 'keep');
});

test('blockquotes are prefixed on every line', () => {
  const md = htmlToMarkdown(frag('<blockquote><p>one</p><p>two</p></blockquote>'), OPTS);
  assert.equal(md, '> one\n>\n> two');
});

test('full fixture message converts end to end', () => {
  const doc = fixture('chat.html');
  const md = htmlToMarkdown(doc.querySelector('.font-claude-response'), OPTS);
  assert.ok(md.includes('```js'), 'code fence with language');
  assert.ok(md.includes('  - handle UTF-8'), 'nested list indented');
  assert.ok(md.includes('[the docs](https://example.com/docs)'), 'link');
  assert.ok(md.includes('| Field | Type |'), 'table header');
  assert.ok(md.includes('[artifact: parser.js]'), 'artifact');
  assert.ok(!md.includes('\n\n\n'), 'no triple blank lines');
});

test('user fixture message records its attachment', () => {
  const doc = fixture('chat.html');
  const md = htmlToMarkdown(doc.querySelector('[data-testid="user-message"]'), OPTS);
  assert.ok(md.includes('**parser**'));
  assert.ok(md.includes('[attachment: notes.md]'));
});
