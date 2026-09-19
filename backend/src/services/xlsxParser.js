const XLSX = require('xlsx');
const csvImport = require('./csvImport');

// Hard ceiling for now — a bigger file should be split rather than run as one
// job. Returned as an { error } result, never thrown, so the route can answer
// with a clear message instead of a stack trace.
const MAX_TOTAL_ROWS = 5000;
const CSV_SHEET_NAME = 'Sheet1';

function isSpreadsheet(filename = '') {
  return /\.(xlsx|xls)$/i.test(filename);
}

/**
 * Parses an uploaded lead file into a uniform shape so nothing downstream has
 * to branch on file type:
 *
 *   { sheetNames: [...], sheets: { [name]: rows[] }, totalRows }
 *
 * A .csv is reported as a single sheet called "Sheet1". Returns
 * { error: '...' } for a file that's too large rather than throwing.
 */
function parseUpload(buffer, filename = '') {
  if (!isSpreadsheet(filename)) {
    // Reuses the existing CSV parser so csv behaviour (trim, BOM, header
    // detection) stays exactly as it already was.
    const { rows } = csvImport.parseCsv(buffer);
    if (rows.length > MAX_TOTAL_ROWS) {
      return { error: 'Files over 5,000 leads should be split into smaller files for now.' };
    }
    return {
      sheetNames: [CSV_SHEET_NAME],
      sheets: { [CSV_SHEET_NAME]: rows },
      totalRows: rows.length,
    };
  }

  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (err) {
    return { error: `Could not read this spreadsheet: ${err.message}` };
  }

  const sheets = {};
  let totalRows = 0;

  for (const name of workbook.SheetNames) {
    // defval:'' keeps blank cells as empty strings so every row object has the
    // same keys — the column mapping downstream relies on that.
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: '', raw: false });
    sheets[name] = rows;
    totalRows += rows.length;
  }

  if (totalRows > MAX_TOTAL_ROWS) {
    return { error: 'Files over 5,000 leads should be split into smaller files for now.' };
  }

  return { sheetNames: workbook.SheetNames, sheets, totalRows };
}

/** Column headers seen across the given sheets, in first-seen order. */
function headersOf(sheets, sheetNames) {
  const headers = [];
  for (const name of sheetNames) {
    for (const row of sheets[name] || []) {
      for (const key of Object.keys(row)) {
        if (!headers.includes(key)) headers.push(key);
      }
    }
  }
  return headers;
}

/** Flattens the selected sheets back into one row list for processing. */
function rowsFor(sheets, sheetNames) {
  return sheetNames.flatMap((name) => sheets[name] || []);
}

module.exports = { MAX_TOTAL_ROWS, CSV_SHEET_NAME, parseUpload, headersOf, rowsFor };
