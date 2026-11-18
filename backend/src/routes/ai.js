const express = require('express');
const noteExpander = require('../services/noteExpander');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Powers the "✨ Expand" button on the call screen's notes field.
router.post(
  '/expand-note',
  asyncHandler(async (req, res) => {
    const { note } = req.body;
    const expanded = await noteExpander.expandNote(note);
    res.json({ note: expanded });
  })
);

module.exports = router;
