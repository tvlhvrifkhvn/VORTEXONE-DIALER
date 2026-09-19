const express = require('express');
const multer = require('multer');
const db = require('../db');
const csvImport = require('../services/csvImport');
const xlsxParser = require('../services/xlsxParser');
const aiCsvMapper = require('../services/aiCsvMapper');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const CSV_MIME_TYPES = new Set(['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain']);

/** Rejects anything that isn't actually a CSV — checked by both extension
 * and mime type, since browsers report inconsistent mime types for CSV. */
function requireCsvFile(req, res, next) {
  if (!req.file) throw new ApiError(400, 'No file uploaded (expected multipart field "file")');
  const hasCsvExtension = /\.csv$/i.test(req.file.originalname || '');
  const hasCsvMimeType = CSV_MIME_TYPES.has(req.file.mimetype);
  if (!hasCsvExtension || !hasCsvMimeType) {
    throw new ApiError(400, 'Uploaded file must be a .csv file');
  }
  next();
}

// Step 1: upload + parse only, so the frontend can show a column-mapping
// preview before anything is committed to the database.
router.post(
  '/preview',
  upload.single('file'),
  requireCsvFile,
  asyncHandler(async (req, res) => {
    const { headers, rows } = csvImport.parseCsv(req.file.buffer);
    const mapping = csvImport.guessMapping(headers);
    res.json({ headers, rows, mapping, fields: csvImport.LEAD_FIELDS });
  })
);

// AI-assisted alternative to /preview: parses the same CSV but asks Groq to
// suggest the column mapping (with a confidence + needsReview list) instead
// of the plain heuristic guessMapping(). Does not touch /preview or /commit.
router.post(
  '/analyze',
  upload.single('file'),
  requireCsvFile,
  asyncHandler(async (req, res) => {
    const { headers, rows } = csvImport.parseCsv(req.file.buffer);
    const sampleRows = rows.slice(0, 4);
    const result = await aiCsvMapper.mapColumns(headers, sampleRows);

    // Second AI pass: clean the row values themselves (license numbers and
    // brokerages glued into names, "boise id usa" instead of a state). Runs
    // after mapping because it needs to know which column is which. Rows are
    // returned already cleaned, so the preview and the commit both use them.
    const cleaning = await aiCsvMapper.cleanRows(rows, result.mapping);

    res.json({
      headers,
      rows: cleaning.rows,
      fields: csvImport.LEAD_FIELDS,
      ...result,
      cleanedCount: cleaning.cleanedCount,
      aiSkippedCount: cleaning.skippedCount,
      originalNames: Object.fromEntries(cleaning.originals),
    });
  })
);

// Step 2: the frontend sends back the parsed rows plus the user-confirmed
// (or corrected) column mapping; this is what actually writes leads.
router.post(
  '/commit',
  asyncHandler(async (req, res) => {
    const { mapping, rows, filename } = req.body;
    const summary = await csvImport.commitImport({ mapping, rows, userId: req.user.sub, filename });
    res.json(summary);
  })
);

// ---------------------------------------------------------------------------
// Background import jobs — upload is separated from processing so a large
// file's AI cleaning never runs inside (and time out) a single HTTP request,
// and keeps going after the user navigates away.
// ---------------------------------------------------------------------------

// Step 1: parse the file, size-check it, and record a job. Accepts .csv as a
// single "Sheet1" plus .xlsx/.xls with any number of sheets.
router.post(
  '/upload',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'No file uploaded (expected multipart field "file")');

    const parsed = xlsxParser.parseUpload(req.file.buffer, req.file.originalname || '');
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (parsed.totalRows === 0) return res.status(400).json({ error: 'That file has no rows.' });

    const headers = xlsxParser.headersOf(parsed.sheets, parsed.sheetNames);
    const sampleRows = xlsxParser.rowsFor(parsed.sheets, parsed.sheetNames).slice(0, 4);

    // One quick AI call for the suggested mapping (falls back to the
    // heuristic guess when Groq isn't configured). Row cleaning — the slow
    // part — is what moves to the background job.
    let mappingResult;
    try {
      mappingResult = await aiCsvMapper.mapColumns(headers, sampleRows);
    } catch {
      mappingResult = { mapping: csvImport.guessMapping(headers), confidence: {}, needsReview: [] };
    }
    if (mappingResult.unavailable) {
      mappingResult = { ...mappingResult, mapping: csvImport.guessMapping(headers) };
    }

    const jobId = await csvImport.createImportJob({
      userId: req.user.sub,
      filename: req.file.originalname || null,
      totalRows: parsed.totalRows,
      sourceRows: parsed.sheets,
      mapping: mappingResult.mapping,
    });

    res.status(201).json({
      jobId,
      sheetNames: parsed.sheetNames,
      totalRows: parsed.totalRows,
      sheetRowCounts: Object.fromEntries(parsed.sheetNames.map((n) => [n, parsed.sheets[n].length])),
      headers,
      fields: csvImport.LEAD_FIELDS,
      sampleRows,
      ...mappingResult,
    });
  })
);

// Step 2: kick off processing and return immediately — the work continues via
// setImmediate regardless of what the browser does next.
router.post(
  '/process',
  asyncHandler(async (req, res) => {
    const { jobId, sheets: selectedSheets, mapping } = req.body;
    if (!jobId) throw new ApiError(400, 'jobId is required');

    const { rows } = await db.query('SELECT source_rows FROM import_jobs WHERE id = $1 AND user_id = $2', [
      jobId,
      req.user.sub,
    ]);
    if (!rows[0]) throw new ApiError(404, 'Import job not found');

    const sheets = rows[0].source_rows || {};
    const names = Array.isArray(selectedSheets) && selectedSheets.length ? selectedSheets : Object.keys(sheets);
    const selectedRows = xlsxParser.rowsFor(sheets, names);
    if (selectedRows.length === 0) throw new ApiError(400, 'The selected sheets have no rows.');

    await csvImport.setJobMappingAndRows(jobId, {
      mapping,
      sourceRows: selectedRows,
      totalRows: selectedRows.length,
    });

    setImmediate(() => {
      csvImport.processImportJob(jobId).catch((err) => {
        console.error(`Import job ${jobId} crashed:`, err.message);
      });
    });

    res.json({ status: 'processing', jobId, totalRows: selectedRows.length });
  })
);

// Polled by the frontend (and by the navbar badge) for live progress.
router.get(
  '/status/:jobId',
  asyncHandler(async (req, res) => {
    const job = await csvImport.getImportJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Import job not found' });

    const percentage = job.total_rows > 0 ? Math.round((job.processed_rows / job.total_rows) * 100) : 0;
    res.json({
      jobId: job.id,
      filename: job.filename,
      status: job.status,
      processedRows: job.processed_rows,
      totalRows: job.total_rows,
      failedRows: job.failed_rows,
      percentage: Math.min(100, percentage),
      resultSummary: job.result_summary,
      errorMessage: job.error_message,
    });
  })
);

router.post(
  '/cancel/:jobId',
  asyncHandler(async (req, res) => {
    const job = await csvImport.cancelImportJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Import job not found' });
    res.json({ cancelled: true, jobId: job.id });
  })
);

// Last 10 imports — powers the Import page's "Import History" table.
router.get(
  '/history',
  asyncHandler(async (req, res) => {
    const history = await csvImport.getImportHistory();
    res.json({ history });
  })
);

module.exports = router;
