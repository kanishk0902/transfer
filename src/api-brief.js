// Optional: generate the handoff brief via the Anthropic Messages API instead
// of asking the open chat. Off by default; requires a key the user pastes in
// options. The key and the transcript go only to api.anthropic.com.

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MAX_TRANSCRIPT = 400000; // keep well inside a single request

export const SYSTEM = [
  'You write handoff briefs that let a fresh Claude instance resume a conversation',
  'it has no memory of. Output only the brief, in markdown, using exactly these',
  'headings: ## Goal, ## Key decisions, ## Current state,',
  '## Important code and snippets, ## Open problems, ## Next steps.',
  'Be concrete: name files, identifiers, and include short snippets where they matter.'
].join(' ');

export async function generateBrief({ apiKey, model, transcript, title }) {
  if (!apiKey) throw new Error('No API key set. Add one in the extension options, or use the in-chat brief.');
  const body = {
    model: model || 'claude-sonnet-5',
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content:
        `Here is the transcript of a conversation titled "${title}". Write the handoff brief.\n\n` +
        '<transcript>\n' + String(transcript).slice(0, MAX_TRANSCRIPT) + '\n</transcript>'
    }]
  };

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Required for requests originating from an extension page.
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error('Network error calling the Anthropic API.');
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('Anthropic API rejected the key (401). Check it in options.');
    if (res.status === 429) throw new Error('Anthropic API rate limit hit (429). Try again shortly.');
    throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const brief = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
  if (!brief) throw new Error('The API returned an empty brief.');
  return brief;
}
