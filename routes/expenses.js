const express = require('express');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { parsePageLimit } = require('../utils/paginationParams');

const router = express.Router();

function parseAmount(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** Summary + day-wise totals for reports */
router.get('/report/summary', authenticateToken, async (req, res) => {
  try {
    let { from_date, to_date } = req.query;
    if (from_date && to_date && String(from_date) > String(to_date)) {
      const t = from_date;
      from_date = to_date;
      to_date = t;
    }

    let where = 'WHERE 1=1';
    const params = [];
    if (from_date) {
      where += ' AND expense_date >= ?';
      params.push(from_date);
    } else {
      where += ' AND expense_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
    }
    if (to_date) {
      where += ' AND expense_date <= ?';
      params.push(to_date);
    } else if (!from_date) {
      where += ' AND expense_date <= CURDATE()';
    }

    const [byDay] = await pool.execute(
      `SELECT expense_date,
              COUNT(*) AS expense_count,
              COALESCE(SUM(amount), 0) AS total_amount
       FROM expenses
       ${where}
       GROUP BY expense_date
       ORDER BY expense_date DESC`,
      params
    );

    const [totals] = await pool.execute(
      `SELECT COUNT(*) AS expense_count, COALESCE(SUM(amount), 0) AS total_amount
       FROM expenses ${where}`,
      params
    );

    const row = totals[0] || {};
    res.json({
      by_day: (byDay || []).map((r) => ({
        expense_date: r.expense_date,
        expense_count: parseInt(r.expense_count, 10) || 0,
        total_amount: parseFloat(r.total_amount) || 0
      })),
      summary: {
        expense_count: parseInt(row.expense_count, 10) || 0,
        total_amount: parseFloat(row.total_amount) || 0,
        days_with_expenses: (byDay || []).length
      }
    });
  } catch (error) {
    console.error('Expenses report summary error:', error);
    res.status(500).json({ error: 'Failed to load expense report' });
  }
});

/** Aggregated by purpose (category) in range */
router.get('/report/by-purpose', authenticateToken, async (req, res) => {
  try {
    let { from_date, to_date } = req.query;
    if (from_date && to_date && String(from_date) > String(to_date)) {
      const t = from_date;
      from_date = to_date;
      to_date = t;
    }

    let where = 'WHERE 1=1';
    const params = [];
    if (from_date) {
      where += ' AND expense_date >= ?';
      params.push(from_date);
    } else {
      where += ' AND expense_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
    }
    if (to_date) {
      where += ' AND expense_date <= ?';
      params.push(to_date);
    } else if (!from_date) {
      where += ' AND expense_date <= CURDATE()';
    }

    const [rows] = await pool.execute(
      `SELECT purpose,
              COUNT(*) AS expense_count,
              COALESCE(SUM(amount), 0) AS total_amount
       FROM expenses
       ${where}
       GROUP BY purpose
       ORDER BY total_amount DESC`,
      params
    );

    res.json({
      rows: (rows || []).map((r) => ({
        purpose: r.purpose,
        expense_count: parseInt(r.expense_count, 10) || 0,
        total_amount: parseFloat(r.total_amount) || 0
      }))
    });
  } catch (error) {
    console.error('Expenses by-purpose report error:', error);
    res.status(500).json({ error: 'Failed to load report' });
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { from_date, to_date, search, page = 1, limit = 50 } = req.query;
    const { pageNum, limitNum, offset } = parsePageLimit(page, limit, { defaultLimit: 50, maxLimit: 5000 });

    let base = 'FROM expenses WHERE 1=1';
    const params = [];

    if (from_date) {
      base += ' AND expense_date >= ?';
      params.push(from_date);
    }
    if (to_date) {
      base += ' AND expense_date <= ?';
      params.push(to_date);
    }
    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      base += ' AND (purpose LIKE ? OR paid_to LIKE ? OR reason LIKE ? OR notes LIKE ?)';
      params.push(q, q, q, q);
    }

    const [countResult] = await pool.execute(`SELECT COUNT(*) AS total ${base}`, params);
    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limitNum);

    const [rows] = await pool.execute(
      `SELECT id, expense_date, amount, purpose, paid_to, reason, notes, created_by_user_id, created_at
       ${base}
       ORDER BY expense_date DESC, id DESC
       LIMIT ${limitNum} OFFSET ${offset}`,
      params
    );

    res.json({
      expenses: rows,
      pagination: { page: pageNum, limit: limitNum, totalRecords, totalPages }
    });
  } catch (error) {
    console.error('List expenses error:', error);
    res.status(500).json({ error: 'Failed to list expenses' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { expense_date, amount, purpose, paid_to, reason, notes } = req.body;
    if (!expense_date || typeof expense_date !== 'string') {
      return res.status(400).json({ error: 'expense_date is required (YYYY-MM-DD)' });
    }
    if (!purpose || typeof purpose !== 'string' || !purpose.trim()) {
      return res.status(400).json({ error: 'purpose is required' });
    }
    const amt = parseAmount(amount);
    if (amt == null) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    const uid = req.user?.id != null ? parseInt(req.user.id, 10) : null;
    const createdBy = Number.isFinite(uid) ? uid : null;

    const [result] = await pool.execute(
      `INSERT INTO expenses (expense_date, amount, purpose, paid_to, reason, notes, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        expense_date.trim().slice(0, 10),
        amt,
        purpose.trim(),
        paid_to != null && String(paid_to).trim() ? String(paid_to).trim() : null,
        reason != null && String(reason).trim() ? String(reason).trim() : null,
        notes != null && String(notes).trim() ? String(notes).trim() : null,
        createdBy
      ]
    );

    const [rows] = await pool.execute(
      `SELECT id, expense_date, amount, purpose, paid_to, reason, notes, created_by_user_id, created_at
       FROM expenses WHERE id = ?`,
      [result.insertId]
    );
    res.status(201).json({ expense: rows[0] });
  } catch (error) {
    console.error('Create expense error:', error);
    res.status(500).json({ error: 'Failed to save expense' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid expense id' });
    }
    const { expense_date, amount, purpose, paid_to, reason, notes } = req.body;
    if (!expense_date || typeof expense_date !== 'string') {
      return res.status(400).json({ error: 'expense_date is required' });
    }
    if (!purpose || typeof purpose !== 'string' || !purpose.trim()) {
      return res.status(400).json({ error: 'purpose is required' });
    }
    const amt = parseAmount(amount);
    if (amt == null) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    const [result] = await pool.execute(
      `UPDATE expenses SET expense_date = ?, amount = ?, purpose = ?, paid_to = ?, reason = ?, notes = ?
       WHERE id = ?`,
      [
        expense_date.trim().slice(0, 10),
        amt,
        purpose.trim(),
        paid_to != null && String(paid_to).trim() ? String(paid_to).trim() : null,
        reason != null && String(reason).trim() ? String(reason).trim() : null,
        notes != null && String(notes).trim() ? String(notes).trim() : null,
        id
      ]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    const [rows] = await pool.execute(
      `SELECT id, expense_date, amount, purpose, paid_to, reason, notes, created_by_user_id, created_at
       FROM expenses WHERE id = ?`,
      [id]
    );
    res.json({ expense: rows[0] });
  } catch (error) {
    console.error('Update expense error:', error);
    res.status(500).json({ error: 'Failed to update expense' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid expense id' });
    }
    const [result] = await pool.execute('DELETE FROM expenses WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Delete expense error:', error);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

module.exports = router;
