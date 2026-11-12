const { parse } = require('csv-parse/sync');
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const { parsePhone } = require('../utils/phoneNormalize');
const { stateFromAreaCode } = require('../utils/stateFromAreaCode');
const { stateFromAddressText } = require('../utils/stateFromAddressText');
const { buildOfficeKey } = require('../utils/officeKey');
const { US_STATES } = require('../utils/usStates');
const aiCsvMapper = require('./aiCsvMapper');

/** Collapses runs of whitespace and trims — every text field gets this, not
 * just name, since scraped CSVs routinely have double spaces/newlines baked in. */
function cleanText(raw) {
  return (raw || '').replace(/\s+/g, ' ').trim();
}

/** Strips scraped-site junk commonly glued onto a name, e.g. "Joshua Barkes
 * License #: AB44850 - null MARKET CENTER Keller Williams Realty Boise" →
 * "Joshua Barkes". Deterministic (no AI) — only ever removes, never rewrites. */
function cleanLeadName(raw) {
  return cleanText(raw).replace(/\s*license\s*#?:?.*$/i, '').trim();
}

const LEAD_FIELDS = ['name', 'phone', 'email', 'address', 'brokerage', 'state'];
// Mappable but not leads columns. `source` is the secondary column that
// carries the brokerage when the primary one's cell is blank (see
// resolveBrokerage); `city` is a city-only locality column, which scraped
// files often have instead of a full address — it feeds state resolution and
// the merge identity. `first_name` / `last_name` are joined into the name when
// the file has no single name column; `zip` is added to the address text.
const SOURCE_FIELD = 'source';
const CITY_FIELD = 'city';
const NAME_PART_FIELDS = ['first_name', 'last_name'];
const ZIP_FIELD = 'zip';
const MAPPABLE_FIELDS = [...LEAD_FIELDS, ...NAME_PART_FIELDS, CITY_FIELD, ZIP_FIELD, SOURCE_FIELD];

/** The raw name of a row: the mapped name column, or first + last name joined. */
function rawName(row, mapping) {
  if (mapping.name) return row[mapping.name] ?? '';
  return NAME_PART_FIELDS.map((f) => (mapping[f] ? cleanText(row[mapping[f]]) : ''))
    .filter(Boolean)
    .join(' ');
}

function hasNameMapping(mapping) {
  return Boolean(mapping && (mapping.name || mapping.first_name || mapping.last_name));
}
const MAX_SKIPPED_DETAILS = 100;

/**
 * Real scraped files put the brokerage in different columns row by row: an
 * "office" column that's populated for some agents and blank for others, with
 * a "source" column carrying it in exactly the blank cases. Choosing one
 * column for the whole file is wrong for half of it either way, so the
 * fallback is applied per row.
 */
function resolveBrokerage(row, mapping) {
  const primary = mapping.brokerage ? cleanText(row[mapping.brokerage]) : '';
  if (primary) return primary;
  return mapping[SOURCE_FIELD] ? cleanText(row[mapping[SOURCE_FIELD]]) : '';
}

/** Parses a CSV buffer into headers + row objects. Does not touch the DB. */
function parseCsv(buffer) {
  let rows;
  try {
    rows = parse(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (err) {
    throw new ApiError(400, `Could not parse CSV: ${err.message}`);
  }
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

// Header synonyms for guessMapping, compared after lower-casing and dropping
// everything but letters/digits ("E-mail" → "email", "Phone Number" →
// "phonenumber"). `exact` must equal the whole header; `partial` only has to
// appear in it. Fields are tried in this order, exact matches for every field
// first, so "Office Phone" becomes phone before "office" can claim it.
const HEADER_SYNONYMS = [
  ['phone', { exact: ['phone', 'phonenumber', 'phoneno', 'mobile', 'mobilephone', 'mobilenumber', 'cell', 'cellphone', 'cellnumber', 'tel', 'telephone', 'directphone', 'officephone', 'contactnumber', 'number'], partial: ['phone', 'mobile', 'cell', 'telephone'] }],
  ['email', { exact: ['email', 'emailaddress', 'mail', 'email1'], partial: ['email'] }],
  ['first_name', { exact: ['firstname', 'first', 'fname', 'givenname'], partial: ['firstname'] }],
  ['last_name', { exact: ['lastname', 'last', 'lname', 'surname', 'familyname'], partial: ['lastname', 'surname'] }],
  ['name', { exact: ['name', 'fullname', 'agentname', 'agent', 'contactname', 'contact', 'realtor', 'realtorname'], partial: ['name'] }],
  ['brokerage', { exact: ['brokerage', 'brokeragename', 'office', 'officename', 'company', 'companyname', 'agency', 'broker', 'firm'], partial: ['brokerage', 'office', 'company', 'agency', 'broker'] }],
  ['address', { exact: ['address', 'street', 'streetaddress', 'address1', 'addressline1', 'mailingaddress'], partial: ['address', 'street'] }],
  ['city', { exact: ['city', 'town'], partial: ['city'] }],
  ['state', { exact: ['state', 'st', 'province', 'stateprovince'], partial: ['state'] }],
  ['zip', { exact: ['zip', 'zipcode', 'postal', 'postalcode', 'postcode'], partial: ['zip', 'postal'] }],
  ['source', { exact: ['source', 'website', 'site', 'url', 'domain', 'web'], partial: ['source', 'website', 'url'] }],
];
// A header containing one of these is never taken as the person's name.
const NOT_A_NAME = ['first', 'last', 'company', 'office', 'broker', 'file', 'user', 'agency', 'street'];

/**
 * A best-guess column mapping without AI, so the preview can be pre-filled
 * (and is the whole mapping when AI is unavailable). The user can change any
 * of it in the preview before importing.
 */
function guessMapping(headers) {
  const normalized = headers.map((h) => ({ header: h, key: String(h).toLowerCase().replace(/[^a-z0-9]/g, '') }));
  const mapping = {};
  const used = new Set();
  const take = (field, h) => {
    mapping[field] = h.header;
    used.add(h.header);
  };

  for (const [field, { exact }] of HEADER_SYNONYMS) {
    // Earlier synonyms are better matches ("brokerage" beats "agency").
    for (const synonym of exact) {
      const h = normalized.find((c) => !used.has(c.header) && c.key === synonym);
      if (h) {
        take(field, h);
        break;
      }
    }
  }
  for (const [field, { partial }] of HEADER_SYNONYMS) {
    if (mapping[field]) continue;
    const h = normalized.find(
      (c) =>
        !used.has(c.header) &&
        partial.some((p) => c.key.includes(p)) &&
        !(field === 'name' && NOT_A_NAME.some((w) => c.key.includes(w)))
    );
    if (h) take(field, h);
  }
  // A single name column wins over first/last parts.
  if (mapping.name) {
    delete mapping.first_name;
    delete mapping.last_name;
  }
  return mapping;
}

/** The AI's mapping, with any field it didn't map filled from guessMapping
 * (the AI knows nothing about first/last name or zip columns). */
function completeMapping(aiMapping, headers) {
  const mapping = { ...(aiMapping || {}) };
  const used = new Set(Object.values(mapping).filter(Boolean));
  for (const [field, header] of Object.entries(guessMapping(headers))) {
    if (!mapping[field] && !used.has(header)) {
      mapping[field] = header;
      used.add(header);
    }
  }
  if (mapping.name) {
    delete mapping.first_name;
    delete mapping.last_name;
  }
  return mapping;
}

/** The locality half of a merge identity — whichever of city/address/state the
 * file actually carries, normalized so "texas-city, TX" and "Texas City TX"
 * compare equal. Blank when the file has no locality column at all. */
function localityKey(row, mapping) {
  const raw =
    (mapping.city ? cleanText(row[mapping.city]) : '') ||
    (mapping.address ? cleanText(row[mapping.address]) : '') ||
    (mapping.state ? cleanText(row[mapping.state]) : '');
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Everything the import does with one row on its own: name cleanup, the
 * phone (number, extension, raw text), address text and the state
 * (mapped column → address/city text → phone area code). The result is
 * stored as import_rows.prep; the raw row stays in import_rows.data.
 */
function prepareRow(row, mapping) {
  const parsedPhone = parsePhone(mapping.phone ? row[mapping.phone] : '');
  const name = cleanLeadName(rawName(row, mapping));
  const street = mapping.address ? cleanText(row[mapping.address]) : '';
  const zip = mapping[ZIP_FIELD] ? cleanText(row[mapping[ZIP_FIELD]]) : '';
  // A city-only column ("boise id usa") is the only locality a scraped row
  // may carry, and it's the sole state source for a row with no phone —
  // the area-code tier below can't help those.
  const city = mapping.city ? cleanText(row[mapping.city]) : '';
  const locationText = [street, city, zip].filter(Boolean).join(' ');

  let state = mapping.state ? cleanText(row[mapping.state]).toUpperCase() : '';
  if (!US_STATES.includes(state)) state = stateFromAddressText(locationText) || '';
  if (!US_STATES.includes(state) && parsedPhone.e164) state = stateFromAreaCode(parsedPhone.e164) || '';

  return {
    name,
    nameKey: name.toLowerCase(),
    localityKey: localityKey(row, mapping),
    phone: parsedPhone.e164,
    extension: parsedPhone.extension,
    originalPhone: parsedPhone.original,
    unreadable: parsedPhone.unreadable,
    email: mapping.email ? cleanText(row[mapping.email]) || null : null,
    address: [street || city, zip].filter(Boolean).join(' ') || null,
    // Kept separately from address: a mapped city column is a cleaner
    // office-grouping input than re-parsing it back out of the address.
    city: city || null,
    brokerage: resolveBrokerage(row, mapping) || null,
    state: US_STATES.includes(state) ? state : null,
  };
}

/** Fills the gaps in `into` from `from` — same person seen twice in one file.
 * The phone travels as a unit (number, extension, raw text); the name keeps
 * the shorter (already-cleaner) spelling. */
function mergePrep(into, from) {
  const merged = { ...into };
  if (!merged.phone && from.phone) {
    Object.assign(merged, { phone: from.phone, extension: from.extension, originalPhone: from.originalPhone, unreadable: false });
  } else if (!merged.phone && !merged.originalPhone && from.originalPhone) {
    Object.assign(merged, { originalPhone: from.originalPhone, unreadable: from.unreadable });
  }
  for (const field of ['email', 'address', 'city', 'brokerage', 'state']) {
    if (!merged[field] && from[field]) merged[field] = from[field];
  }
  if (from.name && (!merged.name || from.name.length < merged.name.length)) merged.name = from.name;
  return merged;
}

// ---------------------------------------------------------------------------
// Import jobs
//
// Upload: the file is read in batches (a CSV is streamed; an XLSX is read
// sheet range by sheet range) and every row is written to import_rows — the
// rows are never held in memory all at once, nor copied into the job row.
// Processing then works through import_rows in batches of IMPORT_BATCH_SIZE:
//   1. cleaning  — AI cleanup (when on) + prepareRow, per batch
//   2. merging   — same person / same number twice in the file
//   3. saving    — one transaction per batch: DNC list, existing leads and
//                  phoneless identities are each checked with ONE query per
//                  batch, then the batch is inserted
// The batch size is fixed and independent of the file size.
// ---------------------------------------------------------------------------

const IMPORT_BATCH_SIZE = 500;
const CHUNK_SIZE = 20; // rows per AI cleaning call
const MAX_CONCURRENT_CHUNKS = 3;
const RETRY_DELAYS_MS = [2000, 4000, 8000]; // 3 attempts total, backing off

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isJobCancelled(jobId) {
  const { rows } = await db.query('SELECT cancelled FROM import_jobs WHERE id = $1', [jobId]);
  return rows[0]?.cancelled === true;
}

/**
 * Cleans one chunk, retrying a failed Groq call with backoff. A chunk that
 * still fails after every attempt is returned untouched and flagged — one bad
 * chunk must never fail the whole file.
 */
async function cleanChunkWithRetry(chunk, mapping) {
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    try {
      const cleaned = await aiCsvMapper.cleanRowsChunk(chunk, mapping);
      return { ...cleaned, needsManualReview: false };
    } catch (err) {
      const isLastAttempt = attempt === RETRY_DELAYS_MS.length - 1;
      if (isLastAttempt) {
        console.error(`Import chunk failed after ${RETRY_DELAYS_MS.length} attempts:`, err.message);
        return {
          cleanedRows: chunk,
          originals: new Map(),
          skippedIndexes: new Set(),
          needsManualReview: true,
        };
      }
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  // Unreachable, but keeps the shape explicit.
  return { cleanedRows: chunk, originals: new Map(), skippedIndexes: new Set(), needsManualReview: true };
}

/** Writes one batch of raw rows to import_rows (one INSERT). */
async function stageRows(jobId, sheet, rows, firstRowNumber) {
  if (rows.length === 0) return;
  await db.query(
    `INSERT INTO import_rows (job_id, sheet, row_number, data)
     SELECT $1, $2, t.n, t.d FROM unnest($3::int[], $4::jsonb[]) AS t(n, d)`,
    [jobId, sheet, rows.map((_, i) => firstRowNumber + i), rows.map((r) => JSON.stringify(r))]
  );
}

/** Next batch of a job's rows after `afterId`, in file order. */
async function nextRowBatch(client, jobId, afterId, { pendingOnly = false } = {}) {
  const { rows } = await client.query(
    `SELECT id, sheet, row_number, data, prep FROM import_rows
     WHERE job_id = $1 AND id > $2 ${pendingOnly ? 'AND outcome IS NULL' : ''}
     ORDER BY id LIMIT $3`,
    [jobId, afterId, IMPORT_BATCH_SIZE]
  );
  return rows;
}

/** Stores prep / outcome / reason for many rows in one statement. */
async function updateRows(client, updates) {
  if (updates.length === 0) return;
  await client.query(
    `UPDATE import_rows r
     SET prep = COALESCE(v.prep, r.prep), outcome = COALESCE(v.outcome, r.outcome), reason = COALESCE(v.reason, r.reason)
     FROM unnest($1::bigint[], $2::jsonb[], $3::text[], $4::text[]) AS v(id, prep, outcome, reason)
     WHERE r.id = v.id`,
    [
      updates.map((u) => u.id),
      updates.map((u) => (u.prep ? JSON.stringify(u.prep) : null)),
      updates.map((u) => u.outcome || null),
      updates.map((u) => u.reason || null),
    ]
  );
}

const rowLabel = (r) => `${r.sheet} row ${r.row_number}`;

/** Phase 1: AI cleanup (when on, with the circuit breaker) + prepareRow, batch by batch. */
async function cleanPhase(jobId, mapping, state) {
  let afterId = 0;
  for (;;) {
    const batch = await nextRowBatch(db, jobId, afterId);
    if (batch.length === 0) return;
    afterId = batch[batch.length - 1].id;

    const raw = batch.map((r) => r.data);
    const cleaned = new Array(raw.length);
    const aiSkipped = new Set();
    const chunks = [];
    for (let i = 0; i < raw.length; i += CHUNK_SIZE) chunks.push(i);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const start = chunks[next++];
        if (start === undefined) return;
        const chunk = raw.slice(start, start + CHUNK_SIZE);
        let result;
        if (state.aiDown) {
          result = { cleanedRows: chunk, originals: new Map(), skippedIndexes: new Set(), needsManualReview: false };
          state.rowsNotAiCleaned += chunk.length;
        } else {
          result = await cleanChunkWithRetry(chunk, mapping);
          // Circuit breaker: once a chunk has failed every AI attempt the
          // service is treated as down for the rest of this job, instead of
          // each chunk paying for the full retry cycle again.
          if (result.needsManualReview) state.aiDown = true;
        }
        if (result.needsManualReview) state.needsManualReview += chunk.length;
        result.cleanedRows.forEach((row, i) => {
          cleaned[start + i] = row;
          if (result.skippedIndexes.has(i)) aiSkipped.add(start + i);
          if (result.originals.has(i)) state.aiRenamed += 1;
        });
      }
    };
    await Promise.all(Array.from({ length: MAX_CONCURRENT_CHUNKS }, worker));

    await updateRows(
      db,
      batch.map((r, i) =>
        aiSkipped.has(i)
          ? { id: r.id, prep: prepareRow(r.data, mapping), outcome: 'invalid', reason: 'The AI cleaner marked this row as unreadable' }
          : { id: r.id, prep: prepareRow(cleaned[i] || r.data, mapping) }
      )
    );

    state.processed += batch.length;
    await db.query('UPDATE import_jobs SET processed_rows = $2, failed_rows = $3 WHERE id = $1', [
      jobId,
      state.processed,
      state.needsManualReview,
    ]);
    if (await isJobCancelled(jobId)) {
      state.cancelled = true;
      return;
    }
  }
}

/** Groups one name's rows into people: same name + same locality is one
 * person (two blank localities match each other). Returns [[survivor, ...dups]]. */
function groupSameName(rows) {
  const byLocality = new Map();
  for (const r of rows) {
    const key = r.prep.localityKey || '';
    if (!byLocality.has(key)) byLocality.set(key, []);
    byLocality.get(key).push(r);
  }
  return [...byLocality.values()];
}

/**
 * Phase 2: the same person (or the same number) twice in one file. Scraped
 * lists repeat a person across rows (one row with the phone, another with a
 * cleaner name and nothing else); merging keeps one complete lead. Identity
 * is name AND locality — two agents can share a name in different markets.
 * Works one page of duplicate names at a time, so memory doesn't grow with
 * the file.
 */
async function mergePhase(jobId, state) {
  let afterKey = '';
  for (;;) {
    const { rows: keys } = await db.query(
      `SELECT prep->>'nameKey' AS k FROM import_rows
       WHERE job_id = $1 AND outcome IS NULL AND prep->>'nameKey' <> '' AND prep->>'nameKey' > $2
       GROUP BY 1 HAVING count(*) > 1 ORDER BY 1 LIMIT $3`,
      [jobId, afterKey, IMPORT_BATCH_SIZE]
    );
    if (keys.length === 0) break;
    afterKey = keys[keys.length - 1].k;

    const { rows } = await db.query(
      `SELECT id, sheet, row_number, prep FROM import_rows
       WHERE job_id = $1 AND outcome IS NULL AND prep->>'nameKey' = ANY($2) ORDER BY id`,
      [jobId, keys.map((k) => k.k)]
    );
    const byName = new Map();
    for (const r of rows) {
      if (!byName.has(r.prep.nameKey)) byName.set(r.prep.nameKey, []);
      byName.get(r.prep.nameKey).push(r);
    }

    const updates = [];
    for (const nameRows of byName.values()) {
      for (const group of groupSameName(nameRows, state)) {
        if (group.length < 2) continue;
        const [survivor, ...dups] = group;
        let prep = survivor.prep;
        for (const d of dups) {
          prep = mergePrep(prep, d.prep);
          updates.push({ id: d.id, outcome: 'merged', reason: `Same person as ${rowLabel(survivor)} — merged into it` });
        }
        updates.push({ id: survivor.id, prep });
      }
    }
    await updateRows(db, updates);
  }

  // Two different people with one phone number is bad data either way —
  // keep whichever came first in the file.
  await db.query(
    `WITH ranked AS (
       SELECT id, sheet, row_number, prep->>'phone' AS phone,
              first_value(id) OVER (PARTITION BY prep->>'phone' ORDER BY id) AS keep_id
       FROM import_rows WHERE job_id = $1 AND outcome IS NULL AND prep->>'phone' IS NOT NULL
     )
     UPDATE import_rows r
     SET outcome = 'merged',
         reason = 'Same phone number as ' || k.sheet || ' row ' || k.row_number || ' (a different name) — kept the first'
     FROM ranked d JOIN import_rows k ON k.id = d.keep_id
     WHERE r.id = d.id AND d.id <> d.keep_id`,
    [jobId]
  );
}

/**
 * Phase 3: one transaction per batch. Each batch looks up its phones on the
 * DNC list, among existing leads, and its phoneless rows' name+state among
 * existing phoneless leads — one query each — then inserts what is new in
 * one statement. A cancel is checked after every committed batch.
 */
async function savePhase(jobId, state) {
  const { rows: toSave } = await db.query('SELECT count(*)::int AS n FROM import_rows WHERE job_id = $1 AND outcome IS NULL', [jobId]);
  await db.query(`UPDATE import_jobs SET phase = 'saving', rows_to_save = $2, saved_rows = 0 WHERE id = $1`, [jobId, toSave[0].n]);

  let afterId = 0;
  let saved = 0;
  const phonelessSeen = new Set();
  for (;;) {
    const batch = await nextRowBatch(db, jobId, afterId, { pendingOnly: true });
    if (batch.length === 0) return;
    afterId = batch[batch.length - 1].id;

    // Last-resort AI state guess (validated against US_STATES) for named rows
    // that still have no state — a no-op when AI is off or down.
    const needsState = batch.filter((r) => r.prep.name && !r.prep.state);
    if (needsState.length > 0 && !state.aiDown) {
      const guesses = await aiCsvMapper.guessStates(
        needsState.map((r, index) => ({ index, name: r.prep.name, address: r.prep.address || '', brokerage: r.prep.brokerage || '' }))
      );
      for (const [index, guessed] of guesses) if (needsState[index]) needsState[index].prep.state = guessed;
    }

    const client = await db.getClient();
    let written = 0;
    try {
      await client.query('BEGIN');
      const phones = batch.filter((r) => r.prep.phone).map((r) => r.prep.phone);
      const { rows: dncRows } = await client.query('SELECT phone FROM dnc_list WHERE phone = ANY($1)', [phones]);
      const { rows: existingRows } = await client.query('SELECT phone FROM leads WHERE phone = ANY($1)', [phones]);
      const phoneless = batch.filter((r) => !r.prep.phone && r.prep.name && r.prep.state);
      const { rows: identityRows } = await client.query(
        `SELECT lower(name) AS n, state FROM leads
         WHERE phone IS NULL AND deleted_at IS NULL
           AND (lower(name), state) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
        [phoneless.map((r) => r.prep.name.toLowerCase()), phoneless.map((r) => r.prep.state)]
      );
      const dnc = new Set(dncRows.map((r) => r.phone));
      const existing = new Set(existingRows.map((r) => r.phone));
      const identities = new Set(identityRows.map((r) => `${r.n}|${r.state}`));

      const updates = [];
      const inserts = [];
      for (const r of batch) {
        const p = r.prep;
        if (!p.name) updates.push({ id: r.id, prep: p, outcome: 'invalid', reason: 'Missing name' });
        else if (!p.state) updates.push({ id: r.id, prep: p, outcome: 'invalid', reason: 'Could not determine a US state for this lead' });
        else if (p.phone && dnc.has(p.phone)) updates.push({ id: r.id, prep: p, outcome: 'dnc_blocked', reason: `Phone number is on the DNC list: ${p.phone}` });
        else if (p.phone && existing.has(p.phone)) updates.push({ id: r.id, prep: p, outcome: 'already_in_list', reason: `Already in your list (same phone number): ${p.phone}` });
        else if (!p.phone && (identities.has(`${p.nameKey}|${p.state}`) || phonelessSeen.has(`${p.nameKey}|${p.state}`))) {
          updates.push({ id: r.id, prep: p, outcome: 'already_in_list', reason: `Already in your list (same name and state, no phone number): ${p.name} (${p.state})` });
        } else {
          inserts.push(r);
          if (!p.phone) phonelessSeen.add(`${p.nameKey}|${p.state}`);
        }
      }

      if (inserts.length > 0) {
        const cols = inserts.map((r) => r.prep);
        const { rows: insertedRows } = await client.query(
          `INSERT INTO leads (name, phone, email, address, brokerage, state, status, missing_phone, office_key, original_phone, extension)
           SELECT t.name, t.phone, t.email, t.address, t.brokerage, t.state, 'new', t.phone IS NULL, t.office_key, t.original_phone, t.extension
           FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[])
             AS t(name, phone, email, address, brokerage, state, office_key, original_phone, extension)
           ON CONFLICT (phone) DO NOTHING
           RETURNING phone`,
          [
            cols.map((p) => p.name),
            cols.map((p) => p.phone || null),
            cols.map((p) => p.email || null),
            cols.map((p) => p.address || null),
            cols.map((p) => p.brokerage || null),
            cols.map((p) => p.state),
            cols.map((p) => buildOfficeKey({ brokerage: p.brokerage, address: p.address, city: p.city, state: p.state })),
            cols.map((p) => p.originalPhone || null),
            cols.map((p) => p.extension || null),
          ]
        );
        const insertedPhones = new Set(insertedRows.map((r) => r.phone));
        for (const r of inserts) {
          const p = r.prep;
          if (p.phone && !insertedPhones.has(p.phone)) {
            // Taken between the lookup and the insert (another import, a manual add).
            updates.push({ id: r.id, prep: p, outcome: 'already_in_list', reason: `Already in your list (same phone number): ${p.phone}` });
          } else {
            updates.push({ id: r.id, prep: p, outcome: p.phone ? 'imported' : 'no_number' });
            written += 1;
          }
        }
      }

      await updateRows(client, updates);
      await client.query('UPDATE import_jobs SET saved_rows = $2, written_leads = written_leads + $3 WHERE id = $1', [
        jobId,
        saved + batch.length,
        written,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    saved += batch.length;

    if (await isJobCancelled(jobId)) {
      const { rows: left } = await db.query('SELECT 1 FROM import_rows WHERE job_id = $1 AND outcome IS NULL LIMIT 1', [jobId]);
      if (left.length > 0) {
        state.cancelled = true;
        return;
      }
    }
  }
}

/** The import's summary, counted from import_rows. */
async function buildSummary(jobId, state) {
  const { rows: counts } = await db.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE outcome = 'imported')::int AS imported,
            count(*) FILTER (WHERE outcome = 'no_number')::int AS no_number,
            count(*) FILTER (WHERE outcome = 'merged')::int AS merged,
            count(*) FILTER (WHERE outcome = 'already_in_list')::int AS already_in_list,
            count(*) FILTER (WHERE outcome = 'dnc_blocked')::int AS dnc_blocked,
            count(*) FILTER (WHERE outcome = 'invalid')::int AS invalid,
            count(*) FILTER (WHERE outcome IS NULL)::int AS not_processed,
            count(*) FILTER (WHERE outcome = 'no_number' AND (prep->>'unreadable')::boolean)::int AS unreadable,
            count(*) FILTER (WHERE outcome = 'imported' AND prep->>'extension' IS NOT NULL)::int AS with_extension
     FROM import_rows WHERE job_id = $1`,
    [jobId]
  );
  const c = counts[0];
  const { rows: skipped } = await db.query(
    `SELECT data, prep, reason FROM import_rows
     WHERE job_id = $1 AND outcome IN ('merged', 'already_in_list', 'dnc_blocked', 'invalid')
     ORDER BY id LIMIT $2`,
    [jobId, MAX_SKIPPED_DETAILS]
  );
  return {
    totalRows: c.total,
    // Leads written (with and without a phone number).
    imported: c.imported + c.no_number,
    importedWithoutPhone: c.no_number,
    mergedDuplicates: c.merged,
    skippedDuplicate: c.already_in_list,
    skippedDnc: c.dnc_blocked,
    skippedInvalid: c.invalid,
    notProcessed: c.not_processed,
    unreadable: c.unreadable,
    withExtension: c.with_extension,
    written: c.imported + c.no_number,
    needsManualReview: state.needsManualReview,
    aiStoppedAfterFailures: state.aiDown,
    rowsNotAiCleaned: state.rowsNotAiCleaned,
    aiRenamed: state.aiRenamed,
    skippedDetails: skipped.map((r) => ({ row: r.prep?.name || '(no name)', reason: r.reason })),
  };
}

/**
 * Runs an import job end to end (see the phases above). Never throws at the
 * caller — it's fire-and-forget from the route, so every outcome is written
 * to the job row instead.
 */
async function processImportJob(jobId) {
  const { rows: jobRows } = await db.query('SELECT * FROM import_jobs WHERE id = $1', [jobId]);
  const job = jobRows[0];
  if (!job) return;

  const state = { processed: 0, needsManualReview: 0, aiDown: false, rowsNotAiCleaned: 0, aiRenamed: 0, cancelled: false };
  try {
    const mapping = job.mapping || {};
    await db.query(`UPDATE import_jobs SET phase = 'cleaning' WHERE id = $1`, [jobId]);
    await cleanPhase(jobId, mapping, state);
    if (!state.cancelled) await mergePhase(jobId, state);
    if (!state.cancelled) await savePhase(jobId, state);

    const summary = await buildSummary(jobId, state);
    // A cancel that arrived while the last batch was saving finds nothing
    // left to stop: the job is still reported as cancelled, with every row it
    // wrote counted, so the answer the user got ("cancelled, N written") holds.
    if (state.cancelled || (await isJobCancelled(jobId))) summary.cancelled = true;

    await db.query(
      `INSERT INTO import_history (user_id, filename, total_rows, imported, skipped_dnc, skipped_duplicate, skipped_invalid)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [job.user_id || null, job.filename || null, summary.totalRows, summary.imported, summary.skippedDnc, summary.skippedDuplicate, summary.skippedInvalid]
    );
    await db.query(
      `UPDATE import_jobs SET status = $3, completed_at = now(), result_summary = $2 WHERE id = $1`,
      [jobId, JSON.stringify(summary), summary.cancelled ? 'cancelled' : 'completed']
    );
    // Rows that became leads are in leads now; the rest stay in import_rows
    // so every skipped row can still be downloaded.
    await db.query(`DELETE FROM import_rows WHERE job_id = $1 AND outcome IN ('imported', 'no_number')`, [jobId]);
  } catch (err) {
    console.error(`Import job ${jobId} failed:`, err.message);
    await db
      .query(
        `UPDATE import_jobs SET status = 'failed', error_message = $2, completed_at = now() WHERE id = $1`,
        [jobId, err.message]
      )
      .catch(() => {});
  }
}

/**
 * Applies a column mapping to rows given directly (the older synchronous
 * POST /api/imports/commit) by running them through the same job pipeline,
 * and returns the summary.
 */
async function commitImport({ mapping, rows, userId, filename }) {
  if (!hasNameMapping(mapping) || !mapping.phone) {
    throw new ApiError(400, 'mapping must include at least name (or first/last name) and phone');
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ApiError(400, 'No rows to import');
  }
  const jobId = await createImportJob({ userId, filename });
  for (let i = 0; i < rows.length; i += IMPORT_BATCH_SIZE) {
    await stageRows(jobId, 'Sheet1', rows.slice(i, i + IMPORT_BATCH_SIZE), i + 1);
  }
  await db.query(`UPDATE import_jobs SET mapping = $2, total_rows = $3, status = 'processing' WHERE id = $1`, [
    jobId,
    JSON.stringify(mapping),
    rows.length,
  ]);
  await processImportJob(jobId);
  const job = await getImportJob(jobId);
  if (job.status === 'failed') throw new Error(job.error_message || 'Import failed');
  return job.result_summary;
}

async function createImportJob({ userId, filename }) {
  const { rows } = await db.query(
    `INSERT INTO import_jobs (user_id, filename, status, total_rows, mapping)
     VALUES ($1, $2, 'pending', 0, '{}')
     RETURNING id`,
    [userId || null, filename || null]
  );
  return rows[0].id;
}

/** After the upload was read: the row count and the suggested mapping. */
async function setUploadResult(jobId, { totalRows, mapping }) {
  await db.query('UPDATE import_jobs SET total_rows = $2, mapping = $3 WHERE id = $1', [jobId, totalRows, JSON.stringify(mapping || {})]);
}

async function deleteImportJob(jobId) {
  await db.query('DELETE FROM import_jobs WHERE id = $1', [jobId]);
}

async function getImportJob(jobId) {
  const { rows } = await db.query(
    `SELECT id, filename, status, total_rows, processed_rows, failed_rows, result_summary,
            error_message, cancelled, created_at, completed_at, phase, rows_to_save, saved_rows, written_leads
     FROM import_jobs WHERE id = $1`,
    [jobId]
  );
  return rows[0] || null;
}

/**
 * The user confirmed the mapping (and, for a workbook, which sheets): drop
 * the rows of sheets they left out, record the mapping, and mark the job
 * processing. Returns the number of rows to import.
 */
async function startJob(jobId, userId, { sheets, mapping }) {
  if (!hasNameMapping(mapping) || !mapping.phone) {
    throw new ApiError(400, 'Map the phone column and a name (or first/last name) column before importing.');
  }
  const { rows } = await db.query(`SELECT id, status FROM import_jobs WHERE id = $1 AND user_id = $2`, [jobId, userId]);
  if (!rows[0]) throw new ApiError(404, 'Import job not found');
  if (rows[0].status !== 'pending') throw new ApiError(409, `This import is already ${rows[0].status}.`);

  if (Array.isArray(sheets) && sheets.length > 0) {
    await db.query('DELETE FROM import_rows WHERE job_id = $1 AND NOT (sheet = ANY($2))', [jobId, sheets]);
  }
  const { rows: count } = await db.query('SELECT count(*)::int AS n FROM import_rows WHERE job_id = $1', [jobId]);
  if (count[0].n === 0) throw new ApiError(400, 'The selected sheets have no rows.');
  await db.query(
    `UPDATE import_jobs SET mapping = $2, total_rows = $3, status = 'processing', processed_rows = 0 WHERE id = $1`,
    [jobId, JSON.stringify(mapping), count[0].n]
  );
  return count[0].n;
}

/**
 * Cancels an import if it is still running. Returns one of:
 *   { cancelled: true, written: 0 }            not started yet (pending)
 *   { cancelled: true, phase, written: N }     running: no further batch is
 *                                              saved; the N rows already
 *                                              committed stay and are reported
 *   { cancelled: false, tooLate: true, ... }   already finished
 *   null                                       no such job
 */
async function cancelImportJob(jobId) {
  const { rows } = await db.query(
    `UPDATE import_jobs
     SET cancelled = true,
         status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE status END,
         completed_at = CASE WHEN status = 'pending' THEN now() ELSE completed_at END
     WHERE id = $1 AND status IN ('pending', 'processing')
     RETURNING id, status, phase, written_leads`,
    [jobId]
  );
  if (rows[0]) {
    const job = rows[0];
    return {
      cancelled: true,
      jobId: job.id,
      phase: job.status === 'cancelled' ? null : job.phase,
      written: job.written_leads,
      message:
        job.written_leads > 0
          ? `Stopping. ${job.written_leads} leads were already saved and stay; no further rows will be saved after the batch in progress.`
          : 'Stopping. No leads have been saved from this file.',
    };
  }
  const { rows: existing } = await db.query('SELECT id, status, written_leads FROM import_jobs WHERE id = $1', [jobId]);
  if (!existing[0]) return null;
  return {
    cancelled: false,
    tooLate: true,
    jobId: existing[0].id,
    status: existing[0].status,
    written: existing[0].written_leads,
    message: `Too late to cancel — this import is already ${existing[0].status}.`,
  };
}

/** Live progress in two phases: "cleaning" (rows read and checked), then
 * "saving" (batches committed). 100% only once the job has completed. */
function progressOf(job) {
  const total = job.total_rows || 0;
  let percentage = 0;
  let phaseLabel = '';
  if (job.status === 'completed') {
    percentage = 100;
    phaseLabel = 'Done';
  } else if (job.phase === 'saving') {
    const toSave = job.rows_to_save || 0;
    percentage = 50 + (toSave > 0 ? Math.floor((job.saved_rows / toSave) * 49) : 49);
    phaseLabel = `Saving ${job.saved_rows.toLocaleString('en-US')} / ${toSave.toLocaleString('en-US')} rows`;
  } else {
    percentage = total > 0 ? Math.floor((job.processed_rows / total) * 50) : 0;
    phaseLabel = `Cleaning ${(job.processed_rows || 0).toLocaleString('en-US')} / ${total.toLocaleString('en-US')} rows`;
  }
  return { percentage: Math.min(job.status === 'completed' ? 100 : 99, percentage), phaseLabel };
}

/** Last 10 imports for the Import page's history table. */
async function getImportHistory() {
  const { rows } = await db.query(
    `SELECT id, filename, imported_at, total_rows, imported, skipped_dnc, skipped_duplicate, skipped_invalid
     FROM import_history
     ORDER BY imported_at DESC
     LIMIT 10`
  );
  return rows;
}

module.exports = {
  LEAD_FIELDS,
  MAPPABLE_FIELDS,
  parseCsv,
  guessMapping,
  completeMapping,
  commitImport,
  getImportHistory,
  IMPORT_BATCH_SIZE,
  createImportJob,
  stageRows,
  setUploadResult,
  deleteImportJob,
  startJob,
  getImportJob,
  cancelImportJob,
  progressOf,
  processImportJob,
};
