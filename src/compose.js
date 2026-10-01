// Builds what gets typed into the new chat. Pure string logic, unit-testable.

export const LARGE_TRANSCRIPT_CHARS = 150000;

const LEAD =
  'I am continuing a conversation I had in another Claude account. ' +
  'Read the handoff brief below (and the attached transcript if present), then ' +
  'briefly confirm what we were working on, what has been decided, and what is left to do. ' +
  'Then ask me what I want to continue with.';

const LEAD_NO_BRIEF =
  'Below is the transcript of a previous conversation I had in another Claude account. ' +
  'Read it carefully, then briefly summarize what we were working on, what has been decided, ' +
  'and what is left to do. After that, ask me what I want to continue with.';

/**
 * Decide what to send for a given chat and requested mode.
 * mode: 'brief' | 'brief+file' | 'full'
 * Returns { text, attach: {filename, content} | null, effectiveMode, reason }.
 */
export function composeImport(chat, mode = 'brief+file') {
  const brief = (chat.brief || '').trim();
  const markdown = chat.markdown || '';
  const filename = `previous-chat_${slug(chat.title)}.md`;
  const tooBig = markdown.length > LARGE_TRANSCRIPT_CHARS;

  if (mode === 'brief' || (!markdown && brief)) {
    return { text: LEAD + '\n\n' + section('handoff_brief', brief), attach: null, effectiveMode: 'brief', reason: null };
  }

  if (mode === 'full' || !brief) {
    if (tooBig && brief) {
      return {
        text: LEAD + '\n\n' + section('handoff_brief', brief),
        attach: null,
        effectiveMode: 'brief',
        reason: `Transcript is ${Math.round(markdown.length / 1000)}k characters — sent the brief only.`
      };
    }
    const lead = brief ? LEAD : LEAD_NO_BRIEF;
    const body = brief ? section('handoff_brief', brief) + '\n\n' : '';
    return {
      text: lead + '\n\n' + body + section('previous_conversation', markdown),
      attach: null,
      effectiveMode: 'full',
      reason: null
    };
  }

  // brief+file (default)
  if (tooBig) {
    return {
      text: LEAD + '\n\n' + section('handoff_brief', brief),
      attach: null,
      effectiveMode: 'brief',
      reason: `Transcript is ${Math.round(markdown.length / 1000)}k characters — sent the brief only.`
    };
  }
  return {
    text: LEAD + ' The full transcript is attached as a file for reference only.\n\n' +
          section('handoff_brief', brief),
    attach: { filename, content: markdown },
    effectiveMode: 'brief+file',
    reason: null
  };
}

/** When the file attach fails, paste the transcript inline instead. */
export function fallbackToPaste(composed, chat) {
  const brief = (chat.brief || '').trim();
  const markdown = chat.markdown || '';
  if (markdown.length > LARGE_TRANSCRIPT_CHARS) {
    return {
      text: LEAD + '\n\n' + section('handoff_brief', brief),
      attach: null,
      effectiveMode: 'brief',
      reason: 'File attach failed and the transcript is too large to paste — sent the brief only.'
    };
  }
  return {
    text: LEAD + '\n\n' +
          (brief ? section('handoff_brief', brief) + '\n\n' : '') +
          section('previous_conversation', markdown),
    attach: null,
    effectiveMode: 'brief+paste',
    reason: 'File attach failed — pasted the transcript inline instead.'
  };
}

function section(tag, body) {
  return `<${tag}>\n${body}\n</${tag}>`;
}

export function slug(title) {
  return (title || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'chat';
}
