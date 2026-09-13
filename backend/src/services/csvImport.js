const { parse } = require('csv-parse/sync');
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const { normalizePhone } = require('../utils/phoneNormalize');
const { stateFromAreaCode } = require('../utils/stateFromAreaCode');
const { US_STATES } = require('../utils/usStates');
const dncCheck = require('./dncCheck');

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
async function commitImport({ mapping, rows }) {
  if (!mapping || !mapping.name || !mapping.phone || !mapping.state) {
    throw new ApiError(400, 'mapping must include at least name, phone, and state');
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

  const seenPhones = new Set();

  const skip = (row, reason) => {
    if (summary.skippedDetails.length < MAX_SKIPPED_DETAILS) {
      summary.skippedDetails.push({ row: row[mapping.name] || row[mapping.phone] || '(unknown)', reason });
    }
  };

  for (const row of rows) {
    const rawPhone = row[mapping.phone];
    const phone = normalizePhone(rawPhone);
    const name = (row[mapping.name] || '').trim();

    if (!name || !phone) {
      summary.skippedInvalid += 1;
      skip(row, !name ? 'Missing name' : `Invalid phone number: "${rawPhone}"`);
      continue;
    }

    let state = (row[mapping.state] || '').trim().toUpperCase();
    if (!US_STATES.includes(state)) {
      state = stateFromAreaCode(phone) || '';
    }
    if (!US_STATES.includes(state)) {
      summary.skippedInvalid += 1;
      skip(row, `Unrecognized US state: "${row[mapping.state] || ''}"`);
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
        mapping.email ? (row[mapping.email] || '').trim() || null : null,
        mapping.address ? (row[mapping.address] || '').trim() || null : null,
        mapping.brokerage ? (row[mapping.brokerage] || '').trim() || null : null,
        state,
      ]
    );
    summary.imported += 1;
  }

  return summary;
}

module.exports = { LEAD_FIELDS, parseCsv, guessMapping, commitImport };
