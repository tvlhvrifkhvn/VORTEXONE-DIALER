const path = require('path');
const PDFDocument = require('pdfkit');
const reports = require('./reports');
const reportingPeriod = require('./reportingPeriod');

const THEME = {
  blue: '#3B82F6',
  heading: '#1F2937',
  subtle: '#6B7280',
  white: '#FFFFFF',
  summaryBg: '#F1F3F5',
  rowShade: '#F8F9FA',
  border: '#E5E7EB',
};

// Bundled open-licence fonts (assets/fonts, SIL OFL 1.1 — see README there).
// PDFKit's built-in Helvetica only covers WinAnsi, so accented names were at
// risk and emoji came out as garbage. Noto Sans covers Latin, Greek and
// Cyrillic; Noto Emoji draws emoji in black and white (no colour emoji in PDF).
const FONT_DIR = path.join(__dirname, '../../assets/fonts');
const FONT = 'NotoSans';
const FONT_BOLD = 'NotoSans-Bold';
const FONT_EMOJI = 'NotoEmoji';
function registerFonts(doc) {
  doc.registerFont(FONT, path.join(FONT_DIR, 'NotoSans-Regular.ttf'));
  doc.registerFont(FONT_BOLD, path.join(FONT_DIR, 'NotoSans-Bold.ttf'));
  doc.registerFont(FONT_EMOJI, path.join(FONT_DIR, 'NotoEmoji-Regular.ttf'));
}

// Emoji (pictographs plus their joiners, skin tones and variation selectors).
const EMOJI_RUN = /((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:[\u{FE0F}\u{20E3}\u{1F3FB}-\u{1F3FF}]|\u{200D}(?:\p{Extended_Pictographic}))*)+/gu;
const PLACEHOLDER = '?';

/**
 * Splits text into runs drawn with Noto Sans or Noto Emoji. Any character
 * neither font has (e.g. a script outside Latin/Greek/Cyrillic) becomes "?"
 * rather than an empty box. Text is always drawn as plain text.
 */
function textRuns(doc, value) {
  const text = String(value ?? '—').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
  doc.font(FONT);
  const sans = doc._font.font;
  doc.font(FONT_EMOJI);
  const emoji = doc._font.font;
  const keep = (chunk, font) =>
    [...chunk].map((ch) => (/\s/.test(ch) || font.hasGlyphForCodePoint(ch.codePointAt(0)) ? ch : PLACEHOLDER)).join('');
  const runs = [];
  let last = 0;
  for (const m of text.matchAll(EMOJI_RUN)) {
    if (m.index > last) runs.push({ font: FONT, text: keep(text.slice(last, m.index), sans) });
    const drawable = [...m[0]].every((ch) => /[\u200D\uFE0F]/.test(ch) || emoji.hasGlyphForCodePoint(ch.codePointAt(0)));
    runs.push(drawable ? { font: FONT_EMOJI, text: m[0] } : { font: FONT, text: PLACEHOLDER });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ font: FONT, text: keep(text.slice(last), sans) });
  return runs.filter((r) => r.text.length);
}

/** Draws text runs as one wrapped paragraph in a box of the given width. */
function drawRuns(doc, runs, x, y, width, { bold = false, size, color }) {
  doc.fillColor(color).fontSize(size);
  runs.forEach((run, i) => {
    doc.font(run.font === FONT && bold ? FONT_BOLD : run.font);
    const opts = { width, continued: i < runs.length - 1, lineBreak: true };
    if (i === 0) doc.text(run.text, x, y, opts);
    else doc.text(run.text, opts);
  });
}

/** Height of the runs when wrapped (emoji measured as two wide letters: never under-estimates). */
function heightOfRuns(doc, runs, width, { bold = false, size }) {
  const flat = runs.map((r) => (r.font === FONT_EMOJI ? 'MM'.repeat([...r.text].length) : r.text)).join('');
  return doc.font(bold ? FONT_BOLD : FONT).fontSize(size).heightOfString(flat, { width });
}

const MARGIN = 40;
const PAGE_SIZE = 'A4';
// Landscape (841.89 x 595.28 pt): eight columns fit without squeezing names and notes.
const PAGE_LAYOUT = 'landscape';

// Proportional widths per the spec, scaled against the usable page width
// (A4 width minus left+right margins) rather than hardcoded points, so the
// table always exactly fills the page regardless of page size.
// Short columns (#, Phone, Status, Duration, Time) are sized to their
// widest value or header so they never wrap; Name, Brokerage and Note share
// the rest of the page by `share` and wrap inside their cells.
const COLUMN_SPEC = [
  { key: 'index', label: '#', fit: true },
  { key: 'name', label: 'Lead Name', share: 0.27 },
  { key: 'brokerage', label: 'Brokerage', share: 0.23 },
  { key: 'phone', label: 'Phone', fit: true },
  { key: 'status', label: 'Status', fit: true },
  { key: 'note', label: 'Note', share: 0.5 },
  { key: 'duration', label: 'Duration', fit: true },
  { key: 'timeCalled', label: 'Time', fit: true },
];
const CELL_PADDING = 8; // 4 pt each side

