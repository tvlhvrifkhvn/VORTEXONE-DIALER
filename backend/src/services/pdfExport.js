const PDFDocument = require('pdfkit');
const db = require('../db');
const reports = require('./reports');

const THEME = {
  heading: '#3E4C63',
  subtle: '#6A7A94',
};

/** Builds the "all dialed contacts today" PDF as a Buffer. */
async function buildDailyReportBuffer(dateInput) {
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

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'LETTER' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).fillColor(THEME.heading).text('Vortex Dialer — Daily Call Report');
    doc.fontSize(11).fillColor(THEME.subtle).text(startOfDay.toDateString());
    doc.moveDown(1);

    doc
      .fontSize(12)
      .fillColor(THEME.heading)
      .text(`Total dials: ${todayStats.dials}    Contacts: ${todayStats.contacts}    Connect rate: ${todayStats.connectRate}%`);
    doc.moveDown(1);

    if (rows.length === 0) {
      doc.fontSize(11).fillColor(THEME.subtle).text('No calls recorded for this date.');
    }

    rows.forEach((row, i) => {
      if (doc.y > 700) doc.addPage();
      doc
        .fontSize(11)
        .fillColor(THEME.heading)
        .text(`${i + 1}. ${row.name} — ${row.phone} (${row.state})`);
      doc
        .fontSize(9)
        .fillColor(THEME.subtle)
        .text(
          `${row.brokerage || 'No brokerage'}  |  ${new Date(row.started_at).toLocaleTimeString()}  |  ` +
            `${row.disposition}  |  ${row.duration_seconds ?? 0}s`
        );
      if (row.note) {
        doc.fontSize(9).fillColor(THEME.heading).text(`Note: ${row.note}`);
      }
      doc.moveDown(0.5);
    });

    doc.end();
  });
}

module.exports = { buildDailyReportBuffer };
