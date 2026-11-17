// The assistant's tools (docs/CRM_PLAN.md, phase C5A). Every tool is
// read-only and a thin wrapper around an existing service function. The
// model never gets the database: it gets what these return, after the
// privacy rules:
//   - no full phone number (phone_last4 only) and no email address, in any
//     field, free text included (notes, texts, titles, imported fields)
//   - free text cut to 500 characters
//   - at most 25 rows per list
//   - no secrets (no tool reads settings)
// Each tool records the leads it returned in ctx.seen (id → name): only those
// ids may be linked in the answer ([lead:ID]).
const db = require('../../db');
const leadQueue = require('../leadQueue');
const timeline = require('../timeline');
const tasks = require('../tasks');
const today = require('../today');
const reports = require('../reports');
const reportingPeriod = require('../reportingPeriod');
const pipeline = require('../pipeline');
const campaigns = require('../campaigns');
const customFields = require('../customFields');
const costEngine = require('../costEngine');
const campaignScope = require('../campaignScope');

const MAX_ROWS = 25;
const MAX_TEXT = 500;
const TIMELINE_EVENTS = 30; // the newest 30 events, then the 25-row cap applies

const STATUSES = [
  'new', 'in_queue', 'in_progress', 'contacted', 'voicemail', 'no_answer', 'callback_scheduled',
  'no_contact_number', 'no_contact_person', 'dnc', 'cold',
];
const PERIODS = ['today', 'yesterday', 'this week', 'this month'];
const TASK_VIEWS = ['overdue', 'today', 'upcoming'];

/** A bad argument from the model: refused and reported back to it. */
class ToolArgError extends Error {}

// ---- privacy -----------------------------------------------------------------

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// +92 300 1234567, +1 (214) 555-0123, 214.555.0123, 2145550123 …
const PLUS_PHONE_RE = /\+\d[\d\s().-]{7,20}\d/g;
const US_PHONE_RE = /(?<!\d)(?:1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
const DIGIT_RUN_RE = /(?<!\d)\d{10,15}(?!\d)/g;

function last4(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function maskNumbers(match) {
  const digits = match.replace(/\D/g, '');
  return digits.length >= 10 ? `…${digits.slice(-4)}` : match;
}

/** Free text as the model may see it: no emails, no full phone numbers, 500 characters at most. */
function scrubText(value) {
  let s = String(value);
  s = s.replace(EMAIL_RE, '[email hidden]');
  s = s.replace(PLUS_PHONE_RE, maskNumbers).replace(US_PHONE_RE, maskNumbers).replace(DIGIT_RUN_RE, maskNumbers);
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;
}

// Fields that are never passed on, whatever the source row holds.
const DROPPED_KEYS = new Set(['phone', 'email', 'original_phone', 'extension', 'to_number', 'from_number', 'media_url', 'password_hash']);

/** The last pass over every tool result: strings scrubbed, dates as ISO text, lists capped. */
function sanitize(value) {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return scrubText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, MAX_ROWS).map(sanitize);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (DROPPED_KEYS.has(k)) continue;
      out[k] = sanitize(v);
    }
    return out;
  }
  return null;
}

/** { total, shown, truncated, <key>: rows } with the 25-row cap. */
function capped(key, rows, total = rows.length) {
  return { total, shown: Math.min(rows.length, MAX_ROWS), truncated: total > Math.min(rows.length, MAX_ROWS), [key]: rows.slice(0, MAX_ROWS) };
}

function remember(ctx, id, name) {
  if (id !== null && id !== undefined && ctx.seen) ctx.seen.set(Number(id), name || `Lead ${id}`);
}

const fileLabel = (fileNumber, name) => `FILE ${String(fileNumber).padStart(2, '0')} · ${name}`;

// ---- arguments -----------------------------------------------------------------

function optionalText(args, key, max = 100) {
  const v = args[key];
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw new ToolArgError(`${key} must be text`);
  const s = v.trim();
  if (s.length > max) throw new ToolArgError(`${key} is at most ${max} characters`);
  return s || null;
}

function requiredId(args, key) {
  const n = Number(args[key]);
  if (!Number.isInteger(n) || n <= 0) throw new ToolArgError(`${key} must be a positive whole number`);
  return n;
}

