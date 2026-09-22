const { parse } = require('csv-parse/sync');
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const { normalizePhone } = require('../utils/phoneNormalize');
const { stateFromAreaCode } = require('../utils/stateFromAreaCode');
const { stateFromAddressText } = require('../utils/stateFromAddressText');
const { buildOfficeKey } = require('../utils/officeKey');
const { US_STATES } = require('../utils/usStates');
const dncCheck = require('./dncCheck');
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
// the merge identity.
const SOURCE_FIELD = 'source';
const CITY_FIELD = 'city';
const MAPPABLE_FIELDS = [...LEAD_FIELDS, CITY_FIELD, SOURCE_FIELD];
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

/** A best-guess column mapping so the frontend can pre-fill the mapping UI. */
function guessMapping(headers) {
  const normalized = headers.map((h) => ({ header: h, key: h.toLowerCase().replace(/[^a-z]/g, '') }));
  const mapping = {};
  const used = new Set();

  for (const field of MAPPABLE_FIELDS) {
    const exact = normalized.find((h) => !used.has(h.header) && h.key === field);
    const partial = normalized.find((h) => !used.has(h.header) && h.key.includes(field));
    const match = exact || partial;
    if (match) {
      mapping[field] = match.header;
      used.add(match.header);
    }
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
 * Scraped agent lists repeat the same person across rows: one row carries the
 * dirty name plus the phone/email, another carries the clean name with no
 * contact details. Merging them keeps one complete lead instead of importing a
 * usable row and a useless one.
 *
 * Identity is name AND locality, not name alone — two different agents can
 * share a name in different markets, and collapsing those loses a real person.
 * Rows with no locality data at all still group on name, since two blank
 * localities match each other.
 *
 * Runs before the per-row import loop below, purely on the in-memory rows —
 * the DNC check, phone validation and existing-lead dedup are untouched and
 * still run afterwards on whatever survives here.
 */
function mergeDuplicateRows(mapping, rows) {
  const valueOf = (row, field) => (mapping[field] ? cleanText(row[mapping[field]]) : '');
  const byName = new Map();
  let mergedCount = 0;

  for (const row of rows) {
    const name = cleanLeadName(row[mapping.name]).toLowerCase();
    const key = name ? `${name}|${localityKey(row, mapping)}` : '';
    if (!key) {
      // No usable name to group on — leave it for the import loop to reject.
      byName.set(`__unkeyed_${byName.size}`, row);
      continue;
    }

    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, row);
      continue;
    }

    // Same person twice: take each field from whichever row actually has it,
    // and prefer the shorter (already-cleaner) name.
    const merged = { ...existing };
    for (const field of LEAD_FIELDS) {
      if (!mapping[field]) continue;
      const existingValue = valueOf(existing, field);
      const incomingValue = valueOf(row, field);

      if (field === 'name') {
        if (incomingValue && (!existingValue || incomingValue.length < existingValue.length)) {
          merged[mapping[field]] = row[mapping[field]];
        }
        continue;
      }
      if (!existingValue && incomingValue) {
        merged[mapping[field]] = row[mapping[field]];
      }
    }

    byName.set(key, merged);
    mergedCount += 1;
  }

  // Two different people sharing one phone number is bad data either way —
  // keep whichever came first, drop the rest.
  const seenPhones = new Set();
  const deduped = [];
  for (const row of byName.values()) {
    const phone = normalizePhone(row[mapping.phone]);
    if (phone) {
      if (seenPhones.has(phone)) {
        mergedCount += 1;
        continue;
      }
      seenPhones.add(phone);
    }
    deduped.push(row);
  }

  return { rows: deduped, mergedCount };
}

/**
 * Applies a column mapping to previously-parsed rows and commits valid,
 * non-duplicate, non-DNC leads to the database. Returns a summary rather
 * than throwing on a per-row basis — a bad row shouldn't fail the batch.
 */
