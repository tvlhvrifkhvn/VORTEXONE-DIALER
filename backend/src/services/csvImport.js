const { parse } = require('csv-parse/sync');
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const { normalizePhone } = require('../utils/phoneNormalize');
const { stateFromAreaCode } = require('../utils/stateFromAreaCode');
const { stateFromAddressText } = require('../utils/stateFromAddressText');
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
const MAX_SKIPPED_DETAILS = 100;

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

  for (const field of LEAD_FIELDS) {
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
    skippedDetails: [],
  };

  const skip = (row, reason) => {
    if (summary.skippedDetails.length < MAX_SKIPPED_DETAILS) {
      summary.skippedDetails.push({ row: row[mapping.name] || row[mapping.phone] || '(unknown)', reason });
    }
  };

  // Pass 1 — deterministic cleanup + state resolution (mapped column, then
  // address text, then phone area code). No AI involved yet.
  const prepared = rows.map((row) => {
    const rawPhone = row[mapping.phone];
    const phone = normalizePhone(rawPhone);
    const name = cleanLeadName(row[mapping.name]);
    const address = mapping.address ? cleanText(row[mapping.address]) : '';

    let state = mapping.state ? cleanText(row[mapping.state]).toUpperCase() : '';
    if (!US_STATES.includes(state)) state = stateFromAddressText(address) || '';
    if (!US_STATES.includes(state) && phone) state = stateFromAreaCode(phone) || '';

    return {
      row,
      rawPhone,
      phone,
      name,
      address,
      state: US_STATES.includes(state) ? state : null,
    };
  });

  // Pass 2 — last-resort AI guess (validated against US_STATES) for
  // otherwise-valid rows that still have no state, capped and batched inside
  // aiCsvMapper.guessStates. Rows with no name/phone aren't worth the call.
  const needsAiState = prepared
    .map((p, index) => ({ ...p, index }))
    .filter((p) => p.name && p.phone && !p.state);

  if (needsAiState.length > 0) {
    const guesses = await aiCsvMapper.guessStates(
      needsAiState.map((p) => ({
        index: p.index,
        name: p.name,
        address: p.address,
        brokerage: mapping.brokerage ? cleanText(p.row[mapping.brokerage]) : '',
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
    const { row, rawPhone, phone, name, address, state } = p;

    if (!name || !phone) {
      summary.skippedInvalid += 1;
      skip(row, !name ? 'Missing name' : `Invalid phone number: "${rawPhone}"`);
      continue;
    }
    if (!state) {
      summary.skippedInvalid += 1;
      skip(row, `Could not determine a US state for this lead`);
      continue;
    }

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

    await db.query(
      `INSERT INTO leads (name, phone, email, address, brokerage, state, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'new')`,
      [
        name,
        phone,
        mapping.email ? cleanText(row[mapping.email]) || null : null,
        address || null,
        mapping.brokerage ? cleanText(row[mapping.brokerage]) || null : null,
        state,
      ]
    );
    summary.imported += 1;
  }

  await db.query(
    `INSERT INTO import_history (user_id, filename, total_rows, imported, skipped_dnc, skipped_duplicate, skipped_invalid)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId || null, filename || null, summary.totalRows, summary.imported, summary.skippedDnc, summary.skippedDuplicate, summary.skippedInvalid]
  );

  return summary;
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

module.exports = { LEAD_FIELDS, parseCsv, guessMapping, commitImport, getImportHistory };
