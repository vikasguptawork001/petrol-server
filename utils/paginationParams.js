/**
 * Shared page/limit parsing for list endpoints.
 * Prevents negative pages and oversized LIMIT values (DoS / accidental huge scans).
 */
function parsePageLimit(page, limit, options = {}) {
  const { defaultLimit = 50, maxLimit = 5000 } = options;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const parsed = parseInt(limit, 10);
  const limitNum = Math.min(
    maxLimit,
    Math.max(1, Number.isFinite(parsed) && parsed > 0 ? parsed : defaultLimit)
  );
  const offset = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, offset };
}

module.exports = { parsePageLimit };