function oneOf(args, key, allowed, fallback) {
  const v = args[key];
  if (v === undefined || v === null || v === '') return fallback;
  const s = String(v).trim().toLowerCase();
  if (!allowed.includes(s)) throw new ToolArgError(`${key} must be one of: ${allowed.join(', ')}`);
  return s;
}

/** "current" | "all" | a file number → a campaign id or ALL. */
async function resolveCampaign(ctx, raw) {
  if (raw === undefined || raw === null || raw === '' || String(raw).toLowerCase() === 'current') return ctx.campaignId;
  if (String(raw).toLowerCase() === 'all') return campaignScope.ALL;
  const n = Number(String(raw).replace(/^file\s*/i, ''));
  if (!Number.isInteger(n) || n <= 0) throw new ToolArgError('campaign must be "current", "all" or a file number');
  const file = (await campaigns.list()).find((c) => c.file_number === n && c.status !== 'archived');
  if (!file) throw new ToolArgError(`There is no file ${n}`);
  return file.id;
}

async function fileNames() {
  return new Map((await campaigns.list()).map((c) => [c.id, fileLabel(c.file_number, c.name)]));
}

// ---- projections ---------------------------------------------------------------

function leadRow(l, files) {
  return {
    id: l.id,
    name: l.name,
    file: files.get(l.campaign_id) || null,
    company: l.brokerage || null,
    state: l.state || null,
    status: l.status,
    stage: l.stage_name || null,
    attempts: l.attempts,
    next_action_at: l.next_action_at,
    tags: l.tags || [],
    deal_value_cents: l.deal_value_cents === null || l.deal_value_cents === undefined ? null : Number(l.deal_value_cents),
    phone_last4: last4(l.phone),
    updated_at: l.updated_at,
  };
}

// ---- the tools -----------------------------------------------------------------

async function searchLeads(args, ctx) {
  const text = optionalText(args, 'text');
  const status = args.status ? oneOf(args, 'status', STATUSES) : null;
  const state = optionalText(args, 'state', 2);
  if (state && !/^[A-Za-z]{2}$/.test(state)) throw new ToolArgError('state must be a 2-letter US state');
  const tag = optionalText(args, 'tag', 40);
  let noActivityDays;
  if (args.no_activity_days !== undefined && args.no_activity_days !== null && args.no_activity_days !== '') {
    noActivityDays = Number(args.no_activity_days);
    if (!Number.isInteger(noActivityDays) || noActivityDays < 1 || noActivityDays > 365) {
      throw new ToolArgError('no_activity_days must be a whole number from 1 to 365');
    }
  }
  const campaignId = await resolveCampaign(ctx, args.campaign);

  // A stage by id, or by name (in every file of the scope that has it).
  const stageArg = optionalText(args, 'stage');
  let scopes = [{ campaignId, stageId: undefined }];
  if (stageArg) {
    const s = campaignScope.scope(null, campaignId, 2);
    const asId = Number(stageArg);
    const { rows } = await db.query(
      `SELECT id, campaign_id FROM pipeline_stages
       WHERE (${Number.isInteger(asId) && asId > 0 ? 'id = $1' : 'lower(name) = lower($1)'}) AND ${s.sql}
       ORDER BY campaign_id LIMIT 20`,
      [Number.isInteger(asId) && asId > 0 ? asId : stageArg, ...s.params]
    );
    if (rows.length === 0) throw new ToolArgError(`No stage "${stageArg}" in this scope (get_pipeline lists the stages)`);
    scopes = rows.map((r) => ({ campaignId: r.campaign_id, stageId: r.id }));
  }

  const files = await fileNames();
  let total = 0;
  const found = [];
  for (const sc of scopes) {
    const res = await leadQueue.list({
      search: text || undefined,
      status: status || undefined,
      state: state ? state.toUpperCase() : undefined,
      tag: tag || undefined,
      noActivityDays,
      stageId: sc.stageId,
      campaignId: sc.campaignId,
      page: 1,
      pageSize: MAX_ROWS,
    });
    total += res.total;
    found.push(...res.leads);
  }
  const rows = found.slice(0, MAX_ROWS).map((l) => leadRow(l, files));
  rows.forEach((r) => remember(ctx, r.id, r.name));
  return capped('leads', rows, total);
}

