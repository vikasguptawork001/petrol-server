const express = require('express');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Fix historical bug: strip trailing "0" only when preceded by a letter (e.g. "akash0" -> "akash", "Mike20" unchanged)
function normalizeName(name) {
  if (name == null || typeof name !== 'string') return name;
  const trimmed = name.trim();
  return trimmed.replace(/([a-zA-Z])0$/, '$1') || trimmed;
}

// List attendants (attendance_id, name, mobile_number, is_archived). Default: active only. ?include_archived=1 for all.
router.get('/', authenticateToken, async (req, res) => {
  try {
    const includeArchived = req.query.include_archived === '1' || req.query.include_archived === 'true';
    let query = 'SELECT id, attendance_id, name, mobile_number, is_archived, created_at FROM attendants';
    const params = [];
    if (!includeArchived) {
      query += ' WHERE is_archived = 0';
    }
    query += ' ORDER BY name ASC';
    const [rows] = await pool.execute(query, params);
    const normalized = rows.map((r) => ({ ...r, name: normalizeName(r.name) }));
    res.json({ attendants: normalized });
  } catch (error) {
    console.error('List attendants error:', error);
    res.status(500).json({ error: 'Failed to list attendants' });
  }
});

// Validate mobile: if provided, must be exactly 10 digits. Returns null if empty, or validated 10-digit string.
function validateMobile(value) {
  if (value == null || String(value).trim() === '') return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length !== 10) return { error: 'Mobile number must be exactly 10 digits' };
  return digits;
}

// Create attendant
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, attendance_id, mobile_number } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Attendant name is required' });
    }
    const aid = attendance_id != null && String(attendance_id).trim() !== '' ? String(attendance_id).trim() : null;
    const mobileResult = validateMobile(mobile_number);
    if (mobileResult && mobileResult.error) return res.status(400).json({ error: mobileResult.error });
    const mobile = mobileResult;
    const nameToSave = normalizeName(name);

    if (mobile) {
      const [existing] = await pool.execute(
        'SELECT id FROM attendants WHERE mobile_number = ? AND is_archived = 0',
        [mobile]
      );
      if (existing.length > 0) {
        return res.status(400).json({ error: 'This mobile number is already used by another attendant' });
      }
    }

    const [result] = await pool.execute(
      'INSERT INTO attendants (attendance_id, name, mobile_number) VALUES (?, ?, ?)',
      [aid, nameToSave, mobile]
    );
    const [rows] = await pool.execute(
      'SELECT id, attendance_id, name, mobile_number, is_archived, created_at FROM attendants WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json({ attendant: { ...rows[0], name: normalizeName(rows[0].name) } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Attendance ID or mobile number already exists' });
    }
    console.error('Create attendant error:', error);
    res.status(500).json({ error: 'Failed to create attendant' });
  }
});

// Update attendant
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid attendant ID' });
    }
    const { name, attendance_id, mobile_number } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Attendant name is required' });
    }
    const aid = attendance_id != null && String(attendance_id).trim() !== '' ? String(attendance_id).trim() : null;
    const mobileResult = validateMobile(mobile_number);
    if (mobileResult && mobileResult.error) return res.status(400).json({ error: mobileResult.error });
    const mobile = mobileResult;
    const nameToSave = normalizeName(name);

    if (mobile) {
      const [existing] = await pool.execute(
        'SELECT id FROM attendants WHERE mobile_number = ? AND id != ? AND is_archived = 0',
        [mobile, id]
      );
      if (existing.length > 0) {
        return res.status(400).json({ error: 'This mobile number is already used by another attendant' });
      }
    }

    const [result] = await pool.execute(
      'UPDATE attendants SET attendance_id = ?, name = ?, mobile_number = ? WHERE id = ?',
      [aid, nameToSave, mobile, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Attendant not found' });
    }
    const [rows] = await pool.execute(
      'SELECT id, attendance_id, name, mobile_number, is_archived, created_at FROM attendants WHERE id = ?',
      [id]
    );
    res.json({ attendant: { ...rows[0], name: normalizeName(rows[0].name) } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Attendance ID or mobile number already exists' });
    }
    console.error('Update attendant error:', error);
    res.status(500).json({ error: 'Failed to update attendant' });
  }
});

// Archive attendant (soft delete)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid attendant ID' });
    }
    const [result] = await pool.execute('UPDATE attendants SET is_archived = 1 WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Attendant not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Archive attendant error:', error);
    res.status(500).json({ error: 'Failed to archive attendant' });
  }
});

// Restore archived attendant
router.post('/:id/restore', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid attendant ID' });
    }
    const [result] = await pool.execute('UPDATE attendants SET is_archived = 0 WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Attendant not found' });
    }
    const [rows] = await pool.execute(
      'SELECT id, attendance_id, name, mobile_number, is_archived, created_at FROM attendants WHERE id = ?',
      [id]
    );
    res.json({ attendant: { ...rows[0], name: normalizeName(rows[0].name) } });
  } catch (error) {
    console.error('Restore attendant error:', error);
    res.status(500).json({ error: 'Failed to restore attendant' });
  }
});

module.exports = router;
