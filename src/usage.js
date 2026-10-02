// Parsing the usage page. Pure DOM-in / data-out so it can be tested against
// HTML fixtures with jsdom. All selectors come from site.js.
import { USAGE_SELECTORS, looksLoggedOut, RESET_PATTERN } from './site.js';

/** A percentage anywhere in a string: "87%", "87.5 %". */
const PERCENT_IN_TEXT = /(\d{1,3}(?:\.\d+)?)\s*%/;

/** "12 of 40 messages", "12/40 used" → a derived percentage. */
const RATIO_IN_TEXT = /(\d[\d,]*)\s*(?:\/|of|out of)\s*(\d[\d,]*)/i;

function clampPercent(n) {
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function num(s) { return Number(String(s).replace(/,/g, '')); }

/** Percentage from an element's attributes, honouring aria min/max. */
function percentFromAttrs(el) {
  for (const attr of USAGE_SELECTORS.percentAttrs) {
    const raw = el.getAttribute && el.getAttribute(attr);
    if (raw === null || raw === undefined || raw === '') continue;
    const value = num(raw);
    if (!Number.isFinite(value)) continue;
    const min = num(el.getAttribute('aria-valuemin') ?? 0);
    const max = num(el.getAttribute('aria-valuemax') ?? 100);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      return { percent: clampPercent(((value - min) / (max - min)) * 100), source: attr };
    }
    return { percent: clampPercent(value), source: attr };
  }
  return null;
}

/** Percentage from a CSS width/transform style, e.g. style="width: 87%". */
function percentFromStyle(el) {
  const style = (el.getAttribute && el.getAttribute('style')) || '';
  const m = style.match(/width\s*:\s*(\d{1,3}(?:\.\d+)?)\s*%/i);
  return m ? { percent: clampPercent(Number(m[1])), source: 'style-width' } : null;
}

/** Percentage stated, or derivable, from visible text. */
export function percentFromText(text) {
  const s = String(text || '');
  const direct = s.match(PERCENT_IN_TEXT);
  if (direct) return { percent: clampPercent(Number(direct[1])), source: 'text-percent' };
  const ratio = s.match(RATIO_IN_TEXT);
  if (ratio) {
    const used = num(ratio[1]);
    const total = num(ratio[2]);
    if (total > 0 && used <= total * 10) {
      return { percent: clampPercent((used / total) * 100), source: 'text-ratio' };
    }
  }
  return null;
}

/**
 * A short human label for a bar. The heading naming a limit is often a sibling
 * of the meter rather than a descendant, so this searches the bar itself and
 * then walks up a few ancestors before giving up.
 */
function labelFor(el) {
  const aria = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'));
  if (aria && aria.trim()) return tidyLabel(aria.trim());

  let scope = el;
  for (let depth = 0; scope && depth < 4; depth++, scope = scope.parentElement) {
    for (const sel of USAGE_SELECTORS.label) {
      let found;
      try { found = scope.querySelector && scope.querySelector(sel); } catch { continue; }
      const text = found && (found.textContent || '').trim();
      if (text && text.length <= 80) return tidyLabel(text);
    }
    const scopeAria = scope.getAttribute && scope.getAttribute('aria-label');
    if (scopeAria && scopeAria.trim()) return tidyLabel(scopeAria.trim());
  }

  const own = (el.textContent || '').trim();
  return own && own.length <= 80 ? tidyLabel(own) : null;
}

function tidyLabel(text) {
  return text.replace(/\s+/g, ' ').replace(/\s*\d{1,3}(?:\.\d+)?\s*%\s*$/, '').trim().slice(0, 60) || null;
}

function nearbyText(el) {
  const self = (el.textContent || '').trim();
  if (PERCENT_IN_TEXT.test(self) || RATIO_IN_TEXT.test(self)) return self;
  const parent = el.parentElement;
  const up = parent ? (parent.textContent || '').trim() : '';
  return up.length <= 400 ? up : self;
}

/**
 * Parse every usage bar on the page.
 * Returns { percent, label, bars:[{percent,label,selector,source}], rawText,
 *           matchedSelector, loggedOut }.
 * `percent` is the HIGHEST bar — that is the one about to bite. null when
 * nothing could be read.
 */
export function parseUsage(doc = document, href = '') {
  const result = {
    percent: null, label: null, bars: [],
    rawText: '', matchedSelector: null, loggedOut: false
  };

  if (looksLoggedOut(doc, href)) {
    result.loggedOut = true;
    return result;
  }

  const seen = new Set();
  for (const sel of USAGE_SELECTORS.bar) {
    let els;
    try { els = Array.from(doc.querySelectorAll(sel)); } catch { continue; }
    for (const el of els) {
      if (seen.has(el)) continue;
      seen.add(el);
      const hit =
        percentFromAttrs(el) ||
        percentFromStyle(el) ||
        percentFromText(nearbyText(el));
      if (!hit || hit.percent === null) continue;
      result.bars.push({
        percent: hit.percent,
        label: labelFor(el),
        selector: sel,
        source: hit.source
      });
    }
    if (result.bars.length) break;
  }

  // Last resort: scan the whole usage region as plain text.
  if (!result.bars.length) {
    for (const sel of USAGE_SELECTORS.region) {
      const region = doc.querySelector(sel);
      if (!region) continue;
      const text = (region.textContent || '').replace(/\s+/g, ' ').trim();
      result.rawText = text.slice(0, 500);
      const hit = percentFromText(text);
      if (hit && hit.percent !== null) {
        result.bars.push({ percent: hit.percent, label: null, selector: sel, source: hit.source });
        result.matchedSelector = sel;
        break;
      }
    }
  }

  if (result.bars.length) {
    const highest = result.bars.reduce((a, b) => (b.percent > a.percent ? b : a));
    result.percent = highest.percent;
    result.label = highest.label;
    result.matchedSelector = result.matchedSelector || highest.selector;
    if (!result.rawText) {
      const region = doc.querySelector(USAGE_SELECTORS.region[0]) || doc.body;
      result.rawText = region
        ? (region.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500)
        : '';
    }
  }

  result.resetHint = (result.rawText.match(RESET_PATTERN) || [])[1] || null;
  return result;
}
