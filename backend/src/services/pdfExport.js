const PDFDocument = require('pdfkit');
const db = require('../db');
const reports = require('./reports');

const THEME = {
  heading: '#3E4C63',
  subtle: '#6A7A94',
  white: '#FFFFFF',
  rowShade: '#EEF1F6',
  headerFill: '#3E4C63',
};

const PAGE_MARGIN = 40;
// Widths sum to 530pt, fitting the 532pt usable width on LETTER
// (612pt page - 40pt margin on each side) — must not exceed that.
const COLUMNS = [
  { key: 'name', label: 'Lead Name', width: 85 },
  { key: 'brokerage', label: 'Brokerage', width: 85 },
  { key: 'phone', label: 'Phone', width: 80 },
  { key: 'status', label: 'Status', width: 65 },
  { key: 'note', label: 'Note', width: 115 },
  { key: 'duration', label: 'Duration', width: 45 },
  { key: 'timeCalled', label: 'Time Called', width: 55 },
];
const TABLE_WIDTH = COLUMNS.reduce((sum, c) => sum + c.width, 0);

function columnX(index) {
  return PAGE_MARGIN + COLUMNS.slice(0, index).reduce((sum, c) => sum + c.width, 0);
}

function formatDuration(seconds) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const DISPOSITION_LABELS = {
  contacted: 'Spoke / Interested',
  voicemail: 'Voicemail',
  no_answer: 'No Answer',
  no_contact_number: 'Bad Number',
  no_contact_person: 'No Contact — Person',
  dnc: 'DNC',
  callback_scheduled: 'Callback Scheduled',
};

function drawHeader(doc, repName, date) {
  // Logo placeholder — a plain box, since there's no real logo asset yet.
  doc.rect(PAGE_MARGIN, doc.y, 36, 36).fillAndStroke(THEME.headerFill, THEME.headerFill);
  doc.fillColor(THEME.white).fontSize(14).text('VA', PAGE_MARGIN, doc.y - 28, { width: 36, align: 'center' });

  doc
    .fillColor(THEME.heading)
    .fontSize(16)
    .text('Vortexone Agency', PAGE_MARGIN + 46, PAGE_MARGIN, { continued: false });
  doc
    .fontSize(10)
    .fillColor(THEME.subtle)
    .text(`Daily Call Report — ${date.toDateString()}`, PAGE_MARGIN + 46, PAGE_MARGIN + 20);
  doc.text(`Rep: ${repName}`, PAGE_MARGIN + 46, PAGE_MARGIN + 34);

  doc.y = PAGE_MARGIN + 60;
  doc.x = PAGE_MARGIN;
}

function drawSummary(doc, summary) {
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor(THEME.heading).text('Summary', PAGE_MARGIN);
  doc.moveDown(0.3);

  const line =
    `Total dials: ${summary.dials}    Contacts: ${summary.contacts}    Voicemails: ${summary.voicemails}    ` +
    `No answers: ${summary.noAnswers}    DNC flagged: ${summary.dncFlagged}    Connect rate: ${summary.connectRate}%`;
  doc.fontSize(9).fillColor(THEME.subtle).text(line, PAGE_MARGIN, doc.y, { width: TABLE_WIDTH });
  doc.moveDown(1);
}

function drawTableHeader(doc) {
  const headerY = doc.y;
  doc.rect(PAGE_MARGIN, headerY, TABLE_WIDTH, 20).fill(THEME.headerFill);
  doc.fontSize(8).fillColor(THEME.white);
  COLUMNS.forEach((col, i) => {
    doc.text(col.label, columnX(i) + 4, headerY + 6, { width: col.width - 8 });
  });
  doc.y = headerY + 20;
  doc.x = PAGE_MARGIN;
}

/** Height a row needs, based on how tall the wrapped note text will be. */
function rowHeight(doc, row) {
  const noteCol = COLUMNS.find((c) => c.key === 'note');
  const noteHeight = doc.heightOfString(row.note || '—', { width: noteCol.width - 8, fontSize: 8 });
  return Math.max(22, noteHeight + 10);
}

function drawRow(doc, row, index, height) {
  const y = doc.y;
  if (index % 2 === 1) {
    doc.rect(PAGE_MARGIN, y, TABLE_WIDTH, height).fill(THEME.rowShade);
  }
  doc.fontSize(8).fillColor(THEME.heading);
  COLUMNS.forEach((col, i) => {
    const value = col.key === 'note' ? row.note || '—' : row[col.key];
    doc.text(String(value ?? '—'), columnX(i) + 4, y + 5, { width: col.width - 8 });
  });
  doc.y = y + height;
  doc.x = PAGE_MARGIN;
}

function drawFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // Temporarily zero the bottom margin so writing this close to the edge
    // doesn't trip PDFKit's auto-page-break and spawn a spurious blank page.
    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const bottom = doc.page.height - PAGE_MARGIN + 10;
    doc
      .fontSize(8)
      .fillColor(THEME.subtle)
      .text(`Page ${i - range.start + 1} of ${range.count}`, PAGE_MARGIN, bottom, {
        width: doc.page.width - PAGE_MARGIN * 2,
        align: 'center',
      });
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
    dncFlagged: rows.filter((r) => r.disposition === 'dnc').length,
  };

  const tableRows = rows.map((r) => ({
    name: r.name,
    brokerage: r.brokerage || '—',
    phone: r.phone,
    status: DISPOSITION_LABELS[r.disposition] || r.disposition,
    note: r.note || '—',
    duration: formatDuration(r.duration_seconds),
    timeCalled: new Date(r.started_at).toLocaleTimeString('en-US', { timeStyle: 'short' }),
  }));

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'LETTER', bufferPages: true });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawHeader(doc, repName, date);
    drawSummary(doc, summary);

    if (tableRows.length === 0) {
      doc.fontSize(10).fillColor(THEME.subtle).text('No calls recorded for this date.', PAGE_MARGIN);
    } else {
      drawTableHeader(doc);
      tableRows.forEach((row, i) => {
        const height = rowHeight(doc, row);
        if (doc.y + height > doc.page.height - PAGE_MARGIN - 20) {
          doc.addPage();
          drawTableHeader(doc);
        }
        drawRow(doc, row, i, height);
      });
    }

    drawFooters(doc);
    doc.end();
  });
}

module.exports = { buildDailyReportBuffer };