async function loadLead(leadId) {
  const lead = await leadQueue.getById(leadId);
  if (!lead || lead.deleted_at) throw new ToolArgError(`There is no lead ${leadId}`);
  return lead;
}

async function getLead(args, ctx) {
  const lead = await loadLead(requiredId(args, 'lead_id'));
  const [files, stage, fields, file] = await Promise.all([
    fileNames(),
    pipeline.getStage(db, lead.pipeline_stage_id),
    customFields.list(lead.campaign_id),
    campaigns.getById(lead.campaign_id),
  ]);
  const custom = {};
  for (const f of fields) {
    const v = lead.custom ? lead.custom[f.key] : undefined;
    if (v !== undefined && v !== null && v !== '') custom[f.label] = v;
  }
  remember(ctx, lead.id, lead.name);
  return {
    id: lead.id,
    name: lead.name,
    file: files.get(lead.campaign_id) || null,
    company_label: file?.company_label || 'Company',
    company: lead.brokerage || null,
    address: lead.address || null,
    state: lead.state || null,
    status: lead.status,
    cold_reason: lead.cold_reason || null,
    stage: stage ? stage.name : null,
    stage_kind: stage ? stage.kind : null,
    deal_value_cents: lead.deal_value_cents === null ? null : Number(lead.deal_value_cents),
    lost_reason: lead.lost_reason || null,
    tags: lead.tags || [],
    custom_fields: custom,
    attempts: lead.attempts,
    max_attempts: lead.max_attempts,
    next_action_at: lead.next_action_at,
    sms_opt_out: Boolean(lead.sms_opt_out),
    do_not_call: Boolean(lead.dnc_flag) || lead.status === 'dnc',
    phone_last4: last4(lead.phone),
    has_email: Boolean(lead.email),
    created_at: lead.created_at,
    updated_at: lead.updated_at,
  };
}

function timelineEvent(e) {
  const base = { type: e.type, at: e.timestamp };
  switch (e.type) {
    case 'call': return { ...base, disposition: e.disposition || null, duration_seconds: e.duration_seconds, note: e.note || null };
    case 'sms': return { ...base, direction: e.direction, body: e.body };
    case 'email': return { ...base, direction: e.direction, subject: e.subject, body: e.body };
    case 'note': return { ...base, body: e.body };
    case 'sms_opt': return { ...base, action: e.action, source: e.source };
    case 'stage': return { ...base, from: e.from_stage, to: e.to_stage, source: e.source, by: e.user_name || null };
    case 'import': return { ...base, stage: e.to_stage };
    case 'task': return { ...base, title: e.title, task_type: e.task_type, due_at: e.due_at, done: Boolean(e.done_at) };
    default: return base;
  }
}

async function getTimeline(args, ctx) {
  const lead = await loadLead(requiredId(args, 'lead_id'));
  const t = await timeline.getTimeline(lead.id);
  remember(ctx, lead.id, lead.name);
  const events = t.timeline.slice(0, TIMELINE_EVENTS).map(timelineEvent);
  return { lead_id: lead.id, ...capped('events', events, t.timeline.length) };
}

function taskRow(t, files) {
  return {
    id: t.id,
    title: t.title,
    type: t.type,
    due_at: t.due_at,
    overdue: Boolean(t.overdue),
    lead_id: t.lead_id,
    lead_name: t.lead_name || null,
    file: files.get(t.campaign_id) || null,
  };
}

