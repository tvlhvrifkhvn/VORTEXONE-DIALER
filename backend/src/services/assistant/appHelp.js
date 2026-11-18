// C7F: "how do I…" answers come from docs/USER_GUIDE.md. The guide is split
// into its "## " sections; search(topic) returns the best-matching sections
// (words in the title count double), or the list of titles for no topic.
const fs = require('fs');
const path = require('path');

const GUIDE = path.join(__dirname, '..', '..', '..', '..', 'docs', 'USER_GUIDE.md');
const MAX_SECTIONS = 3;
const STOP = new Set(['how', 'do', 'i', 'a', 'an', 'the', 'to', 'in', 'on', 'of', 'and', 'or', 'my', 'is', 'it', 'can', 'what', 'where', 'for', 'with', 'make', 'use']);

let cache = null;

function sections() {
  if (cache) return cache;
  let text = '';
  try {
    text = fs.readFileSync(GUIDE, 'utf8');
  } catch {
    text = '';
  }
  cache = text
    .split(/^## /m)
    .slice(1)
    .map((block) => {
      const [title, ...rest] = block.split('\n');
      return { title: title.trim(), body: rest.join('\n').trim() };
    });
  return cache;
}

const words = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.replace(/(ies|es|s)$/, (m) => (m === 'ies' ? 'y' : '')));

/** { topics } for no topic; else { topic, sections: [{ title, body }] } (best first, at most 3). */
function search(topic) {
  const all = sections();
  const asked = words(topic);
  if (asked.length === 0) return { topics: all.map((s) => s.title) };
  const scored = all
    .map((s) => {
      const t = new Set(words(s.title));
      const b = words(s.body);
      const score = asked.reduce((n, w) => n + (t.has(w) ? 3 : 0) + b.filter((x) => x === w).length, 0);
      return { ...s, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SECTIONS);
  return scored.length
    ? { topic: String(topic).slice(0, 100), sections: scored.map(({ title, body }) => ({ title, body })) }
    : { topic: String(topic).slice(0, 100), sections: [], topics: all.map((s) => s.title) };
}

module.exports = { search, sections, GUIDE };
