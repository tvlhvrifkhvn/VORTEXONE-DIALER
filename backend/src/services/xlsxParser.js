const fs = require('fs');
const XLSX = require('xlsx');
const { parse } = require('csv-parse');
const csvImport = require('./csvImport');

// There is no row limit: a file's size is limited only by the upload size
// setting (IMPORT_MAX_UPLOAD_MB, see routes/imports.js).
const CSV_SHEET_NAME = 'Sheet1';
const SAMPLE_ROWS = 4;

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

  return { sheetNames: workbook.SheetNames, sheets, totalRows };
}

/**
 * Lead files must be CSV or Excel. Checks the extension AND the first bytes,
 * so a renamed PDF or image is refused instead of being read as text.
 * Returns an error message, or null when the file is acceptable.
 */
async function checkUploadType(filePath, filename = '') {
  const ext = (filename.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  if (!['csv', 'xlsx', 'xls'].includes(ext)) {
    return 'Only CSV or Excel (.xlsx) files can be imported. Save the list as CSV or .xlsx and try again.';
  }
  const fh = await fs.promises.open(filePath, 'r');
  const head = Buffer.alloc(4096);
  let bytes = 0;
  try {
    ({ bytesRead: bytes } = await fh.read(head, 0, head.length, 0));
  } finally {
    await fh.close();
  }
  const start = head.subarray(0, bytes);
  const isZip = start.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])); // .xlsx is a zip
  const isOle = start.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])); // legacy .xls
  if (ext === 'xlsx' && !isZip) return "This file is named .xlsx but isn't an Excel workbook. Re-save it from Excel or as CSV.";
  if (ext === 'xls' && !isOle && !isZip) return "This file is named .xls but isn't an Excel workbook. Re-save it from Excel or as CSV.";
  if (ext === 'csv' && (isZip || isOle || start.includes(0))) {
    return "This file is named .csv but isn't plain text (it may be an Excel file or a PDF). Re-save it as CSV.";
  }
  return null;
}

/** SheetJS's header keys for a header row: blanks become __EMPTY, repeats get _1, _2… */
function headerKeys(cells) {
  const seen = new Map();
  return cells.map((cell) => {
    const base = cell === undefined || cell === null || String(cell).trim() === '' ? '__EMPTY' : String(cell);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}_${n}`;
  });
}

/**
 * Reads an uploaded file from disk in batches and hands each batch to
 * onBatch(sheetName, rows, firstRowNumber) — awaited, so a batch is written
 * before the next one is read. A CSV is streamed (memory stays flat however
 * long the file is). An XLSX workbook has to be opened whole (a SheetJS
 * limitation), but its rows are still converted one batch at a time.
 *
 * Returns { sheetNames, sheetRowCounts, totalRows, headers, sampleRows }, or
 * { error } for a file that can't be read.
 */
async function readUploadInBatches(filePath, filename, batchSize, onBatch) {
  const sheetRowCounts = {};
  const headers = [];
  const sampleRows = [];
  const addHeaders = (keys) => keys.forEach((k) => !headers.includes(k) && headers.push(k));

  if (!isSpreadsheet(filename)) {
    // Same options as csvImport.parseCsv, so CSV behaviour (trim, BOM, header row) is unchanged.
    const parser = fs.createReadStream(filePath).pipe(parse({ columns: true, skip_empty_lines: true, trim: true, bom: true }));
    let batch = [];
    let count = 0;
    try {
      for await (const row of parser) {
        if (count === 0) addHeaders(Object.keys(row));
        if (sampleRows.length < SAMPLE_ROWS) sampleRows.push(row);
        batch.push(row);
        count += 1;
        if (batch.length >= batchSize) {
          await onBatch(CSV_SHEET_NAME, batch, count - batch.length + 1);
          batch = [];
        }
      }
    } catch (err) {
      return { error: `Could not parse CSV: ${err.message}` };
    }
    if (batch.length > 0) await onBatch(CSV_SHEET_NAME, batch, count - batch.length + 1);
    sheetRowCounts[CSV_SHEET_NAME] = count;
    return { sheetNames: [CSV_SHEET_NAME], sheetRowCounts, totalRows: count, headers, sampleRows };
  }

  let workbook;
  try {
    // dense: rows stored as arrays — noticeably less memory than the default.
    workbook = XLSX.readFile(filePath, { dense: true });
  } catch (err) {
    return { error: `Could not read this spreadsheet: ${err.message}` };
  }

  let totalRows = 0;
  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name];
    sheetRowCounts[name] = 0;
    if (!ws || !ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const headerCells = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      range: { s: { r: range.s.r, c: range.s.c }, e: { r: range.s.r, c: range.e.c } },
      defval: '',
      raw: false,
    })[0] || [];
    const keys = headerKeys(headerCells);
    addHeaders(keys);
    for (let r = range.s.r + 1; r <= range.e.r; r += batchSize) {
      // defval:'' keeps blank cells as empty strings so every row object has
      // the same keys — the column mapping downstream relies on that.
      const rows = XLSX.utils.sheet_to_json(ws, {
        header: keys,
        range: { s: { r, c: range.s.c }, e: { r: Math.min(r + batchSize - 1, range.e.r), c: range.e.c } },
        defval: '',
        raw: false,
        blankrows: false,
      });
      if (rows.length === 0) continue;
      for (const row of rows) if (sampleRows.length < SAMPLE_ROWS) sampleRows.push(row);
      await onBatch(name, rows, sheetRowCounts[name] + 1);
      sheetRowCounts[name] += rows.length;
      totalRows += rows.length;
    }
  }
  return { sheetNames: workbook.SheetNames, sheetRowCounts, totalRows, headers, sampleRows };
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

module.exports = { CSV_SHEET_NAME, parseUpload, readUploadInBatches, checkUploadType, headersOf, rowsFor };
