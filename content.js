// ---------- Selectors (the fragile part: if claude.ai changes, fix these) ----------
const SELECTORS = {
  user: '[data-testid="user-message"]',
  assistant: '.font-claude-response, .font-claude-message, [data-testid="assistant-message"]',
  editor: 'div[contenteditable="true"].ProseMirror, div[contenteditable="true"]',
  fileInput: 'input[type="file"]'
};

// ---------- HTML -> Markdown ----------
function toMd(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const tag = node.tagName.toLowerCase();
  const kids = () => Array.from(node.childNodes).map(toMd).join('');

  switch (tag) {
    case 'script': case 'style': case 'svg': case 'button': return '';
    case 'pre': {
      const code = node.querySelector('code');
      const lang = ((code && code.className.match(/language-([\w+-]+)/)) || [])[1] || '';
      const text = (code || node).textContent.replace(/\n$/, '');
      return '\n```' + lang + '\n' + text + '\n```\n\n';
    }
    case 'code': return '`' + node.textContent + '`';
    case 'strong': case 'b': return '**' + kids() + '**';
    case 'em': case 'i': return '*' + kids() + '*';
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return '#'.repeat(Number(tag[1])) + ' ' + kids().trim() + '\n\n';
    case 'p': return kids().trim() + '\n\n';
    case 'br': return '\n';
    case 'hr': return '\n---\n\n';
    case 'blockquote':
      return kids().trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n';
    case 'a': return '[' + kids() + '](' + (node.getAttribute('href') || '') + ')';
    case 'ul': case 'ol': {
      const items = Array.from(node.children).filter(c => c.tagName.toLowerCase() === 'li');
      return items.map((li, i) => {
        const bullet = tag === 'ol' ? (i + 1) + '. ' : '- ';
        const body = toMd(li).trim().split('\n').map((l, j) => (j ? '   ' + l : l)).join('\n');
        return bullet + body;
      }).join('\n') + '\n\n';
    }
    case 'table': {
      const rows = Array.from(node.querySelectorAll('tr')).map(tr =>
        Array.from(tr.children).map(c => c.textContent.trim().replace(/\|/g, '\\|')));
      if (!rows.length) return '';
      const out = ['| ' + rows[0].join(' | ') + ' |', '| ' + rows[0].map(() => '---').join(' | ') + ' |'];
      rows.slice(1).forEach(r => out.push('| ' + r.join(' | ') + ' |'));
      return out.join('\n') + '\n\n';
    }
    default: return kids();
  }
}

// ---------- Extraction ----------
function extractChat() {
  const all = Array.from(document.querySelectorAll(SELECTORS.user + ', ' + SELECTORS.assistant));
  const nodes = all.filter(el => !all.some(other => other !== el && other.contains(el)));
  if (!nodes.length) throw new Error('No messages found. Open a chat first (selectors may also need updating).');

  const messages = nodes.map(el => ({
    role: el.matches(SELECTORS.user) ? 'user' : 'assistant',
    content: toMd(el).replace(/\n{3,}/g, '\n\n').trim()
  })).filter(m => m.content);

  const idMatch = location.pathname.match(/\/chat\/([\w-]+)/);
  const title = document.title.replace(/\s*[-–|]\s*Claude\s*$/i, '').trim() || 'Untitled chat';
  const markdown =
    '# ' + title + '\n\n' +
    messages.map(m => (m.role === 'user' ? '## User\n\n' : '## Claude\n\n') + m.content).join('\n\n---\n\n');

  return {
    id: idMatch ? idMatch[1] : 'chat-' + Date.now(),
    title, url: location.href, savedAt: new Date().toISOString(),
    messageCount: messages.length, messages, markdown
  };
}
