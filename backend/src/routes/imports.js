const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const multer = require('multer');
const csvImport = require('../services/csvImport');
const xlsxParser = require('../services/xlsxParser');
const aiCsvMapper = require('../services/aiCsvMapper');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

// Largest lead file accepted, in MB (env IMPORT_MAX_UPLOAD_MB, default 50).
// There is no row limit: within this size a file of any length is imported in
// batches. A larger file gets a 413 asking to split it.
const DEFAULT_MAX_UPLOAD_MB = 50;
const MAX_UPLOAD_MB = Number(process.env.IMPORT_MAX_UPLOAD_MB) > 0 ? Number(process.env.IMPORT_MAX_UPLOAD_MB) : DEFAULT_MAX_UPLOAD_MB;
const limits = { fileSize: Math.round(MAX_UPLOAD_MB * 1024 * 1024) };

// /upload writes the file to a temp directory and reads it back in batches,
// so a big file is never held in memory. /preview and /analyze (older
// single-request flow) still read it into memory.
const UPLOAD_DIR = path.join(os.tmpdir(), 'vortex-imports');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits });
const uploadToDisk = multer({ dest: UPLOAD_DIR, limits });

/** Runs a multer middleware, turning "file too large" into a plain 413. */
function acceptFile(middleware) {
  return (req, res, next) =>
    middleware(req, res, (err) => {
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new ApiError(
            413,
            `That file is larger than ${MAX_UPLOAD_MB} MB. Split it into smaller files (for example by state or by sheet) and upload them one at a time.`
          )
        );
      }
      return next(err);
    });
}

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
  acceptFile(upload.single('file')),
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
  acceptFile(upload.single('file')),
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
  acceptFile(uploadToDisk.single('file')),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'No file uploaded (expected multipart field "file")');
    const typeError = await xlsxParser.checkUploadType(req.file.path, req.file.originalname || '');
    if (typeError) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      throw new ApiError(400, typeError);
    }

    // The rows go straight from the file into the job's import_rows, batch by batch.
    const jobId = await csvImport.createImportJob({ userId: req.user.sub, filename: req.file.originalname || null });
    let parsed;
    try {
      parsed = await xlsxParser.readUploadInBatches(req.file.path, req.file.originalname || '', csvImport.IMPORT_BATCH_SIZE, (sheet, rows, first) =>
        csvImport.stageRows(jobId, sheet, rows, first)
      );
    } catch (err) {
      await csvImport.deleteImportJob(jobId);
      throw err;
    } finally {
      fs.promises.unlink(req.file.path).catch(() => {});
    }
    if (parsed.error || parsed.totalRows === 0) {
      await csvImport.deleteImportJob(jobId);
      return res.status(400).json({ error: parsed.error || 'That file has no rows.' });
    }

    const { headers, sampleRows } = parsed;

    // One quick AI call for the suggested mapping (falls back to the
    // heuristic guess when Groq isn't configured). Row cleaning — the slow
    // part — is what moves to the background job.
    let mappingResult;
    try {
      mappingResult = await aiCsvMapper.mapColumns(headers, sampleRows);
    } catch {
      // AI failed (unreachable, bad key, bad answer): same as unavailable.
      mappingResult = { mapping: csvImport.guessMapping(headers), confidence: {}, needsReview: [], unavailable: true };
    }
    if (mappingResult.unavailable) {
      mappingResult = { ...mappingResult, mapping: csvImport.guessMapping(headers) };
    } else {
      mappingResult = { ...mappingResult, mapping: csvImport.completeMapping(mappingResult.mapping, headers) };
    }

    await csvImport.setUploadResult(jobId, { totalRows: parsed.totalRows, mapping: mappingResult.mapping });

    res.status(201).json({
      jobId,
      sheetNames: parsed.sheetNames,
      totalRows: parsed.totalRows,
      sheetRowCounts: parsed.sheetRowCounts,
      headers,
      fields: csvImport.MAPPABLE_FIELDS,
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

    const totalRows = await csvImport.startJob(jobId, req.user.sub, { sheets: selectedSheets, mapping });

    setImmediate(() => {
      csvImport.processImportJob(jobId).catch((err) => {
        console.error(`Import job ${jobId} crashed:`, err.message);
      });
    });

    res.json({ status: 'processing', jobId, totalRows });
  })
);

// Polled by the frontend (and by the navbar badge) for live progress.
router.get(
  '/status/:jobId',
  asyncHandler(async (req, res) => {
    const job = await csvImport.getImportJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Import job not found' });

    const { percentage, phaseLabel } = csvImport.progressOf(job);
    res.json({
      jobId: job.id,
      filename: job.filename,
      status: job.status,
      phase: job.phase,
      phaseLabel,
      processedRows: job.processed_rows,
      totalRows: job.total_rows,
      failedRows: job.failed_rows,
      rowsToSave: job.rows_to_save,
      savedRows: job.saved_rows,
      written: job.written_leads,
      percentage,
      resultSummary: job.result_summary,
      errorMessage: job.error_message,
    });
  })
);

router.post(
  '/cancel/:jobId',
  asyncHandler(async (req, res) => {
    const result = await csvImport.cancelImportJob(req.params.jobId);
    if (!result) return res.status(404).json({ error: 'Import job not found' });
    res.status(result.tooLate ? 409 : 200).json(result.tooLate ? { ...result, reason: 'too_late', error: result.message } : result);
  })
);

// Every row of an import that didn't become a lead, as a CSV download.
router.get(
  '/:jobId/skipped.csv',
  asyncHandler(async (req, res) => {
    const job = await csvImport.getImportJob(req.params.jobId);
    const base = (job?.filename || 'import').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '_');
    let started = false;
    await csvImport.writeSkippedRowsCsv(req.params.jobId, req.user, (chunk) => {
      if (!started) {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${base}-skipped-rows.csv"`);
        started = true;
      }
      res.write(chunk);
    });
    res.end();
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
