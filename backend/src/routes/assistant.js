// C5A: the assistant. POST /api/assistant/ask (X-Campaign-Id or ALL) and
// GET /api/leads/:id/summary (?refresh=1 skips the cache). C5C: GET
// /api/assistant/brief and POST /api/leads/:id/draft. Logic lives in
// services/assistant. Its own limit: 20 requests a minute per user
// (RATE_LIMIT_ASSISTANT_MAX raises it in tests only, as in rateLimit.js).
// No Groq key, or the assistant switched off: 503 assistant_not_configured.
const express = require('express');
const rateLimit = require('express-rate-limit');
const assistant = require('../services/assistant');
const extras = require('../services/assistant/extras');
const web = require('../services/assistant/web');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { campaignOrAll } = require('../middleware/campaign');
const { maxFor } = require('../middleware/rateLimit');

const ASSISTANT_MAX = 20;
const assistantLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: maxFor('RATE_LIMIT_ASSISTANT_MAX', ASSISTANT_MAX),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `assistant-user:${req.user.sub}`,
  message: { error: 'The assistant takes 20 questions a minute. Try again shortly.', code: 'assistant_rate_limited' },
});

/** 503 with its code; any other error goes to the error handler. */
function handle(fn) {
  return asyncHandler(async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      if (err instanceof assistant.NotConfiguredError) return res.status(503).json({ error: err.message, code: err.code });
      throw err;
    }
  });
}

// Mounted at /api/assistant.
const router = express.Router();
router.use(requireAuth);

router.post(
  '/ask',
  assistantLimiter,
  campaignOrAll,
  handle(async (req, res) => {
    const b = req.body || {};
    res.json(await assistant.ask({ userId: req.user.sub, campaignId: req.campaignId, question: b.question, history: b.history }));
  })
);

// C7F: the WEB switch. Only { question } is read: no history, no CRM data.
router.post(
  '/web',
  assistantLimiter,
  campaignOrAll,
  handle(async (req, res) => {
    res.json(await web.webAsk({ userId: req.user.sub, campaignId: req.campaignId, question: req.body?.question }));
  })
);

// C5C: the daily brief for the file or ALL (?refresh=1 rebuilds it).
router.get(
  '/brief',
  assistantLimiter,
  campaignOrAll,
  handle(async (req, res) => {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    res.json(await extras.brief({ userId: req.user.sub, campaignId: req.campaignId, refresh }));
  })
);

// Mounted at /api/leads, before routes/leads.js.
const leadRouter = express.Router();
leadRouter.get(
  '/:id/summary',
  requireAuth,
  assistantLimiter,
  handle(async (req, res) => {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    res.json(await assistant.summarizeLead({ userId: req.user.sub, leadId: req.params.id, refresh }));
  })
);

// C5C: a draft for the composer, text only ({ channel: 'sms' | 'email', intent }).
leadRouter.post(
  '/:id/draft',
  requireAuth,
  assistantLimiter,
  handle(async (req, res) => {
    const b = req.body || {};
    res.json(await extras.draft({ userId: req.user.sub, leadId: req.params.id, channel: b.channel, intent: b.intent }));
  })
);

module.exports = router;
module.exports.leadRouter = leadRouter;
module.exports.ASSISTANT_MAX = ASSISTANT_MAX;
