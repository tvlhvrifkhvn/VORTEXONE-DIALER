const PDFDocument = require('pdfkit');
const db = require('../db');
const reports = require('./reports');

const THEME = {
  blue: '#3B82F6',
  heading: '#1F2937',
  subtle: '#6B7280',
  white: '#FFFFFF',
  summaryBg: '#F1F3F5',
  rowShade: '#F8F9FA',
  border: '#E5E7EB',
};

const MARGIN = 40;
const PAGE_SIZE = 'A4'; // 595.28 x 841.89pt

// Proportional widths per the spec, scaled against the usable page width
// (A4 width minus left+right margins) rather than hardcoded points, so the
// table always exactly fills the page regardless of page size.
const COLUMN_SPEC = [
  { key: 'index', label: '#', pct: 0.04 },
  { key: 'name', label: 'Lead Name', pct: 0.15 },
  { key: 'brokerage', label: 'Brokerage', pct: 0.15 },
  { key: 'phone', label: 'Phone', pct: 0.12 },
  { key: 'status', label: 'Status', pct: 0.1 },
  { key: 'note', label: 'Note', pct: 0.28 },
  { key: 'duration', label: 'Duration', pct: 0.08 },
  { key: 'timeCalled', label: 'Time Called', pct: 0.08 },
];

const DISPOSITION_LABELS = {
  contacted: 'Contacted',
  voicemail: 'Voicemail',
  no_answer: 'No Answer',
  no_contact_number: 'Bad Number',
  no_contact_person: 'No Contact',
  dnc: 'DNC',
  callback_scheduled: 'Callback',
};

function formatDuration(seconds) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Builds the column layout (x offset + width per column) against however
 * wide the page's usable area actually is. */
function buildColumns(usableWidth) {
  let x = MARGIN;
  return COLUMN_SPEC.map((col) => {
    const width = Math.round(usableWidth * col.pct);
    const column = { ...col, x, width };
    x += width;
    return column;
  });
}

function drawHeader(doc, usableWidth, repName, date) {
  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor(THEME.blue)
    .text('VORTEXONE AGENCY — Daily Call Report', MARGIN, MARGIN, { continued: false });

  const rightText = `${date.toDateString()}\n${repName}`;
  doc.font('Helvetica').fontSize(10).fillColor(THEME.subtle).text(rightText, MARGIN, MARGIN, {
    width: usableWidth,
    align: 'right',
  });

  const ruleY = MARGIN + 34;
  doc.moveTo(MARGIN, ruleY).lineTo(MARGIN + usableWidth, ruleY).strokeColor(THEME.border).lineWidth(1).stroke();

  doc.y = ruleY + 12;
  doc.x = MARGIN;
}

function drawSummary(doc, usableWidth, summary) {
  const boxHeight = 40;
  const boxY = doc.y;
  doc.rect(MARGIN, boxY, usableWidth, boxHeight).fill(THEME.summaryBg);

  const stats = [
    ['Total Dials', summary.dials],
    ['Contacts', summary.contacts],
    ['Voicemails', summary.voicemails],
    ['No Answers', summary.noAnswers],
    ['DNC', summary.dnc],
    ['Connect Rate', `${summary.connectRate}%`],
  ];
  const cellWidth = usableWidth / stats.length;

  stats.forEach(([label, value], i) => {
    const x = MARGIN + i * cellWidth;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(THEME.subtle)
      .text(label, x, boxY + 8, { width: cellWidth, align: 'center' });
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(THEME.heading)
      .text(String(value), x, boxY + 20, { width: cellWidth, align: 'center' });
  });

  doc.y = boxY + boxHeight + 16;
  doc.x = MARGIN;
}

/** Height needed for a row, based on whichever column's wrapped text is
 * tallest — not just Note: narrow columns (Duration, Time Called, even
 * Phone) can wrap too, and every column must fit within the row's border. */
function computeRowHeight(doc, columns, row, font, fontSize) {
  doc.font(font).fontSize(fontSize);
  const tallest = columns.reduce((max, col) => {
    const value = String((col.key === 'note' ? row.note : row[col.key]) ?? '—');
    const height = doc.heightOfString(value, { width: col.width - 8 });
    return Math.max(max, height);
  }, 0);
  return Math.max(20, tallest + 10);
}