async function getTasks(args, ctx) {
  const view = oneOf(args, 'view', TASK_VIEWS, 'today');
  const now = new Date();
  const files = await fileNames();
  let rows;
  let total;
  if (view === 'upcoming') {
    // Open tasks due after today (C6A adds this view to tasks.js; until then, here).
    const end = await tasks.endOfToday(now);
    const s = campaignScope.scope('t', ctx.campaignId, 2);
    const { rows: r } = await db.query(
      `SELECT t.id, t.campaign_id, t.lead_id, t.type, t.title, t.due_at, l.name AS lead_name, count(*) OVER ()::int AS total
       FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id
       WHERE t.done_at IS NULL AND t.due_at >= $1 AND (t.lead_id IS NULL OR l.deleted_at IS NULL) AND ${s.sql}
       ORDER BY t.due_at ASC, t.id ASC
       LIMIT ${MAX_ROWS}`,
      [end, ...s.params]
    );
    rows = r;
    total = r[0]?.total ?? 0;
  } else {
    const due = await tasks.listDue({ campaignId: ctx.campaignId, now, limit: 500 });
    const start = reportingPeriod.dayContaining(now, await reportingPeriod.getSettings()).start;
    rows = view === 'overdue' ? due.items.filter((t) => t.overdue) : due.items.filter((t) => new Date(t.due_at) >= start);
    total = rows.length;
  }
  const out = rows.map((t) => taskRow(t, files));
  out.forEach((t) => t.lead_id && remember(ctx, t.lead_id, t.lead_name));
  return { view, ...capped('tasks', out, total) };
}

async function getToday(args, ctx) {
  const t = await today.getToday(ctx.campaignId, new Date());
  const files = await fileNames();
  // Callbacks, unread texts and stale rows are leads (id); a task row names its lead in lead_id.
  const list = (part, map, isTask = false) => {
    const items = part.items.map(map);
    items.forEach((i) => (isTask ? i.lead_id && remember(ctx, i.lead_id, i.lead_name) : remember(ctx, i.id, i.name)));
    return { total: part.total, shown: Math.min(items.length, MAX_ROWS), items: items.slice(0, MAX_ROWS) };
  };
  return {
    end_of_day: t.endOfDay,
    callbacks: list(t.callbacks, (c) => ({ id: c.id, name: c.name, state: c.state, due_at: c.due_at, overdue: c.overdue, file: files.get(c.campaign_id) || null, phone_last4: last4(c.phone) })),
    tasks: list(t.tasks, (x) => taskRow(x, files), true),
    unread_texts: list(t.unreadTexts, (u) => ({ id: u.id, name: u.name, unread: u.unread, last_at: u.last_at, file: files.get(u.campaign_id) || null })),
    stale: list(t.stale, (s) => ({ id: s.id, name: s.name, stage: s.stage_name, last_activity_at: s.activity_at, file: files.get(s.campaign_id) || null })),
  };
}

async function getPipeline(args, ctx) {
  const campaignId = await resolveCampaign(ctx, args.campaign);
  const list = campaignId === campaignScope.ALL
    ? (await campaigns.list()).filter((c) => c.status !== 'archived')
    : [await campaigns.getById(campaignId)];
  const out = [];
  for (const c of list.slice(0, MAX_ROWS)) {
    const stages = await pipeline.listStages(c.id);
    const { rows } = await db.query(
      `SELECT pipeline_stage_id, COALESCE(sum(deal_value_cents), 0)::bigint AS value
       FROM leads WHERE campaign_id = $1 AND deleted_at IS NULL GROUP BY pipeline_stage_id`,
      [c.id]
    );
    const value = new Map(rows.map((r) => [r.pipeline_stage_id, Number(r.value)]));
    out.push({
      file: fileLabel(c.file_number, c.name),
      stages: stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, leads: s.lead_count, deal_value_cents: value.get(s.id) || 0 })),
    });
  }
  return capped('files', out, list.length);
}

/** today | yesterday | this week (from Monday) | this month, in the reporting timezone. */
async function periodFor(name, now = new Date()) {
  const settings = await reportingPeriod.getSettings();
  const day = reportingPeriod.dayContaining(now, settings);
  if (name === 'today') return { start: day.start, end: day.end, label: `today (${day.date})` };
  if (name === 'yesterday') {
    const y = reportingPeriod.dayContaining(new Date(day.start.getTime() - 1000), settings);
    return { start: y.start, end: y.end, label: `yesterday (${y.date})` };
  }
  const [y, m, d] = day.date.split('-').map(Number);
  const [sh, sm] = settings.dayStart.split(':').map(Number);
  if (name === 'this week') {
    const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
    const monday = new Date(Date.UTC(y, m - 1, d - weekday));
    const start = reportingPeriod.zonedToInstant(settings.timezone, monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), sh, sm);
    return { start, end: day.end, label: `this week (from ${monday.toISOString().slice(0, 10)})` };
  }
  const p = await costEngine.periods(now);
  return { start: p.month.start, end: p.month.end, label: `this month (${p.month.label})` };
}

