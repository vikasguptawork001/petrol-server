const express = require('express');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Helper: get local datetime for MySQL
function getLocalDatetime(d) {
  const date = d ? new Date(d) : new Date();
  const pad = (n) => (n < 10 ? '0' + n : n);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

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

    const nowDatetime = getLocalDatetime();
    const openingAt = openingAtReq ? getLocalDatetime(openingAtReq) : nowDatetime;
    const closingAt = closingAtReq ? getLocalDatetime(closingAtReq) : nowDatetime;

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

// List daily nozzle readings (filter by date range, nozzle_id, attendant_id)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { from_date, to_date, nozzle_id, attendant_id, pending_closing, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
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