function drawTableHeader(doc, columns, usableWidth) {
  const y = doc.y;
  const height = computeRowHeight(
    doc,
    columns,
    Object.fromEntries(columns.map((c) => [c.key, c.label])),
    'Helvetica-Bold',
    10
  );
  doc.rect(MARGIN, y, usableWidth, height).fill(THEME.blue);
  columns.forEach((col) => {
    doc.rect(col.x, y, col.width, height).strokeColor(THEME.blue).lineWidth(0.5).stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(THEME.white)
      .text(col.label, col.x + 4, y + 5, { width: col.width - 8 });
  });
  doc.y = y + height;
  doc.x = MARGIN;
  return height;
}

function drawRow(doc, columns, usableWidth, row, index, height) {
  const y = doc.y;
  const fill = index % 2 === 1 ? THEME.rowShade : THEME.white;
  doc.rect(MARGIN, y, usableWidth, height).fill(fill);

  columns.forEach((col) => {
    doc.rect(col.x, y, col.width, height).strokeColor(THEME.border).lineWidth(0.5).stroke();
    const value = col.key === 'note' ? row.note || '—' : row[col.key];
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(THEME.heading)
      .text(String(value ?? '—'), col.x + 4, y + 5, { width: col.width - 8 });
  });

  doc.y = y + height;
  doc.x = MARGIN;
}

function drawFooters(doc, usableWidth) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // Temporarily zero the bottom margin so writing this close to the edge
    // doesn't trip PDFKit's auto-page-break and spawn a spurious blank page.
    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const ruleY = doc.page.height - MARGIN - 20;
    doc.moveTo(MARGIN, ruleY).lineTo(MARGIN + usableWidth, ruleY).strokeColor(THEME.border).lineWidth(1).stroke();

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(THEME.subtle)
      .text(
        `Generated by Vortex Outreach · Vortexone Agency · Page ${i - range.start + 1} of ${range.count}`,
        MARGIN,
        ruleY + 6,
        { width: usableWidth, align: 'center' }
      );

    doc.page.margins.bottom = originalBottomMargin;
  }
}

/** Builds the "all dialed contacts today" PDF as a Buffer. */
async function buildDailyReportBuffer(dateInput, repName = 'Talha Arif') {
  const date = dateInput ? new Date(dateInput) : new Date();
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const { rows } = await db.query(
    `SELECT ch.started_at, ch.duration_seconds, ch.disposition, ch.note,
            l.name, l.phone, l.state, l.brokerage
     FROM call_history ch
     JOIN leads l ON l.id = ch.lead_id
     WHERE ch.started_at BETWEEN $1 AND $2 AND ch.disposition IS NOT NULL
     ORDER BY ch.started_at ASC`,
    [startOfDay, endOfDay]
  );
  const todayStats = await reports.todayStats();

  const summary = {
    dials: todayStats.dials,
    contacts: todayStats.contacts,
    connectRate: todayStats.connectRate,
    voicemails: rows.filter((r) => r.disposition === 'voicemail').length,
    noAnswers: rows.filter((r) => r.disposition === 'no_answer').length,
    dnc: rows.filter((r) => r.disposition === 'dnc').length,
  };

  const tableRows = rows.map((r, i) => ({
    index: i + 1,
    name: r.name,
    brokerage: r.brokerage || '—',
    phone: r.phone,
    status: DISPOSITION_LABELS[r.disposition] || r.disposition,
    note: r.note || '—',
    duration: formatDuration(r.duration_seconds),
    timeCalled: new Date(r.started_at).toLocaleTimeString('en-US', { timeStyle: 'short' }),
  }));

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: PAGE_SIZE, bufferPages: true });
    const usableWidth = doc.page.width - MARGIN * 2;
    const columns = buildColumns(usableWidth);

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawHeader(doc, usableWidth, repName, date);
    drawSummary(doc, usableWidth, summary);

    if (tableRows.length === 0) {
      doc.font('Helvetica').fontSize(10).fillColor(THEME.subtle).text('No calls recorded for this date.', MARGIN);
    } else {
      drawTableHeader(doc, columns, usableWidth);
      tableRows.forEach((row, i) => {
        const height = computeRowHeight(doc, columns, row, 'Helvetica', 9);
        if (doc.y + height > doc.page.height - MARGIN - 30) {
          doc.addPage();
          drawTableHeader(doc, columns, usableWidth);
        }
        drawRow(doc, columns, usableWidth, row, i, height);
      });
    }

    drawFooters(doc, usableWidth);
    doc.end();
  });
}

module.exports = { buildDailyReportBuffer };