async function getReport(args, ctx) {
  const period = oneOf(args, 'period', PERIODS, 'today');
  const campaignId = await resolveCampaign(ctx, args.campaign);
  const p = await periodFor(period);
  const stats = await reports.periodStats({ ...p, timezone: (await reportingPeriod.getSettings()).timezone, kind: 'range' }, campaignId);
  const files = await fileNames();
  return {
    period: p.label,
    scope: campaignId === campaignScope.ALL ? 'all files' : files.get(campaignId) || null,
    dials: stats.dials,
    contacts: stats.contacts,
    voicemails: stats.voicemails,
    no_answers: stats.noAnswers,
    dnc: stats.dnc,
    connect_rate_pct: stats.connectRate,
  };
}

async function getSpend(args, ctx) {
  const s = await costEngine.spend({ campaignId: ctx.campaignId });
  return {
    rates_set: s.ratesSet,
    today_cents: s.today.cents,
    month_cents: s.month.cents,
    month: s.month.label,
    budget_state: s.state,
    budgets: s.budgets,
    ...capped('per_file', s.perCampaign.map((c) => ({ file: fileLabel(c.fileNumber, c.name), today_cents: c.today, month_cents: c.month, budget_cents: c.budget }))),
  };
}

async function listCampaigns(args, ctx) {
  const list = await campaigns.list();
  const rows = list.map((c) => ({
    file: fileLabel(c.file_number, c.name),
    file_number: c.file_number,
    kind: c.kind,
    status: c.status,
    current: ctx.campaignId !== campaignScope.ALL && c.id === Number(ctx.campaignId),
  }));
  return capped('files', rows);
}

// ---- proposals (C5C): recorded for the owner to confirm, never executed --------

const MAX_PROPOSALS = 5;

function recordProposal(ctx, proposal) {
  if (!ctx.proposals) throw new ToolArgError('Proposals are not available here');
  if (ctx.proposals.length >= MAX_PROPOSALS) throw new ToolArgError(`At most ${MAX_PROPOSALS} proposals per answer`);
  ctx.proposals.push(proposal);
  return { recorded: true, note: 'Shown to the user as a card to confirm or dismiss. Nothing has changed yet: never say it is done.' };
}

async function proposeTask(args, ctx) {
  const lead = await loadLead(requiredId(args, 'lead_id'));
  let checked;
  try {
    checked = tasks.checkInput({ title: args.title, type: args.type, dueAt: args.due_at });
  } catch (err) {
    throw new ToolArgError(err.message);
  }
  remember(ctx, lead.id, lead.name);
  return recordProposal(ctx, {
    kind: 'task', leadId: lead.id, leadName: lead.name, title: checked.title, type: checked.type, dueAt: checked.due.toISOString(),
  });
}

async function proposeStage(args, ctx) {
  const lead = await loadLead(requiredId(args, 'lead_id'));
  const stage = await pipeline.getStage(db, requiredId(args, 'stage_id'));
  if (!stage || stage.campaign_id !== lead.campaign_id) throw new ToolArgError("That stage isn't one of this lead's file (get_pipeline lists the stages)");
  if (stage.id === lead.pipeline_stage_id) throw new ToolArgError('The lead is already in that stage');
  const from = await pipeline.getStage(db, lead.pipeline_stage_id);
  remember(ctx, lead.id, lead.name);
  return recordProposal(ctx, {
    kind: 'stage', leadId: lead.id, leadName: lead.name, stageId: stage.id, stageName: stage.name, stageKind: stage.kind, fromStage: from ? from.name : null,
  });
}

// ---- the registry (names, descriptions and JSON schemas sent to the model) -----

const campaignParam = {
  type: 'string',
  description: 'Which files: "current" (default: the file the user is in), "all", or a file number like "2".',
};

