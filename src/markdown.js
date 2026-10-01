// HTML -> Markdown. Pure DOM in, string out: no claude.ai knowledge beyond the
// marker selectors passed in, so this is unit-testable under jsdom.

const DEFAULTS = {
  artifactSelector: '[data-testid="artifact-block"]',
  attachmentSelector: '[data-testid="file-thumbnail"]'
};

const SKIP_TAGS = new Set(['script', 'style', 'svg', 'noscript', 'template']);

export function htmlToMarkdown(node, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return collapse(convert(node, o, { listDepth: 0 }));
}

function collapse(s) {
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function convert(node, o, ctx) {
  if (!node) return '';
  if (node.nodeType === 3 /* TEXT_NODE */) return node.textContent;
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return '';

  const tag = node.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return '';

  // Artifacts and attachments are recognised before generic handling, because
  // they are usually <div>s that would otherwise render as plain text.
  const special = specialBlock(node, o);
  if (special !== null) return special;

  // Buttons are chrome (copy, retry, ...) unless they carry the only text.
  if (tag === 'button') return '';

  const kids = () => childrenToMd(node, o, ctx);

  switch (tag) {
    case 'pre': return fencedCode(node);
    case 'code': return node.closest('pre') ? node.textContent : '`' + node.textContent.trim() + '`';
    case 'strong': case 'b': return wrapInline(kids(), '**');
    case 'em': case 'i': return wrapInline(kids(), '*');
    case 'del': case 's': return wrapInline(kids(), '~~');
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return '\n' + '#'.repeat(Number(tag[1])) + ' ' + kids().trim() + '\n\n';
    case 'p': case 'div': case 'section': case 'article': {
      const body = kids();
      return body.trim() ? body.trim() + '\n\n' : '';
    }
    case 'br': return '\n';
    case 'hr': return '\n---\n\n';
    case 'blockquote':
      return '\n' + kids().trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n';
    case 'a': {
      const href = node.getAttribute('href') || '';
      const text = kids().trim();
      if (!text) return '';
      return href ? '[' + text + '](' + href + ')' : text;
    }
    case 'img': {
      const alt = node.getAttribute('alt') || '';
      const src = node.getAttribute('src') || '';
      const name = alt || fileNameFromUrl(src) || 'image';
      // Data URLs would bloat the transcript; record them as attachments.
      if (!src || src.startsWith('data:')) return '[attachment: ' + name + ']';
      return '![' + alt + '](' + src + ')';
    }
    case 'ul': case 'ol': return list(node, o, ctx);
    case 'li': return kids();
    case 'table': return table(node);
    default: return kids();
  }
}

function childrenToMd(node, o, ctx) {
  return Array.from(node.childNodes).map(c => convert(c, o, ctx)).join('');
}

/** Keep emphasis markers tight against the text so Markdown stays valid. */
function wrapInline(text, marker) {
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m || !m[2]) return text;
  return m[1] + marker + m[2] + marker + m[3];
}

function fencedCode(pre) {
  const code = pre.querySelector('code');
  const source = code || pre;
  const lang = languageOf(source) || languageOf(pre) || '';
  const text = source.textContent.replace(/\n+$/, '');
  // Use a longer fence if the code itself contains a triple backtick.
  const fence = text.includes('```') ? '````' : '```';
  return '\n' + fence + lang + '\n' + text + '\n' + fence + '\n\n';
}

function languageOf(el) {
  const cls = el.getAttribute && (el.getAttribute('class') || '');
  const m = cls && cls.match(/language-([\w+#.-]+)/);
  if (m) return m[1];
  const attr = el.getAttribute && el.getAttribute('data-language');
  return attr || '';
}

/** Nested lists: indent child content by the bullet width. */
function list(node, o, ctx) {
  const ordered = node.tagName.toLowerCase() === 'ol';
  const start = Number(node.getAttribute('start') || 1);
  const items = Array.from(node.children).filter(c => c.tagName.toLowerCase() === 'li');
  if (!items.length) return '';
  const inner = { ...ctx, listDepth: ctx.listDepth + 1 };
  const lines = items.map((li, i) => {
    const bullet = ordered ? `${start + i}. ` : '- ';
    const body = convert(li, o, inner).trim();
    const indent = ' '.repeat(bullet.length);
    return bullet + body.split('\n').map((l, j) => (j && l ? indent + l : l)).join('\n');
  });
  const block = lines.join('\n');
  return ctx.listDepth === 0 ? '\n' + block + '\n\n' : '\n' + block + '\n';
}

function table(node) {
  const rows = Array.from(node.querySelectorAll('tr')).map(tr =>
    Array.from(tr.children).map(c => c.textContent.trim().replace(/\|/g, '\\|').replace(/\n+/g, ' ')));
  if (!rows.length) return '';
  const width = Math.max(...rows.map(r => r.length));
  const pad = r => { const c = r.slice(); while (c.length < width) c.push(''); return c; };
  const out = [
    '| ' + pad(rows[0]).join(' | ') + ' |',
    '| ' + Array(width).fill('---').join(' | ') + ' |',
    ...rows.slice(1).map(r => '| ' + pad(r).join(' | ') + ' |')
  ];
  return '\n' + out.join('\n') + '\n\n';
}

/**
 * Artifacts and attachment chips. Returns a markdown string, or null when the
 * node is not special and should fall through to normal handling.
 */
function specialBlock(node, o) {
  if (o.attachmentSelector && matches(node, o.attachmentSelector)) {
    const name = attachmentName(node);
    return '[attachment: ' + name + ']\n\n';
  }
  if (o.artifactSelector && matches(node, o.artifactSelector)) {
    const title = (node.getAttribute('aria-label') || node.getAttribute('title') || '').trim();
    const visible = node.textContent.trim().replace(/\s+/g, ' ').slice(0, 2000);
    const label = title || visible.slice(0, 80) || 'untitled';
    const body = visible && visible !== label ? '\n' + visible + '\n' : '';
    return '\n[artifact: ' + label + ']' + body + '\n\n';
  }
  return null;
}

function matches(node, selector) {
  try { return node.matches && node.matches(selector); } catch { return false; }
}

function attachmentName(node) {
  const titled = node.querySelector && node.querySelector('[title]');
  const name =
    node.getAttribute('title') ||
    node.getAttribute('aria-label') ||
    (titled && titled.getAttribute('title')) ||
    node.textContent.trim().split('\n')[0];
  return (name || 'file').trim().slice(0, 120);
}

function fileNameFromUrl(src) {
  try { return decodeURIComponent(new URL(src, 'https://x/').pathname.split('/').pop()) || ''; }
  catch { return ''; }
}
