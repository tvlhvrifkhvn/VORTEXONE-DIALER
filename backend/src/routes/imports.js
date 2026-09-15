const express = require('express');
const multer = require('multer');
const csvImport = require('../services/csvImport');
const aiCsvMapper = require('../services/aiCsvMapper');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
    const { mapping, confidence, needsReview } = await aiCsvMapper.mapColumns(headers, sampleRows);
    res.json({ headers, rows, mapping, confidence, needsReview, fields: csvImport.LEAD_FIELDS });
  })
);

// Step 2: the frontend sends back the parsed rows plus the user-confirmed
// (or corrected) column mapping; this is what actually writes leads.
router.post(
  '/commit',
  asyncHandler(async (req, res) => {
    const { mapping, rows } = req.body;
    const summary = await csvImport.commitImport({ mapping, rows });
    res.json(summary);
  })
);

module.exports = router;
