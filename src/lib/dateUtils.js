// Jira date parsing (handles both ISO strings and the legacy "d/MMM/yy h:mm a" format)
// plus the month-overlap weighting used by the popup's "calculate by month" mode.
(function (global) {
  const NQFM = (global.NQFM = global.NQFM || {});
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  function parseJiraDate(value) {
    if (!value) return null;
    const direct = new Date(value);
    if (!isNaN(direct.getTime())) return direct;

    const m = /^(\d{1,2})\/(\w{3})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(String(value).trim());
    if (!m) return null;
    let [, day, mon, year, hour, min, ampm] = m;
    const monthIndex = MONTHS[mon.toLowerCase()];
    if (monthIndex === undefined) return null;
    year = year.length === 2 ? Number(year) + 2000 : Number(year);
    hour = Number(hour);
    if (ampm) {
      const upper = ampm.toUpperCase();
      if (upper === 'PM' && hour < 12) hour += 12;
      if (upper === 'AM' && hour === 12) hour = 0;
    }
    return new Date(year, monthIndex, Number(day), hour, Number(min));
  }

  // Number of days (fractional) that [startDate, endDate) overlaps the given calendar month.
  function daysOverlapWithMonth(startDate, endDate, year, monthIndex) {
    if (!startDate || !endDate) return 0;
    const monthStart = new Date(year, monthIndex, 1, 0, 0, 0);
    const monthEnd = new Date(year, monthIndex + 1, 1, 0, 0, 0);
    const overlapStart = startDate > monthStart ? startDate : monthStart;
    const overlapEnd = endDate < monthEnd ? endDate : monthEnd;
    const ms = overlapEnd - overlapStart;
    if (ms <= 0) return 0;
    return ms / (1000 * 60 * 60 * 24);
  }

  // Parses a "YYYY-MM" value from an <input type="month"> element.
  function parseMonthInputValue(value) {
    const m = /^(\d{4})-(\d{2})$/.exec(value || '');
    if (!m) return null;
    return { year: Number(m[1]), monthIndex: Number(m[2]) - 1 };
  }

  NQFM.dateUtils = { parseJiraDate, daysOverlapWithMonth, parseMonthInputValue };
})(typeof window !== 'undefined' ? window : globalThis);
