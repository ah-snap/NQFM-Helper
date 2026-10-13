// Builds clipboard text (TSV) that pastes directly into the spreadsheet's existing
// columns/rows — data rows only, no header, since the sheet already has headers.
(function (global) {
  const NQFM = (global.NQFM = global.NQFM || {});

  function boolStr(v) {
    return v ? 'TRUE' : 'FALSE';
  }

  function ticketsToTsv(tickets) {
    const columns = NQFM.TICKET_COLUMNS.map((c) => c.key);
    return tickets
      .map((t) =>
        columns
          .map((col) => {
            const v = t[col];
            if (typeof v === 'boolean') return boolStr(v);
            return v === undefined || v === null ? '' : v;
          })
          .join('\t')
      )
      .join('\n');
  }

  function pct(v) {
    return `${Math.round(v * 1000) / 10}%`;
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  // One row per metrics set (Sprint label, Reliability, Predictability, Quality, Throughput, Cost, Score).
  function summaryToTsv(metrics, sprintLabel) {
    const row = (m) => [sprintLabel, pct(m.reliability), pct(m.predictability), pct(m.quality), round2(m.throughput), m.cost, round2(m.score)].join('\t');
    return `${row(metrics.standard)}\n\nAlternate\n${row(metrics.alternate)}`;
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      return false;
    }
  }

  NQFM.format = { ticketsToTsv, summaryToTsv, copyToClipboard, pct, round2 };
})(typeof window !== 'undefined' ? window : globalThis);