/** (214) 555-1050 for a US number; anything else as stored. */
function formatPhone(phone) {
  const m = /^\+?1?(\d{3})(\d{3})(\d{4})$/.exec(String(phone || '').replace(/[^\d+]/g, ''));
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone || '—';
}

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
function buildColumns(doc, usableWidth, rows) {
  const fitWidth = (col) => {
    const header = doc.font(FONT_BOLD).fontSize(10).widthOfString(col.label);
    doc.font(FONT).fontSize(9);
    const widest = rows.reduce((max, row) => Math.max(max, doc.widthOfString(String(row[col.key] ?? '—'))), 0);
    return Math.ceil(Math.max(header, widest)) + CELL_PADDING + 2;
  };
  const widths = COLUMN_SPEC.map((col) => (col.fit ? fitWidth(col) : 0));
  const rest = usableWidth - widths.reduce((a, b) => a + b, 0);
  let x = MARGIN;
  return COLUMN_SPEC.map((col, i) => {
    const width = col.fit ? widths[i] : Math.floor(rest * col.share);
    const column = { ...col, x, width };
    x += width;
    return column;
  });
}

function drawHeader(doc, usableWidth, repName, period) {
  doc
    .font(FONT_BOLD)
    .fontSize(18)
    .fillColor(THEME.blue)
    .text(period.kind === 'range' ? 'VORTEXONE AGENCY — Call Report' : 'VORTEXONE AGENCY — Daily Call Report', MARGIN, MARGIN, { continued: false });

  // The day or range, and the timezone every time on the page is in.
  const periodLine = period.kind === 'range' ? `From ${period.label}` : period.label;
  doc.font(FONT).fontSize(9.5).fillColor(THEME.subtle)
    .text(`${periodLine}  ·  Times in ${period.timezone}  ·  ${repName}`, MARGIN, MARGIN + 26, { width: usableWidth });

  const ruleY = doc.y + 6;
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
      .font(FONT)
      .fontSize(8)
      .fillColor(THEME.subtle)
      .text(label, x, boxY + 8, { width: cellWidth, align: 'center' });
    doc
      .font(FONT_BOLD)
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
  const bold = font === FONT_BOLD;
  const tallest = columns.reduce((max, col) => {
    const value = (col.key === 'note' ? row.note : row[col.key]) ?? '—';
    const height = heightOfRuns(doc, textRuns(doc, value), col.width - 8, { bold, size: fontSize });
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
    FONT_BOLD,
    10
  );
  doc.rect(MARGIN, y, usableWidth, height).fill(THEME.blue);
  columns.forEach((col) => {
    doc.rect(col.x, y, col.width, height).strokeColor(THEME.blue).lineWidth(0.5).stroke();
    doc
      .font(FONT_BOLD)
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
    drawRuns(doc, textRuns(doc, value), col.x + 4, y + 5, col.width - 8, { size: 9, color: THEME.heading });
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
      .font(FONT)
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

/** Builds the call report PDF for a period (reportingPeriod.resolvePeriod;
 * default the reporting day containing now) as a Buffer. */
async function buildDailyReportBuffer(periodInput, repName = 'Talha Arif') {
  const period = periodInput || (await reportingPeriod.resolvePeriod());

  // Headline numbers and table rows come from the same period and the same
  // WHERE clause (reports.periodStats / periodCalls): the counts always match.
  const [summary, rows] = await Promise.all([reports.periodStats(period), reports.periodCalls(period)]);

  const tableRows = rows.map((r, i) => ({
    index: i + 1,
    name: r.is_manual ? 'Dial pad call' : r.name,
    brokerage: r.brokerage || '—',
    phone: formatPhone(r.is_manual ? r.to_number : r.phone),
    status: r.disposition
      ? DISPOSITION_LABELS[r.disposition] || r.disposition
      : r.was_abandoned ? 'Abandoned' : r.is_manual ? 'Dial pad' : r.ended_at ? 'Not logged' : 'In progress',
    note: r.note || '—',
    duration: formatDuration(r.duration_seconds),
    // In the reporting timezone; a range longer than one day also shows the date.
    timeCalled: new Intl.DateTimeFormat('en-US', {
      timeZone: period.timezone, hour: 'numeric', minute: '2-digit',
      ...(period.kind === 'range' && period.end - period.start > 864e5 ? { month: 'short', day: 'numeric' } : {}),
    }).format(new Date(r.started_at)),
  }));

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: PAGE_SIZE, layout: PAGE_LAYOUT, bufferPages: true });
    registerFonts(doc);
    const usableWidth = doc.page.width - MARGIN * 2;
    const columns = buildColumns(doc, usableWidth, tableRows);

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawHeader(doc, usableWidth, repName, period);
    drawSummary(doc, usableWidth, summary);

    if (tableRows.length === 0) {
      doc.font(FONT).fontSize(10).fillColor(THEME.subtle).text('No calls recorded for this period.', MARGIN);
    } else {
      drawTableHeader(doc, columns, usableWidth);
      // Room for one row on an empty page (below the repeated header row, above the footer).
      const maxRowHeight = doc.page.height - MARGIN - 30 - MARGIN - 40;
      tableRows.forEach((row, i) => {
        let height = computeRowHeight(doc, columns, row, FONT, 9);
        if (height > maxRowHeight) {
          // A note longer than a whole page is cut to fit, and says so.
          const full = row.note;
          let lo = 0;
          let hi = full.length;
          while (hi - lo > 1) {
            const mid = Math.floor((lo + hi) / 2);
            const fits = computeRowHeight(doc, columns, { ...row, note: `${full.slice(0, mid)}… [note cut: too long for one page]` }, FONT, 9) <= maxRowHeight;
            if (fits) lo = mid; else hi = mid;
          }
          row = { ...row, note: `${full.slice(0, lo)}… [note cut: too long for one page]` };
          height = computeRowHeight(doc, columns, row, FONT, 9);
        }
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