const TOOLS = {
  search_leads: {
    run: searchLeads,
    description: 'Find leads. Every filter is optional. Returns at most 25 leads with id, name, file, company, state, status, stage, attempts, next action, tags and the last 4 phone digits.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Part of the name, company or phone number.' },
        stage: { type: 'string', description: 'A pipeline stage name or id.' },
        status: { type: 'string', enum: STATUSES, description: 'The dialer status.' },
        state: { type: 'string', description: '2-letter US state, e.g. TX.' },
        tag: { type: 'string', description: 'An exact tag.' },
        no_activity_days: { type: 'integer', description: 'Only leads with no activity for at least this many days.' },
        campaign: campaignParam,
      },
      additionalProperties: false,
    },
  },
  get_lead: {
    run: getLead,
    description: "One lead's details: company, stage, deal value, tags, custom fields, attempts, next action.",
    parameters: { type: 'object', properties: { lead_id: { type: 'integer' } }, required: ['lead_id'], additionalProperties: false },
  },
  get_timeline: {
    run: getTimeline,
    description: "A lead's history, newest first: calls, notes, texts, emails, stage changes and tasks.",
    parameters: { type: 'object', properties: { lead_id: { type: 'integer' } }, required: ['lead_id'], additionalProperties: false },
  },
  get_tasks: {
    run: getTasks,
    description: 'Open tasks in the current scope: overdue (due before now), today (due today), or upcoming (due after today).',
    parameters: { type: 'object', properties: { view: { type: 'string', enum: TASK_VIEWS } }, required: ['view'], additionalProperties: false },
  },
  get_today: {
    run: getToday,
    description: "What needs doing today: callbacks due, tasks due, unread texts, and stale leads (no activity for 7 days, no open task).",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  get_pipeline: {
    run: getPipeline,
    description: 'The pipeline stages with their lead counts and deal value, per file.',
    parameters: { type: 'object', properties: { campaign: campaignParam }, additionalProperties: false },
  },
  get_report: {
    run: getReport,
    description: 'Call numbers for a period: dials, contacts, voicemails, no answers, DNC, connect rate.',
    parameters: {
      type: 'object',
      properties: { period: { type: 'string', enum: PERIODS }, campaign: campaignParam },
      required: ['period'],
      additionalProperties: false,
    },
  },
  get_spend: {
    run: getSpend,
    description: "Call spend in cents: today, this month, the budgets and their state, and the split by file.",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  propose_task: {
    run: proposeTask,
    description: 'Propose a task for a lead. It is NOT created: the user sees a card and confirms or dismisses it.',
    parameters: {
      type: 'object',
      properties: {
        lead_id: { type: 'integer' },
        title: { type: 'string', description: 'Short, e.g. "Call back about pricing".' },
        due_at: { type: 'string', description: 'ISO 8601 date and time with offset, e.g. 2026-11-18T10:00:00-05:00.' },
        type: { type: 'string', enum: ['call', 'email', 'text', 'other'] },
      },
      required: ['lead_id', 'title', 'due_at'],
      additionalProperties: false,
    },
  },
  propose_stage: {
    run: proposeStage,
    description: "Propose moving a lead to another pipeline stage of its file (get_pipeline lists stage ids). It is NOT moved: the user confirms or dismisses it.",
    parameters: {
      type: 'object',
      properties: { lead_id: { type: 'integer' }, stage_id: { type: 'integer' } },
      required: ['lead_id', 'stage_id'],
      additionalProperties: false,
    },
  },
  list_campaigns: {
    run: listCampaigns,
    description: 'Every file (campaign) with its number, kind and status, and which one is current.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
};

/** The `tools` array for the chat request. */
function specs() {
  return Object.entries(TOOLS).map(([name, t]) => ({
    type: 'function',
    function: { name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * Runs one tool. ctx = { campaignId (id or ALL), seen: Map }. Returns the
 * sanitized result; throws ToolArgError for an unknown tool or a bad argument.
 */
async function run(name, args, ctx) {
  const tool = Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : null;
  if (!tool) throw new ToolArgError(`Unknown tool "${String(name).slice(0, 60)}". The tools are: ${Object.keys(TOOLS).join(', ')}`);
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new ToolArgError('The arguments must be a JSON object');
  return sanitize(await tool.run(args, ctx));
}

module.exports = { periodFor, leadRow, fileNames, TOOLS, MAX_ROWS, MAX_PROPOSALS, MAX_TEXT, ToolArgError, specs, run, sanitize, scrubText, last4, getLead, getTimeline };
