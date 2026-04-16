/**
 * India Standard Time (IST, Asia/Kolkata) for all business dates and datetimes.
 */

const IST = 'Asia/Kolkata';

function collectParts(date, options) {
  const d = new Date(date);
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: IST, ...options });
  const parts = {};
  for (const x of f.formatToParts(d)) {
    if (x.type !== 'literal') parts[x.type] = x.value;
  }
  return parts;
}

/**
 * Calendar date in IST as YYYY-MM-DD
 */
const getLocalDateString = (date = new Date()) => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const parts = collectParts(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${parts.year}-${parts.month}-${parts.day}`;
};

/**
 * ISO-like string in IST: YYYY-MM-DDTHH:mm:ss.sss
 */
const getLocalISOString = (date = new Date()) => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  });
  const parts = {};
  for (const x of f.formatToParts(d)) {
    if (x.type !== 'literal') parts[x.type] = x.value;
  }
  const frac = parts.fractionalSecond != null ? parts.fractionalSecond : String(d.getMilliseconds()).padStart(3, '0');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${frac}`;
};

/**
 * MySQL DATETIME string in IST: YYYY-MM-DD HH:mm:ss
 * When the client sends `getLocalISOString()` (YYYY-MM-DDTHH:mm:ss — IST wall time, no Z),
 * do not parse with `new Date(str)` on the server: Node may interpret that in the host TZ.
 * Strip to MySQL format so stored times match what the user picked.
 */
const formatISTDateTimeForMySQL = (date = new Date()) => {
  if (typeof date === 'string') {
    const m = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const [, y, mo, d, h, mi, se] = m;
      return `${y}-${mo}-${d} ${h}:${mi}:${se}`;
    }
  }
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return formatISTDateTimeForMySQL(new Date());
  const parts = collectParts(d, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
};

module.exports = {
  getLocalDateString,
  getLocalISOString,
  formatISTDateTimeForMySQL,
};
