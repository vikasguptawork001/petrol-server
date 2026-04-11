const express = require('express');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { formatISTDateTimeForMySQL } = require('../utils/dateUtils');

const router = express.Router();

router.get('/last/:nozzle_id', authenticateToken, async (req, res) => {
  try {
    const nozzle_id = parseInt(req.params.nozzle_id, 10);
    if (!nozzle_id) return res.status(400).json({ error: 'Invalid nozzle_id' });
    const [rows] = await pool.execute(
      `SELECT closing_reading 
       FROM nozzle_readings 
       WHERE nozzle_id = ? AND closing_reading IS NOT NULL 
       ORDER BY reading_date DESC, id DESC LIMIT 1`,
      [nozzle_id]
    );
    res.json({ last_closing_reading: rows.length > 0 ? rows[0].closing_reading : '' });
  } catch (error) {
    console.error('Fetch last reading error:', error);
    res.status(500).json({ error: 'Failed to fetch last reading' });
  }
});

// Submit or upsert a daily nozzle reading (parcel: opening only first, add closing later)
// Body: attendant_id, nozzle_id, reading_date, opening_reading? (optional if adding closing only), closing_reading?, opening_at?, closing_at?
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      id,
      attendant_id,
      nozzle_id,
      reading_date,
      opening_reading,
      closing_reading,
      opening_at: openingAtReq,
      closing_at: closingAtReq
    } = req.body;

    if (!attendant_id || !nozzle_id || !reading_date) {
      return res.status(400).json({ error: 'attendant_id, nozzle_id and reading_date are required' });
    }

    const hasOpening = opening_reading != null && opening_reading !== '';
    const hasClosing = closing_reading != null && closing_reading !== '';
    if (!hasOpening && !hasClosing) {
      return res.status(400).json({ error: 'Provide at least opening_reading or closing_reading' });
    }

    const openingVal = hasOpening ? parseFloat(opening_reading) : null;
    const closingVal = hasClosing ? parseFloat(closing_reading) : null;
    if (hasOpening && (isNaN(openingVal) || openingVal < 0)) {
      return res.status(400).json({ error: 'opening_reading must be a non-negative number' });
    }
    if (hasClosing && (isNaN(closingVal) || closingVal < 0)) {
      return res.status(400).json({ error: 'closing_reading must be a non-negative number' });
    }

    const nowDatetime = formatISTDateTimeForMySQL();
    const openingAt = openingAtReq ? formatISTDateTimeForMySQL(openingAtReq) : nowDatetime;
    const closingAt = closingAtReq ? formatISTDateTimeForMySQL(closingAtReq) : nowDatetime;

    const connection = await pool.getConnection();
    try {
      let row = null;
      if (id) {
        const [existing] = await connection.execute(
          `SELECT id, opening_reading, opening_at, closing_reading, closing_at
           FROM nozzle_readings
           WHERE id = ?`,
          [id]
        );
        row = existing[0];
      }

      const openingForValidation = hasOpening ? openingVal : (row && row.opening_reading != null ? parseFloat(row.opening_reading) : null);
      if (hasClosing && openingForValidation != null && closingVal <= openingForValidation) {
        return res.status(400).json({ error: 'Closing reading must be greater than opening reading' });
      }

      if (!row && hasOpening && hasClosing && closingVal <= openingVal) {
        return res.status(400).json({ error: 'Closing reading must be greater than opening reading' });
      }

      if (row) {
        // Update existing record (parcel: may set only closing)
        const newOpening = hasOpening ? openingVal : (row.opening_reading != null ? parseFloat(row.opening_reading) : 0);
        const newOpeningAt = hasOpening ? openingAt : (row.opening_at || nowDatetime);
        const newClosing = hasClosing ? closingVal : (row.closing_reading != null ? parseFloat(row.closing_reading) : null);
        const newClosingAt = hasClosing ? closingAt : (row.closing_at || null);

        await connection.execute(
          `UPDATE nozzle_readings
           SET opening_reading = ?, opening_at = ?, closing_reading = ?, closing_at = ?
           WHERE id = ?`,
          [newOpening, newOpeningAt, newClosing, newClosingAt, row.id]
        );
      } else {
        // Insert new: must have opening for new row
        if (!hasOpening) {
          return res.status(400).json({
            error: 'Cannot add a closing reading without an existing shift record ID. Add opening reading first.'
          });
        }
        await connection.execute(
          `INSERT INTO nozzle_readings (attendant_id, nozzle_id, reading_date, opening_reading, closing_reading, opening_at, closing_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            attendant_id,
            nozzle_id,
            reading_date,
            openingVal,
            hasClosing ? closingVal : null,
            openingAt,
            hasClosing ? closingAt : null
          ]
        );
      }

      // Fetch the newly inserted/updated row
      const [rows] = await connection.execute(
        `SELECT nr.*, a.name AS attendant_name, n.name AS nozzle_name
         FROM nozzle_readings nr
         JOIN attendants a ON a.id = nr.attendant_id
         JOIN nozzles n ON n.id = nr.nozzle_id
         WHERE nr.id = ? OR (nr.attendant_id = ? AND nr.nozzle_id = ? AND nr.reading_date = ?)
         ORDER BY nr.id DESC LIMIT 1`,
        [row ? row.id : 0, attendant_id, nozzle_id, reading_date]
      );
      res.status(201).json({ reading: rows[0] });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Submit nozzle reading error:', error);
    res.status(500).json({ error: 'Failed to save reading' });
  }
});

function buildNozzleReadingsFilterClause(query) {
  const { from_date, to_date, nozzle_id, attendant_id } = query;
  let clause = `
    FROM nozzle_readings nr
    JOIN attendants a ON a.id = nr.attendant_id
    JOIN nozzles n ON n.id = nr.nozzle_id
    WHERE 1=1
  `;
  const params = [];
  if (from_date) {
    clause += ' AND nr.reading_date >= ?';
    params.push(from_date);
  }
  if (to_date) {
    clause += ' AND nr.reading_date <= ?';
    params.push(to_date);
  }
  if (nozzle_id) {
    clause += ' AND nr.nozzle_id = ?';
    params.push(nozzle_id);
  }
  if (attendant_id) {
    clause += ' AND nr.attendant_id = ?';
    params.push(attendant_id);
  }
  return { clause, params };
}

// Aggregates for the selected period (not paginated) — totals, nozzle/attendant breakdown
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const { clause, params } = buildNozzleReadingsFilterClause(req.query);
    const [aggRows] = await pool.execute(
      `SELECT
        COUNT(*) AS total_shifts,
        SUM(CASE WHEN nr.closing_reading IS NOT NULL THEN 1 ELSE 0 END) AS completed_shifts,
        SUM(CASE WHEN nr.closing_reading IS NULL THEN 1 ELSE 0 END) AS pending_shifts,
        COALESCE(SUM(CASE WHEN nr.closing_reading IS NOT NULL THEN (nr.closing_reading - nr.opening_reading) ELSE 0 END), 0) AS total_sale_liters
      ${clause}`,
      params
    );
    const a = aggRows[0] || {};
    const [nozzleRows] = await pool.execute(
      `SELECT n.name AS name,
        COALESCE(SUM(CASE WHEN nr.closing_reading IS NOT NULL THEN (nr.closing_reading - nr.opening_reading) ELSE 0 END), 0) AS total_liters
      ${clause}
      GROUP BY nr.nozzle_id, n.name
      ORDER BY total_liters DESC`,
      params
    );
    const [attRows] = await pool.execute(
      `SELECT a.name AS name,
        COALESCE(SUM(CASE WHEN nr.closing_reading IS NOT NULL THEN (nr.closing_reading - nr.opening_reading) ELSE 0 END), 0) AS total_liters
      ${clause}
      GROUP BY nr.attendant_id, a.name
      ORDER BY total_liters DESC`,
      params
    );
    res.json({
      total_sale_liters: parseFloat(a.total_sale_liters) || 0,
      total_shifts: Number(a.total_shifts) || 0,
      completed_shifts: Number(a.completed_shifts) || 0,
      pending_shifts: Number(a.pending_shifts) || 0,
      by_nozzle: (nozzleRows || []).map((r) => ({
        name: r.name,
        total: parseFloat(r.total_liters) || 0
      })),
      by_attendant: (attRows || []).map((r) => ({
        name: r.name,
        total: parseFloat(r.total_liters) || 0
      }))
    });
  } catch (error) {
    console.error('Nozzle readings summary error:', error);
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

/**
 * Full meter-reading history for one attendant (all nozzles, date range).
 * Ordered by date, then time — shows each shift: opening/closing, nozzle, liters sold.
 */
router.get('/report/attendant-history', authenticateToken, async (req, res) => {
  try {
    const attendant_id = parseInt(req.query.attendant_id, 10);
    if (!Number.isFinite(attendant_id) || attendant_id <= 0) {
      return res.status(400).json({ error: 'attendant_id is required' });
    }
    const { from_date, to_date } = req.query;
    let sql = `
      SELECT nr.id, nr.attendant_id, nr.nozzle_id, nr.reading_date,
             nr.opening_reading, nr.closing_reading, nr.opening_at, nr.closing_at,
             (CASE WHEN nr.closing_reading IS NOT NULL THEN (nr.closing_reading - nr.opening_reading) ELSE NULL END) AS sale_liters,
             a.name AS attendant_name, n.name AS nozzle_name
      FROM nozzle_readings nr
      JOIN attendants a ON a.id = nr.attendant_id
      JOIN nozzles n ON n.id = nr.nozzle_id
      WHERE nr.attendant_id = ?
    `;
    const params = [attendant_id];
    if (from_date) {
      sql += ' AND nr.reading_date >= ?';
      params.push(from_date);
    }
    if (to_date) {
      sql += ' AND nr.reading_date <= ?';
      params.push(to_date);
    }
    sql += ' ORDER BY nr.reading_date ASC, nr.opening_at ASC, nr.id ASC';

    const [rows] = await pool.execute(sql, params);
    const normalized = (rows || []).map((r) => ({
      id: r.id,
      attendant_id: r.attendant_id,
      nozzle_id: r.nozzle_id,
      reading_date: r.reading_date,
      opening_reading: r.opening_reading != null ? parseFloat(r.opening_reading) : null,
      closing_reading: r.closing_reading != null ? parseFloat(r.closing_reading) : null,
      opening_at: r.opening_at,
      closing_at: r.closing_at,
      sale_liters: r.sale_liters != null ? parseFloat(r.sale_liters) : null,
      attendant_name: r.attendant_name,
      nozzle_name: r.nozzle_name,
      completed: r.closing_reading != null
    }));

    const totals = normalized.reduce(
      (acc, r) => {
        acc.shifts += 1;
        if (r.completed) acc.completed_shifts += 1;
        acc.total_liters += r.sale_liters != null ? r.sale_liters : 0;
        return acc;
      },
      { shifts: 0, completed_shifts: 0, total_liters: 0 }
    );

    res.json({ shifts: normalized, summary: totals });
  } catch (error) {
    console.error('Attendant history report error:', error);
    res.status(500).json({ error: 'Failed to load attendant history' });
  }
});

/**
 * One nozzle over a date range: shifts in order (by calendar day, then opening time).
 * Query: nozzle_id (required), from_date + to_date (YYYY-MM-DD), or reading_date alone for one day.
 */
router.get('/report/nozzle-daily', authenticateToken, async (req, res) => {
  try {
    const nozzle_id = parseInt(req.query.nozzle_id, 10);
    if (!Number.isFinite(nozzle_id) || nozzle_id <= 0) {
      return res.status(400).json({ error: 'nozzle_id is required' });
    }
    let fromStr = req.query.from_date && String(req.query.from_date).trim().slice(0, 10);
    let toStr = req.query.to_date && String(req.query.to_date).trim().slice(0, 10);
    if ((!fromStr || !toStr) && req.query.reading_date) {
      const d = String(req.query.reading_date).trim().slice(0, 10);
      fromStr = d;
      toStr = d;
    }
    if (!fromStr || !toStr) {
      return res.status(400).json({
        error: 'from_date and to_date are required (YYYY-MM-DD), or use reading_date for a single day'
      });
    }
    if (fromStr > toStr) {
      return res.status(400).json({ error: 'from_date cannot be after to_date' });
    }

    const [rows] = await pool.execute(
      `SELECT nr.id, nr.attendant_id, nr.nozzle_id, nr.reading_date,
              nr.opening_reading, nr.closing_reading, nr.opening_at, nr.closing_at,
              (CASE WHEN nr.closing_reading IS NOT NULL THEN (nr.closing_reading - nr.opening_reading) ELSE NULL END) AS sale_liters,
              a.name AS attendant_name, n.name AS nozzle_name
       FROM nozzle_readings nr
       JOIN attendants a ON a.id = nr.attendant_id
       JOIN nozzles n ON n.id = nr.nozzle_id
       WHERE nr.nozzle_id = ? AND nr.reading_date >= ? AND nr.reading_date <= ?
       ORDER BY nr.reading_date ASC, nr.opening_at ASC, nr.id ASC`,
      [nozzle_id, fromStr, toStr]
    );

    const shifts = (rows || []).map((r, idx) => ({
      sequence: idx + 1,
      id: r.id,
      attendant_id: r.attendant_id,
      attendant_name: r.attendant_name,
      nozzle_id: r.nozzle_id,
      nozzle_name: r.nozzle_name,
      reading_date: r.reading_date,
      opening_reading: r.opening_reading != null ? parseFloat(r.opening_reading) : null,
      closing_reading: r.closing_reading != null ? parseFloat(r.closing_reading) : null,
      opening_at: r.opening_at,
      closing_at: r.closing_at,
      sale_liters: r.sale_liters != null ? parseFloat(r.sale_liters) : null,
      completed: r.closing_reading != null
    }));

    const totalLiters = shifts.reduce((s, r) => s + (r.sale_liters != null ? r.sale_liters : 0), 0);

    res.json({
      nozzle_id,
      from_date: fromStr,
      to_date: toStr,
      reading_date: fromStr === toStr ? fromStr : undefined,
      shifts,
      summary: {
        shift_count: shifts.length,
        completed_count: shifts.filter((s) => s.completed).length,
        total_liters: totalLiters
      }
    });
  } catch (error) {
    console.error('Nozzle daily report error:', error);
    res.status(500).json({ error: 'Failed to load nozzle daily report' });
  }
});

// List daily nozzle readings (filter by date range, nozzle_id, attendant_id)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { from_date, to_date, nozzle_id, attendant_id, pending_closing, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(5000, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    let baseQuery = `
      FROM nozzle_readings nr
      JOIN attendants a ON a.id = nr.attendant_id
      JOIN nozzles n ON n.id = nr.nozzle_id
      WHERE 1=1
    `;
    const params = [];

    if (from_date) {
      baseQuery += ' AND nr.reading_date >= ?';
      params.push(from_date);
    }
    if (to_date) {
      baseQuery += ' AND nr.reading_date <= ?';
      params.push(to_date);
    }
    if (nozzle_id) {
      baseQuery += ' AND nr.nozzle_id = ?';
      params.push(nozzle_id);
    }
    if (attendant_id) {
      baseQuery += ' AND nr.attendant_id = ?';
      params.push(attendant_id);
    }
    if (pending_closing === '1' || pending_closing === 'true') {
      baseQuery += ' AND nr.closing_reading IS NULL';
    }

    const [countResult] = await pool.execute(`SELECT COUNT(*) AS total ${baseQuery}`, params);
    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limitNum);

    const [rows] = await pool.execute(
      `SELECT nr.id, nr.attendant_id, nr.nozzle_id, nr.reading_date,
              nr.opening_reading, nr.closing_reading, nr.opening_at, nr.closing_at,
              (CASE WHEN nr.closing_reading IS NOT NULL THEN (nr.closing_reading - nr.opening_reading) ELSE NULL END) AS sale_quantity,
              nr.created_at, a.name AS attendant_name, n.name AS nozzle_name
       ${baseQuery}
       ORDER BY nr.reading_date DESC, nr.id DESC
       LIMIT ${limitNum} OFFSET ${offset}`,
      params
    );

    res.json({
      readings: rows,
      pagination: { page: pageNum, limit: limitNum, totalRecords, totalPages }
    });
  } catch (error) {
    console.error('List nozzle readings error:', error);
    res.status(500).json({ error: 'Failed to list readings' });
  }
});

// Get a single reading by attendant + nozzle + date (for adding closing later)
router.get('/by-key', authenticateToken, async (req, res) => {
  try {
    const { attendant_id, nozzle_id, reading_date } = req.query;
    if (!attendant_id || !nozzle_id || !reading_date) {
      return res.status(400).json({ error: 'attendant_id, nozzle_id and reading_date are required' });
    }
    const [rows] = await pool.execute(
      `SELECT nr.*, a.name AS attendant_name, n.name AS nozzle_name
       FROM nozzle_readings nr
       JOIN attendants a ON a.id = nr.attendant_id
       JOIN nozzles n ON n.id = nr.nozzle_id
       WHERE nr.attendant_id = ? AND nr.nozzle_id = ? AND nr.reading_date = ?`,
      [attendant_id, nozzle_id, reading_date]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No reading found for this attendant, nozzle and date' });
    }
    res.json({ reading: rows[0] });
  } catch (error) {
    console.error('Get nozzle reading by key error:', error);
    res.status(500).json({ error: 'Failed to get reading' });
  }
});

module.exports = router;