async function commitImport({ mapping, rows, userId, filename }) {
  if (!mapping || !mapping.name || !mapping.phone) {
    throw new ApiError(400, 'mapping must include at least name and phone');
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ApiError(400, 'No rows to import');
  }

  const summary = {
    totalRows: rows.length,
    imported: 0,
    skippedDnc: 0,
    skippedDuplicate: 0,
    skippedInvalid: 0,
    mergedDuplicates: 0,
    importedWithoutPhone: 0,
    skippedDetails: [],
  };

  // Fold repeated rows for the same person into one complete lead first.
  // summary.totalRows above is deliberately the pre-merge count.
  const merged = mergeDuplicateRows(mapping, rows);
  summary.mergedDuplicates = merged.mergedCount;
  const workingRows = merged.rows;

  const skip = (row, reason) => {
    if (summary.skippedDetails.length < MAX_SKIPPED_DETAILS) {
      summary.skippedDetails.push({ row: row[mapping.name] || row[mapping.phone] || '(unknown)', reason });
    }
  };

  // Pass 1 — deterministic cleanup + state resolution (mapped column, then
  // address text, then phone area code). No AI involved yet.
  const prepared = workingRows.map((row) => {
    const rawPhone = row[mapping.phone];
    const phone = normalizePhone(rawPhone);
    const name = cleanLeadName(row[mapping.name]);
    const address = mapping.address ? cleanText(row[mapping.address]) : '';
    // A city-only column ("boise id usa") is the only locality a scraped row
    // may carry, and it's the sole state source for a row with no phone —
    // the area-code tier below can't help those.
    const city = mapping.city ? cleanText(row[mapping.city]) : '';
    const locationText = [address, city].filter(Boolean).join(' ');

    let state = mapping.state ? cleanText(row[mapping.state]).toUpperCase() : '';
    if (!US_STATES.includes(state)) state = stateFromAddressText(locationText) || '';
    if (!US_STATES.includes(state) && phone) state = stateFromAreaCode(phone) || '';

    return {
      row,
      rawPhone,
      phone,
      name,
      address: address || city,
      // Kept separately from address: a mapped city column is a cleaner
      // office-grouping input than re-parsing it back out of the address.
      city,
      state: US_STATES.includes(state) ? state : null,
    };
  });

  // Pass 2 — last-resort AI guess (validated against US_STATES) for
  // otherwise-valid rows that still have no state, capped and batched inside
  // aiCsvMapper.guessStates. Rows with no name aren't worth the call — but
  // phoneless ones are exactly the rows that need it most, since they skipped
  // the area-code tier above.
  const needsAiState = prepared
    .map((p, index) => ({ ...p, index }))
    .filter((p) => p.name && !p.state);

  if (needsAiState.length > 0) {
    const guesses = await aiCsvMapper.guessStates(
      needsAiState.map((p) => ({
        index: p.index,
        name: p.name,
        address: p.address,
        brokerage: resolveBrokerage(p.row, mapping),
      }))
    );
    for (const [index, state] of guesses) {
      prepared[index].state = state;
    }
  }

  // Pass 3 — dedupe (exact phone match, in-file and against existing leads),
  // DNC check, and insert.
  const seenPhones = new Set();

  for (const p of prepared) {
    const { row, rawPhone, phone, name, address, city, state } = p;

    if (!name) {
      summary.skippedInvalid += 1;
      skip(row, 'Missing name');
      continue;
    }
    if (!state) {
      summary.skippedInvalid += 1;
      skip(row, `Could not determine a US state for this lead`);
      continue;
    }

    // A row with a name but no usable phone is a real person from a partial
    // scrape, not junk — import it flagged and non-dialable rather than
    // dropping it (CLAUDE.md: no lead ever silently disappears).
    const missingPhone = !phone;

    if (phone) {
      if (seenPhones.has(phone)) {
        summary.skippedDuplicate += 1;
        skip(row, `Duplicate phone number within this file: ${phone}`);
        continue;
      }
      seenPhones.add(phone);

      if (await dncCheck.isOnDncList(phone)) {
        summary.skippedDnc += 1;
        skip(row, `Phone number is on the DNC list: ${phone}`);
        continue;
      }

      const { rows: existing } = await db.query('SELECT id FROM leads WHERE phone = $1', [phone]);
      if (existing.length > 0) {
        summary.skippedDuplicate += 1;
        skip(row, `Lead with this phone number already exists: ${phone}`);
        continue;
      }
    } else {
      // No phone to dedupe on, so re-importing the same file would stack
      // copies — match on the name+state identity instead.
      const { rows: existing } = await db.query(
        `SELECT id FROM leads
         WHERE phone IS NULL AND lower(name) = lower($1) AND state = $2 AND deleted_at IS NULL`,
        [name, state]
      );
      if (existing.length > 0) {
        summary.skippedDuplicate += 1;
        skip(row, `Lead without a phone number already exists: ${name} (${state})`);
        continue;
      }
    }

    const brokerage = resolveBrokerage(row, mapping) || null;

    await db.query(
      `INSERT INTO leads (name, phone, email, address, brokerage, state, status, missing_phone, office_key)
       VALUES ($1, $2, $3, $4, $5, $6, 'new', $7, $8)`,
      [
        name,
        phone,
        mapping.email ? cleanText(row[mapping.email]) || null : null,
        address || null,
        brokerage,
        state,
        missingPhone,
        buildOfficeKey({ brokerage, address, city, state }),
      ]
    );
    summary.imported += 1;
    if (missingPhone) summary.importedWithoutPhone += 1;
  }

  await db.query(
    `INSERT INTO import_history (user_id, filename, total_rows, imported, skipped_dnc, skipped_duplicate, skipped_invalid)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId || null, filename || null, summary.totalRows, summary.imported, summary.skippedDnc, summary.skippedDuplicate, summary.skippedInvalid]
  );

  return summary;
}

// ---------------------------------------------------------------------------
// Background import jobs
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 20;
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

/**
 * Runs an import as a background job: AI-cleans the rows in chunks of 20 (up
 * to 3 chunks in flight at once), recording progress and honouring the
 * cancel flag as it goes, then hands the cleaned rows to the existing
 * commitImport() so merging, dedup, the DNC check and insertion all behave
 * exactly as they already did.
 *
 * Never throws at the caller — it's fire-and-forget from the route, so every
 * outcome is written to the job row instead.
 */
async function processImportJob(jobId) {
  const { rows: jobRows } = await db.query('SELECT * FROM import_jobs WHERE id = $1', [jobId]);
  const job = jobRows[0];
  if (!job) return;

  try {
    const sourceRows = job.source_rows || [];
    const mapping = job.mapping || {};

    const chunks = [];
    for (let i = 0; i < sourceRows.length; i += CHUNK_SIZE) {
      chunks.push({ index: chunks.length, rows: sourceRows.slice(i, i + CHUNK_SIZE) });
    }

    const cleanedChunks = new Array(chunks.length);
    let processed = 0;
    let failedRows = 0;
    let needsManualReview = 0;
    let cancelled = false;
    let nextChunk = 0;

    // Up to MAX_CONCURRENT_CHUNKS workers pulling from the same chunk list —
    // faster than one at a time without firing 50 Groq calls simultaneously.
    const worker = async () => {
      for (;;) {
        if (cancelled) return;
        const current = nextChunk++;
        if (current >= chunks.length) return;

        // Checked before every chunk so a cancel lands promptly.
        if (await isJobCancelled(jobId)) {
          cancelled = true;
          return;
        }

        const chunk = chunks[current];
        const cleaned = await cleanChunkWithRetry(chunk.rows, mapping);
        cleanedChunks[current] = cleaned;

        processed += chunk.rows.length;
        if (cleaned.needsManualReview) {
          failedRows += chunk.rows.length;
          needsManualReview += chunk.rows.length;
        }

        await db.query('UPDATE import_jobs SET processed_rows = $2, failed_rows = $3 WHERE id = $1', [
          jobId,
          processed,
          failedRows,
        ]);

        // Checked again after the chunk, not just before claiming one: with
        // every chunk already claimed (a small file, or fewer chunks than
        // workers) a pre-claim check alone can never observe a cancel.
        if (await isJobCancelled(jobId)) {
          cancelled = true;
          return;
        }
      }
    };

    await Promise.all(Array.from({ length: MAX_CONCURRENT_CHUNKS }, worker));

    // Final gate before anything is written to leads — a cancel that landed
    // while the last chunks were in flight must still prevent the insert.
    if (!cancelled && (await isJobCancelled(jobId))) cancelled = true;

    if (cancelled) {
      await db.query(
        `UPDATE import_jobs SET status = 'cancelled', completed_at = now() WHERE id = $1`,
        [jobId]
      );
      return;
    }

    // Reassemble in original order, dropping rows the model marked
    // unrecoverable, and remember which names it rewrote (for the ✨ marker).
    const rowsToImport = [];
    const originalNames = {};
    let aiSkipped = 0;

    cleanedChunks.forEach((cleaned, chunkIndex) => {
      if (!cleaned) return;
      cleaned.cleanedRows.forEach((row, indexInChunk) => {
        if (cleaned.skippedIndexes.has(indexInChunk)) {
          aiSkipped += 1;
          return;
        }
        const original = cleaned.originals.get(indexInChunk);
        if (original) originalNames[rowsToImport.length] = original;
        rowsToImport.push(row);
      });
      void chunkIndex;
    });

    const summary = await commitImport({
      mapping,
      rows: rowsToImport,
      userId: job.user_id,
      filename: job.filename,
    });

    summary.needsManualReview = needsManualReview;
    summary.aiSkipped = aiSkipped;
    summary.originalNames = originalNames;

    await db.query(
      `UPDATE import_jobs
       SET status = 'completed', completed_at = now(), result_summary = $2, processed_rows = $3
       WHERE id = $1`,
      [jobId, JSON.stringify(summary), sourceRows.length]
    );
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

async function createImportJob({ userId, filename, totalRows, sourceRows, mapping }) {
  const { rows } = await db.query(
    `INSERT INTO import_jobs (user_id, filename, status, total_rows, source_rows, mapping)
     VALUES ($1, $2, 'pending', $3, $4, $5)
     RETURNING id`,
    [userId || null, filename || null, totalRows, JSON.stringify(sourceRows), JSON.stringify(mapping || {})]
  );
  return rows[0].id;
}

async function getImportJob(jobId) {
  const { rows } = await db.query(
    `SELECT id, filename, status, total_rows, processed_rows, failed_rows, result_summary,
            error_message, cancelled, created_at, completed_at
     FROM import_jobs WHERE id = $1`,
    [jobId]
  );
  return rows[0] || null;
}

async function setJobMappingAndRows(jobId, { mapping, sourceRows, totalRows }) {
  await db.query(
    `UPDATE import_jobs SET mapping = $2, source_rows = $3, total_rows = $4, status = 'processing'
     WHERE id = $1`,
    [jobId, JSON.stringify(mapping || {}), JSON.stringify(sourceRows), totalRows]
  );
}

async function cancelImportJob(jobId) {
  const { rows } = await db.query(
    `UPDATE import_jobs SET cancelled = true WHERE id = $1 RETURNING id, status`,
    [jobId]
  );
  return rows[0] || null;
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
  parseCsv,
  guessMapping,
  commitImport,
  getImportHistory,
  createImportJob,
  getImportJob,
  setJobMappingAndRows,
  cancelImportJob,
  processImportJob,
};
