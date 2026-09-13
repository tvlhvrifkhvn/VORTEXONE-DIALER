const express = require('express');
const multer = require('multer');
const csvImport = require('../services/csvImport');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Step 1: upload + parse only, so the frontend can show a column-mapping
// preview before anything is committed to the database.
router.post(
  '/preview',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'No file uploaded (expected multipart field "file")');
    const { headers, rows } = csvImport.parseCsv(req.file.buffer);
    const mapping = csvImport.guessMapping(headers);
    res.json({ headers, rows, mapping, fields: csvImport.LEAD_FIELDS });
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
