// C7C: hand-picked lists of people (docs/CRM_PLAN.md). A list is a tag that
// starts with "list:" — no new table. Adding leads to a list adds the tag
// `list:<name>` through the existing bulk tag action; a list's count is the
// number of live leads carrying the tag.
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const campaignScope = require('./campaignScope');
const bulkActions = require('./bulkActions');

const PREFIX = 'list:';
const MAX_TAG = 40; // leadQueue.addTag's limit
const MAX_NAME = MAX_TAG - PREFIX.length;

/** "Hot sellers" → "list:Hot sellers"; 400 for an empty or too long name. */
function tagFor(rawName) {
  const name = String(rawName ?? '').replace(/^list:/i, '').replace(/\s+/g, ' ').trim();
  if (!name) throw new ApiError(400, 'A list needs a name');
  if (name.length > MAX_NAME) throw new ApiError(400, `A list name is ${MAX_NAME} characters at most`);
  return `${PREFIX}${name}`;
}

/** Every list in the file (or ALL) with its count of live leads, by name. */
async function listsFor(campaignId) {
  const s = campaignScope.scope('l', campaignId, 2);
  const { rows } = await db.query(
    `SELECT t AS tag, count(*)::int AS count
     FROM leads l, unnest(l.tags) AS t
     WHERE l.deleted_at IS NULL AND t LIKE $1 AND ${s.sql}
     GROUP BY t
     ORDER BY lower(t)`,
    [`${PREFIX}%`, ...s.params]
  );
  return rows.map((r) => ({ name: r.tag.slice(PREFIX.length), tag: r.tag, count: r.count }));
}

/** ADD TO LIST: the existing bulk tag action with the list's tag. */
async function addToList({ leadIds, name }) {
  const tag = tagFor(name);
  const result = await bulkActions.tag({ leadIds, tag, action: 'add' });
  return { tag, ...result };
}

module.exports = { PREFIX, MAX_NAME, tagFor, listsFor, addToList };
